import assert from 'node:assert/strict';
import test from 'node:test';
import { FakeDahuaClient } from '../src/devices/fake-dahua-client.mjs';
import { connectDevice, registrationRequest, startTestHub } from './helpers.mjs';

const user = {
  userId: 'RB0001', name: 'Huésped de prueba', pin: '482913',
  validFrom: '2031-01-10T18:00:00.000Z', validTo: '2031-01-13T14:00:00.000Z',
};

test('un comando para un terminal online se ejecuta con FakeDahuaClient y queda SUCCESS', async (t) => {
  FakeDahuaClient.reset();
  const hub = await startTestHub();
  t.after(() => hub.stop());
  const device = await connectDevice(hub.tcpPort, registrationRequest('PROP-0001'));
  t.after(() => device.socket.destroy());

  const queued = await hub.request('POST', '/api/devices/PROP-0001/commands', { type: 'upsert_access_user', payload: user });
  assert.equal(queued.status, 202);
  assert.equal(queued.body.command.status, 'PENDING');
  assert.equal(queued.body.deviceOnline, true);

  await hub.worker.runOnce();
  const { body } = await hub.request('GET', `/api/commands/${queued.body.command.id}`);
  assert.equal(body.command.status, 'SUCCESS');
  assert.deepEqual(body.command.result, { userId: 'RB0001' });
  const state = await hub.request('GET', '/api/devices/PROP-0001/fake-state');
  assert.equal(state.body.users[0].pin, '482913');
});

test('si el terminal falla se reintenta y al agotar los intentos queda FAILED', async (t) => {
  FakeDahuaClient.reset();
  const hub = await startTestHub();
  t.after(() => hub.stop());
  const device = await connectDevice(hub.tcpPort, registrationRequest('PROP-0001'));
  t.after(() => device.socket.destroy());

  FakeDahuaClient.failNext('PROP-0001', 'openDoor', 1);
  const retried = (await hub.request('POST', '/api/devices/PROP-0001/commands', { type: 'OPEN_DOOR' })).body.command;
  await hub.worker.runOnce();
  let command = await hub.store.getCommand(retried.id);
  assert.equal(command.status, 'PENDING');
  assert.equal(command.attempts, 1);
  assert.match(command.lastError, /Falla simulada/);
  // Se adelanta el reintento para no esperar el plazo real.
  await hub.store.completeCommand(retried.id, { ok: false, error: command.lastError, retryDelayMs: -1 });
  await hub.worker.runOnce();
  assert.equal((await hub.store.getCommand(retried.id)).status, 'SUCCESS');

  FakeDahuaClient.failNext('PROP-0001', 'ping', 10);
  const failing = (await hub.request('POST', '/api/devices/PROP-0001/commands', { type: 'PING', maxAttempts: 1 })).body.command;
  await hub.worker.runOnce();
  const failed = await hub.store.getCommand(failing.id);
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.attempts, 1);
});

test('los comandos de un terminal desconectado esperan sin gastar intentos', async (t) => {
  const hub = await startTestHub();
  t.after(() => hub.stop());
  const queued = await hub.request('POST', '/api/devices/PROP-0002/commands', { type: 'PING' });
  assert.equal(queued.body.deviceOnline, false);
  await hub.worker.runOnce();
  const command = await hub.store.getCommand(queued.body.command.id);
  assert.equal(command.status, 'PENDING');
  assert.equal(command.attempts, 0);
});

test('la API valida comandos, reservas y la clave de acceso', async (t) => {
  const hub = await startTestHub({ api: { apiKey: 'clave-de-prueba' } });
  t.after(() => hub.stop());
  const key = { 'x-api-key': 'clave-de-prueba' };
  assert.equal((await hub.request('GET', '/api/devices')).status, 401);
  assert.equal((await hub.request('GET', '/api/devices', undefined, { 'x-api-key': 'otra' })).status, 401);
  assert.equal((await hub.request('POST', '/api/devices/PROP-0001/commands', { type: 'BORRAR_TODO' }, key)).status, 400);
  assert.equal((await hub.request('GET', '/api/devices/PROP-0404', undefined, key)).status, 404);
  assert.equal((await hub.request('POST', '/api/devices', { registrationId: 'PROP-0001' }, key)).status, 409);

  const reservation = {
    propertyId: hub.property.id, guestName: 'Ana Pérez', pin: '1234',
    validFrom: '2031-02-01T15:00:00-03:00', validTo: '2031-02-03T11:00:00-03:00', externalCode: 'RB-TEST-1',
  };
  assert.equal((await hub.request('POST', '/api/reservations', { ...reservation, pin: '12' }, key)).status, 400);
  assert.equal((await hub.request('POST', '/api/reservations', { ...reservation, validTo: reservation.validFrom }, key)).status, 400);
  const created = await hub.request('POST', '/api/reservations', reservation, key);
  assert.equal(created.status, 201);
  assert.equal(created.body.reservation.syncStatus, 'PENDING');
  assert.equal(created.body.reservation.validFrom, '2031-02-01T18:00:00.000Z');
  assert.equal((await hub.request('POST', '/api/reservations', reservation, key)).status, 409);
});
