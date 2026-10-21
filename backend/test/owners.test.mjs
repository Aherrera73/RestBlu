import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { createLocalDatabase } from '../src/database/local-database.mjs';
import { OwnerError, ownerDashboard, ownerFirebaseUser, ownerFromInput, verifiedOwnerIdentity } from '../src/owners/owner-service.mjs';
import { publicApiRequest } from '../src/server/manager-auth.mjs';

const properties = [1, 2].map((id) => ({ id, name: `Casa ${id}`, place: 'Chile', type: 'Casa', image: 'image.jpg',
  price: 10000, rating: 4.7, active: true, gallery: [], tags: [], ownerName: 'Titular',
  ownerEmail: 'private@example.test', ownerPhone: '+56911111111', ownerDocumentId: '11.111.111-1',
  dahuaRegistrationId: 'SECRET-TERMINAL', guidePrivate: 'WiFi secret' }));
const input = { name: 'Propietaria A', email: 'owner-a@example.test', phone: '+56912345678', active: true, propertyIds: ['1'] };
const identity = { uid: 'firebase-a', email: input.email };
const owner = { ...ownerFromInput(input, { properties }), uid: identity.uid };

test('el alta valida asignaciones y conserva UID/correo sólo del servidor', () => {
  assert.deepEqual(owner.propertyIds, [1]);
  assert.equal(ownerFromInput({ ...input, uid: 'attacker' }, { properties }).uid, '');
  assert.throws(() => ownerFromInput({ ...input, email: 'bad' }, { properties }), OwnerError);
  assert.throws(() => ownerFromInput({ ...input, active: 'true' }, { properties }), OwnerError);
  for (const propertyIds of [['1x'], [-1], [1.5], [3], null]) {
    assert.throws(() => ownerFromInput({ ...input, propertyIds }, { properties }), OwnerError);
  }
  assert.throws(() => ownerFromInput({ ...input, email: 'other@example.test' }, { existing: owner, properties }), /no se puede cambiar/);
  assert.throws(() => ownerFromInput(input, { properties, owners: [owner] }), (error) => error.status === 409);
  assert.throws(() => ownerFromInput({ ...input, email: 'owner-b@example.test' }, { properties, owners: [owner] }), (error) => error.status === 409);
  const updated = ownerFromInput({ ...input, propertyIds: ['2', 2], uid: 'attacker' }, { properties, owners: [owner], existing: owner });
  assert.equal(updated.uid, identity.uid);
  assert.deepEqual(updated.propertyIds, [2]);
});

test('la cuenta se vincula por Firebase o se crea sin contraseña y sin enviar correos', async () => {
  const existing = { uid: identity.uid, email: input.email, disabled: false };
  assert.equal(await ownerFirebaseUser({ getUserByEmail: async () => existing }, { ...owner, uid: '' }), existing);
  let created;
  const fresh = await ownerFirebaseUser({
    getUserByEmail: async () => { throw { code: 'auth/user-not-found' }; },
    createUser: async (value) => { created = value; return existing; },
  }, { ...owner, uid: '' });
  assert.equal(fresh.uid, identity.uid);
  assert.deepEqual(created, { email: input.email, displayName: input.name, emailVerified: false });
  await assert.rejects(() => ownerFirebaseUser({ getUser: async () => ({ ...existing, disabled: true }) }, owner), (error) => error.status === 409);
  await assert.rejects(() => ownerFirebaseUser({ getUser: async () => ({ ...existing, email: 'changed@example.test' }) }, owner), (error) => error.status === 409);
});

test('el panel exige token vigente y correo verificado actual; revocados y deshabilitados no entran', async () => {
  const account = { uid: identity.uid, email: identity.email, emailVerified: true, disabled: false };
  let checkRevoked;
  const auth = {
    verifyIdToken: async (_token, revoked) => { checkRevoked = revoked; return { uid: identity.uid, email: identity.email, email_verified: true }; },
    getUser: async () => account,
  };
  assert.deepEqual(await verifiedOwnerIdentity(auth, 'valid-token'), identity);
  assert.equal(checkRevoked, true);
  await assert.rejects(() => verifiedOwnerIdentity(auth, ''), (error) => error.status === 401);
  for (const change of [{ disabled: true }, { emailVerified: false }, { email: 'changed@example.test' }]) {
    await assert.rejects(() => verifiedOwnerIdentity({ ...auth, getUser: async () => ({ ...account, ...change }) }, 'valid'), (error) => error.status === 401);
  }
  await assert.rejects(() => verifiedOwnerIdentity({ ...auth, verifyIdToken: async () => { throw new Error('revoked'); } }, 'revoked'), (error) => error.status === 401);
});

