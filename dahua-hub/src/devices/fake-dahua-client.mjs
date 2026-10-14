import { IAccessDeviceClient, validateAccessUser } from './access-device-client.mjs';

// Terminal Dahua simulado. Guarda los usuarios en memoria (por Registration
// ID, compartidos entre instancias) y permite forzar fallas para probar los
// reintentos de la cola de comandos.
const terminals = new Map();

function terminal(registrationId) {
  const key = String(registrationId).toUpperCase();
  if (!terminals.has(key)) terminals.set(key, { users: new Map(), doorOpenings: 0, failures: new Map() });
  return terminals.get(key);
}

export class FakeDahuaClient extends IAccessDeviceClient {
  constructor({ registrationId, latencyMs = 20 }) {
    super({ registrationId });
    this.latencyMs = latencyMs;
  }

  // Estado del terminal simulado, para pruebas y para la API de diagnóstico.
  static state(registrationId) {
    const current = terminal(registrationId);
    return { users: [...current.users.values()].map((user) => ({ ...user })), doorOpenings: current.doorOpenings };
  }

  // Las próximas `times` llamadas a `method` fallarán con `message`.
  static failNext(registrationId, method, times = 1, message = 'Falla simulada del terminal.') {
    terminal(registrationId).failures.set(method, { times, message });
  }

  static reset() {
    terminals.clear();
  }

  async #call(method, action) {
    await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    const failure = terminal(this.registrationId).failures.get(method);
    if (failure && failure.times > 0) {
      failure.times -= 1;
      throw new Error(failure.message);
    }
    return action(terminal(this.registrationId));
  }

  ping() {
    const started = Date.now();
    return this.#call('ping', () => ({ ok: true, latencyMs: Date.now() - started }));
  }

  getDeviceInfo() {
    return this.#call('getDeviceInfo', () => ({
      model: 'DHI-ASI6214S-PW (simulado)',
      serialNumber: `FAKE-${this.registrationId}`,
      firmware: 'simulado',
    }));
  }

  upsertAccessUser(user) {
    validateAccessUser(user);
    return this.#call('upsertAccessUser', (current) => {
      current.users.set(user.userId, {
        userId: user.userId, name: user.name, pin: user.pin ?? null, validFrom: user.validFrom, validTo: user.validTo,
      });
      return { userId: user.userId };
    });
  }

  removeAccessUser(userId) {
    return this.#call('removeAccessUser', (current) => ({ removed: current.users.delete(userId) }));
  }

  openDoor() {
    return this.#call('openDoor', (current) => {
      current.doorOpenings += 1;
      return { opened: true };
    });
  }
}
