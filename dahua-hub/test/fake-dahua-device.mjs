import net from 'node:net';
import tls from 'node:tls';
import { verifyDigest } from '../src/devices/digest.mjs';
import { registrationRequest } from './helpers.mjs';

// Dahua simulado a nivel de protocolo para las pruebas del canal: se registra
// por Auto Register y luego atiende, sobre la misma conexión, el login Digest,
// las CGI con X-cgi-Token y el keep-alive, como el DHI-ASI6214S-PW real.
// secure: { ca } para conectarse con HTTPS (HTTPs activado en el Registro Automático CGI).
export function connectFakeDahua(port, { registrationId = 'PROP-0001', username = 'restblu_api', password = 'clave-123', secure = null } = {}) {
  const realm = 'Login to fake';
  const users = new Map();
  const cards = new Map();
  const state = { users, cards, doorOpenings: 0, logins: 0, keepAlives: 0, requests: [], requestBodyBytes: [], token: '', nonce: '' };
  let buffer = Buffer.alloc(0);
  let registered = false;
  let onRegistered;
  const ready = new Promise((resolve) => { onRegistered = resolve; });

  const register = () => socket.write(registrationRequest(registrationId, { deviceClass: 'DHI-ASI6214S-PW' }));
  const socket = secure
    ? tls.connect({ host: '127.0.0.1', port, servername: 'localhost', ca: secure.ca }, register)
    : net.connect({ host: '127.0.0.1', port }, register);
  state.tlsError = null;
  socket.on('error', (error) => { state.tlsError = error; });

  // Algunas respuestas sin Content-Length, como el equipo real.
  // state.delayMs: el equipo responde tarde (como por Internet lento).
  const respond = (status, reason, body = '', options = {}) => {
    if (state.delayMs) {
      setTimeout(() => sendResponse(status, reason, body, options), state.delayMs);
      return;
    }
    sendResponse(status, reason, body, options);
  };
  const sendResponse = (status, reason, body = '', { length = true } = {}) => {
    const headers = [`HTTP/1.1 ${status} ${reason}`, 'X-Frame-Options: SAMEORIGIN'];
    if (length) headers.push(`Content-Length: ${Buffer.byteLength(body)}`, 'Connection: keep-alive');
    else headers.push('CONNECTION: close', 'Content-type: text/plain;charset=utf-8');
    socket.write(`${headers.join('\r\n')}\r\n\r\n${body}`);
    // Como el equipo real: a veces manda un 404 sobrante, sin largo, pegado a la respuesta.
    if (state.strayAfterEachResponse && status !== 404) {
      socket.write('HTTP/1.1 404 Not Found\r\nCONNECTION: close\r\nCONTENT-TYPE: text/html\r\n\r\n');
    }
  };

  function handle({ method, target, headers, body }) {
    const url = new URL(target, 'http://dahua');
    const params = Object.fromEntries(url.searchParams);
    state.requests.push(`${method} ${url.pathname}${params.action ? `?action=${params.action}` : ''}`);
    state.requestBodyBytes.push(Buffer.byteLength(body));
    if (url.pathname === '/cgi-bin/api/global/login') {
      const user = headers.authorization && verifyDigest({ header: headers.authorization, password, method, realm, nonce: state.nonce });
      if (!user || user !== username) {
        state.nonce = String(Math.floor(Math.random() * 1e9));
        socket.write(`HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Digest realm="${realm}", qop="auth", nonce="${state.nonce}", opaque="abc", algorithm=MD5\r\nConnection: close\r\nCONTENT-LENGTH: 0\r\n\r\n`);
        return;
      }
      state.logins += 1;
      state.token = `tok${state.logins}`;
      return respond(200, 'OK', `{ "Token" : "${state.token}" }`);
    }
    if (!headers['x-cgi-token'] || headers['x-cgi-token'] !== state.token) return respond(500, 'Internal Server Error', '');
    if (url.pathname === '/cgi-bin/api/global/keep-alive') { state.keepAlives += 1; return respond(200, 'OK', ''); }
    if (url.pathname === '/cgi-bin/global.cgi') return respond(200, 'OK', 'result=2026-10-06 10:00:00\r\n', { length: false });
    if (url.pathname === '/cgi-bin/magicBox.cgi' && params.action === 'getSystemInfo') {
      return respond(200, 'OK', 'deviceType=DHI-ASI6214S-PW\r\nserialNumber=FAKE123\r\n', { length: false });
    }
    if (url.pathname === '/cgi-bin/magicBox.cgi') return respond(200, 'OK', 'version=3.003.0000000.4.R\r\n', { length: false });
    if (url.pathname === '/cgi-bin/AccessUser.cgi') {
      if (params.action === 'startFind') return respond(200, 'OK', JSON.stringify({ Token: 7, Total: users.has(params['Condition.UserID']) ? 1 : 0 }));
      if (params.action === 'stopFind') return respond(200, 'OK', 'OK\r\n');
      if (params.action === 'insertMulti' || params.action === 'updateMulti') {
        const user = JSON.parse(body).UserList[0];
        if (params.action === 'insertMulti' && users.has(user.UserID)) return respond(200, 'OK', 'Error\r\n');
        users.set(user.UserID, user);
        return respond(200, 'OK', 'OK\r\n');
      }
      if (params.action === 'removeMulti') { users.delete(params['UserIDList[0]']); return respond(200, 'OK', 'OK\r\n'); }
    }
    if (url.pathname === '/cgi-bin/AccessCard.cgi') {
      const card = JSON.parse(body).CardList[0];
      if (params.action === 'insertMulti' && cards.has(card.CardNo)) return respond(200, 'OK', 'Error\r\n');
      cards.set(card.CardNo, card);
      return respond(200, 'OK', 'OK\r\n');
    }
    if (url.pathname === '/cgi-bin/accessControl.cgi' && params.action === 'openDoor') { state.doorOpenings += 1; return respond(200, 'OK', 'OK\r\n'); }
    return respond(404, 'Not Found', '', { length: false });
  }

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length) {
      if (buffer.subarray(0, 5).toString('latin1') === 'HTTP/') {
        // Respuesta del hub a nuestro registro o heartbeat.
        const end = buffer.indexOf('\r\n\r\n');
        if (end === -1) return;
        buffer = buffer.subarray(end + 4);
        if (!registered) { registered = true; onRegistered(); }
        continue;
      }
      const end = buffer.indexOf('\r\n\r\n');
      if (end === -1) return;
      const [line, ...lines] = buffer.subarray(0, end).toString('latin1').split('\r\n');
      const headers = Object.fromEntries(lines.map((item) => [item.slice(0, item.indexOf(':')).toLowerCase(), item.slice(item.indexOf(':') + 1).trim()]));
      const length = Number(headers['content-length'] || 0);
      if (buffer.length < end + 4 + length) return;
      const body = buffer.subarray(end + 4, end + 4 + length).toString('utf8');
      buffer = buffer.subarray(end + 4 + length);
      const [method, target] = line.split(' ');
      handle({ method, target, headers, body });
    }
  });

  return {
    socket,
    state,
    ready,
    heartbeat: () => socket.write(registrationRequest(registrationId, { deviceClass: 'DHI-ASI6214S-PW' })),
    // El 404 suelto que el equipo real envía tras algunos heartbeats.
    stray404: () => respond(404, 'Not Found', '', { length: false }),
    close: () => socket.destroy(),
  };
}
