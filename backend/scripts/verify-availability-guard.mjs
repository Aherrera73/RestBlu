import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';

const databasePath = resolve('data', 'lumastay.sqlite');
const schemaPath = resolve('src', 'database', 'schema.sql');
const database = new DatabaseSync(databasePath);
database.exec('PRAGMA foreign_keys = ON;');
database.exec(readFileSync(schemaPath, 'utf8'));

let overlapRejected = false;
let adjacentAccepted = false;
database.exec('BEGIN IMMEDIATE;');
try {
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO clientes (id, nombre_completo, rut, correo, creado_at, actualizado_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(999999, 'Prueba disponibilidad', '1-9', 'disponibilidad@example.invalid', now, now);
  const insert = database.prepare(`
    INSERT INTO estadias (
      codigo, cliente_id, alojamiento_id, alojamiento_nombre,
      alojamiento_ubicacion, fecha_check_in, fecha_check_out,
      creado_at, actualizado_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run('TEST-BASE', 999999, 1, 'Prueba', 'Chile', '2099-01-10', '2099-01-12', now, now);
  try {
    insert.run('TEST-OVERLAP', 999999, 1, 'Prueba', 'Chile', '2099-01-11', '2099-01-13', now, now);
  } catch (error) {
    overlapRejected = String(error.message).includes('ocupa esas fechas');
  }
  insert.run('TEST-ADJACENT', 999999, 1, 'Prueba', 'Chile', '2099-01-12', '2099-01-13', now, now);
  adjacentAccepted = true;
} finally {
  database.exec('ROLLBACK;');
  database.close();
}

if (!overlapRejected || !adjacentAccepted) {
  throw new Error('La protección de disponibilidad no respondió como se esperaba.');
}
console.log(JSON.stringify({ overlapRejected, adjacentAccepted }, null, 2));
