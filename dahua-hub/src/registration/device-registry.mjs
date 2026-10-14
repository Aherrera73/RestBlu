import { EventEmitter } from 'node:events';

// Terminales conectados en este momento, indexados por Registration ID (sin
// distinguir mayúsculas). Es la fuente de verdad de "quién está online".
// Eventos: 'online' (session), 'offline' (session, reason).
export class DeviceRegistry extends EventEmitter {
  #sessions = new Map();

  static key(registrationId) {
    return String(registrationId).toUpperCase();
  }

  // Registra la sesión y devuelve la anterior del mismo terminal, si había.
  register(session) {
    const key = DeviceRegistry.key(session.registrationId);
    const previous = this.#sessions.get(key) || null;
    this.#sessions.set(key, session);
    this.emit('online', session);
    return previous;
  }

  // Sólo quita la sesión si sigue siendo la vigente (una reconexión ya pudo
  // reemplazarla).
  unregister(session, reason = '') {
    const key = DeviceRegistry.key(session.registrationId);
    if (this.#sessions.get(key) !== session) return false;
    this.#sessions.delete(key);
    this.emit('offline', session, reason);
    return true;
  }

  get(registrationId) {
    return this.#sessions.get(DeviceRegistry.key(registrationId)) || null;
  }

  isOnline(registrationId) {
    return this.#sessions.has(DeviceRegistry.key(registrationId));
  }

  list() {
    return [...this.#sessions.values()];
  }

  onlineDeviceIds() {
    return this.list().map((session) => session.deviceId).filter((id) => id !== null && id !== undefined);
  }
}

export function describeSession(session) {
  const now = Date.now();
  return {
    sessionId: session.id,
    registrationId: session.registrationId,
    deviceId: session.deviceId,
    deviceClass: session.deviceClass,
    remoteAddress: session.remoteAddress,
    tls: Boolean(session.secure),
    serverIpReported: session.serverIp,
    connectedAt: new Date(session.connectedAt).toISOString(),
    connectedSeconds: Math.round((now - session.connectedAt) / 1000),
    lastActivityAt: new Date(session.lastActivityAt).toISOString(),
    heartbeats: session.heartbeats ?? 0,
    lastHeartbeatAt: session.lastHeartbeatAt ? new Date(session.lastHeartbeatAt).toISOString() : null,
    bytesReceived: session.bytesReceived,
    bytesSent: session.bytesSent,
  };
}
