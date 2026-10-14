// Almacenamiento en memoria con la misma interfaz que el de SQL Server. Sirve
// para las pruebas y para probar el hub sin base de datos (DAHUA_HUB_STORE=memory).

const iso = () => new Date().toISOString();

export function createMemoryStore() {
  const properties = [];
  const devices = [];
  const logs = [];
  const reservations = [];
  const commands = [];
  const ids = { property: 0, device: 0, log: 0, reservation: 0, command: 0 };
  const copy = (value) => (value ? structuredClone(value) : null);

  return {
    kind: 'memory',
    describe: () => 'memoria (se pierde al cerrar)',
    async init() {},
    async close() {},

    async listProperties() { return properties.map(copy); },
    async getProperty(id) { return copy(properties.find((item) => item.id === id)); },
    async createProperty({ name, address = '', restbluPropertyId = null }) {
      const property = { id: ++ids.property, name, address, restbluPropertyId, createdAt: iso(), updatedAt: iso() };
      properties.push(property);
      return copy(property);
    },

    async getPropertyByRestbluId(restbluPropertyId) {
      return copy(properties.find((item) => item.restbluPropertyId === restbluPropertyId));
    },
    async upsertPropertyByRestbluId({ restbluPropertyId, name }) {
      const existing = properties.find((item) => item.restbluPropertyId === restbluPropertyId);
      if (existing) {
        Object.assign(existing, { name, updatedAt: iso() });
        return copy(existing);
      }
      return this.createProperty({ name, restbluPropertyId });
    },
    async setDeviceProperty(deviceId, propertyId) {
      const device = devices.find((item) => item.id === deviceId);
      if (device) Object.assign(device, { propertyId, updatedAt: iso() });
    },

    async listDevices() { return devices.map(copy); },
    async getDeviceByRegistrationId(registrationId) {
      const wanted = registrationId.toUpperCase();
      return copy(devices.find((item) => item.registrationId.toUpperCase() === wanted));
    },
    async createDevice({ registrationId, propertyId = null, name = '' }) {
      if (devices.some((item) => item.registrationId.toUpperCase() === registrationId.toUpperCase())) {
        throw new Error(`Ya existe un terminal con el Registration ID ${registrationId}.`);
      }
      const device = {
        id: ++ids.device, registrationId, propertyId, name, deviceClass: '', status: 'OFFLINE',
        lastRemoteAddress: '', lastConnectedAt: null, lastDisconnectedAt: null, lastSeenAt: null,
        enabled: true, createdAt: iso(), updatedAt: iso(),
      };
      devices.push(device);
      return copy(device);
    },
    async markDeviceOnline(deviceId, { remoteAddress = '', deviceClass = '' } = {}) {
      const device = devices.find((item) => item.id === deviceId);
      if (!device) return;
      Object.assign(device, {
        status: 'ONLINE', lastRemoteAddress: remoteAddress, deviceClass: deviceClass || device.deviceClass,
        lastConnectedAt: iso(), lastSeenAt: iso(), updatedAt: iso(),
      });
    },
    async markDeviceOffline(deviceId) {
      const device = devices.find((item) => item.id === deviceId);
      if (device) Object.assign(device, { status: 'OFFLINE', lastDisconnectedAt: iso(), updatedAt: iso() });
    },
    async touchDevice(deviceId) {
      const device = devices.find((item) => item.id === deviceId);
      if (device) device.lastSeenAt = iso();
    },
    async markAllDevicesOffline() {
      for (const device of devices) if (device.status === 'ONLINE') device.status = 'OFFLINE';
    },

    async addConnectionLog({ deviceId = null, registrationId = '', event, remoteAddress = '', detail = '' }) {
      logs.push({ id: ++ids.log, deviceId, registrationId, event, remoteAddress, detail: String(detail).slice(0, 1000), createdAt: iso() });
    },
    async listConnectionLogs({ registrationId = '', limit = 100 } = {}) {
      return logs
        .filter((item) => !registrationId || item.registrationId.toUpperCase() === registrationId.toUpperCase())
        .slice(-limit).reverse().map(copy);
    },

    async createReservation(input) {
      if (input.externalCode && reservations.some((item) => item.externalCode === input.externalCode)) {
        throw new Error(`Ya existe una reserva con el código ${input.externalCode}.`);
      }
      const reservation = {
        id: ++ids.reservation, propertyId: input.propertyId, externalCode: input.externalCode || null,
        guestName: input.guestName, pin: input.pin, validFrom: input.validFrom, validTo: input.validTo,
        status: 'ACTIVE', syncStatus: 'PENDING', lastSyncError: null, syncedAt: null, createdAt: iso(), updatedAt: iso(),
      };
      reservations.push(reservation);
      return copy(reservation);
    },
    async listReservations({ propertyId = null } = {}) {
      return reservations.filter((item) => propertyId === null || item.propertyId === propertyId).map(copy);
    },

    async enqueueCommand({ deviceId, reservationId = null, type, payload = {}, maxAttempts = 5 }) {
      const command = {
        id: ++ids.command, deviceId, reservationId, type, payload, status: 'PENDING', attempts: 0, maxAttempts,
        lockedUntil: null, nextAttemptAt: null, lastError: null, result: null, createdAt: iso(), executedAt: null,
      };
      commands.push(command);
      return copy(command);
    },
    async getCommand(id) { return copy(commands.find((item) => item.id === id)); },
    async listCommands({ status = '', deviceId = null, limit = 100 } = {}) {
      return commands
        .filter((item) => (!status || item.status === status) && (deviceId === null || item.deviceId === deviceId))
        .slice(-limit).reverse().map(copy);
    },
    async claimCommands({ deviceIds, limit = 10, lockMs = 60_000 }) {
      const now = Date.now();
      const claimed = commands.filter((item) => item.status === 'PENDING'
        && deviceIds.includes(item.deviceId)
        && (!item.lockedUntil || Date.parse(item.lockedUntil) < now)
        && (!item.nextAttemptAt || Date.parse(item.nextAttemptAt) <= now)).slice(0, limit);
      for (const command of claimed) {
        command.lockedUntil = new Date(now + lockMs).toISOString();
        command.attempts += 1;
      }
      return claimed.map(copy);
    },
    // final: falla que no mejora reintentando; queda FAILED de inmediato.
    async completeCommand(id, { ok, result = null, error = '', retryDelayMs = 0, final = false }) {
      const command = commands.find((item) => item.id === id);
      if (!command) return null;
      command.lockedUntil = null;
      if (ok) {
        Object.assign(command, { status: 'SUCCESS', result, lastError: null, executedAt: iso() });
      } else if (final || command.attempts >= command.maxAttempts) {
        Object.assign(command, { status: 'FAILED', lastError: error, executedAt: iso() });
      } else {
        Object.assign(command, { lastError: error, nextAttemptAt: new Date(Date.now() + retryDelayMs).toISOString() });
      }
      return copy(command);
    },
  };
}
