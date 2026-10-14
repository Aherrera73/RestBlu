import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_ATTEMPTS, checkVerificationCode, hashVerificationCode, newVerificationCode,
} from '../src/accounts/verification-code.mjs';

test('el código de verificación es de 6 dígitos y se valida por su hash', () => {
  const code = newVerificationCode();
  assert.match(code, /^\d{6}$/);
  const record = { hash: hashVerificationCode('uid-1', code), expiresAt: new Date(Date.now() + 60_000).toISOString(), attempts: 0 };
  assert.equal(checkVerificationCode(record, 'uid-1', code), 'ok');
  assert.equal(checkVerificationCode(record, 'uid-2', code), 'invalid', 'el hash depende de la cuenta');
  assert.equal(checkVerificationCode(record, 'uid-1', code === '000000' ? '111111' : '000000'), 'invalid');
  assert.equal(checkVerificationCode({ ...record, expiresAt: '2020-01-01T00:00:00Z' }, 'uid-1', code), 'expired');
  assert.equal(checkVerificationCode({ ...record, attempts: MAX_ATTEMPTS }, 'uid-1', code), 'locked');
  assert.equal(checkVerificationCode(null, 'uid-1', code), 'missing');
});
