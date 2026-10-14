// Limpieza puntual de las cinco reservas que el usuario pidió borrar el 2026-10-07.
// Uso: node scripts/delete-current-reservations.mjs --preview
//      node scripts/delete-current-reservations.mjs --execute=DELETE_CURRENT_FIVE
// El gestor debe estar detenido en el segundo caso. Se conserva un respaldo
// local antes de revocar accesos o borrar documentos.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { cert, initializeApp } from 'firebase-admin/app';
import { initializeFirestore } from 'firebase-admin/firestore';
import { createSqlServerDatabase, sqlServerConfigFromEnv } from '../src/database/sqlserver-database.mjs';
import { DahuaClient } from '../src/dahua/device-client.mjs';
import { createHubTransport } from '../src/dahua/hub-transport.mjs';
import { revokeReservationFace } from '../src/dahua/reservation-access.mjs';

const backend = resolve(fileURLToPath(new URL('..', import.meta.url)));
const project = resolve(backend, '..');
const privatePath = process.env.RESTBLU_ENV_PATH || join(
  process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'RestBlu', '.env.local',
);
dotenv.config({ path: privatePath, quiet: true });

const expectedIds = new Set([
  'RB-VNIK49-D57DAA3D4BFC',
  'RB-XHL1S2-0B3FE8F46197',
  'RB-XE7OM4-BAEA99E5EB93',
  'RB-X563AC-CC0F62677F74',
  'RB-X3WQNJ-C6CD96244DA7',
]);
const directCollections = [
  'reservation_status', 'reservation_intake',
  'reservation_verification_requests', 'cloud_reservations',
];
const requestCollections = [
  'reservation_payment_requests', 'public_biometric_requests',
  'phone_access_requests', 'tap_access_requests',
];
const execute = process.argv.includes('--execute=DELETE_CURRENT_FIVE');
if (!execute && !process.argv.includes('--preview')) throw new Error('Indica --preview o --execute=DELETE_CURRENT_FIVE.');
if (process.env.RESTBLU_DB_ENGINE !== 'sqlserver') throw new Error('La base activa no es SQL Server.');

