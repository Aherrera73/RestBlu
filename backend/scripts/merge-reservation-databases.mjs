// Crea una base nueva a partir de la web actual y agrega el historial del
// gestor antiguo. Las dos fuentes se leen sin modificarlas; nunca sobrescribe.
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createLocalDatabase } from '../src/database/local-database.mjs';

const [legacyArg, currentArg, outputArg] = process.argv.slice(2);
if (!legacyArg || !currentArg || !outputArg) {
  throw new Error('Uso: node scripts/merge-reservation-databases.mjs <gestor-antiguo.sqlite> <web-actual.sqlite> <salida-nueva.sqlite>');
}
const legacyPath = resolve(legacyArg);
const currentPath = resolve(currentArg);
const outputPath = resolve(outputArg);
const legacySnapshotPath = `${outputPath}.gestor-original.sqlite`;
if (!existsSync(legacyPath) || !existsSync(currentPath)) throw new Error('Falta una de las bases de origen.');
if (new Set([legacyPath.toLowerCase(), currentPath.toLowerCase(), outputPath.toLowerCase()]).size !== 3) {
  throw new Error('Origen y destino deben ser archivos diferentes.');
}
if (existsSync(outputPath) || existsSync(legacySnapshotPath)) {
  throw new Error('El destino o su respaldo ya existen. Elige un nombre nuevo; nunca se sobrescribe una base.');
}
mkdirSync(dirname(outputPath), { recursive: true });

function snapshot(sourcePath, destinationPath) {
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    const result = source.prepare('PRAGMA integrity_check').get();
    if (result.integrity_check !== 'ok') throw new Error(`Integridad SQLite inválida: ${sourcePath}`);
    source.prepare('VACUUM INTO ?').run(destinationPath);
  } finally {
    source.close();
  }
}

