import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHttpApi } from './api/http-api.mjs';
import { createCommandWorker } from './commands/command-worker.mjs';
import { loadPrivateConfig, readConfig } from './config.mjs';
import { createMemoryStore } from './db/memory-store.mjs';
import { createSqlServerStore } from './db/sqlserver-store.mjs';
import { createClientFactory } from './devices/client-factory.mjs';
import { createLogger } from './logger.mjs';
import { DeviceRegistry } from './registration/device-registry.mjs';
import { createRegistrationServer } from './registration/registration-server.mjs';

// Arma el hub completo: almacenamiento, listener TCP de Auto Register, cola
// de comandos y API REST. Se exporta para poder levantarlo en las pruebas.
export async function startHub(config, { logger = createLogger('hub'), store: givenStore } = {}) {
  const store = givenStore || (config.store === 'memory' ? createMemoryStore() : createSqlServerStore(config.sqlserver));
  await store.init();
  // Ninguna conexión sobrevive a un reinicio del servicio.
  await store.markAllDevicesOffline();

  const registry = new DeviceRegistry();
  let certificate = config.tcp.certificate || null;
  if (!certificate && (config.tcp.tlsCertPath || config.tcp.tlsKeyPath)) {
    try {
      certificate = { cert: readFileSync(config.tcp.tlsCertPath), key: readFileSync(config.tcp.tlsKeyPath) };
    } catch (error) {
      throw new Error(`No se pudo leer el certificado TLS del hub (DAHUA_HUB_TLS_CERT / DAHUA_HUB_TLS_KEY): ${error.message}`);
    }
  }
  const tcp = createRegistrationServer({
    store, registry, config: config.tcp, channel: config.device, certificate, logger: createLogger('tcp'),
  });
  const worker = createCommandWorker({
    store, registry, clientFactory: createClientFactory(config.client, config.device), config: config.commands, logger: createLogger('cola'),
  });
  const tcpAddress = await tcp.listen();
  const api = createHttpApi({
    store,
    registry,
    config: config.api,
    clientMode: config.client,
    tcpInfo: () => ({ host: tcpAddress.address, port: tcpAddress.port, connections: tcp.connectionCount() }),
    logger: createLogger('api'),
  });
  const apiAddress = await api.listen();
  worker.start();

  logger.info(`Almacenamiento: ${store.describe()}`);
  logger.info(`Auto Register (TCP): ${tcpAddress.address}:${tcpAddress.port} · ${certificate ? 'acepta HTTP y HTTPS' : 'sólo HTTP (sin certificado)'}`);
  logger.info(`API REST: http://${apiAddress.address}:${apiAddress.port}/api/devices/online`);
  logger.info(`Cliente de terminales: ${config.client === 'fake' ? 'FakeDahuaClient (sin hardware)' : 'DahuaClient'}`);
  if (config.client === 'dahua' && (!config.device.username || !config.device.password)) {
    logger.warn('Sin cuenta CGI para los terminales: los comandos reales fallarán (DAHUA_HUB_DEVICE_USERNAME / _PASSWORD).');
  }

  return {
    store, registry, tcp, api, worker, tcpAddress, apiAddress,
    async stop() {
      await worker.stop();
      await api.close();
      await tcp.close();
      await store.markAllDevicesOffline().catch(() => {});
      await store.close();
    },
  };
}

const isEntryPoint = Boolean(process.argv[1])
  && pathToFileURL(process.argv[1]).href.toLowerCase() === import.meta.url.toLowerCase();
if (isEntryPoint) {
  loadPrivateConfig();
  const logger = createLogger('hub');
  try {
    const hub = await startHub(readConfig(), { logger });
    let stopping = false;
    const shutdown = async (signal) => {
      if (stopping) return;
      stopping = true;
      logger.info(`${signal}: cerrando conexiones…`);
      await hub.stop();
      process.exit(0);
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    logger.error('No se pudo iniciar el hub', error);
    process.exit(1);
  }
}
