import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createLocalDatabase } from '../src/database/local-database.mjs';

const root = resolve(import.meta.dirname, '..');
const project = 'demo-restblu-owners';
const managerPassword = 'owners-http-manager-test-0123456789abcdef';

function accountToken(uid, email) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
    iss: `https://securetoken.google.com/${project}`, aud: project, auth_time: now - 10,
    iat: now - 10, exp: now + 3600, sub: uid, user_id: uid, email, email_verified: true,
    firebase: { identities: { email: [email] }, sign_in_provider: 'password' },
  })}.`;
}

test('HTTP: gestor registra y revoca propietarios, cada cuenta sólo obtiene sus datos', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'restblu-owners-http-'));
  const databasePath = join(folder, 'owners.sqlite');
  const configPath = join(folder, 'isolated.env');
  await writeFile(configPath, 'SMTP_HOST=127.0.0.1\nSMTP_PORT=1\nSMTP_USER=test\nSMTP_PASS=test\n', 'utf8');
  const db = createLocalDatabase({ databasePath, legacyJsonPath: join(folder, 'missing.json'), schemaPath: join(root, 'src/database/schema.sql') });
  const data = db.readDatabase();
  data.properties.push(...[1, 2].map((id) => ({ id, name: `Casa ${id}`, place: 'Chile', type: 'Casa', image: 'image.jpg',
    price: 10000, active: true, gallery: [], tags: [], ownerName: 'Titular',
    ownerEmail: 'private@example.test', ownerPhone: '11111111', ownerDocumentId: '11.111.111-1' })));
  data.customers.push({ id: 1, name: 'Huésped', email: 'guest@example.test', documentId: '12.345.678-5', phone: '12345678' });
  data.reservations.push(...[1, 2].map((propertyId) => ({ id: `RB-HTTP-OWNER-${propertyId}`, customerId: 1, propertyId,
    propertyName: `Casa ${propertyId}`, guestName: 'Huésped', guestEmail: 'guest-private@example.test',
    guestDocumentId: '12.345.678-5', accessPin: 'SECRET-PIN', dahuaQrCode: 'PRIVATE-QR', ownerUid: 'firebase-guest',
    paymentToken: 'PRIVATE-PAYMENT-TOKEN', checkIn: '2027-01-01', checkOut: '2027-01-03',
    nights: 2, guests: 1, total: 20000, status: 'pendiente-verificacion', expiresAt: '2028-01-01T00:00:00Z' })));
  db.saveDatabase(data);
  db.close();

  const users = ['a', 'b', 'guest'].map((letter) => ({ localId: `firebase-${letter}`, email: `${letter}@example.test`,
    emailVerified: true, disabled: false, validSince: '0', providerUserInfo: [{ providerId: 'password', rawId: `${letter}@example.test`, email: `${letter}@example.test` }] }));
  const authRequests = [];
  const authEmulator = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      const input = JSON.parse(body || '{}');
      authRequests.push({ path: request.url, input });
      const found = users.filter((user) => input.localId?.includes(user.localId) || input.email?.includes(user.email));
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ users: found }));
    });
  });
  await new Promise((done) => authEmulator.listen(0, '127.0.0.1', done));
  const probe = createServer();
  await new Promise((done) => probe.listen(0, '127.0.0.1', done));
  const port = probe.address().port;
  await new Promise((done) => probe.close(done));
  const server = spawn(process.execPath, ['server.mjs'], { cwd: root, stdio: 'ignore', env: {
    ...process.env, RESTBLU_ADMIN_PORT: String(port), RESTBLU_MANAGER_PASSWORD: managerPassword,
    RESTBLU_DB_ENGINE: 'sqlite', RESTBLU_DB_PATH: databasePath, RESTBLU_ENV_PATH: configPath,
    FIREBASE_SERVICE_ACCOUNT_PATH: join(folder, 'no-firebase.json'),
    FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${authEmulator.address().port}`, RESTBLU_FIREBASE_EMULATOR_PROJECT: project,
    DAHUA_RESERVATION_SYNC: '0', AI_KEEP_WARM: '0', SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '',
  } });
  const api = (path, { method = 'GET', body, account, manager = false } = {}) => fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(manager ? { Authorization: `Basic ${Buffer.from(`manager:${managerPassword}`).toString('base64')}` } : {}),
      ...(account ? { Authorization: `Bearer ${accountToken(`firebase-${account}`, `${account}@example.test`)}` } : {}),
    }, body: body ? JSON.stringify(body) : undefined,
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      try { if ((await api('/api/health')).ok) { ready = true; break; } } catch {}
      if (server.exitCode !== null) break;
      await delay(100);
    }
    assert.ok(ready, 'inicia el servidor aislado');
    assert.equal((await api('/api/admin/owners')).status, 401);
    assert.equal((await api('/api/admin/owners', { account: 'a' })).status, 401);
    assert.equal((await api('/api/owner/dashboard')).status, 401);
    const unassigned = await api('/api/owner/dashboard', { account: 'guest' });
    assert.equal(unassigned.status, 403, JSON.stringify({ requests: authRequests, response: await unassigned.clone().json() }));
    const createOwner = (letter, propertyIds) => api('/api/admin/owners', { manager: true, method: 'POST',
      body: { name: `Propietario ${letter}`, email: `${letter}@example.test`, phone: '', active: true, propertyIds, uid: 'attacker' } });
    const createdA = await createOwner('a', [1]);
    assert.equal(createdA.status, 201, JSON.stringify(await createdA.clone().json()));
    const { owner: a } = await createdA.json();
    assert.equal(a.uid, 'firebase-a');
    assert.equal((await createOwner('b', [1])).status, 409);
    assert.equal((await createOwner('b', [2])).status, 201);
    const aResponse = await api('/api/owner/dashboard?uid=firebase-b', { account: 'a' });
    assert.equal(aResponse.status, 200);
    assert.equal(aResponse.headers.get('cache-control'), 'no-store');
    const aDashboard = await aResponse.json();
    assert.deepEqual(aDashboard.properties.map((item) => item.id), [1]);
    assert.deepEqual(aDashboard.reservations.map((item) => item.propertyId), [1]);
    const bDashboard = await (await api('/api/owner/dashboard', { account: 'b' })).json();
    assert.deepEqual(bDashboard.properties.map((item) => item.id), [2]);
    for (const secret of ['SECRET-PIN', 'PRIVATE-QR', 'PRIVATE-PAYMENT-TOKEN', 'guest-private@example.test', '12.345.678-5', 'firebase-guest']) {
      assert.equal(JSON.stringify(aDashboard).includes(secret), false);
    }
    const changeEmail = await api(`/api/admin/owners/${a.id}`, { manager: true, method: 'PUT', body: { ...a, email: 'b@example.test' } });
    assert.equal(changeEmail.status, 400);
    const deactivate = await api(`/api/admin/owners/${a.id}`, { manager: true, method: 'PUT', body: { ...a, active: false } });
    assert.equal(deactivate.status, 200);
    assert.equal((await api('/api/owner/dashboard', { account: 'a' })).status, 403);
    const owners = await (await api('/api/admin/owners', { manager: true })).json();
    assert.equal(owners.owners.length, 2);
    assert.equal(owners.owners.find((item) => item.id === a.id).active, false);
  } finally {
    server.kill();
    if (server.exitCode === null) await new Promise((done) => server.once('exit', done));
    await new Promise((done) => authEmulator.close(done));
    await rm(folder, { recursive: true, force: true });
  }
});
