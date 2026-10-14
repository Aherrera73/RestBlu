import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import {
  CUSTOMER_COLUMNS, PROPERTY_COLUMNS, RESERVATION_COLUMNS, SCHEMA_VERSION,
  accessEventFromRow, customerFromRow, customerValues, integer, now, planCollection,
  propertyFromRow, propertyImages, propertyTags, propertyValues, refreshFromPersisted,
  reservationFromRow, reservationValues,
} from './records.mjs';

export function createLocalDatabase({ databasePath, legacyJsonPath, schemaPath }) {
  mkdirSync(dirname(databasePath), { recursive: true });
  const sqlite = new DatabaseSync(databasePath);
  sqlite.exec('PRAGMA foreign_keys = ON;');
  // Una sola base portable resulta más práctica para DBeaver y respaldos locales.
  sqlite.exec('PRAGMA journal_mode = DELETE;');
  sqlite.exec('PRAGMA busy_timeout = 5000;');
  sqlite.exec(readFileSync(schemaPath, 'utf8'));
  const readSnapshots = new WeakMap();
  const reservationColumns = new Set(
    sqlite.prepare('PRAGMA table_info(estadias)').all().map((column) => column.name),
  );
  if (!reservationColumns.has('token_verificacion_hash')) {
    sqlite.exec('ALTER TABLE estadias ADD COLUMN token_verificacion_hash TEXT;');
  }
  if (!reservationColumns.has('token_verificacion_pendiente')) {
    sqlite.exec('ALTER TABLE estadias ADD COLUMN token_verificacion_pendiente TEXT;');
  }
  if (!reservationColumns.has('error_correo_verificacion')) {
    sqlite.exec('ALTER TABLE estadias ADD COLUMN error_correo_verificacion TEXT;');
  }
  for (const [column, definition] of [
    ['huesped_nombre', "TEXT NOT NULL DEFAULT ''"],
    ['huesped_rut', "TEXT NOT NULL DEFAULT ''"],
    ['huesped_correo', "TEXT NOT NULL DEFAULT ''"],
    ['huesped_telefono', "TEXT NOT NULL DEFAULT ''"],
    ['vence_at', 'TEXT'],
    ['vencida_at', 'TEXT'],
    ['owner_uid', "TEXT NOT NULL DEFAULT ''"],
    ['pago_estado', "TEXT NOT NULL DEFAULT 'no-realizado-demo'"],
    ['pago_referencia', "TEXT NOT NULL DEFAULT ''"],
    ['biometria_perfil_id', 'TEXT'],
    ['biometria_plantilla_cifrada', 'TEXT'],
    ['biometria_estado', "TEXT NOT NULL DEFAULT 'sin-registrar'"],
    ['biometria_consentimiento_at', 'TEXT'],
    ['biometria_registrada_at', 'TEXT'],
    ['biometria_expira_at', 'TEXT'],
    ['biometria_revocada_at', 'TEXT'],
    ['biometria_ultima_verificacion_at', 'TEXT'],
    ['biometria_ultimo_puntaje', 'REAL'],
    ['biometria_ultimo_error', 'TEXT'],
    ['dahua_user_id', 'TEXT'],
    ['dahua_rec_no', 'TEXT'],
    ['dahua_estado', "TEXT NOT NULL DEFAULT 'sin-registrar'"],
    ['dahua_error', 'TEXT'],
    ['dahua_registrado_at', 'TEXT'],
    ['dahua_verificado_at', 'TEXT'],
    ['dahua_revocado_at', 'TEXT'],
    ['dahua_qr_codigo', 'TEXT'],
    ['dahua_qr_estado', "TEXT NOT NULL DEFAULT 'sin-registrar'"],
    ['dahua_qr_error', 'TEXT'],
    ['dahua_qr_registrado_at', 'TEXT'],
    ['pago_token', "TEXT NOT NULL DEFAULT ''"],
    ['pago_detalle', "TEXT NOT NULL DEFAULT ''"],
    ['dahua_terminal', "TEXT NOT NULL DEFAULT ''"],
  ]) {
    if (!reservationColumns.has(column)) {
      sqlite.exec(`ALTER TABLE estadias ADD COLUMN ${column} ${definition};`);
    }
  }
  const customerColumns = new Set(
    sqlite.prepare('PRAGMA table_info(clientes)').all().map((column) => column.name),
  );
  // Cuenta RestBlu (uid de Firebase) a la que pertenece la ficha del cliente.
  if (!customerColumns.has('owner_uid')) {
    sqlite.exec("ALTER TABLE clientes ADD COLUMN owner_uid TEXT NOT NULL DEFAULT '';");
  }
  // Terminal del que se copió cada movimiento: 'lan' o un Registration ID del hub.
  const accessColumns = new Set(
    sqlite.prepare('PRAGMA table_info(accesos_eventos)').all().map((column) => column.name),
  );
  if (!accessColumns.has('terminal')) {
    sqlite.exec("ALTER TABLE accesos_eventos ADD COLUMN terminal TEXT NOT NULL DEFAULT '';");
  }
  const propertyColumns = new Set(
    sqlite.prepare('PRAGMA table_info(alojamientos)').all().map((column) => column.name),
  );
  for (const [column, definition] of [
    ['propietario_nombre', "TEXT NOT NULL DEFAULT ''"],
    ['propietario_rut', "TEXT NOT NULL DEFAULT ''"],
    ['propietario_correo', "TEXT NOT NULL DEFAULT ''"],
    ['propietario_telefono', "TEXT NOT NULL DEFAULT ''"],
    ['dahua_registration_id', "TEXT NOT NULL DEFAULT ''"],
    ['manual_publico', "TEXT NOT NULL DEFAULT ''"],
    ['manual_huesped', "TEXT NOT NULL DEFAULT ''"],
  ]) {
    if (!propertyColumns.has(column)) {
      sqlite.exec(`ALTER TABLE alojamientos ADD COLUMN ${column} ${definition};`);
    }
  }

  function metadata(key) {
    return sqlite.prepare('SELECT value FROM app_metadata WHERE key = ?').get(key)?.value;
  }

  function setMetadata(key, value) {
    sqlite
      .prepare(`INSERT INTO app_metadata (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(key, String(value));
  }

  if (metadata('reservation_guest_snapshot_backfill') !== '1') {
    // Para reservas históricas no se puede reconstruir el contacto original;
    // se congela la ficha que existe hoy y no se vuelve a sobrescribir.
    sqlite.exec(`
      UPDATE estadias SET
        huesped_nombre = COALESCE(NULLIF(huesped_nombre, ''), (SELECT nombre_completo FROM clientes WHERE id = cliente_id), ''),
        huesped_rut = COALESCE(NULLIF(huesped_rut, ''), (SELECT rut FROM clientes WHERE id = cliente_id), ''),
        huesped_correo = COALESCE(NULLIF(huesped_correo, ''), (SELECT correo FROM clientes WHERE id = cliente_id), ''),
        huesped_telefono = COALESCE(NULLIF(huesped_telefono, ''), (SELECT telefono FROM clientes WHERE id = cliente_id), '');
    `);
    setMetadata('reservation_guest_snapshot_backfill', '1');
  }

  if (integer(metadata('schema_version'), 0) < 9) {
    setMetadata('schema_version', '9');
  }


  function readDatabase() {
    const imageStatement = sqlite.prepare(`
      SELECT url, texto_alternativo, es_principal, orden
      FROM alojamiento_imagenes
      WHERE alojamiento_id = ?
      ORDER BY es_principal DESC, orden ASC, id ASC
    `);
    const tagStatement = sqlite.prepare(`
      SELECT etiqueta FROM alojamiento_etiquetas
      WHERE alojamiento_id = ? ORDER BY etiqueta COLLATE NOCASE
    `);

    const properties = sqlite.prepare('SELECT * FROM alojamientos ORDER BY id').all().map((row) =>
      propertyFromRow(row, imageStatement.all(row.id), tagStatement.all(row.id).map((tag) => tag.etiqueta)));
    const customers = sqlite.prepare('SELECT * FROM clientes ORDER BY id').all().map(customerFromRow);
    const reservations = sqlite.prepare('SELECT * FROM estadias ORDER BY creado_at DESC').all().map(reservationFromRow);

    const database = {
      meta: {
        version: integer(metadata('schema_version'), 2),
        updatedAt: metadata('updated_at') || now(),
        storage: 'sqlite',
      },
      properties,
      customers,
      reservations,
    };
    readSnapshots.set(database, structuredClone({ properties, customers, reservations }));
    return database;
  }

  function saveDatabase(database) {
    const updatedAt = now();
    const snapshot = readSnapshots.get(database);
    const prepareRow = (table, columns) => ({
      insert: sqlite.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`),
      update: sqlite.prepare(`UPDATE ${table} SET ${columns.slice(1).map((column) => `${column} = ?`).join(', ')} WHERE ${columns[0]} = ?`),
      count: columns.length,
    });
    const customerRow = prepareRow('clientes', CUSTOMER_COLUMNS);
    const propertyRow = prepareRow('alojamientos', PROPERTY_COLUMNS);
    const reservationRow = prepareRow('estadias', RESERVATION_COLUMNS);
    const insertImage = sqlite.prepare(`
      INSERT INTO alojamiento_imagenes
      (alojamiento_id, url, texto_alternativo, es_principal, orden)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertTag = sqlite.prepare(`
      INSERT INTO alojamiento_etiquetas (alojamiento_id, etiqueta) VALUES (?, ?)
    `);
    const writeRow = (row, values, existing) => {
      if (values.length !== row.count) throw new Error('El esquema SQLite y los valores no coinciden.');
      if (existing) row.update.run(...values.slice(1), values[0]);
      else row.insert.run(...values);
    };

    sqlite.exec('BEGIN IMMEDIATE;');
    try {
      const changes = snapshot ? (() => {
        const latest = readDatabase();
        return {
          customers: planCollection('customers', snapshot, latest, database),
          properties: planCollection('properties', snapshot, latest, database),
          reservations: planCollection('reservations', snapshot, latest, database),
        };
      })() : null;
      if (!changes) {
        // Sólo la importación inicial y el reseed explícito reemplazan el conjunto completo.
        sqlite.exec(`
          DELETE FROM estadia_eventos;
          DELETE FROM estadias;
          DELETE FROM alojamiento_etiquetas;
          DELETE FROM alojamiento_imagenes;
          DELETE FROM alojamientos;
          DELETE FROM clientes;
        `);
      } else {
        for (const id of changes.reservations.removals) sqlite.prepare('DELETE FROM estadias WHERE codigo = ?').run(id);
        for (const id of changes.properties.removals) sqlite.prepare('DELETE FROM alojamientos WHERE id = ?').run(id);
        for (const id of changes.customers.removals) sqlite.prepare('DELETE FROM clientes WHERE id = ?').run(id);
      }

      for (const entry of changes?.customers.upserts || (database.customers || []).map((value) => ({ value, existing: false }))) {
        writeRow(customerRow, customerValues(entry.value, updatedAt), entry.existing);
      }

      for (const entry of changes?.properties.upserts || (database.properties || []).map((value) => ({ value, existing: false }))) {
        const property = entry.value;
        writeRow(propertyRow, propertyValues(property, updatedAt), entry.existing);
        if (entry.existing) {
          sqlite.prepare('DELETE FROM alojamiento_imagenes WHERE alojamiento_id = ?').run(property.id);
          sqlite.prepare('DELETE FROM alojamiento_etiquetas WHERE alojamiento_id = ?').run(property.id);
        }
        for (const image of propertyImages(property)) insertImage.run(property.id, ...image);
        for (const tag of propertyTags(property)) insertTag.run(property.id, tag);
      }

      for (const entry of changes?.reservations.upserts || (database.reservations || []).map((value) => ({ value, existing: false }))) {
        writeRow(reservationRow, reservationValues(entry.value, database.customers, updatedAt), entry.existing);
      }

      setMetadata('schema_version', SCHEMA_VERSION);
      setMetadata('updated_at', updatedAt);
      setMetadata('legacy_import_complete', '1');
      sqlite.exec('COMMIT;');
      refreshFromPersisted(database, readDatabase());
      readSnapshots.set(database, structuredClone({
        properties: database.properties || [],
        customers: database.customers || [],
        reservations: database.reservations || [],
      }));
      sqlite.exec('PRAGMA optimize;');
    } catch (error) {
      sqlite.exec('ROLLBACK;');
      throw error;
    }
  }

  if (metadata('legacy_import_complete') !== '1') {
    if (existsSync(legacyJsonPath)) {
      saveDatabase(JSON.parse(readFileSync(legacyJsonPath, 'utf8')));
    } else {
      setMetadata('schema_version', '9');
      setMetadata('updated_at', now());
      setMetadata('legacy_import_complete', '1');
    }
  }

  return {
    engine: 'SQLite',
    storage: 'sqlite',
    path: databasePath,
    readDatabase,
    saveDatabase,
    hasVerifiedEmailSession: (ownerUid, email, rut) => Boolean(sqlite.prepare(
      'SELECT 1 FROM correo_sesiones_verificadas WHERE owner_uid = ? AND correo = ? AND rut = ? LIMIT 1',
    ).get(ownerUid, email, rut)),
    rememberVerifiedEmailSession: (ownerUid, email, rut) => sqlite.prepare(`
      INSERT INTO correo_sesiones_verificadas (owner_uid, correo, rut, verificado_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(owner_uid, correo, rut)
      DO UPDATE SET verificado_at = excluded.verificado_at
    `).run(ownerUid, email, rut, now()),
    // Último movimiento copiado de un terminal (los anteriores al hub son 'lan').
    lastAccessEventAt: (terminal = 'lan') => sqlite.prepare(
      "SELECT MAX(ocurrido_at) AS last FROM accesos_eventos WHERE terminal = ? OR (? = 'lan' AND terminal = '')",
    ).get(terminal, terminal).last || null,
    // Fecha desde la que se copia el registro del Dahua (la fija una limpieza).
    accessEventsSince: () => metadata('accesos_sincronizar_desde') || null,
    saveAccessEvents: (events) => {
      const insert = sqlite.prepare(`
        INSERT OR IGNORE INTO accesos_eventos (
          dahua_rec_no, ocurrido_at, tipo, metodo, autorizado, codigo_error,
          dahua_user_id, persona, estadia_codigo, alojamiento_id, terminal
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      let inserted = 0;
      sqlite.exec('BEGIN IMMEDIATE;');
      try {
        for (const event of events) {
          inserted += insert.run(
            event.recNo, event.occurredAt, event.type, event.method ?? null,
            event.authorized ? 1 : 0, event.errorCode ?? null, event.userId || '',
            event.person || '', event.reservationId || null, event.propertyId ?? null,
            event.terminal || '',
          ).changes;
        }
        sqlite.exec('COMMIT;');
      } catch (error) {
        sqlite.exec('ROLLBACK;');
        throw error;
      }
      return inserted;
    },
    listAccessEvents: ({ since = null, limit = 1000 } = {}) => sqlite.prepare(`
      SELECT id, ocurrido_at AS occurredAt, tipo AS type, metodo AS method,
        autorizado AS authorized, codigo_error AS errorCode, dahua_user_id AS userId,
        persona AS person, estadia_codigo AS reservationId, alojamiento_id AS propertyId,
        terminal
      FROM accesos_eventos
      WHERE (? IS NULL OR ocurrido_at >= ?)
      ORDER BY ocurrido_at DESC, id DESC
      LIMIT ?
    `).all(since, since, Math.min(5000, Math.max(1, limit))).map(accessEventFromRow),
    close: () => sqlite.close(),
    // Valoraciones 👍 / 👎 de las respuestas de la IA (una por solicitud).
    saveAiFeedback: (item) => sqlite.prepare(`
      INSERT INTO ia_valoraciones (solicitud_id, canal, pregunta, respuesta, valoracion, owner_uid, creado_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(solicitud_id) DO UPDATE SET valoracion = excluded.valoracion, creado_at = excluded.creado_at
    `).run(item.requestId, item.channel, item.question, item.answer, item.rating, item.ownerUid || '', item.createdAt || now()),
    listAiFeedback: ({ limit = 200 } = {}) => sqlite.prepare(`
      SELECT id, solicitud_id AS requestId, canal AS channel, pregunta AS question, respuesta AS answer,
        valoracion AS rating, creado_at AS createdAt
      FROM ia_valoraciones ORDER BY creado_at DESC LIMIT ?
    `).all(Math.min(1000, Math.max(1, limit))),
    tableCounts: () => ({
      properties: sqlite.prepare('SELECT COUNT(*) AS count FROM alojamientos').get().count,
      customers: sqlite.prepare('SELECT COUNT(*) AS count FROM clientes').get().count,
      reservations: sqlite.prepare('SELECT COUNT(*) AS count FROM estadias').get().count,
      images: sqlite.prepare('SELECT COUNT(*) AS count FROM alojamiento_imagenes').get().count,
      tags: sqlite.prepare('SELECT COUNT(*) AS count FROM alojamiento_etiquetas').get().count,
    }),
  };
}
