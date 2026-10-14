import { digestAuthorization, parseDigestChallenge } from './digest.mjs';

// Canal de comandos hacia un Dahua conectado por Auto Register CGI. Sobre la
// misma conexión TCP que abrió el terminal, el hub actúa como cliente HTTP:
//
//   1. POST /cgi-bin/api/global/login con Digest  -> { "Token": "…" }
//   2. Cualquier CGI normal con la cabecera X-cgi-Token: <token>
//   3. POST /cgi-bin/api/global/keep-alive cada ~40 s para mantener la sesión
//
// Las peticiones van de a una (HTTP/1.1 sin pipelining). El terminal además
// reenvía su registro cada 30 s; el servidor TCP lo responde y avisa al canal
// para que espere un momento antes de enviar la siguiente petición.

const LOGIN_PATH = '/cgi-bin/api/global/login';
const KEEP_ALIVE_PATH = '/cgi-bin/api/global/keep-alive';
// Tras responder un heartbeat, el terminal a veces devuelve un 404 suelto.
const HEARTBEAT_QUIET_MS = 2_500;
// Respuestas sin Content-Length ni chunked: terminan cuando dejan de llegar datos.
const IDLE_END_MS = 300;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
// Las CGI normales siguen limitadas: el firmware ha respondido mal cuando se
// le envía un cuerpo grande de una sola vez por Auto Register.
export const MAX_REQUEST_BODY_BYTES = 4 * 1024;
// PhotoData admite una imagen JPEG de hasta 200 KB, codificada en base64.
// El JSON completo necesita margen para ese incremento de tamaño.
export const MAX_FACE_REQUEST_BODY_BYTES = 280 * 1024;
const FACE_WRITE_CHUNK_BYTES = 1024;
const FACE_WRITE_PAUSE_MS = 8;
// Antes de enviar una petición se espera a que el terminal deje de mandar
// respuestas sobrantes de la anterior.
const SETTLE_MS = 400;
const MAX_SETTLE_WAIT_MS = 3_000;

// Una respuesta sin Content-Length termina donde empieza la siguiente.
function nextStatusLine(buffer, from) {
  const index = buffer.indexOf('HTTP/1.', from, 'latin1');
  if (index === -1) return -1;
  if (index === from) return index;
  return buffer.subarray(index - 2, index).toString('latin1') === '\r\n' ? index : nextStatusLine(buffer, index + 1);
}

export class ChannelError extends Error {
  constructor(message, code = 'CHANNEL_ERROR') {
    super(message);
    this.code = code;
  }
}

function parseResponseHead(buffer) {
  const headerEnd = buffer.indexOf('\r\n\r\n');
  if (headerEnd === -1) return null;
  const [statusLine, ...lines] = buffer.subarray(0, headerEnd).toString('latin1').split('\r\n');
  const match = /^HTTP\/\d\.\d (\d{3})/.exec(statusLine);
  if (!match) throw new ChannelError(`Respuesta HTTP inválida del terminal: ${statusLine.slice(0, 80)}`, 'BAD_RESPONSE');
  const headers = {};
  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator > 0) headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
  }
  return { status: Number(match[1]), headers, bodyStart: headerEnd + 4 };
}

function decodeChunked(buffer, start) {
  const parts = [];
  let offset = start;
  while (true) {
    const lineEnd = buffer.indexOf('\r\n', offset);
    if (lineEnd === -1) return null;
    const size = Number.parseInt(buffer.subarray(offset, lineEnd).toString('latin1').split(';')[0], 16);
    if (!Number.isFinite(size)) throw new ChannelError('Bloque chunked inválido.', 'BAD_RESPONSE');
    if (size === 0) {
      const end = buffer.indexOf('\r\n\r\n', lineEnd);
      return end === -1 ? null : { body: Buffer.concat(parts), end: end + 4 };
    }
    if (buffer.length < lineEnd + 2 + size + 2) return null;
    parts.push(buffer.subarray(lineEnd + 2, lineEnd + 2 + size));
    offset = lineEnd + 2 + size + 2;
  }
}