const db = await createSqlServerDatabase({
  config: sqlServerConfigFromEnv(),
  schemaPath: join(backend, 'src', 'database', 'schema-sqlserver.sql'),
});
try {
  const database = await db.readDatabase();
  const currentIds = new Set(database.reservations.map((item) => item.id));
  if (currentIds.size !== expectedIds.size || [...currentIds].some((id) => !expectedIds.has(id))) {
    throw new Error('Las reservas del gestor cambiaron desde la inspección. No se ha borrado nada.');
  }
  const credentialsPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!credentialsPath || !existsSync(credentialsPath)) throw new Error('Falta la cuenta de servicio Firebase.');
  const credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
  const app = initializeApp({ credential: cert(credentials) });
  const store = initializeFirestore(app, { preferRest: true });
  const cloudDocuments = new Map();
  for (const collection of directCollections) {
    for (const id of expectedIds) {
      const document = await store.collection(collection).doc(id).get();
      if (document.exists) cloudDocuments.set(document.ref.path, document);
    }
  }
  for (const collection of requestCollections) {
    const snapshot = await store.collection(collection).where('reservationId', 'in', [...expectedIds]).get();
    for (const document of snapshot.docs) cloudDocuments.set(document.ref.path, document);
  }
  const preview = {
    mode: execute ? 'execute' : 'preview',
    reservations: database.reservations.map(({ id, propertyName, checkIn, checkOut, dahuaTerminal, dahuaStatus, dahuaQrStatus }) => ({
      id, propertyName, checkIn, checkOut, dahuaTerminal, dahuaStatus, dahuaQrStatus,
    })),
    cloudDocuments: Object.fromEntries([...new Set([...directCollections, ...requestCollections])].map((name) => [
      name, [...cloudDocuments.values()].filter((document) => document.ref.parent.id === name).length,
    ])),
  };
  if (!execute) {
    console.log(JSON.stringify(preview, null, 2));
    process.exitCode = 0;
  } else {
    try {
      const response = await fetch('http://127.0.0.1:3100/api/health', { signal: AbortSignal.timeout(1500) });
      if (response.ok) throw new Error('Detén el gestor antes de borrar; sigue atendiendo el puerto 3100.');
    } catch (error) {
      if (error.message.includes('Detén el gestor')) throw error;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDirectory = join(project, 'respaldos', `antes_eliminar_cinco_reservas_${stamp}`);
    if (existsSync(backupDirectory)) throw new Error('Ya existe el directorio de respaldo.');
    await mkdir(backupDirectory, { recursive: true });
    const accessEvents = await db.listAccessEvents({ limit: 5000 });
    await writeFile(join(backupDirectory, 'gestor-sqlserver.json'), JSON.stringify({
      exportedAt: new Date().toISOString(), database, accessEvents,
    }, null, 2), 'utf8');
    await writeFile(join(backupDirectory, 'reservas-firebase.json'), JSON.stringify({
      exportedAt: new Date().toISOString(),
      documents: [...cloudDocuments.values()].map((document) => ({ path: document.ref.path, data: document.data() })),
    }, null, 2), 'utf8');

    const dahuaVerified = [];
    for (const reservation of database.reservations) {
      if (!reservation.dahuaUserId) continue;
      // El terminal LAN histórico es el mismo equipo registrado en el hub.
      // Se comprueban también las credenciales marcadas como revocadas.
      const terminal = reservation.dahuaTerminal === 'lan'
        ? process.env.DAHUA_HUB_LAN_DEVICE || 'lan' : reservation.dahuaTerminal;
      let client;
      if (terminal === 'lan') {
        client = new DahuaClient({
          baseUrl: process.env.DAHUA_BASE_URL,
          caCertPath: process.env.DAHUA_CA_CERT_PATH,
          allowSelfSigned: process.env.DAHUA_ALLOW_SELF_SIGNED === '1',
          username: process.env.DAHUA_USERNAME,
          password: process.env.DAHUA_PASSWORD_BASE64
            ? Buffer.from(process.env.DAHUA_PASSWORD_BASE64, 'base64').toString('utf8')
            : process.env.DAHUA_PASSWORD,
        });
      } else if (terminal && process.env.DAHUA_HUB_URL) {
        client = new DahuaClient({ transport: createHubTransport({
          hubUrl: process.env.DAHUA_HUB_URL,
          apiKey: process.env.DAHUA_HUB_API_KEY,
          registrationId: terminal,
        }) });
      } else {
        throw new Error(`La reserva ${reservation.id} no tiene un terminal Dahua accesible.`);
      }
      const wasPresent = await client.findPerson(reservation.dahuaUserId);
      if (wasPresent) {
        await revokeReservationFace(client, {
          userId: reservation.dahuaUserId,
          recNo: reservation.dahuaRecNo,
          cardNo: reservation.dahuaQrCode,
        });
      }
      if (await client.findPerson(reservation.dahuaUserId)) {
        throw new Error(`La persona Dahua de ${reservation.id} aún aparece en el terminal.`);
      }
      dahuaVerified.push({ reservationId: reservation.id, terminal, removedNow: wasPresent });
    }

    if (cloudDocuments.size) {
      const batch = store.batch();
      for (const document of cloudDocuments.values()) batch.delete(document.ref);
      await batch.commit();
    }
    database.reservations = [];
    await db.saveDatabase(database);

    const remaining = await db.readDatabase();
    if (remaining.reservations.length) throw new Error('Persisten reservas en SQL Server.');
    for (const path of cloudDocuments.keys()) {
      const [collection, id] = path.split('/');
      if ((await store.collection(collection).doc(id).get()).exists) {
        throw new Error(`Persiste el documento ${path} en Firebase.`);
      }
    }
    console.log(JSON.stringify({
      mode: 'completed', removedReservations: [...expectedIds],
      removedCloudDocuments: cloudDocuments.size, dahuaVerified,
      backupDirectory,
      preserved: ['alojamientos', 'clientes', 'historial de accesos'],
    }, null, 2));
  }
} finally {
  await db.close();
}