test('cada titular sólo ve sus propiedades y reservas, sin secretos de acceso o pagos', () => {
  const reservation = { id: 'RB-A', propertyId: 1, propertyName: 'Casa 1', guestName: 'Huésped A',
    ownerUid: 'guest-uid', guestEmail: 'secret@example.test', guestDocumentId: '11.111.111-1', accessPin: '654321',
    paymentToken: 'PAYMENT-SECRET', biometricTemplateEncrypted: 'BIOMETRY', dahuaQrCode: 'PRIVATEQR',
    checkIn: '2026-11-01', checkOut: '2026-11-03', nights: 2, total: 20000, paymentStatus: 'aprobado-demo', status: 'confirmada' };
  const database = { properties, reservations: [reservation, { ...reservation, id: 'RB-B', propertyId: 2, ownerUid: identity.uid }] };
  const dashboard = ownerDashboard(database, [owner], identity);
  assert.deepEqual(dashboard.properties.map((item) => item.id), [1]);
  assert.deepEqual(dashboard.reservations.map((item) => item.id), ['RB-A']);
  for (const secret of ['654321', 'PAYMENT-SECRET', 'BIOMETRY', 'PRIVATEQR', 'secret@example.test', 'guest-uid', 'SECRET-TERMINAL', 'WiFi secret']) {
    assert.equal(JSON.stringify(dashboard).includes(secret), false, `no debe devolver ${secret}`);
  }
  assert.throws(() => ownerDashboard(database, [owner], { ...identity, uid: 'guest-uid' }), (error) => error.status === 403);
  assert.throws(() => ownerDashboard(database, [{ ...owner, active: false }], identity), (error) => error.status === 403);
  assert.equal(publicApiRequest('GET', '/api/owner/dashboard', new URL('http://localhost/api/owner/dashboard')), true);
  for (const [method, path] of [['GET', '/api/admin/owners'], ['POST', '/api/admin/owners'], ['PUT', `/api/admin/owners/${owner.id}`]]) {
    assert.equal(publicApiRequest(method, path, new URL(`http://localhost${path}`)), false);
  }
});

test('SQLite persiste propietarios, revoca asignaciones y rechaza conflictos sin perder datos', () => {
  const folder = mkdtempSync(join(tmpdir(), 'restblu-owner-db-'));
  const options = { databasePath: join(folder, 'owners.sqlite'), legacyJsonPath: join(folder, 'missing.json'), schemaPath: resolve(import.meta.dirname, '../src/database/schema.sql') };
  let db = createLocalDatabase(options);
  try {
    const data = db.readDatabase();
    data.properties.push(...properties);
    db.saveDatabase(data);
    db.saveOwner(owner);
    // Un guardado de reservas/propiedades no borra el registro independiente.
    data.properties[0].price = 12000;
    db.saveDatabase(data);
    const second = { ...owner, id: 'owner-b', uid: 'firebase-b', email: 'owner-b@example.test', propertyIds: [1] };
    assert.throws(() => db.saveOwner(second), (error) => error.status === 409);
    assert.equal(db.listOwners().length, 1);
    assert.deepEqual(db.listOwners()[0].propertyIds, [1]);
    db.saveOwner({ ...owner, active: false, propertyIds: [] });
    db.saveOwner(second);
    db.close();
    db = createLocalDatabase(options);
    const rows = db.listOwners();
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.find((item) => item.id === owner.id).propertyIds, []);
    assert.equal(rows.find((item) => item.id === owner.id).active, false);
    assert.deepEqual(rows.find((item) => item.id === second.id).propertyIds, [1]);
    assert.equal(db.readDatabase().properties[0].price, 12000);
  } finally {
    db.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
