import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function loadManagerPassword(path, configured = '') {
  if (configured.trim()) {
    if (configured.trim().length < 32) throw new Error('RESTBLU_MANAGER_PASSWORD requiere al menos 32 caracteres.');
    return configured.trim();
  }
  mkdirSync(dirname(path), { recursive: true });
  try {
    const password = readFileSync(path, 'utf8').trim();
    if (password.length < 32) throw new Error('La clave del gestor es demasiado corta.');
    return password;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const password = randomBytes(32).toString('hex');
  try {
    writeFileSync(path, `${password}\n`, { flag: 'wx', mode: 0o600 });
    return password;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = readFileSync(path, 'utf8').trim();
    if (existing.length < 32) throw new Error('La clave del gestor es demasiado corta.');
    return existing;
  }
}

export function managerAuthorized(request, password) {
  const header = String(request.headers.authorization || '');
  if (!header.startsWith('Basic ')) return false;
  let decoded;
  try { decoded = Buffer.from(header.slice(6), 'base64').toString('utf8'); } catch { return false; }
  const separator = decoded.indexOf(':');
  if (separator < 0 || decoded.slice(0, separator) !== 'manager') return false;
  const given = Buffer.from(decoded.slice(separator + 1));
  const expected = Buffer.from(password);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function publicApiRequest(method, pathname, url) {
  if (method === 'GET' && pathname === '/api/health') return true;
  if (method === 'GET' && pathname === '/api/properties' && url.searchParams.get('includeInactive') !== '1') return true;
  if (method === 'POST' && pathname === '/api/public/reservations/lookup') return true;
  if (method === 'POST' && pathname === '/api/reservations') return true;
  if (method === 'GET' && pathname === '/api/my/reservations') return true;
  // La ruta exige su propio Bearer de Firebase y permisos de propietario.
  if (method === 'GET' && pathname === '/api/owner/dashboard') return true;
  if (method === 'POST' && pathname === '/api/ai/public-chat') return true;
  if (method === 'GET' && /^\/api\/reservations\/[^/]+\/verify$/.test(pathname)) return true;
  return false;
}
