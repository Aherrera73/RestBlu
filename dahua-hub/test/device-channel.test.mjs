import assert from 'node:assert/strict';
import test from 'node:test';
import { deviceDateTime } from '../src/devices/dahua-client.mjs';
import { connectFakeDahua } from './fake-dahua-device.mjs';
import { startTestHub, waitFor } from './helpers.mjs';

const credentials = { username: 'restblu_api', password: 'clave-123', timeZone: 'America/Santiago' };

async function hubWithDevice(t, device = credentials) {
  const hub = await startTestHub({ client: 'dahua', device });
  t.after(() => hub.stop());
  const dahua = connectFakeDahua(hub.tcpPort, { username: 'restblu_api', password: 'clave-123' });
  t.after(() => dahua.close());
  await dahua.ready;
  await waitFor(() => hub.registry.isOnline('PROP-0001'));
  const run = async (type, payload = {}, maxAttempts = 5) => {
    const queued = await hub.request('POST', '/api/devices/PROP-0001/commands', { type, payload, maxAttempts });
    await hub.worker.runOnce();
    return hub.store.getCommand(queued.body.command.id);
  };
  return { hub, dahua, run };
}

test('convierte la vigencia a la hora local del terminal', () => {
  assert.equal(deviceDateTime('2031-01-10T18:00:00Z', 'America/Santiago'), '2031-01-10 15:00:00');
  assert.equal(deviceDateTime('2031-07-10T18:00:00Z', 'America/Santiago'), '2031-07-10 14:00:00');
});

test('el hub inicia sesión con Digest y ejecuta comandos por el canal del Auto Register', async (t) => {
  const { dahua, run } = await hubWithDevice(t);

  const ping = await run('PING');
  assert.equal(ping.status, 'SUCCESS', ping.lastError);
  assert.equal(dahua.state.logins, 1);

  const info = await run('GET_DEVICE_INFO');
  assert.equal(info.status, 'SUCCESS', info.lastError);
  assert.equal(info.result.model, 'DHI-ASI6214S-PW');
  assert.equal(info.result.serialNumber, 'FAKE123');
  assert.equal(info.result.firmware, '3.003.0000000.4.R');

  const user = {
    userId: 'RB0001', name: 'Ana Pérez', pin: '482913', cardNo: 'A1B2C3D4E5',
    validFrom: '2031-01-10T18:00:00.000Z', validTo: '2031-01-13T14:00:00.000Z',
  };
  const created = await run('UPSERT_ACCESS_USER', user);
  assert.equal(created.status, 'SUCCESS', created.lastError);
  assert.equal(created.result.action, 'created');
  assert.deepEqual(
    { password: dahua.state.users.get('RB0001').Password, from: dahua.state.users.get('RB0001').ValidFrom, to: dahua.state.users.get('RB0001').ValidTo },
    { password: '482913', from: '2031-01-10 15:00:00', to: '2031-01-13 11:00:00' },
  );
  assert.equal(dahua.state.cards.get('A1B2C3D4E5').UserID, 'RB0001');

  const updated = await run('UPSERT_ACCESS_USER', { ...user, pin: '111222' });
  assert.equal(updated.result.action, 'updated');
  assert.equal(dahua.state.users.get('RB0001').Password, '111222');

  const door = await run('OPEN_DOOR');
  assert.equal(door.status, 'SUCCESS', door.lastError);
  assert.equal(dahua.state.doorOpenings, 1);

  const removed = await run('REMOVE_ACCESS_USER', { userId: 'RB0001' });
  assert.deepEqual(removed.result, { removed: true });
  assert.equal(dahua.state.users.has('RB0001'), false);
  // Una sola sesión para todos los comandos.
  assert.equal(dahua.state.logins, 1);
});

test('si el terminal da la sesión por vencida, el hub vuelve a iniciar sesión', async (t) => {
  const { dahua, run } = await hubWithDevice(t);
  assert.equal((await run('PING')).status, 'SUCCESS');
  dahua.state.token = 'vencido';
  const again = await run('PING');
  assert.equal(again.status, 'SUCCESS', again.lastError);
  assert.equal(dahua.state.logins, 2);
});

