import { existsSync, readFileSync } from 'node:fs';
import sql from 'mssql';
import { createLocalDatabase } from './local-database.mjs';
import { ownerFromRow, OwnerError } from '../owners/owner-service.mjs';
import {
  CUSTOMER_COLUMNS, PROPERTY_COLUMNS, RESERVATION_COLUMNS, SCHEMA_VERSION,
  accessEventFromRow, customerFromRow, customerValues, integer, now, planCollection,
  propertyFromRow, propertyImages, propertyTags, propertyValues, refreshFromPersisted,
  reservationFromRow, reservationValues,
} from './records.mjs';

// Misma interfaz que createLocalDatabase (SQLite), pero asíncrona y sobre
// SQL Server. La primera vez que arranca con una base vacía copia los datos
// de la base SQLite anterior.

export function sqlServerConfigFromEnv(env = process.env) {
  const value = (name, fallback = '') => String(env[`RESTBLU_SQLSERVER_${name}`] ?? fallback).trim();
  const config = {
    server: value('HOST', 'localhost'),
    port: integer(value('PORT', '1433'), 1433),
    database: value('DATABASE', 'RestBlu'),
    user: value('USER', 'restblu_app'),
    password: value('PASSWORD'),
    options: {
      encrypt: value('ENCRYPT', 'true') !== 'false',
      // SQL Server Express local usa un certificado autofirmado.
      trustServerCertificate: value('TRUST_CERTIFICATE', 'true') !== 'false',
      instanceName: value('INSTANCE') || undefined,
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30_000 },
    connectionTimeout: 15_000,
    requestTimeout: 30_000,
  };
  if (config.options.instanceName) delete config.port;
  return config;
}

export function describeSqlServer(config) {
  const instance = config.options?.instanceName ? `\\${config.options.instanceName}` : `:${config.port}`;
  return `${config.server}${instance}/${config.database}`;
}

// Ejecuta una consulta con parámetros @p0, @p1… en el orden de values.
function exec(executor, text, values = []) {
  const request = new sql.Request(executor);
  values.forEach((value, index) => request.input(`p${index}`, value === undefined ? null : value));
  return request.query(text);
}

function schemaBatches(schemaPath) {
  return readFileSync(schemaPath, 'utf8')
    .split(/^\s*GO\s*$/im)
    .map((batch) => batch.trim())
    .filter((batch) => batch.replace(/^\s*--.*$/gm, '').trim());
}

const DUPLICATE_KEY_ERRORS = new Set([2601, 2627]);

