import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createLocalDatabase } from '../src/database/local-database.mjs';
import { propertyFromInput } from '../src/properties/property-service.mjs';

const root = resolve(import.meta.dirname, '..');

async function listen(server) {
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return server.address().port;
}

test('la apertura manual sólo acciona el terminal exclusivo desde el gestor local', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'restblu-manual-door-'));
  const configPath = join(temp, 'test.env');
  await writeFile(configPath, '', 'utf8');
  const database = createLocalDatabase({
    databasePath: join(temp, 'doors.sqlite'),
    legacyJsonPath: join(temp, 'missing.json'),
    schemaPath: join(root, 'src', 'database', 'schema.sql'),
  });
  const snapshot = database.readDatabase();
  for (const [id, terminal] of [[1, 'SHARED'], [2, 'shared'], [3, 'UNIQUE'], [4, '']]) {
    snapshot.properties.push({
      id,
      ...propertyFromInput({
        name: `Alojamiento ${id}`, place: 'Chile', type: 'Casa',
        image: 'https://example.invalid/house.jpg', guests: 2, beds: 1,
        price: 10000, dahuaRegistrationId: terminal,
        ownerName: 'Propietaria de prueba', ownerDocumentId: '11.111.111-1',
        ownerEmail: 'owner@example.invalid', ownerPhone: '+56911111111',
      }),
      createdAt: new Date().toISOString(),
    });
  }
  database.saveDatabase(snapshot);
  database.close();

  const commands = [];
  const hub = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    if (request.url.endsWith('/cgi')) commands.push({ url: request.url, body });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ status: 200, text: 'OK\r\n' }));
  });
  const hubPort = await listen(hub);
  const probe = createServer();
  const port = await listen(probe);
  await new Promise((done) => probe.close(done));
  const manager = spawn(process.execPath, ['server.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      RESTBLU_ADMIN_PORT: String(port),
      RESTBLU_DB_PATH: join(temp, 'doors.sqlite'),
      RESTBLU_DB_ENGINE: 'sqlite',
      RESTBLU_ENV_PATH: configPath,
      FIREBASE_SERVICE_ACCOUNT_PATH: join(temp, 'missing-firebase.json'),
      DAHUA_RESERVATION_SYNC: '1',
      DAHUA_HUB_URL: `http://127.0.0.1:${hubPort}`,
      DAHUA_HUB_API_KEY: 'test-key',
      DAHUA_HUB_LAN_DEVICE: 'NO-SUCH-DEVICE',
      DAHUA_BASE_URL: 'http://127.0.0.1:1',
      DAHUA_USERNAME: 'test',
      DAHUA_PASSWORD: 'test',
      AI_BASE_URL: 'http://127.0.0.1:1',
      AI_API_KEY: 'test',
    },
    stdio: 'ignore',
  });
  const endpoint = (id) => `http://127.0.0.1:${port}/api/admin/properties/${id}/open-door`;
  const open = (id, headers = {}) => fetch(endpoint(id), {
    method: 'POST', headers: { 'X-RestBlu-Manager-Action': 'open-door', ...headers },
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (manager.exitCode !== null) break;
      try {
        ready = (await fetch(`http://127.0.0.1:${port}/api/health`)).ok;
        if (ready) break;
      } catch { await delay(100); }
    }
    assert.ok(ready, 'el gestor aislado debe iniciar');
    assert.equal((await open(3, { Origin: 'https://otro-sitio.example' })).status, 403);
    assert.equal((await open(4)).status, 409);
    assert.equal((await open(1)).status, 409);
    const result = await open(3, { Origin: `http://127.0.0.1:${port}` });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).opened, true);
    assert.equal(commands.length, 1);
    assert.equal(commands[0].url, '/api/devices/UNIQUE/cgi');
    assert.equal(commands[0].body.path, '/cgi-bin/accessControl.cgi');
    assert.deepEqual(commands[0].body.params, { action: 'openDoor', channel: 1, Type: 'Remote' });
    assert.equal((await open(3)).status, 429);
    assert.equal(commands.length, 1);
  } finally {
    if (manager.exitCode === null) {
      manager.kill();
      await new Promise((done) => manager.once('exit', done));
    }
    await new Promise((done) => hub.close(done));
    await rm(temp, { recursive: true, force: true });
  }
});