export class DeviceChannel {
  #session;
  #username;
  #password;
  #logger;
  #queue = Promise.resolve();
  #pending = null;
  #token = '';
  #nonceCount = 0;
  #quietUntil = 0;
  #keepAliveTimer = null;
  #idleWaiters = [];
  #closed = false;
  #lastInboundAt = 0;
  #maxBodyBytes;

  constructor(session, { username, password, keepAliveMs = 40_000, maxBodyBytes = MAX_REQUEST_BODY_BYTES, logger = null }) {
    this.#session = session;
    this.#maxBodyBytes = maxBodyBytes;
    this.#username = username;
    this.#password = password;
    this.#logger = logger;
    if (keepAliveMs > 0) {
      this.#keepAliveTimer = setInterval(() => this.#keepAlive(), keepAliveMs);
      this.#keepAliveTimer.unref?.();
    }
  }

  get hasCredentials() { return Boolean(this.#username && this.#password); }
  get loggedIn() { return Boolean(this.#token); }
  // Hay una petición enviada esperando respuesta.
  get awaiting() { return Boolean(this.#pending); }
  // Ya empezó a llegar la respuesta (los bytes siguientes son parte de ella).
  get receiving() { return Boolean(this.#pending?.buffer.length); }

  // Llegaron datos del terminal que no son respuesta a nada (se descartan).
  noteInbound() {
    this.#lastInboundAt = Date.now();
  }

  noteHeartbeatReply() {
    this.#quietUntil = Date.now() + HEARTBEAT_QUIET_MS;
  }

  // Ejecuta fn cuando no haya una respuesta en curso (para no intercalar la
  // respuesta a un heartbeat en medio de un intercambio).
  whenIdle(fn) {
    if (!this.#pending) fn();
    else this.#idleWaiters.push(fn);
  }

  // Recibe bytes del terminal mientras se espera una respuesta. Devuelve lo que
  // sobra después de la respuesta (por ejemplo, un heartbeat pegado).
  feed(buffer) {
    const pending = this.#pending;
    if (!pending) return buffer;
    this.#lastInboundAt = Date.now();
    pending.buffer = Buffer.concat([pending.buffer, buffer]);
    if (pending.buffer.length > MAX_RESPONSE_BYTES) {
      this.#finish(new ChannelError('La respuesta del terminal excedió el límite.', 'BAD_RESPONSE'));
      return Buffer.alloc(0);
    }
    try {
      const head = parseResponseHead(pending.buffer);
      if (!head) return Buffer.alloc(0);
      const { status, headers, bodyStart } = head;
      const noBody = pending.method === 'HEAD' || status === 204 || status === 304 || status < 200;
      if (noBody || headers['content-length'] !== undefined) {
        const length = noBody ? 0 : Number.parseInt(headers['content-length'], 10) || 0;
        if (pending.buffer.length < bodyStart + length) return Buffer.alloc(0);
        const rest = pending.buffer.subarray(bodyStart + length);
        this.#finish(null, { status, headers, body: pending.buffer.subarray(bodyStart, bodyStart + length) });
        return rest;
      }
      if (/chunked/i.test(headers['transfer-encoding'] || '')) {
        const decoded = decodeChunked(pending.buffer, bodyStart);
        if (!decoded) return Buffer.alloc(0);
        const rest = pending.buffer.subarray(decoded.end);
        this.#finish(null, { status, headers, body: decoded.body });
        return rest;
      }
      const next = nextStatusLine(pending.buffer, bodyStart);
      if (next !== -1) {
        const rest = pending.buffer.subarray(next);
        this.#finish(null, { status, headers, body: pending.buffer.subarray(bodyStart, next) });
        return rest;
      }
      clearTimeout(pending.idleTimer);
      pending.idleTimer = setTimeout(() => {
        this.#finish(null, { status, headers, body: pending.buffer.subarray(bodyStart) });
      }, IDLE_END_MS);
      return Buffer.alloc(0);
    } catch (error) {
      this.#finish(error);
      return Buffer.alloc(0);
    }
  }

  close(reason = 'El terminal se desconectó.') {
    this.#closed = true;
    clearInterval(this.#keepAliveTimer);
    this.#token = '';
    if (this.#pending) this.#finish(new ChannelError(reason, 'DISCONNECTED'));
  }

  #finish(error, response) {
    const pending = this.#pending;
    if (!pending) return;
    this.#pending = null;
    clearTimeout(pending.timer);
    clearTimeout(pending.idleTimer);
    if (!error && !pending.sendingComplete) {
      error = new ChannelError('El terminal respondió antes de recibir la foto completa.', 'EARLY_RESPONSE');
      this.#reset('respuesta antes del fin de la foto');
    }
    if (error) pending.reject(error);
    else pending.resolve({ ...response, text: response.body.toString('utf8') });
    const waiters = this.#idleWaiters.splice(0);
    for (const waiter of waiters) waiter();
  }

  async #exchange({ method = 'GET', path, headers = {}, body = null, timeoutMs = 15_000, paced = false }) {
    if (this.#closed || this.#session.socket.destroyed) throw new ChannelError('El terminal no está conectado.', 'DISCONNECTED');
    const wait = this.#quietUntil - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    const settleStarted = Date.now();
    while (Date.now() - this.#lastInboundAt < SETTLE_MS && Date.now() - settleStarted < MAX_SETTLE_WAIT_MS) {
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    }
    const content = body === null || body === undefined ? Buffer.alloc(0) : Buffer.from(body);
    const allHeaders = {
      Host: 'dahua',
      Connection: 'keep-alive',
      ...(content.length ? { 'Content-Type': 'application/json' } : {}),
      'Content-Length': String(content.length),
      ...headers,
    };
    const head = `${method} ${path} HTTP/1.1\r\n${Object.entries(allHeaders).map(([name, value]) => `${name}: ${value}`).join('\r\n')}\r\n\r\n`;
    return new Promise((resolve, reject) => {
      this.#pending = {
        method,
        buffer: Buffer.alloc(0),
        sendingComplete: !paced,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.#finish(new ChannelError(`El terminal no respondió ${method} ${path.split('?')[0]} a tiempo.`, 'TIMEOUT'));
          // Si la respuesta llega tarde quedaría asignada a la petición siguiente.
          this.#reset(`sin respuesta a ${path.split('?')[0]}`);
        }, timeoutMs),
        idleTimer: null,
      };
      if (!paced) {
        this.#session.write(Buffer.concat([Buffer.from(head, 'latin1'), content]));
        return;
      }
      // Cada write crea un registro TLS pequeño. Esto evita mandar la foto en
      // un bloque que el firmware del ASI6214S-PW no procesa correctamente.
      this.#session.write(Buffer.from(head, 'latin1'));
      const sendBody = async () => {
        for (let offset = 0; offset < content.length; offset += FACE_WRITE_CHUNK_BYTES) {
          if (this.#pending?.resolve !== resolve || this.#session.socket.destroyed) return;
          this.#session.write(content.subarray(offset, offset + FACE_WRITE_CHUNK_BYTES));
          if (offset + FACE_WRITE_CHUNK_BYTES < content.length) {
            await new Promise((resume) => setTimeout(resume, FACE_WRITE_PAUSE_MS));
          }
        }
        if (this.#pending?.resolve === resolve) this.#pending.sendingComplete = true;
      };
      sendBody().catch((error) => {
        this.#finish(error);
        this.#reset('error enviando la foto');
      });
    });
  }

  // HTTP/1.1 sin identificadores: una respuesta perdida o tardía desfasa todas
  // las siguientes. Se corta la conexión y el terminal se vuelve a registrar
  // en unos segundos con el canal limpio.
  #reset(reason) {
    if (this.#closed || this.#session.socket.destroyed) return;
    this.#logger?.warn(`${this.#session.registrationId}: canal desfasado (${reason}); se reinicia la conexión.`);
    this.#session.closeReason = `canal reiniciado: ${reason}`;
    this.#token = '';
    this.#session.socket.destroy();
  }

  // Serializa operaciones completas (login + petición + reintento).
  #enqueue(task) {
    const run = this.#queue.then(task, task);
    this.#queue = run.catch(() => {});
    return run;
  }

  async #login() {
    if (!this.hasCredentials) throw new ChannelError('Falta la cuenta CGI del terminal (DAHUA_HUB_DEVICE_USERNAME / _PASSWORD).', 'NO_CREDENTIALS');
    const body = '{}';
    const first = await this.#exchange({ method: 'POST', path: LOGIN_PATH, body });
    let response = first;
    if (first.status === 401) {
      const challenge = parseDigestChallenge(first.headers['www-authenticate']);
      if (!challenge) throw new ChannelError('El terminal no entregó un desafío Digest para el login.', 'LOGIN_FAILED');
      response = await this.#exchange({
        method: 'POST',
        path: LOGIN_PATH,
        body,
        headers: {
          Authorization: digestAuthorization({
            challenge, username: this.#username, password: this.#password, method: 'POST', uri: LOGIN_PATH, nonceCount: ++this.#nonceCount,
          }),
        },
      });
    }
    if (response.status === 401) throw new ChannelError('El terminal rechazó usuario o contraseña del login CGI.', 'LOGIN_FAILED');
    let token = '';
    try { token = JSON.parse(response.text).Token || ''; } catch { /* sin JSON */ }
    if (response.status !== 200 || !token) {
      this.#reset('respuesta inesperada al login');
      throw new ChannelError(`Login CGI fallido (HTTP ${response.status}): ${response.text.slice(0, 200)}`, 'LOGIN_FAILED');
    }
    this.#token = token;
    this.#logger?.info(`${this.#session.registrationId}: sesión CGI iniciada.`);
  }

  // Envía una CGI con el token de sesión; inicia sesión si hace falta y la
  // renueva una vez si el terminal la da por vencida.
  cgi({ method = 'GET', path, params = {}, json, timeoutMs = 15_000 }) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') query.append(key, String(value));
    }
    const target = query.size ? `${path}?${query}` : path;
    const body = json === undefined ? null : JSON.stringify(json);
    const hasPhoto = (Array.isArray(json?.FaceList) && json.FaceList.some((face) => Array.isArray(face?.PhotoData) && face.PhotoData.length > 0))
      || (Array.isArray(json?.Info?.PhotoData) && json.Info.PhotoData.length > 0);
    const facePhoto = method === 'POST' && (
      (path === '/cgi-bin/AccessFace.cgi' && ['insertMulti', 'updateMulti'].includes(params.action)) ||
      (path === '/cgi-bin/FaceInfoManager.cgi' && ['add', 'update'].includes(params.action))
    ) && hasPhoto;
    const maxBodyBytes = facePhoto ? MAX_FACE_REQUEST_BODY_BYTES : this.#maxBodyBytes;
    if (body && Buffer.byteLength(body) > maxBodyBytes) {
      return Promise.reject(new ChannelError(
        `La petición pesa ${Math.round(Buffer.byteLength(body) / 1024)} KB y supera el límite de ${Math.round(maxBodyBytes / 1024)} KB del canal del terminal.`,
        'BODY_TOO_LARGE',
      ));
    }
    return this.#enqueue(async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (!this.#token) await this.#login();
        const response = await this.#exchange({ method, path: target, body, timeoutMs, paced: Boolean(facePhoto && Buffer.byteLength(body) > this.#maxBodyBytes), headers: { 'X-cgi-Token': this.#token } });
        // Token vencido: 401, o 500 sin cuerpo (lo que responde a un token inválido).
        const expired = response.status === 401 || (response.status === 500 && !response.body.length);
        if (!expired) return response;
        this.#token = '';
      }
      throw new ChannelError('El terminal rechazó la sesión CGI.', 'LOGIN_FAILED');
    });
  }

  #keepAlive() {
    if (!this.#token || this.#pending || this.#closed) return;
    this.#enqueue(async () => {
      if (!this.#token) return;
      const response = await this.#exchange({
        method: 'POST', path: KEEP_ALIVE_PATH, body: JSON.stringify({ timeout: 60, active: true }),
        headers: { 'X-cgi-Token': this.#token },
      });
      if (response.status !== 200) this.#token = '';
    }).catch((error) => {
      this.#token = '';
      this.#logger?.warn(`${this.#session.registrationId}: keep-alive fallido (${error.message}).`);
    });
  }
}
