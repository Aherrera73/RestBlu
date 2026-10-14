import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createLocalDatabase } from '../src/database/local-database.mjs';
import {
  dahuaFaceInput, dahuaUserId, enrollReservationFace,
  reservationAccessWindow, revokeReservationFace,
} from '../src/dahua/reservation-access.mjs';

const reservation = {
  id: 'RB-H7HBHZ-B02D5DB3D002',
  status: 'confirmada',
  paymentStatus: 'aprobado-demo',
  biometricConsentAt: '2026-09-28T10:00:00',
  biometricStatus: 'activa',
  checkIn: '2099-09-28',
  checkInTime: '15:00',
  checkOut: '2099-09-30',
  checkOutTime: '11:00',
};

test('el usuario Dahua es estable por reserva y la vigencia no excede el checkout', () => {
  assert.match(dahuaUserId(reservation.id), /^RB[a-f0-9]{20}$/);
  assert.equal(dahuaUserId(reservation.id), dahuaUserId(reservation.id));
  assert.notEqual(dahuaUserId(reservation.id), dahuaUserId('otra-reserva'));
  assert.deepEqual(reservationAccessWindow(reservation), {
    validFrom: '20990928 150000',
    validTo: '20990930 110000',
    expiresAt: '2099-09-30T11:00:00',
  });
});

test('la foto y la reserva deben ser aptas antes del alta', () => {
  const bytes = Buffer.alloc(12_000, 17);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[bytes.length - 2] = 0xff;
  bytes[bytes.length - 1] = 0xd9;
  const image = { mimeType: 'image/jpeg', base64: bytes.toString('base64') };
  const result = dahuaFaceInput({
    reservation, customer: { name: 'Persona de prueba' }, image,
  });
  assert.equal(result.validTo, '20990930 110000');
  assert.equal(result.photoBase64, image.base64);
  assert.throws(() => dahuaFaceInput({
    reservation: { ...reservation, paymentStatus: 'no-realizado-demo' },
    customer: { name: 'Persona' }, image,
  }), /no está autorizada/);
  assert.throws(() => dahuaFaceInput({
    reservation, customer: { name: 'Persona' },
    image: { mimeType: 'image/png', base64: image.base64 },
  }), /JPEG/);
});

test('se confirma el rostro después de crear persona y rostro; ante error se revierte', async () => {
  const calls = [];
  const client = {
    async insertPerson() { calls.push('person'); return { recNo: '7' }; },
    async addFace() { calls.push('face'); },
    async findFace() { calls.push('verify'); return true; },
    async removePerson() { calls.push('rollback'); },
  };
  const result = await enrollReservationFace(client, { userId: 'RBtest' });
  assert.equal(result.verified, true);
  assert.deepEqual(calls, ['person', 'face', 'verify']);
  client.addFace = async () => { calls.push('face-error'); throw new Error('reject'); };
  await assert.rejects(enrollReservationFace(client, { userId: 'RBtest' }), /reject/);
  assert.deepEqual(calls.slice(3), ['person', 'face-error', 'rollback']);
});

test('la revocación intenta eliminar rostro y persona', async () => {
  const calls = [];
  await revokeReservationFace({
    async removeFace() { calls.push('face'); },
    async removePerson() { calls.push('person'); },
  }, { userId: dahuaUserId(reservation.id), recNo: '7' });
  assert.deepEqual(calls.sort(), ['face', 'person']);
});

test('la migración SQLite agrega los campos de seguimiento Dahua', () => {
  const directory = mkdtempSync(join(tmpdir(), 'restblu-dahua-test-'));
  try {
    const databasePath = join(directory, 'test.sqlite');
    const database = createLocalDatabase({
      databasePath,
      legacyJsonPath: join(directory, 'inexistente.json'),
      schemaPath: fileURLToPath(new URL('../src/database/schema.sql', import.meta.url)),
    });
    database.close();
    const sqlite = new DatabaseSync(databasePath);
    try {
      const names = sqlite.prepare('PRAGMA table_info(estadias)').all().map((row) => row.name);
      for (const name of ['dahua_user_id', 'dahua_rec_no', 'dahua_estado', 'dahua_verificado_at', 'dahua_qr_codigo', 'dahua_qr_estado', 'dahua_qr_error', 'dahua_qr_registrado_at']) {
        assert.ok(names.includes(name), `Falta columna ${name}`);
      }
    } finally {
      sqlite.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
