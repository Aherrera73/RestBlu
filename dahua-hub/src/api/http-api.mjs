import { timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import { silentLogger } from '../logger.mjs';
import { COMMAND_TYPES } from '../commands/command-worker.mjs';
import { FakeDahuaClient } from '../devices/fake-dahua-client.mjs';
import { describeSession } from '../registration/device-registry.mjs';
import { REGISTRATION_ID_PATTERN } from '../registration/http-registration.mjs';

const MAX_BODY_BYTES = 64 * 1024;
// El proxy CGI transporta fotos de rostro en base64.
const MAX_CGI_BODY_BYTES = 8 * 1024 * 1024;
const CGI_PATH = /^\/cgi-bin\/[A-Za-z0-9_.\/-]+$/;
const COMMAND_STATUSES = ['PENDING', 'SUCCESS', 'FAILED'];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(response, status, body) {
  const content = JSON.stringify(body, null, 2);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(content);
}

async function readJson(request, limit = MAX_BODY_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'El cuerpo de la petición es demasiado grande.');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'El cuerpo debe ser JSON válido.');
  }
}

function limitParam(url, fallback = 100) {
  return Math.min(1000, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '', 10) || fallback));
}

function optionalInt(value, name) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new HttpError(400, `${name} debe ser un número entero positivo.`);
  return parsed;
}

function requiredText(value, name, max = 200) {
  const text = String(value ?? '').trim();
  if (!text) throw new HttpError(400, `Falta ${name}.`);
  if (text.length > max) throw new HttpError(400, `${name} admite como máximo ${max} caracteres.`);
  return text;
}

function isoDate(value, name) {
  const parsed = Date.parse(value);
  if (!value || !Number.isFinite(parsed)) throw new HttpError(400, `${name} debe ser una fecha ISO 8601 (ej. 2026-10-10T15:00:00-03:00).`);
  return new Date(parsed).toISOString();
}

