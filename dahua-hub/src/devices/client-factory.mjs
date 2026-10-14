import { ACCESS_DEVICE_METHODS } from './access-device-client.mjs';
import { DahuaClient } from './dahua-client.mjs';
import { FakeDahuaClient } from './fake-dahua-client.mjs';

// Elige la implementación de IAccessDeviceClient: "fake" (sin hardware) o
// "dahua" (terminal real conectado por Auto Register).
export function createClientFactory(mode = 'fake', deviceOptions = {}) {
  if (!['fake', 'dahua'].includes(mode)) throw new Error(`DAHUA_HUB_CLIENT inválido: ${mode} (usa fake o dahua).`);
  return (device, session) => {
    const client = mode === 'dahua'
      ? new DahuaClient({ registrationId: device.registrationId, session, timeZone: deviceOptions.timeZone, door: deviceOptions.door })
      : new FakeDahuaClient({ registrationId: device.registrationId });
    for (const method of ACCESS_DEVICE_METHODS) {
      if (typeof client[method] !== 'function') throw new TypeError(`${client.constructor.name} no implementa ${method}.`);
    }
    return client;
  };
}