export async function createSqlServerDatabase({ config, schemaPath, importFrom = null }) {
  const pool = new sql.ConnectionPool(config);
  pool.on('error', (error) => console.warn(`[SQL Server] ${error.message}`));
  try {
    await pool.connect();
  } catch (error) {
    throw new Error(`No fue posible conectar con SQL Server en ${describeSqlServer(config)}: ${error.message}`);
  }
  for (const batch of schemaBatches(schemaPath)) await exec(pool, batch);
  // Las lecturas no esperan a que termine un guardado en curso.
  try {
    await exec(pool, `IF (SELECT is_read_committed_snapshot_on FROM sys.databases WHERE name = DB_NAME()) = 0
      EXEC('ALTER DATABASE CURRENT SET READ_COMMITTED_SNAPSHOT ON WITH ROLLBACK IMMEDIATE')`);
  } catch (error) {
    console.warn(`[SQL Server] No se activó READ_COMMITTED_SNAPSHOT: ${error.message}`);
  }
  const readSnapshots = new WeakMap();

  async function metadata(key, executor = pool) {
    return (await exec(executor, 'SELECT value FROM dbo.app_metadata WHERE [key] = @p0', [key])).recordset[0]?.value;
  }

  async function setMetadata(key, value, executor = pool) {
    await exec(executor, `
      MERGE dbo.app_metadata WITH (HOLDLOCK) AS destino
      USING (SELECT @p0 AS [key]) AS origen ON destino.[key] = origen.[key]
      WHEN MATCHED THEN UPDATE SET value = @p1
      WHEN NOT MATCHED THEN INSERT ([key], value) VALUES (@p0, @p1);
    `, [key, String(value)]);
  }

  async function readDatabase(executor = pool) {
    const { recordsets } = await exec(executor, `
      SELECT * FROM dbo.alojamientos ORDER BY id;
      SELECT alojamiento_id, url, texto_alternativo, es_principal, orden
        FROM dbo.alojamiento_imagenes ORDER BY alojamiento_id, es_principal DESC, orden ASC, id ASC;
      SELECT alojamiento_id, etiqueta FROM dbo.alojamiento_etiquetas ORDER BY alojamiento_id, etiqueta;
      SELECT * FROM dbo.clientes ORDER BY id;
      SELECT * FROM dbo.estadias ORDER BY creado_at DESC;
      SELECT [key], value FROM dbo.app_metadata WHERE [key] IN ('schema_version', 'updated_at');
    `);
    const [propertyRows, imageRows, tagRows, customerRows, reservationRows, metadataRows] = recordsets;
    const group = (rows) => {
      const groups = new Map();
      for (const row of rows) {
        if (!groups.has(row.alojamiento_id)) groups.set(row.alojamiento_id, []);
        groups.get(row.alojamiento_id).push(row);
      }
      return groups;
    };
    const images = group(imageRows);
    const tags = group(tagRows);
    const meta = Object.fromEntries(metadataRows.map((row) => [row.key, row.value]));
    const properties = propertyRows.map((row) => propertyFromRow(
      row, images.get(row.id) || [], (tags.get(row.id) || []).map((tag) => tag.etiqueta),
    ));
    const customers = customerRows.map(customerFromRow);
    const reservations = reservationRows.map(reservationFromRow);
    const database = {
      meta: {
        version: integer(meta.schema_version, 2),
        updatedAt: meta.updated_at || now(),
        storage: 'sqlserver',
      },
      properties,
      customers,
      reservations,
    };
    readSnapshots.set(database, structuredClone({ properties, customers, reservations }));
    return database;
  }

  const rowStatements = (table, columns) => ({
    insert: `INSERT INTO dbo.${table} (${columns.join(', ')}) VALUES (${columns.map((_, index) => `@p${index}`).join(', ')})`,
    update: `UPDATE dbo.${table} SET ${columns.slice(1).map((column, index) => `${column} = @p${index + 1}`).join(', ')} WHERE ${columns[0]} = @p0`,
    count: columns.length,
  });
  const customerRow = rowStatements('clientes', CUSTOMER_COLUMNS);
  const propertyRow = rowStatements('alojamientos', PROPERTY_COLUMNS);
  const reservationRow = rowStatements('estadias', RESERVATION_COLUMNS);

  async function writeRow(transaction, row, values, existing) {
    if (values.length !== row.count) throw new Error('El esquema SQL Server y los valores no coinciden.');
    await exec(transaction, existing ? row.update : row.insert, values);
  }

  async function saveDatabase(database) {
    const updatedAt = now();
    const snapshot = readSnapshots.get(database);
    const transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
    try {
      // Un guardado a la vez, como BEGIN IMMEDIATE en SQLite.
      await exec(transaction, `
        DECLARE @resultado INT;
        EXEC @resultado = sp_getapplock @Resource = 'restblu-guardar', @LockMode = 'Exclusive',
          @LockOwner = 'Transaction', @LockTimeout = 15000;
        IF @resultado < 0 THROW 50002, 'La base de datos está ocupada. Reintenta la operación.', 1;
      `);
      let changes = null;
      if (snapshot) {
        const latest = await readDatabase(transaction);
        changes = {
          customers: planCollection('customers', snapshot, latest, database),
          properties: planCollection('properties', snapshot, latest, database),
          reservations: planCollection('reservations', snapshot, latest, database),
        };
      }
      if (!changes) {
        // Sólo la importación inicial y el reseed explícito reemplazan el conjunto completo.
        await exec(transaction, `
          DELETE FROM dbo.estadia_eventos;
          DELETE FROM dbo.estadias;
          DELETE FROM dbo.alojamiento_etiquetas;
          DELETE FROM dbo.alojamiento_imagenes;
          DELETE FROM dbo.alojamientos;
          DELETE FROM dbo.clientes;
        `);
      } else {
        for (const id of changes.reservations.removals) await exec(transaction, 'DELETE FROM dbo.estadias WHERE codigo = @p0', [id]);
        for (const id of changes.properties.removals) await exec(transaction, 'DELETE FROM dbo.alojamientos WHERE id = @p0', [id]);
        for (const id of changes.customers.removals) await exec(transaction, 'DELETE FROM dbo.clientes WHERE id = @p0', [id]);
      }

      const all = (items) => (items || []).map((value) => ({ value, existing: false }));
      for (const entry of changes?.customers.upserts || all(database.customers)) {
        await writeRow(transaction, customerRow, customerValues(entry.value, updatedAt), entry.existing);
      }
      for (const entry of changes?.properties.upserts || all(database.properties)) {
        const property = entry.value;
        await writeRow(transaction, propertyRow, propertyValues(property, updatedAt), entry.existing);
        if (entry.existing) {
          await exec(transaction, `
            DELETE FROM dbo.alojamiento_imagenes WHERE alojamiento_id = @p0;
            DELETE FROM dbo.alojamiento_etiquetas WHERE alojamiento_id = @p0;
          `, [property.id]);
        }
        for (const image of propertyImages(property)) {
          await exec(transaction, `INSERT INTO dbo.alojamiento_imagenes
            (alojamiento_id, url, texto_alternativo, es_principal, orden) VALUES (@p0, @p1, @p2, @p3, @p4)`,
          [property.id, ...image]);
        }
        for (const tag of propertyTags(property)) {
          await exec(transaction, 'INSERT INTO dbo.alojamiento_etiquetas (alojamiento_id, etiqueta) VALUES (@p0, @p1)', [property.id, tag]);
        }
      }
      for (const entry of changes?.reservations.upserts || all(database.reservations)) {
        await writeRow(transaction, reservationRow, reservationValues(entry.value, database.customers, updatedAt), entry.existing);
      }

      await setMetadata('schema_version', SCHEMA_VERSION, transaction);
      await setMetadata('updated_at', updatedAt, transaction);
      await setMetadata('legacy_import_complete', '1', transaction);
      await transaction.commit();
    } catch (error) {
      // Un THROW dentro de un trigger ya revierte la transacción.
      await transaction.rollback().catch(() => {});
      throw error;
    }
    refreshFromPersisted(database, await readDatabase());
    readSnapshots.set(database, structuredClone({
      properties: database.properties || [],
      customers: database.customers || [],
      reservations: database.reservations || [],
    }));
  }

  async function insertAccessEvent(executor, event) {
    try {
      const result = await exec(executor, `
        INSERT INTO dbo.accesos_eventos (
          dahua_rec_no, ocurrido_at, tipo, metodo, autorizado, codigo_error,
          dahua_user_id, persona, estadia_codigo, alojamiento_id, terminal
        )
        SELECT @p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8, @p9, @p10
        WHERE NOT EXISTS (SELECT 1 FROM dbo.accesos_eventos WHERE dahua_rec_no = @p0 AND ocurrido_at = @p1)
      `, [
        event.recNo, event.occurredAt, event.type || '', event.method ?? null,
        event.authorized ? 1 : 0, event.errorCode ?? null, event.userId || '',
        event.person || '', event.reservationId || null, event.propertyId ?? null,
        event.terminal || '',
      ]);
      return result.rowsAffected[0] || 0;
    } catch (error) {
      if (DUPLICATE_KEY_ERRORS.has(error?.number)) return 0;
      throw error;
    }
  }

  // Copia todo desde la base SQLite anterior y reemplaza lo que hubiera aquí.
  async function importFromSqlite({ sqlitePath, sqliteSchemaPath, legacyJsonPath = '' }) {
    const source = createLocalDatabase({ databasePath: sqlitePath, legacyJsonPath, schemaPath: sqliteSchemaPath });
    try {
      const { DatabaseSync } = await import('node:sqlite');
      const raw = new DatabaseSync(sqlitePath, { readOnly: true });
      const sessions = raw.prepare('SELECT owner_uid, correo, rut, verificado_at FROM correo_sesiones_verificadas').all();
      const events = raw.prepare(`SELECT dahua_rec_no AS recNo, ocurrido_at AS occurredAt, tipo AS type,
        metodo AS method, autorizado AS authorized, codigo_error AS errorCode, dahua_user_id AS userId,
        persona AS person, estadia_codigo AS reservationId, alojamiento_id AS propertyId, terminal
        FROM accesos_eventos ORDER BY id`).all();
      const stayEvents = raw.prepare('SELECT estadia_codigo, tipo, detalle, creado_at FROM estadia_eventos ORDER BY id').all();
      const meta = raw.prepare('SELECT key, value FROM app_metadata').all();
      raw.close();

      const data = source.readDatabase();
      await saveDatabase({ meta: data.meta, properties: data.properties, customers: data.customers, reservations: data.reservations });
      await exec(pool, 'DELETE FROM dbo.propietario_alojamientos; DELETE FROM dbo.propietarios;');
      for (const owner of source.listOwners()) await saveOwner(owner);
      await exec(pool, 'DELETE FROM dbo.correo_sesiones_verificadas; DELETE FROM dbo.accesos_eventos;');
      for (const row of sessions) {
        await exec(pool, 'INSERT INTO dbo.correo_sesiones_verificadas (owner_uid, correo, rut, verificado_at) VALUES (@p0, @p1, @p2, @p3)',
          [row.owner_uid, row.correo, row.rut, row.verificado_at]);
      }
      for (const event of events) await insertAccessEvent(pool, { ...event, authorized: Number(event.authorized) === 1 });
      for (const row of stayEvents) {
        await exec(pool, 'INSERT INTO dbo.estadia_eventos (estadia_codigo, tipo, detalle, creado_at) VALUES (@p0, @p1, @p2, @p3)',
          [row.estadia_codigo, row.tipo, row.detalle, row.creado_at]);
      }
      for (const { key, value } of meta) {
        if (!['schema_version', 'updated_at', 'legacy_import_complete'].includes(key)) await setMetadata(key, value);
      }
      await setMetadata('importado_desde_sqlite', `${sqlitePath} | ${now()}`);
      return {
        properties: data.properties.length,
        customers: data.customers.length,
        reservations: data.reservations.length,
        verifiedSessions: sessions.length,
        accessEvents: events.length,
      };
    } finally {
      source.close();
    }
  }

  async function listOwners() {
    const { recordsets: [rows, assignments] } = await exec(pool, `
      SELECT * FROM dbo.propietarios ORDER BY nombre, id;
      SELECT propietario_id, alojamiento_id FROM dbo.propietario_alojamientos ORDER BY alojamiento_id;
    `);
    return rows.map((row) => ownerFromRow(row,
      assignments.filter((item) => item.propietario_id === row.id).map((item) => item.alojamiento_id)));
  }

  async function saveOwner(owner) {
    const transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      await exec(transaction, `
        MERGE dbo.propietarios WITH (HOLDLOCK) AS destino
        USING (SELECT @p0 AS id) AS origen ON destino.id = origen.id
        WHEN MATCHED THEN UPDATE SET nombre = @p2, telefono = @p4, activo = @p5, actualizado_at = @p7
        WHEN NOT MATCHED THEN INSERT (id, firebase_uid, nombre, correo, telefono, activo, creado_at, actualizado_at)
          VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7);
      `, [owner.id, owner.uid, owner.name, owner.email, owner.phone, owner.active, owner.createdAt, owner.updatedAt]);
      await exec(transaction, 'DELETE FROM dbo.propietario_alojamientos WHERE propietario_id = @p0', [owner.id]);
      for (const propertyId of owner.propertyIds) {
        await exec(transaction, 'INSERT INTO dbo.propietario_alojamientos (alojamiento_id, propietario_id) VALUES (@p0, @p1)', [propertyId, owner.id]);
      }
      await setMetadata('updated_at', now(), transaction);
      await transaction.commit();
    } catch (error) {
      await transaction.rollback().catch(() => {});
      if (DUPLICATE_KEY_ERRORS.has(error?.number)) {
        throw new OwnerError('El correo, la cuenta o una propiedad ya se asignaron a otro propietario. Actualiza la lista.', 409);
      }
      throw error;
    }
    return (await listOwners()).find((item) => item.id === owner.id);
  }

  if (await metadata('legacy_import_complete') !== '1') {
    if (importFrom?.sqlitePath && existsSync(importFrom.sqlitePath)) {
      const counts = await importFromSqlite(importFrom);
      console.log(`[SQL Server] Datos copiados desde SQLite: ${JSON.stringify(counts)}`);
    } else if (importFrom?.legacyJsonPath && existsSync(importFrom.legacyJsonPath)) {
      const legacy = JSON.parse(readFileSync(importFrom.legacyJsonPath, 'utf8'));
      await saveDatabase(legacy);
      for (const owner of legacy.owners || []) await saveOwner(owner);
    } else {
      await setMetadata('schema_version', SCHEMA_VERSION);
      await setMetadata('updated_at', now());
      await setMetadata('legacy_import_complete', '1');
    }
  }

  if (integer(await metadata('schema_version'), 0) < Number(SCHEMA_VERSION)) {
    await setMetadata('schema_version', SCHEMA_VERSION);
  }

  return {
    listOwners,
    saveOwner,
    engine: 'SQL Server',
    storage: 'sqlserver',
    path: describeSqlServer(config),
    readDatabase: () => readDatabase(),
    saveDatabase,
    importFromSqlite,
    hasVerifiedEmailSession: async (ownerUid, email, rut) => (await exec(pool,
      'SELECT TOP 1 1 AS ok FROM dbo.correo_sesiones_verificadas WHERE owner_uid = @p0 AND correo = @p1 AND rut = @p2',
      [ownerUid, email, rut])).recordset.length > 0,
    rememberVerifiedEmailSession: async (ownerUid, email, rut) => {
      await exec(pool, `
        MERGE dbo.correo_sesiones_verificadas WITH (HOLDLOCK) AS destino
        USING (SELECT @p0 AS owner_uid, @p1 AS correo, @p2 AS rut) AS origen
          ON destino.owner_uid = origen.owner_uid AND destino.correo = origen.correo AND destino.rut = origen.rut
        WHEN MATCHED THEN UPDATE SET verificado_at = @p3
        WHEN NOT MATCHED THEN INSERT (owner_uid, correo, rut, verificado_at) VALUES (@p0, @p1, @p2, @p3);
      `, [ownerUid, email, rut, now()]);
    },
    // Último movimiento copiado de un terminal (los anteriores al hub son 'lan').
    lastAccessEventAt: async (terminal = 'lan') => (await exec(pool,
      "SELECT MAX(ocurrido_at) AS last FROM dbo.accesos_eventos WHERE terminal = @p0 OR (@p0 = 'lan' AND terminal = '')",
      [terminal])).recordset[0]?.last || null,
    // Fecha desde la que se copia el registro del Dahua (la fija una limpieza).
    accessEventsSince: async () => (await metadata('accesos_sincronizar_desde')) || null,
    saveAccessEvents: async (events) => {
      let inserted = 0;
      for (const event of events) inserted += await insertAccessEvent(pool, event);
      return inserted;
    },
    listAccessEvents: async ({ since = null, limit = 1000 } = {}) => (await exec(pool, `
      SELECT TOP (@p1) id, ocurrido_at AS occurredAt, tipo AS type, metodo AS method,
        autorizado AS authorized, codigo_error AS errorCode, dahua_user_id AS userId,
        persona AS person, estadia_codigo AS reservationId, alojamiento_id AS propertyId,
        terminal
      FROM dbo.accesos_eventos
      WHERE (@p0 IS NULL OR ocurrido_at >= @p0)
      ORDER BY ocurrido_at DESC, id DESC
    `, [since, Math.min(5000, Math.max(1, limit))])).recordset.map(accessEventFromRow),
    // Limpieza de reservas: deja los alojamientos y borra todo lo demás.
    resetReservationData: async (accessSyncSince) => {
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        await exec(transaction, `
          DELETE FROM dbo.estadia_eventos;
          DELETE FROM dbo.estadias;
          DELETE FROM dbo.clientes;
          DELETE FROM dbo.accesos_eventos;
        `);
        await setMetadata('accesos_sincronizar_desde', accessSyncSince, transaction);
        await setMetadata('updated_at', now(), transaction);
        await transaction.commit();
      } catch (error) {
        await transaction.rollback().catch(() => {});
        throw error;
      }
    },
    close: () => pool.close(),
    // Valoraciones 👍 / 👎 de las respuestas de la IA (una por solicitud).
    saveAiFeedback: async (item) => {
      await exec(pool, `
        MERGE dbo.ia_valoraciones WITH (HOLDLOCK) AS destino
        USING (SELECT @p0 AS solicitud_id) AS origen ON destino.solicitud_id = origen.solicitud_id
        WHEN MATCHED THEN UPDATE SET valoracion = @p4, creado_at = @p6
        WHEN NOT MATCHED THEN INSERT (solicitud_id, canal, pregunta, respuesta, valoracion, owner_uid, creado_at)
          VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6);
      `, [item.requestId, item.channel, item.question, item.answer, item.rating, item.ownerUid || '', item.createdAt || now()]);
    },
    listAiFeedback: async ({ limit = 200 } = {}) => (await exec(pool, `
      SELECT TOP (@p0) id, solicitud_id AS requestId, canal AS channel, pregunta AS question, respuesta AS answer,
        valoracion AS rating, creado_at AS createdAt
      FROM dbo.ia_valoraciones ORDER BY creado_at DESC
    `, [Math.min(1000, Math.max(1, limit))])).recordset,
    tableCounts: async () => {
      const row = (await exec(pool, `SELECT
        (SELECT COUNT(*) FROM dbo.alojamientos) AS properties,
        (SELECT COUNT(*) FROM dbo.clientes) AS customers,
        (SELECT COUNT(*) FROM dbo.estadias) AS reservations,
        (SELECT COUNT(*) FROM dbo.alojamiento_imagenes) AS images,
        (SELECT COUNT(*) FROM dbo.alojamiento_etiquetas) AS tags`)).recordset[0];
      return row;
    },
  };
}
