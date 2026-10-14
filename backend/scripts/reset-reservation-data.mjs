import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createSqlServerDatabase, sqlServerConfigFromEnv } from '../src/database/sqlserver-database.mjs';

const BACKEND = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = resolve(BACKEND, '..');
const DATABASE = join(BACKEND, 'data', 'lumastay.sqlite');
const PRIVATE_CONFIG = process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, 'RestBlu', '.env.local')
  : join(BACKEND, '.env.local');
const COLLECTIONS = [
  'reservation_verification_requests',
  'reservation_status',
  'reservation_intake',
  'cloud_reservations',
];

dotenv.config({ path: PRIVATE_CONFIG, quiet: true });
const SQLSERVER = String(process.env.RESTBLU_DB_ENGINE || '').trim().toLowerCase() === 'sqlserver';

const credentialsPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (!credentialsPath || !existsSync(credentialsPath)) {
  throw new Error('No se encontró la cuenta de servicio configurada para Firebase.');
}
if (!SQLSERVER && !existsSync(DATABASE)) throw new Error('No se encontró la base SQLite de RestBlu.');
const sqlServer = SQLSERVER
  ? await createSqlServerDatabase({
    config: sqlServerConfigFromEnv(),
    schemaPath: join(BACKEND, 'src', 'database', 'schema-sqlserver.sql'),
  })
  : null;

const credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
const app = getApps()[0] || initializeApp({ credential: cert(credentials) });
const store = getFirestore(app);
const snapshots = {};

for (const name of COLLECTIONS) {
  const snapshot = await store.collection(name).get();
  snapshots[name] = snapshot.docs.map((document) => ({
    id: document.id,
    data: document.data(),
  }));
}

let localCounts;
if (sqlServer) {
  const counts = await sqlServer.tableCounts();
  localCounts = { clientes: counts.customers, estadias: counts.reservations };
} else {
  const sqlite = new DatabaseSync(DATABASE, { readOnly: true });
  localCounts = {
    clientes: sqlite.prepare('SELECT COUNT(*) AS total FROM clientes').get().total,
    estadias: sqlite.prepare('SELECT COUNT(*) AS total FROM estadias').get().total,
    eventos: sqlite.prepare('SELECT COUNT(*) AS total FROM estadia_eventos').get().total,
  };
  sqlite.close();
}

const remoteCounts = Object.fromEntries(
  COLLECTIONS.map((name) => [name, snapshots[name].length]),
);

if (!process.argv.includes('--confirm=RESET_RESERVATION_DATA')) {
  console.log(JSON.stringify({ mode: 'preview', engine: sqlServer ? 'sqlserver' : 'sqlite', localCounts, remoteCounts }, null, 2));
  await sqlServer?.close();
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDirectory = join(PROJECT, 'respaldos', `antes_reinicio_reservas_${stamp}`);
await mkdir(backupDirectory, { recursive: true });
if (sqlServer) {
  const backup = await sqlServer.readDatabase();
  backup.accessEvents = await sqlServer.listAccessEvents({ limit: 5000 });
  await writeFile(join(backupDirectory, 'restblu-sqlserver.json'), `${JSON.stringify(backup, null, 2)}
`, 'utf8');
} else {
  await copyFile(DATABASE, join(backupDirectory, 'lumastay.sqlite'));
}
await writeFile(
  join(backupDirectory, 'reservas-firestore.json'),
  `${JSON.stringify({ exportedAt: new Date().toISOString(), collections: snapshots }, null, 2)}\n`,
  'utf8',
);

for (const name of COLLECTIONS) {
  while (true) {
    const snapshot = await store.collection(name).limit(400).get();
    if (snapshot.empty) break;
    const batch = store.batch();
    for (const document of snapshot.docs) batch.delete(document.ref);
    await batch.commit();
  }
}

if (sqlServer) {
  // El registro de accesos se copia del Dahua: desde ahora sólo lo nuevo.
  await sqlServer.resetReservationData(new Date().toISOString());
  await sqlServer.close();
}
const writable = sqlServer ? null : new DatabaseSync(DATABASE);
if (writable) {
  writable.exec('PRAGMA foreign_keys = ON;');
  writable.exec('BEGIN IMMEDIATE;');
  try {
    writable.exec(`
      DELETE FROM estadia_eventos;
      DELETE FROM estadias;
      DELETE FROM clientes;
      DELETE FROM accesos_eventos;
      DELETE FROM sqlite_sequence WHERE name = 'estadia_eventos';
    `);
    writable.prepare(`
      INSERT INTO app_metadata (key, value) VALUES ('updated_at', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(new Date().toISOString());
    // El registro de accesos se copia del Dahua: desde ahora sólo lo nuevo.
    writable.prepare(`
      INSERT INTO app_metadata (key, value) VALUES ('accesos_sincronizar_desde', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(new Date().toISOString());
    writable.exec('COMMIT;');
    writable.exec('VACUUM;');
  } catch (error) {
    writable.exec('ROLLBACK;');
    throw error;
  } finally {
    writable.close();
  }
}

console.log(JSON.stringify({
  mode: 'completed',
  backupDirectory,
  removed: { local: localCounts, remote: remoteCounts },
  preserved: ['alojamientos', 'alojamiento_imagenes', 'alojamiento_etiquetas'],
}, null, 2));
