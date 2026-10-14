import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { test } from 'node:test';
import { phoneAccessPayload, phoneAccessWithinStay, verifyPhoneAccessSignature } from '../src/access/phone-access.mjs';
import { DahuaClient } from '../src/dahua/device-client.mjs';

test('la firma del teléfono queda ligada a cuenta, reserva, solicitud y hora', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const data = {
    ownerUid: 'firebaseUser01', reservationId: 'RB-ABC123-ABCDEF123456',
    requestId: '550e8400-e29b-41d4-a716-446655440000', signedAt: '2026-10-07T10:00:00Z',
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  };
  const signature = sign('sha256', Buffer.from(phoneAccessPayload(data)), privateKey).toString('base64');
  assert.equal(verifyPhoneAccessSignature({ ...data, signature }), true);
  assert.equal(verifyPhoneAccessSignature({ ...data, signature, reservationId: 'RB-ABC123-OTHER12345678' }), false);
  assert.equal(verifyPhoneAccessSignature({ ...data, signature, requestId: '550e8400-e29b-41d4-a716-446655440001' }), false);
});

test('la apertura con teléfono sólo se permite durante la estadía', () => {
  const reservation = { checkIn: '2026-10-10', checkInTime: '15:00', checkOut: '2026-10-12', checkOutTime: '11:00' };
  assert.equal(phoneAccessWithinStay(reservation, new Date('2026-10-10T14:59:59')), false);
  assert.equal(phoneAccessWithinStay(reservation, new Date('2026-10-10T15:00:00')), true);
  assert.equal(phoneAccessWithinStay(reservation, new Date('2026-10-12T11:00:00')), false);
});

test('el cliente sólo informa apertura si el Dahua devuelve OK', async () => {
  const calls = [];
  const client = new DahuaClient({ transport: async (input) => {
    calls.push(input);
    return { status: 200, text: 'OK' };
  } });
  assert.deepEqual(await client.openDoor({ channel: 1 }), { opened: true });
  assert.deepEqual(calls[0].params, { action: 'openDoor', channel: 1, Type: 'Remote' });
  await assert.rejects(client.openDoor({ channel: 0 }), /Canal/);
  assert.equal(calls.length, 1);
  const rejected = new DahuaClient({ transport: async () => ({ status: 200, text: 'ERROR' }) });
  await assert.rejects(rejected.openDoor(), /no confirmó/);
});