// API REST del hub. Escucha sólo en localhost por omisión; si se define
// DAHUA_HUB_API_KEY, cada petición debe traer la cabecera x-api-key.
export function createHttpApi({ store, registry, config, clientMode = 'fake', tcpInfo = () => ({}), logger = silentLogger }) {
  const expectedKey = config.apiKey ? Buffer.from(config.apiKey) : null;

  function authorized(request) {
    if (!expectedKey) return true;
    const given = Buffer.from(String(request.headers['x-api-key'] || ''));
    return given.length === expectedKey.length && timingSafeEqual(given, expectedKey);
  }

  function withLiveStatus(device) {
    const session = registry.get(device.registrationId);
    return { ...device, online: Boolean(session), session: session ? describeSession(session) : null };
  }

  async function deviceOr404(registrationId) {
    const device = await store.getDeviceByRegistrationId(registrationId);
    if (!device) throw new HttpError(404, `No existe el terminal ${registrationId}.`);
    return device;
  }

  const routes = [
    ['GET', /^\/api\/health$/, async () => ({
      ok: true,
      store: store.describe(),
      client: clientMode,
      tcp: tcpInfo(),
      devicesOnline: registry.list().length,
    })],

    ['GET', /^\/api\/properties$/, async () => ({ properties: await store.listProperties() })],
    ['POST', /^\/api\/properties$/, async ({ body }) => {
      const property = await store.createProperty({
        name: requiredText(body.name, 'name'),
        address: String(body.address ?? '').trim().slice(0, 300),
        restbluPropertyId: optionalInt(body.restbluPropertyId, 'restbluPropertyId'),
      });
      return [201, { property }];
    }],

    ['GET', /^\/api\/devices$/, async () => ({ devices: (await store.listDevices()).map(withLiveStatus) })],
    ['GET', /^\/api\/devices\/online$/, async () => {
      const devices = await store.listDevices();
      const byKey = new Map(devices.map((device) => [device.registrationId.toUpperCase(), device]));
      return {
        count: registry.list().length,
        devices: registry.list().map((session) => ({
          ...(byKey.get(session.registrationId.toUpperCase()) || { registrationId: session.registrationId }),
          online: true,
          session: describeSession(session),
        })),
      };
    }],
    ['POST', /^\/api\/devices$/, async ({ body }) => {
      const registrationId = requiredText(body.registrationId, 'registrationId', 64);
      if (!REGISTRATION_ID_PATTERN.test(registrationId)) {
        throw new HttpError(400, 'registrationId sólo admite letras, números, punto, guion y guion bajo (ej. PROP-0001).');
      }
      const propertyId = optionalInt(body.propertyId, 'propertyId');
      if (propertyId && !(await store.getProperty(propertyId))) throw new HttpError(400, `No existe la propiedad ${propertyId}.`);
      try {
        const device = await store.createDevice({ registrationId, propertyId, name: String(body.name ?? '').trim().slice(0, 200) });
        return [201, { device: withLiveStatus(device) }];
      } catch (error) {
        throw new HttpError(409, error.message);
      }
    }],
    ['GET', /^\/api\/devices\/([^/]+)$/, async ({ params }) => ({ device: withLiveStatus(await deviceOr404(params[0])) })],
    ['GET', /^\/api\/devices\/([^/]+)\/logs$/, async ({ params, url }) => {
      const device = await deviceOr404(params[0]);
      return { logs: await store.listConnectionLogs({ registrationId: device.registrationId, limit: limitParam(url) }) };
    }],
    ['GET', /^\/api\/devices\/([^/]+)\/fake-state$/, async ({ params }) => {
      if (clientMode !== 'fake') throw new HttpError(404, 'Sólo disponible con DAHUA_HUB_CLIENT=fake.');
      const device = await deviceOr404(params[0]);
      return { registrationId: device.registrationId, ...FakeDahuaClient.state(device.registrationId) };
    }],
    ['POST', /^\/api\/devices\/([^/]+)\/commands$/, async ({ params, body }) => {
      const device = await deviceOr404(params[0]);
      const type = requiredText(body.type, 'type', 40).toUpperCase();
      if (!COMMAND_TYPES[type]) throw new HttpError(400, `type debe ser uno de: ${Object.keys(COMMAND_TYPES).join(', ')}.`);
      const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
      const maxAttempts = Math.min(20, Math.max(1, optionalInt(body.maxAttempts, 'maxAttempts') || 5));
      const command = await store.enqueueCommand({
        deviceId: device.id, reservationId: optionalInt(body.reservationId, 'reservationId'), type, payload, maxAttempts,
      });
      return [202, { command, deviceOnline: registry.isOnline(device.registrationId) }];
    }],

    // Proxy CGI: el gestor RestBlu envía por aquí las mismas CGI que usa en la
    // red local, y el hub las ejecuta en el terminal por el canal del Auto
    // Register. El login y el keep-alive los maneja el hub.
    ['POST', /^\/api\/devices\/([^/]+)\/cgi$/, async ({ params, body }) => {
      const device = await deviceOr404(params[0]);
      const session = registry.get(device.registrationId);
      if (!session?.channel) throw new HttpError(503, `El terminal ${device.registrationId} no está conectado al hub.`);
      const path = requiredText(body.path, 'path', 300);
      if (!CGI_PATH.test(path) || path.includes('..') || path.startsWith('/cgi-bin/api/global/')) {
        throw new HttpError(400, 'path debe ser una CGI del terminal (/cgi-bin/…), sin login ni keep-alive.');
      }
      const method = String(body.method || 'GET').toUpperCase();
      if (!['GET', 'POST'].includes(method)) throw new HttpError(400, 'method debe ser GET o POST.');
      const query = body.params && typeof body.params === 'object' ? body.params : {};
      for (const value of Object.values(query)) {
        if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) throw new HttpError(400, 'params sólo admite valores simples.');
      }
      const timeoutMs = Math.min(60_000, Math.max(1_000, Number(body.timeoutMs) || 15_000));
      try {
        const result = await session.channel.cgi({
          method, path, params: query, json: body.json === undefined ? undefined : body.json, timeoutMs,
        });
        return { status: result.status, contentType: result.headers['content-type'] || '', text: result.text };
      } catch (error) {
        throw new HttpError(error.code === 'DISCONNECTED' ? 503 : error.code === 'BODY_TOO_LARGE' ? 413 : 502, error.message);
      }
    }],

    // Asignación alojamiento RestBlu -> terminales. La envía el gestor.
    ['GET', /^\/api\/restblu-properties$/, async () => {
      const devices = await store.listDevices();
      const properties = (await store.listProperties()).filter((property) => property.restbluPropertyId !== null);
      return {
        properties: properties.map((property) => ({
          ...property,
          devices: devices.filter((device) => device.propertyId === property.id).map(withLiveStatus),
        })),
      };
    }],
    ['PUT', /^\/api\/restblu-properties\/(\d+)$/, async ({ params, body }) => {
      const restbluPropertyId = Number(params[0]);
      const name = requiredText(body.name, 'name');
      const registrationIds = Array.isArray(body.registrationIds) ? body.registrationIds.map((id) => String(id).trim()).filter(Boolean) : [];
      if (registrationIds.length > 10) throw new HttpError(400, 'Como máximo 10 terminales por alojamiento.');
      for (const id of registrationIds) {
        if (!REGISTRATION_ID_PATTERN.test(id)) throw new HttpError(400, `Registration ID inválido: ${id}`);
      }
      const property = await store.upsertPropertyByRestbluId({ restbluPropertyId, name });
      const wanted = new Set(registrationIds.map((id) => id.toUpperCase()));
      const assigned = [];
      for (const id of registrationIds) {
        const device = await store.getDeviceByRegistrationId(id)
          || await store.createDevice({ registrationId: id, propertyId: property.id, name: `Terminal ${id}` });
        if (device.propertyId !== property.id) await store.setDeviceProperty(device.id, property.id);
        assigned.push(id);
      }
      for (const device of await store.listDevices()) {
        if (device.propertyId === property.id && !wanted.has(device.registrationId.toUpperCase())) {
          await store.setDeviceProperty(device.id, null);
        }
      }
      return { property, registrationIds: assigned };
    }],

    ['GET', /^\/api\/connection-logs$/, async ({ url }) => ({
      logs: await store.listConnectionLogs({ registrationId: url.searchParams.get('registrationId') || '', limit: limitParam(url) }),
    })],

    ['GET', /^\/api\/commands$/, async ({ url }) => {
      const status = (url.searchParams.get('status') || '').toUpperCase();
      if (status && !COMMAND_STATUSES.includes(status)) throw new HttpError(400, `status debe ser ${COMMAND_STATUSES.join(', ')}.`);
      const registrationId = url.searchParams.get('registrationId');
      const deviceId = registrationId ? (await deviceOr404(registrationId)).id : null;
      return { commands: await store.listCommands({ status, deviceId, limit: limitParam(url) }) };
    }],
    ['GET', /^\/api\/commands\/(\d+)$/, async ({ params }) => {
      const command = await store.getCommand(Number(params[0]));
      if (!command) throw new HttpError(404, `No existe el comando ${params[0]}.`);
      return { command };
    }],

    // Reservas: por ahora sólo se guardan; la sincronización con los
    // terminales queda en sync_status = PENDING.
    ['GET', /^\/api\/reservations$/, async ({ url }) => ({
      reservations: await store.listReservations({ propertyId: optionalInt(url.searchParams.get('propertyId'), 'propertyId') }),
    })],
    ['POST', /^\/api\/reservations$/, async ({ body }) => {
      const propertyId = optionalInt(body.propertyId, 'propertyId');
      if (!propertyId) throw new HttpError(400, 'Falta propertyId.');
      if (!(await store.getProperty(propertyId))) throw new HttpError(400, `No existe la propiedad ${propertyId}.`);
      const pin = String(body.pin ?? '').trim();
      if (!/^\d{4,8}$/.test(pin)) throw new HttpError(400, 'pin debe tener entre 4 y 8 dígitos.');
      const validFrom = isoDate(body.validFrom, 'validFrom');
      const validTo = isoDate(body.validTo, 'validTo');
      if (Date.parse(validTo) <= Date.parse(validFrom)) throw new HttpError(400, 'validTo debe ser posterior a validFrom.');
      try {
        const reservation = await store.createReservation({
          propertyId,
          externalCode: String(body.externalCode ?? '').trim().slice(0, 80) || null,
          guestName: requiredText(body.guestName, 'guestName'),
          pin,
          validFrom,
          validTo,
        });
        return [201, { reservation }];
      } catch (error) {
        throw new HttpError(409, error.message);
      }
    }],
  ];

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://hub.local');
    try {
      if (!authorized(request)) throw new HttpError(401, 'Falta o es incorrecta la cabecera x-api-key.');
      const candidates = routes.filter(([, pattern]) => pattern.test(url.pathname));
      if (!candidates.length) throw new HttpError(404, 'Ruta no encontrada.');
      const route = candidates.find(([method]) => method === request.method);
      if (!route) throw new HttpError(405, `Método no permitido. Usa ${candidates.map(([method]) => method).join(' o ')}.`);
      const [, pattern, handler] = route;
      const params = pattern.exec(url.pathname).slice(1).map(decodeURIComponent);
      const body = ['POST', 'PUT'].includes(request.method)
        ? await readJson(request, url.pathname.endsWith('/cgi') ? MAX_CGI_BODY_BYTES : MAX_BODY_BYTES)
        : {};
      const result = await handler({ params, url, body, request });
      const [status, payload] = Array.isArray(result) ? result : [200, result];
      sendJson(response, status, payload);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) logger.error(`${request.method} ${url.pathname}`, error);
      sendJson(response, status, { error: status === 500 ? 'Error interno del hub.' : error.message });
    }
  });

  return {
    server,
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.host, () => {
        server.off('error', reject);
        resolve(server.address());
      });
    }),
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    }),
  };
}
