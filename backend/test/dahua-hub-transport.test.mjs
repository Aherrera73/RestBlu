import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createLocalDatabase } from '../src/database/local-database.mjs';
import { DahuaClient } from '../src/dahua/device-client.mjs';
import { createHubTransport, ngrokTunnel, pushPropertyTerminals } from '../src/dahua/hub-transport.mjs';
import { propertyFromInput } from '../src/properties/property-service.mjs';

// Hub simulado: guarda lo que recibe y responde como el hub real.
async function fakeHub(t, handler) {
  const calls = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    calls.push({ method: request.method, url: request.url, key: request.headers['x-api-key'], body });
    const [status, payload] = handler({ method: request.method, url: request.url, body });
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(payload));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return { calls, url: `http://127.0.0.1:${server.address().port}` };
}

test('DahuaClient envía sus CGI al terminal a través del hub', async (t) => {
  const hub = await fakeHub(t, ({ body }) => [200, {
    status: 200,
    text: body.path === '/cgi-bin/AccessUser.cgi' ? 'OK\r\n' : 'deviceType=DHI-ASI6214S-PW\r\nserialNumber=BH07\r\n',
  }]);
  const client = new DahuaClient({ transport: createHubTransport({ hubUrl: hub.url, apiKey: 'k1', registrationId: 'PROP-0001' }) });

  const info = await client.getDeviceInfo();
  assert.equal(info.serialNumber, 'BH07');
  await client.updatePersonValidity({ userId: 'RB1', name: 'Ana', validFrom: '20311010 150000', validTo: '20311012 110000' });

  const update = hub.calls.find((call) => call.body.path === '/cgi-bin/AccessUser.cgi');
  assert.equal(update.url, '/api/devices/PROP-0001/cgi');
  assert.equal(update.key, 'k1');
  assert.equal(update.body.method, 'POST');
  assert.deepEqual(update.body.params, { action: 'updateMulti' });
  assert.equal(update.body.json.UserList[0].ValidFrom, '2031-10-10 15:00:00');
});

test('los errores del hub y del terminal llegan como errores Dahua', async (t) => {
  let reply = [503, { error: 'El terminal PROP-0001 no está conectado al hub.' }];
  const hub = await fakeHub(t, () => reply);
  const client = new DahuaClient({ transport: createHubTransport({ hubUrl: hub.url, registrationId: 'PROP-0001' }) });
  await assert.rejects(client.findPerson('RB1'), (error) => error.code === 'DEVICE_UNREACHABLE' && /no está conectado/.test(error.message));
  reply = [200, { status: 401, text: '' }];
  await assert.rejects(client.findPerson('RB1'), (error) => error.code === 'DEVICE_AUTH_FAILED');
  reply = [200, { status: 500, text: 'Error' }];
  await assert.rejects(client.findPerson('RB1'), (error) => error.code === 'DEVICE_HTTP_ERROR');
  await assert.rejects(
    new DahuaClient({ transport: createHubTransport({ hubUrl: 'http://127.0.0.1:1', registrationId: 'X' }) }).findPerson('RB1'),
    (error) => error.code === 'DEVICE_UNREACHABLE' && /hub Dahua/.test(error.message),
  );
});

test('el gestor informa al hub el terminal de cada alojamiento', async (t) => {
  const hub = await fakeHub(t, () => [200, { ok: true }]);
  await pushPropertyTerminals({
    hubUrl: hub.url,
    apiKey: 'k2',
    properties: [{ id: 3, name: 'Loft', dahuaRegistrationId: 'PROP-0003' }, { id: 4, name: 'Casa', dahuaRegistrationId: '' }],
  });
  assert.deepEqual(hub.calls.map((call) => [call.method, call.url, call.body.registrationIds]), [
    ['PUT', '/api/restblu-properties/3', ['PROP-0003']],
    ['PUT', '/api/restblu-properties/4', []],
  ]);
});

test('el gestor muestra sólo el túnel ngrok que llega al hub', async (t) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ tunnels: [
      { public_url: 'tcp://wrong.example:12000', config: { addr: 'localhost:3100' } },
      { public_url: 'tcp://hub.example:15512', config: { addr: 'localhost:9500' } },
    ] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const apiUrl = `http://127.0.0.1:${server.address().port}`;
  const tunnel = await ngrokTunnel(apiUrl);
  assert.equal(tunnel.host, 'hub.example');
  assert.equal(tunnel.port, 15512);
  const missing = await ngrokTunnel(apiUrl, 9600);
  assert.equal(missing.active, false);
  assert.match(missing.error, /puerto 9600/);
});

test('el terminal del alojamiento y el de la reserva se guardan en la base', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'restblu-hub-'));
  const database = createLocalDatabase({
    databasePath: join(directory, 'prueba.sqlite'),
    legacyJsonPath: join(directory, 'no-existe.json'),
    schemaPath: new URL('../src/database/schema.sql', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  });
  // En Windows la base debe cerrarse antes de borrar su carpeta.
  t.after(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const base = {
    name: 'Refugio', place: 'Pucón', type: 'Cabaña', image: 'https://example.com/a.jpg',
    ownerName: 'Camila Torres', ownerDocumentId: '11.111.111-1', ownerEmail: 'camila@example.com', ownerPhone: '+56911111111',
  };
  assert.throws(() => propertyFromInput({ ...base, dahuaRegistrationId: 'PROP 1; DROP' }), /Registration ID/);
  const property = { id: 1, ...propertyFromInput({ ...base, dahuaRegistrationId: 'PROP-0007' }), createdAt: new Date().toISOString() };
  const data = database.readDatabase();
  data.properties.push(property);
  data.customers.push({ id: 1, name: 'Ana', documentId: '22.222.222-2', email: 'ana@example.com', createdAt: property.createdAt, updatedAt: property.createdAt });
  data.reservations.push({
    id: 'RB-T1', customerId: 1, propertyId: 1, propertyName: 'Refugio', propertyPlace: 'Pucón',
    checkIn: '2031-01-10', checkOut: '2031-01-12', nights: 2, status: 'confirmada', dahuaTerminal: 'PROP-0007',
  });
  database.saveDatabase(data);
  const stored = database.readDatabase();
  assert.equal(stored.properties[0].dahuaRegistrationId, 'PROP-0007');
  assert.equal(stored.reservations[0].dahuaTerminal, 'PROP-0007');
});
