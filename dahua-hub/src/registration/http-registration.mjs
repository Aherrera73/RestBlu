// Auto Register de Dahua en modo CGI: el terminal abre una conexión TCP hacia
// el servidor y, sobre ella, envía una petición HTTP como
//
//   POST /cgi-bin/api/autoRegist/connect HTTP/1.1
//   Content-Type: application/json
//   Content-Length: 72
//
//   {"DevClass":"AccessControl","DeviceID":"PROP-0001","ServerIP":"x.x.x.x"}
//
// El servidor responde 200 y desde entonces usa esa misma conexión para
// enviarle comandos CGI. Según el firmware, el identificador puede venir en el
// cuerpo, en la URL o en una cabecera; se aceptan todas esas variantes.

export const MAX_REQUEST_BYTES = 64 * 1024;
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'HEAD', 'OPTIONS', 'DELETE', 'PATCH'];
export const REGISTRATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export class ProtocolError extends Error {
  constructor(message, code = 'PROTOCOLO_INVALIDO') {
    super(message);
    this.code = code;
  }
}

// Indica si los primeros bytes pueden ser HTTP. El protocolo privado de Dahua
// es binario y empieza de otra forma.
export function looksLikeHttp(buffer) {
  const start = buffer.subarray(0, 8).toString('latin1');
  // Con pocos bytes recibidos basta con que sean el comienzo de un método.
  return HTTP_METHODS.some((method) => {
    const prefix = `${method} `;
    return start.length >= prefix.length ? start.startsWith(prefix) : prefix.startsWith(start);
  });
}

// Devuelve null si todavía faltan bytes; si no, la petición y lo que sobra.
export function parseHttpRequest(buffer) {
  if (!looksLikeHttp(buffer)) {
    throw new ProtocolError(
      `La conexión no habla HTTP (¿Auto Register en modo privado?). Primeros bytes: ${buffer.subarray(0, 16).toString('hex')}`,
      'PROTOCOLO_NO_HTTP',
    );
  }
  const headerEnd = buffer.indexOf('\r\n\r\n');
  if (headerEnd === -1) {
    if (buffer.length > MAX_REQUEST_BYTES) throw new ProtocolError('Cabeceras HTTP demasiado largas.');
    return null;
  }
  const [requestLine, ...headerLines] = buffer.subarray(0, headerEnd).toString('latin1').split('\r\n');
  const match = /^([A-Z]+) (\S+) HTTP\/(\d\.\d)$/.exec(requestLine);
  if (!match) throw new ProtocolError(`Línea de petición inválida: ${requestLine.slice(0, 120)}`);
  const headers = {};
  for (const line of headerLines) {
    const separator = line.indexOf(':');
    if (separator > 0) headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
  }
  const length = Number.parseInt(headers['content-length'] || '0', 10);
  if (!Number.isFinite(length) || length < 0 || length > MAX_REQUEST_BYTES) {
    throw new ProtocolError('Content-Length inválido.');
  }
  const bodyStart = headerEnd + 4;
  if (buffer.length < bodyStart + length) return null;
  return {
    request: {
      method: match[1],
      target: match[2],
      httpVersion: match[3],
      headers,
      body: buffer.subarray(bodyStart, bodyStart + length).toString('utf8'),
    },
    rest: buffer.subarray(bodyStart + length),
  };
}

function pick(object, names) {
  if (!object || typeof object !== 'object') return '';
  const lower = Object.fromEntries(Object.entries(object).map(([key, value]) => [key.toLowerCase(), value]));
  for (const name of names) {
    const value = lower[name.toLowerCase()];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

const ID_FIELDS = ['DeviceID', 'DeviceId', 'RegisterID', 'RegistrationID', 'DevID', 'ID'];

// Extrae los datos del registro: identificador, clase de equipo e IP que el
// terminal cree tener configurada como servidor.
export function readRegistration(request) {
  let body = {};
  if (request.body.trim()) {
    try {
      body = JSON.parse(request.body);
    } catch {
      body = Object.fromEntries(new URLSearchParams(request.body));
    }
  }
  const params = Object.fromEntries(new URL(request.target, 'http://registro.local').searchParams);
  const registrationId = pick(body, ID_FIELDS) || pick(params, ID_FIELDS)
    || pick(request.headers, ['x-device-id', 'x-registration-id', 'deviceid']);
  if (!registrationId) throw new ProtocolError('El registro no trae Registration ID (DeviceID).', 'SIN_REGISTRATION_ID');
  if (!REGISTRATION_ID_PATTERN.test(registrationId)) {
    throw new ProtocolError(`Registration ID inválido: ${registrationId.slice(0, 80)}`, 'REGISTRATION_ID_INVALIDO');
  }
  return {
    registrationId,
    deviceClass: pick(body, ['DevClass', 'DeviceClass']) || pick(params, ['DevClass', 'DeviceClass']),
    serverIp: pick(body, ['ServerIP']) || pick(params, ['ServerIP']),
    path: request.target.split('?')[0],
  };
}

export function httpResponse(status, reason, body = '', extraHeaders = {}) {
  const content = Buffer.from(body, 'utf8');
  const headers = {
    'Content-Length': String(content.length),
    Connection: 'keep-alive',
    ...(content.length ? { 'Content-Type': 'application/json' } : {}),
    ...extraHeaders,
  };
  const head = [`HTTP/1.1 ${status} ${reason}`, ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`)].join('\r\n');
  return Buffer.concat([Buffer.from(`${head}\r\n\r\n`, 'latin1'), content]);
}