test('los heartbeats y el 404 suelto del terminal no se confunden con las respuestas', async (t) => {
  const { hub, dahua, run } = await hubWithDevice(t);
  dahua.heartbeat();
  dahua.stray404();
  await waitFor(() => hub.registry.get('PROP-0001').heartbeats === 1);
  const info = await run('GET_DEVICE_INFO');
  assert.equal(info.status, 'SUCCESS', info.lastError);
  assert.equal(info.result.serialNumber, 'FAKE123');
  // Heartbeat que llega mientras el hub espera la respuesta a un comando.
  const queued = await hub.request('POST', '/api/devices/PROP-0001/commands', { type: 'PING' });
  const running = hub.worker.runOnce();
  dahua.heartbeat();
  await running;
  assert.equal((await hub.store.getCommand(queued.body.command.id)).status, 'SUCCESS');
  await waitFor(() => hub.registry.get('PROP-0001').heartbeats === 2);
});

test('con una contraseña incorrecta el comando falla con un error claro', async (t) => {
  const { run } = await hubWithDevice(t, { ...credentials, password: 'otra' });
  const ping = await run('PING', {}, 1);
  assert.equal(ping.status, 'FAILED');
  assert.match(ping.lastError, /rechazó usuario o contraseña/);
});

test('el proxy CGI ejecuta en el terminal la petición del gestor', async (t) => {
  const { hub, dahua } = await hubWithDevice(t);
  const info = await hub.request('POST', '/api/devices/PROP-0001/cgi', { path: '/cgi-bin/magicBox.cgi', params: { action: 'getSystemInfo' } });
  assert.equal(info.status, 200);
  assert.equal(info.body.status, 200);
  assert.match(info.body.text, /serialNumber=FAKE123/);

  const user = await hub.request('POST', '/api/devices/PROP-0001/cgi', {
    method: 'POST', path: '/cgi-bin/AccessUser.cgi', params: { action: 'insertMulti' },
    json: { UserList: [{ UserID: 'RBX1', UserName: 'Desde el gestor' }] },
  });
  assert.match(user.body.text, /OK/);
  assert.equal(dahua.state.users.get('RBX1').UserName, 'Desde el gestor');

  assert.equal((await hub.request('POST', '/api/devices/PROP-0001/cgi', { path: '/cgi-bin/api/global/login' })).status, 400);
  assert.equal((await hub.request('POST', '/api/devices/PROP-0001/cgi', { path: '/cgi-bin/../etc' })).status, 400);
  assert.equal((await hub.request('POST', '/api/devices/PROP-0002/cgi', { path: '/cgi-bin/magicBox.cgi' })).status, 503);
});

test('asigna terminales a un alojamiento de RestBlu y los reasigna', async (t) => {
  const hub = await startTestHub();
  t.after(() => hub.stop());
  const first = await hub.request('PUT', '/api/restblu-properties/7', { name: 'Refugio Arrayán', registrationIds: ['PROP-0001', 'PROP-0050'] });
  assert.equal(first.status, 200);
  let mapping = (await hub.request('GET', '/api/restblu-properties')).body.properties;
  assert.equal(mapping.length, 1);
  assert.equal(mapping[0].restbluPropertyId, 7);
  assert.deepEqual(mapping[0].devices.map((device) => device.registrationId).sort(), ['PROP-0001', 'PROP-0050']);

  await hub.request('PUT', '/api/restblu-properties/7', { name: 'Refugio Arrayán', registrationIds: ['PROP-0050'] });
  mapping = (await hub.request('GET', '/api/restblu-properties')).body.properties;
  assert.deepEqual(mapping[0].devices.map((device) => device.registrationId), ['PROP-0050']);
  assert.equal((await hub.request('GET', '/api/devices/PROP-0001')).body.device.propertyId, null);
  assert.equal((await hub.request('PUT', '/api/restblu-properties/7', { name: 'X', registrationIds: ['mal id!'] })).status, 400);
});

