import { readFileSync } from 'node:fs';
import sql from 'mssql';

// Almacenamiento en SQL Server (esquema hub de la base RestBlu).

const SCHEMA_PATH = new URL('./schema-sqlserver.sql', import.meta.url);

function exec(executor, text, values = []) {
  const request = new sql.Request(executor);
  values.forEach((value, index) => request.input(`p${index}`, value === undefined ? null : value));
  return request.query(text);
}

const isoOrNull = (value) => (value instanceof Date ? value.toISOString() : value ?? null);

function toProperty(row) {
  return row && {
    id: row.id, name: row.name, address: row.address, restbluPropertyId: row.restblu_property_id,
    createdAt: isoOrNull(row.created_at), updatedAt: isoOrNull(row.updated_at),
  };
}

function toDevice(row) {
  return row && {
    id: row.id, registrationId: row.registration_id, propertyId: row.property_id, name: row.name,
    deviceClass: row.device_class, status: row.status, lastRemoteAddress: row.last_remote_address,
    lastConnectedAt: isoOrNull(row.last_connected_at), lastDisconnectedAt: isoOrNull(row.last_disconnected_at),
    lastSeenAt: isoOrNull(row.last_seen_at), enabled: Boolean(row.enabled),
    createdAt: isoOrNull(row.created_at), updatedAt: isoOrNull(row.updated_at),
  };
}

function toLog(row) {
  return {
    id: Number(row.id), deviceId: row.device_id, registrationId: row.registration_id, event: row.event,
    remoteAddress: row.remote_address, detail: row.detail, createdAt: isoOrNull(row.created_at),
  };
}

function toReservation(row) {
  return row && {
    id: row.id, propertyId: row.property_id, externalCode: row.external_code, guestName: row.guest_name,
    pin: row.pin, validFrom: isoOrNull(row.valid_from), validTo: isoOrNull(row.valid_to), status: row.status,
    syncStatus: row.sync_status, lastSyncError: row.last_sync_error, syncedAt: isoOrNull(row.synced_at),
    createdAt: isoOrNull(row.created_at), updatedAt: isoOrNull(row.updated_at),
  };
}

function toCommand(row) {
  if (!row) return null;
  let payload = {};
  try { payload = JSON.parse(row.payload || '{}'); } catch { /* se deja vacío */ }
  let result = null;
  try { result = row.result ? JSON.parse(row.result) : null; } catch { result = row.result; }
  return {
    id: Number(row.id), deviceId: row.device_id, reservationId: row.reservation_id, type: row.type, payload,
    status: row.status, attempts: row.attempts, maxAttempts: row.max_attempts,
    lockedUntil: isoOrNull(row.locked_until), nextAttemptAt: isoOrNull(row.next_attempt_at),
    lastError: row.last_error, result, createdAt: isoOrNull(row.created_at), executedAt: isoOrNull(row.executed_at),
  };
}

const DUPLICATE_KEY_ERRORS = new Set([2601, 2627]);

