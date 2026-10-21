import assert from 'node:assert/strict';
import { test } from 'node:test';
import { firebaseIdentityUrl, firebaseTokenUrl } from '../modules/public-site/services/firebase-auth-endpoints.ts';

test('en desarrollo las cuentas y su renovación usan el mismo origen', () => {
  assert.equal(firebaseIdentityUrl('accounts:signInWithPassword', 'public-key', true), '/__restblu/firebase/identity/accounts:signInWithPassword?key=public-key');
  assert.equal(firebaseTokenUrl('public-key', true), '/__restblu/firebase/token?key=public-key');
});

test('en producción el acceso sigue dirigido a los servicios oficiales de Firebase', () => {
  assert.equal(firebaseIdentityUrl('accounts:signInWithPassword', 'public-key'), 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=public-key');
  assert.equal(firebaseTokenUrl('public-key'), 'https://securetoken.googleapis.com/v1/token?key=public-key');
});

test('la ruta no acepta destinos arbitrarios ni inyección de parámetros', () => {
  for (const action of ['https://example.test', '../accounts:signUp', 'accounts:signInWithPassword/other', 'accounts:signUp?key=other']) {
    assert.throws(() => firebaseIdentityUrl(action, 'key', true));
  }
  assert.ok(firebaseIdentityUrl('accounts:sendOobCode', 'key&other=1', true).endsWith('key=key%26other%3D1'));
});
