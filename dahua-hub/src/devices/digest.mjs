import crypto from 'node:crypto';

// Autenticación HTTP Digest (MD5, qop=auth), la que usa Dahua para el login.

const md5 = (value) => crypto.createHash('md5').update(value).digest('hex');

export function parseDigestChallenge(header = '') {
  const match = /^\s*Digest\s+/i.exec(header);
  if (!match) return null;
  const values = {};
  const pattern = /([\w-]+)\s*=\s*(?:"([^"]*)"|([^,\s]+))/g;
  let part;
  while ((part = pattern.exec(header.slice(match[0].length)))) values[part[1].toLowerCase()] = part[2] ?? part[3];
  return values.realm && values.nonce ? values : null;
}

export function digestAuthorization({ challenge, username, password, method, uri, nonceCount = 1 }) {
  const algorithm = (challenge.algorithm || 'MD5').toUpperCase();
  if (algorithm !== 'MD5' && algorithm !== 'MD5-SESS') throw new Error(`Algoritmo Digest no soportado: ${algorithm}`);
  const qops = String(challenge.qop || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  const qop = qops.includes('auth') ? 'auth' : '';
  if (qops.length && !qop) throw new Error('El terminal exige un modo Digest no compatible (se requiere qop=auth).');
  const cnonce = crypto.randomBytes(12).toString('hex');
  const nc = nonceCount.toString(16).padStart(8, '0');
  let ha1 = md5(`${username}:${challenge.realm}:${password}`);
  if (algorithm === 'MD5-SESS') ha1 = md5(`${ha1}:${challenge.nonce}:${cnonce}`);
  const ha2 = md5(`${method}:${uri}`);
  const response = qop
    ? md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${challenge.nonce}:${ha2}`);
  const quote = (value) => String(value).replaceAll('"', '\\"');
  const parts = [
    `username="${quote(username)}"`, `realm="${quote(challenge.realm)}"`, `nonce="${quote(challenge.nonce)}"`,
    `uri="${quote(uri)}"`, `response="${response}"`, `algorithm=${algorithm}`,
  ];
  if (challenge.opaque) parts.push(`opaque="${quote(challenge.opaque)}"`);
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  return `Digest ${parts.join(', ')}`;
}

// Calcula la respuesta esperada; lo usa el terminal simulado de las pruebas.
export function verifyDigest({ header, password, method, realm, nonce }) {
  const values = {};
  const pattern = /([\w-]+)\s*=\s*(?:"([^"]*)"|([^,\s]+))/g;
  let part;
  while ((part = pattern.exec(String(header).replace(/^\s*Digest\s+/i, '')))) values[part[1].toLowerCase()] = part[2] ?? part[3];
  if (values.realm !== realm || values.nonce !== nonce) return null;
  const ha1 = md5(`${values.username}:${realm}:${password}`);
  const ha2 = md5(`${method}:${values.uri}`);
  const expected = values.qop
    ? md5(`${ha1}:${nonce}:${values.nc}:${values.cnonce}:${values.qop}:${ha2}`)
    : md5(`${ha1}:${nonce}:${ha2}`);
  return expected === values.response ? values.username : null;
}
