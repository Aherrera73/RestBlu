import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

// Código de 6 dígitos para verificar el correo de una cuenta RestBlu. Sólo se
// guarda su hash, con vencimiento y número de intentos.

export const CODE_TTL_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 5;
export const RESEND_INTERVAL_MS = 60_000;

export function newVerificationCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashVerificationCode(uid, code) {
  return createHash('sha256').update(`${uid}:${code}`).digest('hex');
}

// Resultado: 'ok' | 'expired' | 'locked' | 'invalid' | 'missing'.
export function checkVerificationCode(record, uid, code, now = Date.now()) {
  if (!record?.hash) return 'missing';
  if (Number(record.attempts || 0) >= MAX_ATTEMPTS) return 'locked';
  if (!(Date.parse(record.expiresAt) > now)) return 'expired';
  if (!/^\d{6}$/.test(String(code || ''))) return 'invalid';
  const expected = Buffer.from(record.hash, 'hex');
  const actual = Buffer.from(hashVerificationCode(uid, code), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? 'ok' : 'invalid';
}
