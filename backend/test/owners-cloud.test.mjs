import assert from 'node:assert/strict';
import { test } from 'node:test';
import { processOwnerDashboardRequests } from '../src/owners/cloud-owner-dashboard.mjs';

const now = Date.parse('2026-10-21T12:00:00Z');
const owners = [
  { id: 'a', uid: 'uid-a', name: 'Titular A', email: 'a@example.test', phone: '', active: true, propertyIds: [1] },
  { id: 'b', uid: 'uid-b', name: 'Titular B', email: 'b@example.test', phone: '', active: true, propertyIds: [2] },
];
const database = {
  properties: [1, 2].map((id) => ({ id, name: `Casa ${id}`, place: 'Chile', active: true, price: 100 })),
  reservations: [1, 2].map((propertyId) => ({ id: `RB-${propertyId}`, propertyId, propertyName: `Casa ${propertyId}`, guestName: 'Visita', accessPin: 'SECRET-PIN' })),
};
const request = (ownerUid, changes = {}) => ({ ownerUid, authTime: now / 1000 - 60, createdAt: new Date(now - 1000).toISOString(), ...changes });

async function process(inputs, { currentOwners = owners, userChanges = {} } = {}) {
  const results = [];
  const usersRead = [];
  const docs = inputs.map((input, index) => ({ data: () => input, ref: { set: async (result) => { results[index] = result; } } }));
  const query = { where: () => query, limit: () => query, get: async () => ({ empty: !docs.length, docs }) };
  await processOwnerDashboardRequests({ collection: () => query }, {
    now: () => now, readDatabase: async () => database, listOwners: async () => currentOwners,
    auth: { getUser: async (uid) => {
      usersRead.push(uid);
      return { uid, email: `${uid.slice(-1)}@example.test`, emailVerified: true, disabled: false, ...userChanges };
    } },
  });
  return { results, usersRead };
}

test('el puente de propietarios separa datos y no devuelve claves de acceso', async () => {
  const { results } = await process([request('uid-a'), request('uid-b')]);
  assert.equal(results[0].syncStatus, 'processed');
  assert.deepEqual(results[0].dashboard.properties.map((item) => item.id), [1]);
  assert.deepEqual(results[1].dashboard.reservations.map((item) => item.propertyId), [2]);
  assert.equal(JSON.stringify(results).includes('SECRET-PIN'), false);
});

test('rechaza roles ausentes, desactivados, cuentas sin verificar y sesiones revocadas', async () => {
  const unknown = await process([request('guest')]);
  assert.equal(unknown.results[0].status, 403);
  assert.deepEqual(unknown.usersRead, []);
  const inactive = await process([request('uid-a')], { currentOwners: [{ ...owners[0], active: false }] });
  assert.equal(inactive.results[0].status, 403);
  for (const userChanges of [
    { disabled: true }, { emailVerified: false }, { email: 'other@example.test' },
    { tokensValidAfterTime: new Date(now - 30_000).toISOString() },
  ]) {
    const { results } = await process([request('uid-a')], { userChanges });
    assert.equal(results[0].syncStatus, 'error');
    assert.equal('dashboard' in results[0], false);
  }
});

test('no procesa solicitudes caducadas, fechas inválidas o authTime ausente', async () => {
  const { results, usersRead } = await process([
    request('uid-a', { createdAt: new Date(now - 121_000).toISOString() }),
    request('uid-a', { createdAt: 'invalid' }),
    request('uid-a', { authTime: undefined }),
  ]);
  assert.ok(results.every((result) => result.status === 401));
  assert.deepEqual(usersRead, []);
});
