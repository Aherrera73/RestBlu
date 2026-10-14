import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import tls from 'node:tls';
import test from 'node:test';
import { connectFakeDahua } from './fake-dahua-device.mjs';
import { connectDevice, registrationRequest, startTestHub, waitFor } from './helpers.mjs';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const certificate = { cert: fixture('test-hub.crt'), key: fixture('test-hub.key') };
const ca = fixture('test-ca.crt');
const device = { username: 'restblu_api', password: 'clave-123', timeZone: 'America/Santiago' };

test('un Dahua con HTTPS se registra por TLS y recibe comandos por el canal cifrado', async (t) => {
  const hub = await startTestHub({ client: 'dahua', device, tcp: { certificate } });
  t.after(() => hub.stop());
  const dahua = connectFakeDahua(hub.tcpPort, { username: 'restblu_api', password: 'clave-123', secure: { ca } });
  t.after(() => dahua.close());
  await dahua.ready;
  assert.equal(dahua.socket.authorized, true, 'el terminal valida el certificado del hub con la CA');
  await waitFor(() => hub.registry.isOnline('PROP-0001'));
  const online = (await hub.request('GET', '/api/devices/online')).body;
  assert.equal(online.devices[0].session.tls, true);

  const queued = await hub.request('POST', '/api/devices/PROP-0001/commands', { type: 'GET_DEVICE_INFO' });
  await hub.worker.runOnce();
  const command = await hub.store.getCommand(queued.body.command.id);
  assert.equal(command.status, 'SUCCESS', command.lastError);
  assert.equal(command.result.serialNumber, 'FAKE123');
  const logs = (await hub.request('GET', '/api/devices/PROP-0001/logs')).body.logs;
  assert.match(logs.find((log) => log.event === 'REGISTERED').detail, /HTTPS/);
});

test('el mismo puerto sigue aceptando terminales sin HTTPS', async (t) => {
  const hub = await startTestHub({ tcp: { certificate } });
  t.after(() => hub.stop());
  const plain = await connectDevice(hub.tcpPort, registrationRequest('PROP-0002'));
  t.after(() => plain.socket.destroy());
  assert.equal(plain.status, 200);
  const online = (await hub.request('GET', '/api/devices/online')).body;
  assert.equal(online.devices[0].session.tls, false);
});

test('un terminal con HTTPS y un hub sin certificado queda registrado como error de protocolo', async (t) => {
  const hub = await startTestHub();
  t.after(() => hub.stop());
  const socket = tls.connect({ host: '127.0.0.1', port: hub.tcpPort, rejectUnauthorized: false });
  socket.on('error', () => {});
  const logs = await waitFor(async () => {
    const result = (await hub.request('GET', '/api/connection-logs')).body.logs;
    return result.find((log) => log.event === 'PROTOCOL_ERROR') && result;
  });
  assert.match(logs.find((log) => log.event === 'PROTOCOL_ERROR').detail, /DAHUA_HUB_TLS_CERT/);
  socket.destroy();
});

test('si el terminal no confía en el certificado, el hub lo deja anotado', async (t) => {
  const hub = await startTestHub({ tcp: { certificate } });
  t.after(() => hub.stop());
  // Sin la CA de RestBlu, el cliente rechaza el certificado durante el handshake.
  const socket = tls.connect({ host: '127.0.0.1', port: hub.tcpPort, servername: 'localhost' });
  socket.on('error', () => {});
  const logs = await waitFor(async () => {
    const result = (await hub.request('GET', '/api/connection-logs')).body.logs;
    return result.find((log) => log.event === 'PROTOCOL_ERROR') && result;
  });
  assert.match(logs.find((log) => log.event === 'PROTOCOL_ERROR').detail, /^TLS:/);
  assert.equal((await hub.request('GET', '/api/devices/online')).body.count, 0);
});
