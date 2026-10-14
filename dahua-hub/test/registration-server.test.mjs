import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import { connectDevice, registrationRequest, startTestHub, waitFor } from './helpers.mjs';

test('varios Dahua se registran a la vez y la API los muestra online', async (t) => {
  const hub = await startTestHub();
  t.after(() => hub.stop());
  const [first, second] = await Promise.all([
    connectDevice(hub.tcpPort, registrationRequest('PROP-0001')),
    connectDevice(hub.tcpPort, registrationRequest('prop-0002')),
  ]);
  t.after(() => { first.socket.destroy(); second.socket.destroy(); });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);

  const online = await hub.request('GET', '/api/devices/online');
  assert.equal(online.status, 200);
  assert.equal(online.body.count, 2);
  assert.deepEqual(online.body.devices.map((device) => device.registrationId).sort(), ['PROP-0001', 'PROP-0002']);
  assert.equal(online.body.devices[0].session.serverIpReported, '203.0.113.10');

  const devices = await hub.request('GET', '/api/devices');
  assert.ok(devices.body.devices.every((device) => device.online && device.status === 'ONLINE'));
  const logs = await hub.request('GET', '/api/devices/PROP-0001/logs');
  assert.equal(logs.body.logs[0].event, 'REGISTERED');
});

test('rechaza un Registration ID que no está dado de alta', async (t) => {
  const hub = await startTestHub();
  t.after(() => hub.stop());
  const unknown = await connectDevice(hub.tcpPort, registrationRequest('PROP-9999'));
  assert.equal(unknown.status, 403);
  await waitFor(() => unknown.socket.destroyed || unknown.socket.readableEnded);
  const logs = await hub.request('GET', '/api/connection-logs?registrationId=PROP-9999');
  assert.equal(logs.body.logs[0].event, 'REJECTED');
  assert.equal((await hub.request('GET', '/api/devices/online')).body.count, 0);
});

test('con DAHUA_HUB_ALLOW_UNKNOWN_DEVICES crea el terminal al registrarse', async (t) => {
  const hub = await startTestHub({ tcp: { allowUnknownDevices: true }, devices: [] });
  t.after(() => hub.stop());
  const device = await connectDevice(hub.tcpPort, registrationRequest('PROP-0100'));
  t.after(() => device.socket.destroy());
  assert.equal(device.status, 200);
  const created = await hub.request('GET', '/api/devices/PROP-0100');
  assert.equal(created.body.device.online, true);
});

test('la desconexión deja el terminal OFFLINE y queda registrada', async (t) => {
  const hub = await startTestHub();
  t.after(() => hub.stop());
  const device = await connectDevice(hub.tcpPort, registrationRequest('PROP-0001'));
  assert.equal(device.status, 200);
  device.socket.destroy();
  await waitFor(async () => !(await hub.request('GET', '/api/devices/PROP-0001')).body.device.online);
  const { body } = await hub.request('GET', '/api/devices/PROP-0001');
  assert.equal(body.device.status, 'OFFLINE');
  assert.ok(body.device.lastDisconnectedAt);
  const logs = await waitFor(async () => {
    const result = await hub.request('GET', '/api/devices/PROP-0001/logs');
    return result.body.logs[0]?.event === 'DISCONNECTED' && result.body.logs;
  });
  assert.match(logs[0].detail, /duración/);
});

test('una reconexión del mismo terminal reemplaza la conexión anterior', async (t) => {
  const hub = await startTestHub();
  t.after(() => hub.stop());
  const first = await connectDevice(hub.tcpPort, registrationRequest('PROP-0001'));
  const second = await connectDevice(hub.tcpPort, registrationRequest('PROP-0001'));
  t.after(() => second.socket.destroy());
  await waitFor(() => first.socket.destroyed);
  const online = await hub.request('GET', '/api/devices/online');
  assert.equal(online.body.count, 1);
  const logs = await waitFor(async () => {
    const events = (await hub.request('GET', '/api/devices/PROP-0001/logs')).body.logs.map((log) => log.event);
    return events.includes('REPLACED') && events.includes('DISCONNECTED') && events;
  });
  assert.equal(logs.filter((event) => event === 'REGISTERED').length, 2);
  // La conexión vieja al cerrarse no debe dejar el terminal OFFLINE.
  assert.equal((await hub.request('GET', '/api/devices/PROP-0001')).body.device.status, 'ONLINE');
});

test('acepta el registro enviado en varios fragmentos', async (t) => {
  const hub = await startTestHub();
  t.after(() => hub.stop());
  const request = registrationRequest('PROP-0002');
  const device = await connectDevice(hub.tcpPort, [request.slice(0, 7), request.slice(7, 60), request.slice(60)]);
  t.after(() => device.socket.destroy());
  assert.equal(device.status, 200);
});

test('cierra conexiones que no hablan HTTP o que no se registran a tiempo', async (t) => {
  const hub = await startTestHub({ tcp: { registrationTimeoutMs: 200 } });
  t.after(() => hub.stop());
  const binary = net.connect({ host: '127.0.0.1', port: hub.tcpPort }, () => binary.write(Buffer.from([0xa0, 0x01, 0x02])));
  const silent = net.connect({ host: '127.0.0.1', port: hub.tcpPort });
  await waitFor(() => binary.destroyed && silent.destroyed);
  const events = (await hub.request('GET', '/api/connection-logs')).body.logs.map((log) => log.event);
  assert.ok(events.includes('PROTOCOL_ERROR'));
  assert.ok(events.includes('REGISTRATION_TIMEOUT'));
});

test('responde 200 al heartbeat (registro repetido) sin abrir otra sesión', async (t) => {
  const hub = await startTestHub();
  t.after(() => hub.stop());
  const device = await connectDevice(hub.tcpPort, registrationRequest('PROP-0001'));
  t.after(() => device.socket.destroy());
  let received = '';
  device.socket.on('data', (chunk) => { received += chunk.toString('latin1'); });
  // Dos heartbeats juntos y uno partido en dos fragmentos.
  device.socket.write(registrationRequest('PROP-0001') + registrationRequest('PROP-0001'));
  const third = registrationRequest('PROP-0001');
  device.socket.write(third.slice(0, 3));
  await new Promise((resolve) => setTimeout(resolve, 30));
  device.socket.write(third.slice(3));
  await waitFor(() => received.split('HTTP/1.1 200 OK').length - 1 === 3);
  const online = (await hub.request('GET', '/api/devices/online')).body;
  assert.equal(online.count, 1);
  assert.equal(online.devices[0].session.heartbeats, 3);
  assert.ok(online.devices[0].session.lastHeartbeatAt);
  const events = (await hub.request('GET', '/api/devices/PROP-0001/logs')).body.logs.map((log) => log.event);
  assert.deepEqual(events, ['REGISTERED']);
});
