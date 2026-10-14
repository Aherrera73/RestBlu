import { loadPrivateConfig, readConfig } from '../src/config.mjs';
import { createSqlServerStore } from '../src/db/sqlserver-store.mjs';

// Da de alta las propiedades y terminales de prueba (PROP-0001, PROP-0002).
// Se puede ejecutar varias veces: no duplica nada.

const DEVICES = [
  { registrationId: 'PROP-0001', property: 'Propiedad de prueba 1', name: 'Dahua puerta principal' },
  { registrationId: 'PROP-0002', property: 'Propiedad de prueba 2', name: 'Dahua puerta principal' },
];

loadPrivateConfig();
const store = createSqlServerStore(readConfig().sqlserver);
await store.init();
try {
  const properties = await store.listProperties();
  for (const entry of DEVICES) {
    if (await store.getDeviceByRegistrationId(entry.registrationId)) {
      console.log(`${entry.registrationId}: ya existía.`);
      continue;
    }
    let property = properties.find((item) => item.name === entry.property);
    if (!property) {
      property = await store.createProperty({ name: entry.property });
      properties.push(property);
    }
    await store.createDevice({ registrationId: entry.registrationId, propertyId: property.id, name: entry.name });
    console.log(`${entry.registrationId}: creado en "${property.name}".`);
  }
} finally {
  await store.close();
}