snapshot(currentPath, outputPath);
snapshot(legacyPath, legacySnapshotPath);
const schemaPath = fileURLToPath(new URL('../src/database/schema.sql', import.meta.url));
const open = (databasePath) => createLocalDatabase({
  databasePath,
  schemaPath,
  legacyJsonPath: `${databasePath}.sin-importacion-json`,
});
const current = open(outputPath);
const legacy = open(legacySnapshotPath);
try {
  const merged = current.readDatabase();
  const old = legacy.readDatabase();
  const normalize = (value) => String(value || '').normalize('NFKC').trim().toLocaleLowerCase('es-CL');
  const propertyKey = (item) => `${normalize(item.name)}|${normalize(item.place)}`;
  const byPropertyKey = new Map(merged.properties.map((item) => [propertyKey(item), item.id]));
  const oldPropertyIds = new Map();
  let nextPropertyId = Math.max(0, ...merged.properties.map((item) => item.id));
  for (const property of old.properties) {
    const key = propertyKey(property);
    let id = byPropertyKey.get(key);
    if (!id) {
      id = ++nextPropertyId;
      merged.properties.push({ ...property, id });
      byPropertyKey.set(key, id);
    }
    oldPropertyIds.set(property.id, id);
  }

  const byRut = new Map(merged.customers.filter((item) => item.documentId)
    .map((item) => [normalize(item.documentId).replace(/[^0-9k]/g, ''), item]));
  const byEmail = new Map(merged.customers.filter((item) => item.email)
    .map((item) => [normalize(item.email), item]));
  const oldCustomerIds = new Map();
  let nextCustomerId = Math.max(0, ...merged.customers.map((item) => item.id));
  for (const customer of old.customers) {
    const rut = normalize(customer.documentId).replace(/[^0-9k]/g, '');
    const rutMatch = rut ? byRut.get(rut) : null;
    const emailMatch = customer.email ? byEmail.get(normalize(customer.email)) : null;
    if (rutMatch && emailMatch && rutMatch.id !== emailMatch.id) {
      throw new Error('Una identidad tiene RUT y correo asociados a clientes distintos. Revisión manual obligatoria.');
    }
    if (emailMatch && rut && normalize(emailMatch.documentId).replace(/[^0-9k]/g, '') !== rut) {
      throw new Error('El correo de un cliente coincide con otro RUT. Revisión manual obligatoria.');
    }
    let id = (rutMatch || emailMatch)?.id;
    if (!id) {
      id = ++nextCustomerId;
      const imported = { ...customer, id };
      merged.customers.push(imported);
      if (rut) byRut.set(rut, imported);
      if (customer.email) byEmail.set(normalize(customer.email), imported);
    }
    oldCustomerIds.set(customer.id, id);
  }

  const existingIds = new Set(merged.reservations.map((item) => item.id));
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Santiago',
    year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const recoveredUntil = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  let recoveredUnpaid = 0;
  for (const reservation of old.reservations) {
    if (existingIds.has(reservation.id)) {
      throw new Error(`La reserva ${reservation.id} existe en ambas bases. Revisión manual obligatoria.`);
    }
    const snapshotKey = `${normalize(reservation.propertyName)}|${normalize(reservation.propertyPlace)}`;
    const propertyId = byPropertyKey.get(snapshotKey) || oldPropertyIds.get(reservation.propertyId);
    const selectedProperty = merged.properties.find((item) => item.id === propertyId);
    if (!selectedProperty || propertyKey(selectedProperty) !== snapshotKey) {
      throw new Error(`No se puede asociar con seguridad el alojamiento de ${reservation.id}.`);
    }
    const customerId = oldCustomerIds.get(reservation.customerId);
    if (!customerId) throw new Error(`Falta el cliente de ${reservation.id}.`);
    const imported = { ...reservation, propertyId, customerId };
    if (imported.paymentStatus !== 'aprobado-demo') {
      recoveredUnpaid++;
      imported.paymentStatus = 'pendiente-demo';
      imported.paymentReference = '';
      imported.biometricStatus = 'bloqueada';
      if (imported.checkOut <= today) {
        imported.status = 'expirada';
        imported.expiredAt ||= new Date().toISOString();
      } else {
        imported.status = imported.emailVerifiedAt
          ? 'correo-verificado-pago-pendiente' : 'pendiente-verificacion';
        imported.expiresAt = recoveredUntil;
        imported.expiredAt = '';
      }
      imported.updatedAt = new Date().toISOString();
    }
    merged.reservations.push(imported);
  }
  current.saveDatabase(merged);
  const counts = current.tableCounts();
  if (counts.reservations !== existingIds.size + old.reservations.length) {
    throw new Error('La cantidad de reservas resultante no coincide con la suma de ambas bases.');
  }
  console.log(JSON.stringify({ outputPath, legacySnapshotPath, counts, recoveredUnpaid }, null, 2));
} finally {
  legacy.close();
  current.close();
}

// Los eventos históricos se copian después del guardado de dominio.
const result = new DatabaseSync(outputPath);
try {
  const oldEvents = new DatabaseSync(legacyPath, { readOnly: true });
  try {
    const insert = result.prepare('INSERT INTO estadia_eventos (estadia_codigo, tipo, detalle, creado_at) VALUES (?, ?, ?, ?)');
    result.exec('BEGIN IMMEDIATE');
    try {
      for (const event of oldEvents.prepare('SELECT estadia_codigo, tipo, detalle, creado_at FROM estadia_eventos').all()) {
        insert.run(event.estadia_codigo, event.tipo, event.detalle, event.creado_at);
      }
      result.exec('COMMIT');
    } catch (error) {
      result.exec('ROLLBACK');
      throw error;
    }
  } finally {
    oldEvents.close();
  }
  if (result.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' ||
      result.prepare('PRAGMA foreign_key_check').all().length) {
    throw new Error('Falló la verificación final de integridad de la base fusionada.');
  }
} finally {
  result.close();
}
