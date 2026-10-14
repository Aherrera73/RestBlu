import { copyFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createLocalDatabase } from '../src/database/local-database.mjs';

const backendRoot = resolve(import.meta.dirname, '..');
const dataRoot = join(backendRoot, 'data');
const databasePath = join(dataRoot, 'lumastay.sqlite');
const legacyPath = join(dataRoot, 'lumastay-data.json');
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
  join(homedir(), 'Downloads', 'lumastay-bab6a-firebase-adminsdk-fbsvc-caa62bc4b1.json');
const collections = [
  'reservation_intake',
  'reservation_status',
  'reservation_verification_requests',
  'reservation_payment_requests',
  'public_biometric_requests',
];

if (!process.argv.includes('--execute')) {
  throw new Error('Este script borra datos de prueba. Ejecuta con --execute sólo después de detener el gestor.');
}
if (!existsSync(databasePath) || !existsSync(serviceAccountPath)) {
  throw new Error('Falta la base SQLite o la credencial del proyecto Firebase. No se borró nada.');
}
let managerRunning = false;
try {
  const response = await fetch('http://127.0.0.1:3100/api/health', { signal: AbortSignal.timeout(1500) });
  managerRunning = response.ok;
} catch {
  // Sin gestor activo en el puerto local.
}
if (managerRunning) throw new Error('Detén primero el gestor del puerto 3100. No se borró nada.');

const serviceAccount = JSON.parse(await (await import('node:fs/promises')).readFile(serviceAccountPath, 'utf8'));
if (serviceAccount.project_id !== 'lumastay-bab6a') {
  throw new Error('La credencial apunta a otro proyecto Firebase. No se borró nada.');
}
initializeApp({ credential: cert(serviceAccount) });
const cloud = getFirestore();
const cloudBackup = {};
for (const name of collections) {
  const snapshot = await cloud.collection(name).get();
  cloudBackup[name] = snapshot.docs.map((document) => ({ id: document.id, data: document.data() }));
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = join(dataRoot, 'backups', `limpieza-${timestamp}`);
await mkdir(backupDir, { recursive: true });
await copyFile(databasePath, join(backupDir, 'lumastay.sqlite'));
await writeFile(
  join(backupDir, 'firebase-reservas.json'),
  JSON.stringify({ project: serviceAccount.project_id, exportedAt: new Date().toISOString(), collections: cloudBackup }, null, 2),
  { encoding: 'utf8', mode: 0o600 },
);

// Aplicar la migración SQLite antes de borrar documentos remotos.
createLocalDatabase({
  databasePath,
  legacyJsonPath: legacyPath,
  schemaPath: join(backendRoot, 'src', 'database', 'schema.sql'),
}).close();

const batch = cloud.batch();
let cloudCount = 0;
for (const name of collections) {
  for (const document of cloudBackup[name]) {
    batch.delete(cloud.collection(name).doc(document.id));
    cloudCount += 1;
  }
}
if (cloudCount > 500) throw new Error('Hay más de 500 documentos; no se borró nada. Usa limpieza por lotes.');
if (cloudCount) await batch.commit();

const sqlite = new DatabaseSync(databasePath);
sqlite.exec('PRAGMA foreign_keys = ON; BEGIN IMMEDIATE;');
try {
  sqlite.exec(`
    DELETE FROM estadia_eventos;
    DELETE FROM estadias;
    DELETE FROM clientes;
    DELETE FROM correo_sesiones_verificadas;
  `);
  sqlite.exec('COMMIT;');
} catch (error) {
  sqlite.exec('ROLLBACK;');
  sqlite.close();
  throw error;
}
const remaining = {
  properties: sqlite.prepare('SELECT COUNT(*) AS n FROM alojamientos').get().n,
  customers: sqlite.prepare('SELECT COUNT(*) AS n FROM clientes').get().n,
  reservations: sqlite.prepare('SELECT COUNT(*) AS n FROM estadias').get().n,
  verifiedSessions: sqlite.prepare('SELECT COUNT(*) AS n FROM correo_sesiones_verificadas').get().n,
};
sqlite.close();

if (existsSync(legacyPath)) {
  await rename(legacyPath, join(backupDir, 'lumastay-data-legacy.json'));
}
console.log(JSON.stringify({ backupDir, removedCloudDocuments: cloudCount, ...remaining }, null, 2));
