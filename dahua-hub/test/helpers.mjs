import net from 'node:net';
import { readConfig } from '../src/config.mjs';
import { createMemoryStore } from '../src/db/memory-store.mjs';
import { silentLogger } from '../src/logger.mjs';
import { startHub } from '../src/main.mjs';

// Hub completo en puertos libres, con almacenamiento en memoria.
export async function startTestHub({ tcp = {}, api = {}, device = {}, client = 'fake', devices = ['PROP-0001', 'PROP-0002'] } = {}) {
  const base = readConfig({});
  const config = {
    ...base,
    store: 'memory',
    client,
    tcp: { ...base.tcp, port: 0, registrationTimeoutMs: 2_000, ...tcp },
    api: { ...base.api, port: 0, ...api },
    device: { ...base.device, keepAliveMs: 0, ...device },
    commands: { intervalMs: 60_000, batchSize: 10 },
  };
  const store = createMemoryStore();
  const property = await store.createProperty({ name: 'Propiedad de prueba' });
  for (const registrationId of devices) await store.createDevice({ registrationId, propertyId: property.id });
  const hub = await startHub(config, { logger: silentLogger, store });
  const apiUrl = `http://127.0.0.1:${hub.apiAddress.port}`;
  return {
    ...hub,
    property,
    tcpPort: hub.tcpAddress.port,
    async request(method, path, body, headers = {}) {
      const response = await fetch(`${apiUrl}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
  };
}

export function registrationRequest(registrationId, { deviceClass = 'AccessControl' } = {}) {
  const body = JSON.stringify({ DevClass: deviceClass, DeviceID: registrationId, ServerIP: '203.0.113.10' });
  return [
    'POST /cgi-bin/api/autoRegist/connect HTTP/1.1',
    'Host: hub',
    'Content-Type: application/json',
    `Content-Length: ${Buffer.byteLength(body)}`,
    '',
    body,
  ].join('\r\n');
}

// Abre una conexión TCP como lo haría un Dahua y devuelve la primera respuesta.
export function connectDevice(port, payload) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port }, () => {
      for (const part of [].concat(payload)) socket.write(part);
    });
    let received = '';
    socket.on('data', (chunk) => {
      received += chunk.toString('latin1');
      if (received.includes('\r\n\r\n')) resolve({ socket, response: received, status: Number(received.split(' ')[1]) });
    });
    socket.on('error', reject);
    socket.on('close', () => resolve({ socket, response: received, status: received ? Number(received.split(' ')[1]) : 0 }));
  });
}

export async function waitFor(check, { timeoutMs = 3_000, intervalMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('La condición no se cumplió a tiempo.');
}