test('los 404 sobrantes pegados a una respuesta no desordenan el canal', async (t) => {
  const { hub, dahua, run } = await hubWithDevice(t);
  assert.equal((await run('PING')).status, 'SUCCESS');
  dahua.state.strayAfterEachResponse = true;
  for (let i = 0; i < 3; i += 1) {
    const info = await run('GET_DEVICE_INFO');
    assert.equal(info.status, 'SUCCESS', info.lastError);
    assert.equal(info.result.serialNumber, 'FAKE123');
    assert.equal(info.result.firmware, '3.003.0000000.4.R');
    const ping = await run('PING');
    assert.equal(ping.status, 'SUCCESS', ping.lastError);
    assert.match(ping.result.deviceTime, /^2026-10-06/);
    const raw = await hub.request('POST', '/api/devices/PROP-0001/cgi', { path: '/cgi-bin/global.cgi', params: { action: 'getCurrentTime' } });
    assert.equal(raw.body.status, 200);
    assert.doesNotMatch(raw.body.text, /HTTP\//, 'la respuesta no debe traer otra pegada');
  }
});

test('envía una foto de tamaño normal completa por el canal remoto y conserva la sesión', async (t) => {
  const { hub, dahua } = await hubWithDevice(t);
  const photo = 'A'.repeat(100_000);
  const result = await hub.request('POST', '/api/devices/PROP-0001/cgi', {
    method: 'POST', path: '/cgi-bin/AccessFace.cgi', params: { action: 'insertMulti' },
    json: { FaceList: [{ UserID: 'RB1', PhotoData: [photo] }] },
    timeoutMs: 15_000,
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 404); // El Dahua simulado no implementa altas faciales.
  assert.equal(dahua.state.requestBodyBytes.at(-1), Buffer.byteLength(JSON.stringify({ FaceList: [{ UserID: 'RB1', PhotoData: [photo] }] })));
  const after = await hub.request('POST', '/api/devices/PROP-0001/cgi', { path: '/cgi-bin/magicBox.cgi', params: { action: 'getSystemInfo' } });
  assert.match(after.body.text, /FAKE123/);
});

test('una petición facial excesiva se rechaza sin enviarla al terminal', async (t) => {
  const { hub, dahua } = await hubWithDevice(t);
  const before = dahua.state.requests.length;
  const big = await hub.request('POST', '/api/devices/PROP-0001/cgi', {
    method: 'POST', path: '/cgi-bin/AccessFace.cgi', params: { action: 'insertMulti' },
    json: { FaceList: [{ UserID: 'RB1', PhotoData: ['A'.repeat(300_000)] }] },
  });
  assert.equal(big.status, 413);
  assert.match(big.body.error, /supera el límite/);
  assert.equal(dahua.state.requests.length, before);
  const after = await hub.request('POST', '/api/devices/PROP-0001/cgi', { path: '/cgi-bin/magicBox.cgi', params: { action: 'getSystemInfo' } });
  assert.match(after.body.text, /FAKE123/);
});

test('una respuesta que llega tarde reinicia la conexión en vez de desfasar el canal', async (t) => {
  const { hub, dahua, run } = await hubWithDevice(t);
  assert.equal((await run('PING')).status, 'SUCCESS');
  dahua.state.delayMs = 1_500;
  const late = await hub.request('POST', '/api/devices/PROP-0001/cgi', {
    path: '/cgi-bin/global.cgi', params: { action: 'getCurrentTime' }, timeoutMs: 1_000,
  });
  assert.equal(late.status, 502);
  assert.match(late.body.error, /a tiempo/);
  await waitFor(() => !hub.registry.isOnline('PROP-0001'));
  const logs = (await hub.request('GET', '/api/devices/PROP-0001/logs')).body.logs;
  assert.match(logs.find((log) => log.event === 'DISCONNECTED').detail, /canal reiniciado/);
});
