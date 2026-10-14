import { silentLogger } from '../logger.mjs';

// Tipos de comando y el método de IAccessDeviceClient que ejecuta cada uno.
export const COMMAND_TYPES = {
  PING: (client) => client.ping(),
  GET_DEVICE_INFO: (client) => client.getDeviceInfo(),
  UPSERT_ACCESS_USER: (client, payload) => client.upsertAccessUser(payload),
  REMOVE_ACCESS_USER: (client, payload) => client.removeAccessUser(payload.userId),
  OPEN_DOOR: (client, payload) => client.openDoor(payload),
};

// Espera antes de reintentar: 5 s, 10 s, 20 s… hasta 5 minutos.
export function retryDelayMs(attempts) {
  return Math.min(5 * 60_000, 5_000 * 2 ** Math.max(0, attempts - 1));
}

// Procesa la cola: toma comandos PENDING de terminales conectados, los ejecuta
// con su IAccessDeviceClient y los deja en SUCCESS, o en FAILED tras agotar
// los reintentos. Un comando de un terminal desconectado espera sin gastar
// intentos.
export function createCommandWorker({ store, registry, clientFactory, config = {}, logger = silentLogger }) {
  const { intervalMs = 2_000, batchSize = 10, lockMs = 60_000 } = config;
  let timer = null;
  let running = null;

  async function execute(command) {
    const session = registry.list().find((item) => item.deviceId === command.deviceId);
    const device = session && { id: session.deviceId, registrationId: session.registrationId };
    try {
      if (!session) throw new Error('El terminal se desconectó antes de ejecutar el comando.');
      const run = COMMAND_TYPES[command.type];
      if (!run) throw new Error(`Tipo de comando desconocido: ${command.type}`);
      const result = await run(clientFactory(device, session), command.payload || {});
      const done = await store.completeCommand(command.id, { ok: true, result: result ?? null });
      logger.info(`Comando ${command.id} ${command.type} en ${device.registrationId}: SUCCESS.`);
      return done;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Un tipo desconocido o una función no implementada no mejora con reintentos.
      const permanent = !COMMAND_TYPES[command.type] || error?.code === 'NOT_IMPLEMENTED';
      const done = await store.completeCommand(command.id, {
        ok: false,
        error: message,
        retryDelayMs: retryDelayMs(command.attempts),
        final: permanent,
      });
      logger.warn(`Comando ${command.id} ${command.type}: ${done?.status} (intento ${command.attempts}/${command.maxAttempts}) ${message}`);
      return done;
    }
  }

  async function runOnce() {
    const deviceIds = registry.onlineDeviceIds();
    if (!deviceIds.length) return [];
    const commands = await store.claimCommands({ deviceIds, limit: batchSize, lockMs });
    const results = [];
    for (const command of commands) results.push(await execute(command));
    return results;
  }

  return {
    // Ejecuta una pasada; si ya hay una en curso, espera esa misma.
    runOnce() {
      running ||= runOnce().finally(() => { running = null; });
      return running;
    },
    start() {
      if (timer) return;
      timer = setInterval(() => {
        this.runOnce().catch((error) => logger.error('Error en la cola de comandos', error));
      }, intervalMs);
      timer.unref?.();
    },
    async stop() {
      clearInterval(timer);
      timer = null;
      await running;
    },
  };
}
