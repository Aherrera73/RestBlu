import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createLocalDatabase } from '../src/database/local-database.mjs';

test('las escrituras parciales conservan otros cambios, eventos y huésped histórico', () => {
  const folder = mkdtempSync(join(tmpdir(), 'restblu-db-integrity-'));
  const databasePath = join(folder, 'restblu.sqlite');
  const database = createLocalDatabase({
    databasePath,
    legacyJsonPath: join(folder, 'missing.json'),
    schemaPath: resolve(import.meta.dirname, '../src/database/schema.sql'),
  });
  try {
    const initial = database.readDatabase();
    initial.properties.push({
      id: 1, name: 'Casa de prueba', place: 'Chile', type: 'Casa', image: 'image.jpg',
      ownerName: 'Propietaria', ownerDocumentId: '11.111.111-1',
      ownerEmail: 'owner@example.test', ownerPhone: '12345678',
      guests: 2, beds: 1, baths: 1, price: 10000, gallery: [], tags: [], active: true,
    });
    initial.customers.push({
      id: 1, name: 'Huésped original', documentId: '12.345.678-5',
      email: 'original@example.test', phone: '11111111', emailVerified: false,
    });
    initial.reservations.push({
      id: 'RB-TEST-000000000001', customerId: 1, propertyId: 1,
      guestName: 'Huésped original', guestDocumentId: '12.345.678-5',
      guestEmail: 'original@example.test', guestPhone: '11111111',
      propertyName: 'Casa de prueba', propertyPlace: 'Chile',
      checkIn: '2027-01-10', checkOut: '2027-01-11', guests: 1, nights: 1,
      nightlyPrice: 10000, total: 10000, status: 'pendiente-verificacion',
      expiresAt: '2027-01-01T00:00:00.000Z', accessPin: '123456',
    });
    database.saveDatabase(initial);

    const inspector = new DatabaseSync(databasePath);
    inspector.exec("INSERT INTO estadia_eventos (estadia_codigo, tipo, detalle, creado_at) VALUES ('RB-TEST-000000000001', 'test', '', '2026-01-01T00:00:00Z')");
    inspector.close();

    const propertyEdit = database.readDatabase();
    const reservationEdit = database.readDatabase();
    propertyEdit.properties[0].price = 12000;
    database.saveDatabase(propertyEdit);
    reservationEdit.reservations[0].verificationEmailSentAt = '2026-01-01T00:00:00Z';
    database.saveDatabase(reservationEdit);

    const first = database.readDatabase();
    const second = database.readDatabase();
    first.reservations[0].status = 'correo-verificado-pago-pendiente';
    database.saveDatabase(first);
    second.reservations[0].verificationEmailError = 'Aviso de prueba';
    database.saveDatabase(second);

    const customerEdit = database.readDatabase();
    customerEdit.customers[0].email = 'nuevo@example.test';
    database.saveDatabase(customerEdit);
    const current = database.readDatabase();
    assert.equal(current.properties[0].price, 12000);
    assert.equal(current.reservations[0].status, 'correo-verificado-pago-pendiente');
    assert.equal(current.reservations[0].verificationEmailError, 'Aviso de prueba');
    assert.equal(current.reservations[0].guestEmail, 'original@example.test');
    assert.equal(current.customers[0].email, 'nuevo@example.test');

    const conflictA = database.readDatabase();
    const conflictB = database.readDatabase();
    conflictA.properties[0].price = 15000;
    database.saveDatabase(conflictA);
    conflictB.properties[0].price = 16000;
    assert.throws(() => database.saveDatabase(conflictB), /Conflicto/);

    const check = new DatabaseSync(databasePath, { readOnly: true });
    assert.equal(check.prepare('SELECT COUNT(*) AS n FROM estadia_eventos').get().n, 1);
    assert.equal(check.prepare('SELECT COUNT(*) AS n FROM estadias').get().n, 1);
    check.close();
  } finally {
    database.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