export function createSqlServerStore(config) {
  const pool = new sql.ConnectionPool(config);
  pool.on('error', () => {});
  const location = `${config.server}:${config.port}/${config.database}`;

  return {
    kind: 'sqlserver',
    describe: () => `SQL Server ${location} (esquema hub)`,
    async init() {
      try {
        await pool.connect();
      } catch (error) {
        throw new Error(`No fue posible conectar con SQL Server en ${location}: ${error.message}`);
      }
      const batches = readFileSync(SCHEMA_PATH, 'utf8').split(/^\s*GO\s*$/im)
        .map((batch) => batch.trim()).filter((batch) => batch.replace(/^\s*--.*$/gm, '').trim());
      for (const batch of batches) await exec(pool, batch);
    },
    close: () => pool.close(),

    async listProperties() {
      return (await exec(pool, 'SELECT * FROM hub.properties ORDER BY id')).recordset.map(toProperty);
    },
    async getProperty(id) {
      return toProperty((await exec(pool, 'SELECT * FROM hub.properties WHERE id = @p0', [id])).recordset[0]) || null;
    },
    async createProperty({ name, address = '', restbluPropertyId = null }) {
      return toProperty((await exec(pool, `INSERT INTO hub.properties (name, address, restblu_property_id)
        OUTPUT inserted.* VALUES (@p0, @p1, @p2)`, [name, address, restbluPropertyId])).recordset[0]);
    },

    async getPropertyByRestbluId(restbluPropertyId) {
      return toProperty((await exec(pool, 'SELECT * FROM hub.properties WHERE restblu_property_id = @p0',
        [restbluPropertyId])).recordset[0]) || null;
    },
    async upsertPropertyByRestbluId({ restbluPropertyId, name }) {
      return toProperty((await exec(pool, `
        MERGE hub.properties WITH (HOLDLOCK) AS destino
        USING (SELECT @p0 AS restblu_property_id) AS origen ON destino.restblu_property_id = origen.restblu_property_id
        WHEN MATCHED THEN UPDATE SET name = @p1, updated_at = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT (name, restblu_property_id) VALUES (@p1, @p0)
        OUTPUT inserted.*;
      `, [restbluPropertyId, name])).recordset[0]);
    },
    async setDeviceProperty(deviceId, propertyId) {
      await exec(pool, 'UPDATE hub.devices SET property_id = @p1, updated_at = SYSUTCDATETIME() WHERE id = @p0', [deviceId, propertyId]);
    },

    async listDevices() {
      return (await exec(pool, 'SELECT * FROM hub.devices ORDER BY registration_id')).recordset.map(toDevice);
    },
    async getDeviceByRegistrationId(registrationId) {
      return toDevice((await exec(pool, 'SELECT * FROM hub.devices WHERE registration_id = @p0', [registrationId])).recordset[0]) || null;
    },
    async createDevice({ registrationId, propertyId = null, name = '' }) {
      try {
        return toDevice((await exec(pool, `INSERT INTO hub.devices (registration_id, property_id, name)
          OUTPUT inserted.* VALUES (@p0, @p1, @p2)`, [registrationId, propertyId, name])).recordset[0]);
      } catch (error) {
        if (DUPLICATE_KEY_ERRORS.has(error?.number)) throw new Error(`Ya existe un terminal con el Registration ID ${registrationId}.`);
        throw error;
      }
    },
    async markDeviceOnline(deviceId, { remoteAddress = '', deviceClass = '' } = {}) {
      await exec(pool, `UPDATE hub.devices SET status = 'ONLINE', last_remote_address = @p1,
        device_class = CASE WHEN @p2 = '' THEN device_class ELSE @p2 END,
        last_connected_at = SYSUTCDATETIME(), last_seen_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
        WHERE id = @p0`, [deviceId, remoteAddress, deviceClass]);
    },
    async markDeviceOffline(deviceId) {
      await exec(pool, `UPDATE hub.devices SET status = 'OFFLINE', last_disconnected_at = SYSUTCDATETIME(),
        updated_at = SYSUTCDATETIME() WHERE id = @p0`, [deviceId]);
    },
    async touchDevice(deviceId) {
      await exec(pool, 'UPDATE hub.devices SET last_seen_at = SYSUTCDATETIME() WHERE id = @p0', [deviceId]);
    },
    async markAllDevicesOffline() {
      await exec(pool, `UPDATE hub.devices SET status = 'OFFLINE', updated_at = SYSUTCDATETIME() WHERE status = 'ONLINE'`);
    },

    async addConnectionLog({ deviceId = null, registrationId = '', event, remoteAddress = '', detail = '' }) {
      await exec(pool, `INSERT INTO hub.device_connection_logs (device_id, registration_id, event, remote_address, detail)
        VALUES (@p0, @p1, @p2, @p3, @p4)`, [deviceId, registrationId.slice(0, 64), event, remoteAddress, String(detail).slice(0, 1000)]);
    },
    async listConnectionLogs({ registrationId = '', limit = 100 } = {}) {
      return (await exec(pool, `SELECT TOP (@p1) * FROM hub.device_connection_logs
        WHERE @p0 = '' OR registration_id = @p0 ORDER BY id DESC`, [registrationId, limit])).recordset.map(toLog);
    },

    async createReservation(input) {
      try {
        return toReservation((await exec(pool, `INSERT INTO hub.reservations
          (property_id, external_code, guest_name, pin, valid_from, valid_to)
          OUTPUT inserted.* VALUES (@p0, @p1, @p2, @p3, @p4, @p5)`, [
          input.propertyId, input.externalCode || null, input.guestName, input.pin,
          new Date(input.validFrom), new Date(input.validTo),
        ])).recordset[0]);
      } catch (error) {
        if (DUPLICATE_KEY_ERRORS.has(error?.number)) throw new Error(`Ya existe una reserva con el código ${input.externalCode}.`);
        throw error;
      }
    },
    async listReservations({ propertyId = null } = {}) {
      return (await exec(pool, `SELECT * FROM hub.reservations WHERE @p0 IS NULL OR property_id = @p0
        ORDER BY valid_from DESC`, [propertyId])).recordset.map(toReservation);
    },

    async enqueueCommand({ deviceId, reservationId = null, type, payload = {}, maxAttempts = 5 }) {
      return toCommand((await exec(pool, `INSERT INTO hub.device_commands (device_id, reservation_id, type, payload, max_attempts)
        OUTPUT inserted.* VALUES (@p0, @p1, @p2, @p3, @p4)`, [deviceId, reservationId, type, JSON.stringify(payload), maxAttempts])).recordset[0]);
    },
    async getCommand(id) {
      return toCommand((await exec(pool, 'SELECT * FROM hub.device_commands WHERE id = @p0', [id])).recordset[0]);
    },
    async listCommands({ status = '', deviceId = null, limit = 100 } = {}) {
      return (await exec(pool, `SELECT TOP (@p2) * FROM hub.device_commands
        WHERE (@p0 = '' OR status = @p0) AND (@p1 IS NULL OR device_id = @p1) ORDER BY id DESC`,
      [status, deviceId, limit])).recordset.map(toCommand);
    },
    // Toma comandos pendientes de terminales conectados y los bloquea por un
    // rato para que ningún otro proceso los ejecute a la vez.
    async claimCommands({ deviceIds, limit = 10, lockMs = 60_000 }) {
      if (!deviceIds.length) return [];
      return (await exec(pool, `
        WITH siguientes AS (
          SELECT TOP (@p1) * FROM hub.device_commands WITH (READPAST, UPDLOCK, ROWLOCK)
          WHERE status = 'PENDING'
            AND device_id IN (SELECT CAST(value AS INT) FROM OPENJSON(@p0))
            AND (locked_until IS NULL OR locked_until < SYSUTCDATETIME())
            AND (next_attempt_at IS NULL OR next_attempt_at <= SYSUTCDATETIME())
          ORDER BY id
        )
        UPDATE siguientes SET locked_until = DATEADD(MILLISECOND, @p2, SYSUTCDATETIME()), attempts = attempts + 1
        OUTPUT inserted.*;
      `, [JSON.stringify(deviceIds), limit, lockMs])).recordset.map(toCommand).sort((a, b) => a.id - b.id);
    },
    // final: falla que no mejora reintentando; queda FAILED de inmediato.
    async completeCommand(id, { ok, result = null, error = '', retryDelayMs = 0, final = false }) {
      const row = (await exec(pool, ok
        ? `UPDATE hub.device_commands SET status = 'SUCCESS', result = @p1, last_error = NULL,
            locked_until = NULL, executed_at = SYSUTCDATETIME() OUTPUT inserted.* WHERE id = @p0`
        : `UPDATE hub.device_commands SET last_error = @p1, locked_until = NULL,
            status = CASE WHEN @p3 = 1 OR attempts >= max_attempts THEN 'FAILED' ELSE 'PENDING' END,
            executed_at = CASE WHEN @p3 = 1 OR attempts >= max_attempts THEN SYSUTCDATETIME() ELSE executed_at END,
            next_attempt_at = DATEADD(MILLISECOND, @p2, SYSUTCDATETIME())
            OUTPUT inserted.* WHERE id = @p0`,
      ok
        ? [id, result === null ? null : JSON.stringify(result)]
        : [id, String(error).slice(0, 1000), retryDelayMs, final ? 1 : 0])).recordset[0];
      return toCommand(row);
    },
  };
}
