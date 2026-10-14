import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { Duplex } from 'node:stream';
import tls from 'node:tls';
import { DeviceChannel } from '../devices/device-channel.mjs';
import { silentLogger } from '../logger.mjs';
import { DeviceRegistry } from './device-registry.mjs';
import { ProtocolError, httpResponse, parseHttpRequest, readRegistration } from './http-registration.mjs';

// Eventos que quedan en hub.device_connection_logs.
export const CONNECTION_EVENTS = {
  REGISTERED: 'REGISTERED',
  REJECTED: 'REJECTED',
  DISCONNECTED: 'DISCONNECTED',
  REPLACED: 'REPLACED',
  PROTOCOL_ERROR: 'PROTOCOL_ERROR',
  REGISTRATION_TIMEOUT: 'REGISTRATION_TIMEOUT',
};

const TOUCH_INTERVAL_MS = 60_000;

// Servicio TCP al que se conectan los Dahua con Auto Register. Acepta muchas
// conexiones a la vez; cada una debe registrarse con su Registration ID antes
// de registrationTimeoutMs y luego queda abierta como canal hacia el terminal.
// channel: { username, password, keepAliveMs } de la cuenta CGI de los terminales.
// certificate: { cert, key } para aceptar terminales con HTTPS activado. El
// mismo puerto atiende conexiones con y sin TLS: se distinguen por el primer
// byte (0x16 = inicio de un handshake TLS).
export function createRegistrationServer({
  store, registry = new DeviceRegistry(), config, channel = {}, certificate = null, logger = silentLogger,
}) {
  const sockets = new Set();
  const secureContext = certificate ? tls.createSecureContext({ ...certificate, minVersion: 'TLSv1.2' }) : null;

  async function log(event, session, detail = '') {
    try {
      await store.addConnectionLog({
        deviceId: session.deviceId ?? null,
        registrationId: session.registrationId || '',
        event,
        remoteAddress: session.remoteAddress,
        detail,
      });
    } catch (error) {
      logger.error('No se pudo guardar el log de conexión', error);
    }
  }

  function send(session, buffer) {
    session.bytesSent += buffer.length;
    session.socket.write(buffer);
  }

  async function reject(session, event, message, status = 403, reason = 'Forbidden') {
    logger.warn(`${session.registrationId || session.remoteAddress} rechazado: ${message}`);
    await log(event, session, message);
    if (!session.socket.destroyed) {
      session.socket.end(httpResponse(status, reason, JSON.stringify({ error: message })));
    }
  }

  async function register(session, request) {
    const registration = readRegistration(request);
    session.registrationId = registration.registrationId;
    session.deviceClass = registration.deviceClass;
    session.serverIp = registration.serverIp;

    let device = await store.getDeviceByRegistrationId(registration.registrationId);
    if (!device && config.allowUnknownDevices) {
      device = await store.createDevice({ registrationId: registration.registrationId, name: `Terminal ${registration.registrationId}` });
      logger.info(`${registration.registrationId}: terminal nuevo creado automáticamente.`);
    }
    if (!device) {
      return reject(session, CONNECTION_EVENTS.REJECTED, `Registration ID ${registration.registrationId} no está dado de alta en el hub.`);
    }
    if (!device.enabled) {
      session.deviceId = device.id;
      return reject(session, CONNECTION_EVENTS.REJECTED, `El terminal ${device.registrationId} está deshabilitado.`);
    }
    if (session.socket.destroyed) return;

    session.deviceId = device.id;
    session.registrationId = device.registrationId;
    session.registered = true;
    session.lastActivityAt = Date.now();
    clearTimeout(session.registrationTimer);
    send(session, httpResponse(200, 'OK'));
    session.channel = new DeviceChannel(session, { ...channel, logger });

    const previous = registry.register(session);
    if (previous && previous !== session) {
      previous.closeReason = 'reemplazada por una conexión nueva del mismo terminal';
      await log(CONNECTION_EVENTS.REPLACED, previous, `Nueva conexión desde ${session.remoteAddress}`);
      previous.socket.destroy();
    }
    await store.markDeviceOnline(device.id, { remoteAddress: session.remoteAddress, deviceClass: session.deviceClass });
    // Si se cortó mientras se guardaba, el cierre ya pasó: no dejarlo ONLINE.
    if (!registry.isOnline(device.registrationId)) await store.markDeviceOffline(device.id);
    const detail = [
      registration.path,
      session.secure ? 'HTTPS' : 'HTTP',
      session.deviceClass && `clase ${session.deviceClass}`,
      session.serverIp && `ServerIP ${session.serverIp}`,
    ].filter(Boolean).join(' · ');
    await log(CONNECTION_EVENTS.REGISTERED, session, detail);
    logger.info(`${device.registrationId} conectado desde ${session.remoteAddress} (${detail}).`);
  }

  // Peticiones que el terminal envía por la conexión ya registrada. El Dahua
  // reenvía su registro como heartbeat (cada 30 s en el DHI-ASI6214S-PW) y
  // espera un 200; si no lo recibe, corta y se vuelve a registrar.
  function answerDeviceRequest(session, request) {
    const path = request.target.split('?')[0];
    if (/\/autoRegist\/connect$/i.test(path)) {
      let registrationId = session.registrationId;
      try { registrationId = readRegistration(request).registrationId; } catch { /* heartbeat sin cuerpo */ }
      if (DeviceRegistry.key(registrationId) !== DeviceRegistry.key(session.registrationId)) {
        logger.warn(`${session.registrationId}: el heartbeat trae otro Registration ID (${registrationId}).`);
      }
      session.heartbeats += 1;
      if (session.heartbeats === 1) {
        logger.info(`${session.registrationId}: heartbeat recibido ${Math.round((Date.now() - session.connectedAt) / 1000)} s después de registrarse.`);
      }
      session.lastHeartbeatAt = Date.now();
    } else {
      logger.info(`${session.registrationId} envió ${request.method} ${path}; se responde 200.`);
    }
    // No se intercala en medio de la respuesta a un comando.
    const reply = () => {
      if (session.socket.destroyed) return;
      send(session, httpResponse(200, 'OK'));
      session.channel?.noteHeartbeatReply();
    };
    if (session.channel) session.channel.whenIdle(reply);
    else reply();
  }

  // Datos que llegan por una conexión ya registrada: peticiones del terminal
  // (heartbeat) o respuestas HTTP a comandos, que consumirá el canal del
  // DahuaClient.
  function handleRegisteredData(session, chunk) {
    session.lastActivityAt = Date.now();
    session.inbound = Buffer.concat([session.inbound, chunk]);
    while (session.inbound.length) {
      const start = session.inbound.subarray(0, 5).toString('latin1');
      // Respuesta (o continuación de una respuesta) a un comando del canal.
      if (session.channel?.receiving || (start === 'HTTP/' && session.channel?.awaiting)) {
        session.inbound = session.channel.feed(session.inbound);
        continue;
      }
      if (start.length < 5 && 'HTTP/'.startsWith(start)) break;
      if (start === 'HTTP/') {
        const data = session.inbound;
        session.inbound = Buffer.alloc(0);
        // Sin comando pendiente: respuestas sobrantes del terminal (404 sueltos).
        session.unsolicitedResponses += 1;
        session.channel?.noteInbound();
        if (session.unsolicitedResponses === 1) {
          const text = data.toString('utf8').replace(/\r\n/g, ' | ').slice(0, 400);
          logger.info(`${session.registrationId} envió una respuesta HTTP sin comando pendiente: ${text}`);
        }
        break;
      }
      let parsed;
      try {
        parsed = parseHttpRequest(session.inbound);
      } catch (error) {
        const preview = session.inbound.subarray(0, 80).toString('latin1').replace(/[^\x20-\x7e]/g, '.');
        logger.warn(`${session.registrationId}: datos no reconocidos (${error.message}): ${preview}`);
        session.inbound = Buffer.alloc(0);
        break;
      }
      if (!parsed) break;
      session.inbound = parsed.rest;
      answerDeviceRequest(session, parsed.request);
    }
    if (Date.now() - session.lastTouchAt > TOUCH_INTERVAL_MS) {
      session.lastTouchAt = Date.now();
      store.touchDevice(session.deviceId).catch((error) => logger.error('No se pudo actualizar last_seen_at', error));
    }
  }

  async function onData(session, chunk) {
    session.bytesReceived += chunk.length;
    if (session.registered) return handleRegisteredData(session, chunk);
    session.buffer = Buffer.concat([session.buffer, chunk]);
    if (session.registering) return;
    let parsed;
    try {
      parsed = parseHttpRequest(session.buffer);
    } catch (error) {
      const message = error instanceof ProtocolError ? error.message : String(error);
      logger.warn(`${session.remoteAddress}: ${message}`);
      await log(CONNECTION_EVENTS.PROTOCOL_ERROR, session, message);
      session.closeReason = 'error de protocolo';
      session.socket.destroy();
      return;
    }
    if (!parsed) return;
    session.registering = true;
    session.buffer = parsed.rest;
    try {
      await register(session, parsed.request);
    } catch (error) {
      if (error instanceof ProtocolError) {
        await reject(session, CONNECTION_EVENTS.PROTOCOL_ERROR, error.message, 400, 'Bad Request');
      } else {
        logger.error(`Error al registrar ${session.registrationId || session.remoteAddress}`, error);
        await reject(session, CONNECTION_EVENTS.PROTOCOL_ERROR, 'Error interno al registrar el terminal.', 500, 'Internal Server Error');
      }
      return;
    } finally {
      session.registering = false;
    }
    if (session.registered && session.buffer.length) {
      const pending = session.buffer;
      session.buffer = Buffer.alloc(0);
      handleRegisteredData(session, pending);
    }
  }

  async function onClose(session) {
    session.channel?.close();
    clearTimeout(session.registrationTimer);
    if (!session.registered) return;
    const seconds = Math.round((Date.now() - session.connectedAt) / 1000);
    const reason = session.closeReason || 'el terminal cerró la conexión';
    const detail = `${reason}; duración ${seconds}s; recibidos ${session.bytesReceived} B`;
    if (registry.unregister(session, reason)) {
      try {
        await store.markDeviceOffline(session.deviceId);
      } catch (error) {
        logger.error('No se pudo marcar el terminal como desconectado', error);
      }
      logger.info(`${session.registrationId} desconectado (${detail}).`);
    }
    await log(CONNECTION_EVENTS.DISCONNECTED, session, detail);
  }

  // Sesión de una conexión aceptada. socket es por donde se lee y escribe: el
  // TCP directo o la capa TLS montada sobre él.
  function startSession(socket, { raw, remoteAddress, acceptedAt, secure }) {
    const session = {
      id: randomUUID(),
      socket,
      raw,
      secure,
      registrationId: '',
      deviceId: null,
      deviceClass: '',
      serverIp: '',
      remoteAddress,
      connectedAt: acceptedAt,
      lastActivityAt: Date.now(),
      lastTouchAt: Date.now(),
      bytesReceived: 0,
      bytesSent: 0,
      buffer: Buffer.alloc(0),
      inbound: Buffer.alloc(0),
      heartbeats: 0,
      lastHeartbeatAt: null,
      unsolicitedResponses: 0,
      registered: false,
      registering: false,
      closeReason: raw.restbluError || '',
      channel: null,
      write: (buffer) => send(session, buffer),
    };
    // El Dahua abre la conexión y envía el registro en su siguiente ciclo de
    // 30 s, por eso el plazo por omisión es de 90 s. Un registro que ya llegó
    // y se está guardando no se corta.
    const remaining = Math.max(1_000, config.registrationTimeoutMs - (Date.now() - acceptedAt));
    session.registrationTimer = setTimeout(() => {
      if (session.registered || session.registering || socket.destroyed) return;
      session.closeReason = 'sin registro a tiempo';
      socket.destroy();
      log(CONNECTION_EVENTS.REGISTRATION_TIMEOUT, session,
        `No envió el registro en ${config.registrationTimeoutMs} ms (recibidos ${session.bytesReceived} B).`);
    }, remaining);
    if (config.idleTimeoutMs > 0) {
      socket.setTimeout(config.idleTimeoutMs, () => {
        session.closeReason = `sin actividad durante ${config.idleTimeoutMs} ms`;
        socket.destroy();
      });
    }
    socket.on('data', (chunk) => {
      onData(session, chunk).catch((error) => logger.error('Error procesando datos TCP', error));
    });
    socket.on('error', (error) => {
      session.closeReason ||= `error de red: ${error.code || error.message}`;
    });
    socket.on('close', () => {
      onClose(session).catch((error) => logger.error('Error al cerrar la sesión', error));
    });
    return session;
  }

  // Monta TLS sobre la conexión ya leída: el primer bloque (inicio del
  // handshake) se vuelve a entregar antes que el resto.
  function secureSocketFor(raw, first) {
    const replay = new Duplex({
      read() { raw.resume(); },
      write(chunk, encoding, callback) { raw.write(chunk, encoding, callback); },
      final(callback) { raw.end(); callback(); },
      destroy(error, callback) { raw.destroy(); callback(error); },
    });
    replay.push(first);
    raw.on('data', (chunk) => { if (!replay.push(chunk)) raw.pause(); });
    raw.on('end', () => replay.push(null));
    raw.on('close', () => replay.destroy());
    return new tls.TLSSocket(replay, { isServer: true, secureContext });
  }

  const server = net.createServer((raw) => {
    if (sockets.size >= config.maxConnections) {
      logger.warn(`Conexión rechazada: se alcanzó el máximo de ${config.maxConnections}.`);
      raw.destroy();
      return;
    }
    sockets.add(raw);
    raw.on('close', () => sockets.delete(raw));
    raw.on('error', (error) => { raw.restbluError ||= `error de red: ${error.code || error.message}`; });
    raw.setNoDelay(true);
    if (config.keepAliveMs > 0) raw.setKeepAlive(true, config.keepAliveMs);
    const acceptedAt = Date.now();
    const remoteAddress = `${raw.remoteAddress}:${raw.remotePort}`;
    const unregistered = { remoteAddress, registrationId: '', deviceId: null };
    const silence = setTimeout(() => {
      raw.destroy();
      log(CONNECTION_EVENTS.REGISTRATION_TIMEOUT, unregistered, `No envió datos en ${config.registrationTimeoutMs} ms.`);
    }, config.registrationTimeoutMs);

    raw.once('data', (first) => {
      clearTimeout(silence);
      if (first[0] !== 0x16) {
        raw.pause();
        raw.unshift(first);
        startSession(raw, { raw, remoteAddress, acceptedAt, secure: false });
        raw.resume();
        return;
      }
      if (!secureContext) {
        log(CONNECTION_EVENTS.PROTOCOL_ERROR, unregistered,
          'El terminal se conecta con HTTPS, pero el hub no tiene certificado (DAHUA_HUB_TLS_CERT / DAHUA_HUB_TLS_KEY).');
        raw.destroy();
        return;
      }
      const secureSocket = secureSocketFor(raw, first);
      let established = false;
      const handshakeTimer = setTimeout(() => {
        if (established) return;
        raw.destroy();
        log(CONNECTION_EVENTS.PROTOCOL_ERROR, unregistered, 'TLS: el terminal no completó el handshake a tiempo.');
      }, Math.max(1_000, config.registrationTimeoutMs - (Date.now() - acceptedAt)));
      secureSocket.once('secure', () => {
        established = true;
        clearTimeout(handshakeTimer);
        startSession(secureSocket, { raw, remoteAddress, acceptedAt, secure: true });
      });
      secureSocket.on('error', (error) => {
        if (established) return;
        established = true;
        clearTimeout(handshakeTimer);
        logger.warn(`${remoteAddress}: handshake TLS fallido (${error.message}).`);
        log(CONNECTION_EVENTS.PROTOCOL_ERROR, unregistered, `TLS: ${error.message}`);
        raw.destroy();
      });
    });
  });
  server.on('error', (error) => logger.error('Error del servidor TCP', error));

  return {
    registry,
    connectionCount: () => sockets.size,
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.host, () => {
        server.off('error', reject);
        resolve(server.address());
      });
    }),
    close: () => new Promise((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    }),
  };
}
