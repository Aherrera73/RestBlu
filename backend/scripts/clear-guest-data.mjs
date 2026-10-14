// Limpieza explícita de datos personales de viajeros y reservas.
// Uso: node scripts/clear-guest-data.mjs <base-activa> <base-escritorio> <directorio-respaldos> --execute
// No elimina alojamientos ni sus fotos, etiquetas o configuración pública.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import dotenv from 'dotenv';
import { cert, initializeApp } from 'firebase-admin/app';
import { initializeFirestore } from 'firebase-admin/firestore';

const [activeArg, desktopArg, backupArg, flag] = process.argv.slice(2);
if (!activeArg || !desktopArg || !backupArg || flag !== '--execute') {
  throw new Error('Faltan las dos bases, el directorio de respaldos o --execute. No se ha borrado nada.');
}
const activePath = resolve(activeArg);
const desktopPath = resolve(desktopArg);
const backupDir = resolve(backupArg);
if (!existsSync(activePath) || !existsSync(desktopPath) || activePath === desktopPath) {
  throw new Error('Las dos bases de origen deben existir y ser distintas. No se ha borrado nada.');
}
// Evitar que el worker vuelva a publicar o importar durante la limpieza.
try {
  const health = await fetch('http://127.0.0.1:3100/api/health', { signal: AbortSignal.timeout(1500) });
  if (health.ok) throw new Error('Cierra primero el gestor en el puerto 3100. No se ha borrado nada.');
} catch (error) {
  if (error?.message?.includes('Cierra primero')) throw error;
}

const personalTables = [
  'estadia_eventos', 'estadias', 'correo_sesiones_verificadas', 'clientes',
];
const cloudCollections = [
  'reservation_intake',
  'reservation_status',
  'reservation_verification_requests',
  'reservation_payment_requests',
  'public_reservation_lookup_requests',
  'public_biometric_requests',
  'public_ai_requests',
];
const now = new Date().toISOString().replace(/[:.]/g, '-');
mkdirSync(backupDir, { recursive: true });

function databaseCounts(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') {
      throw new Error(`Integridad SQLite inválida: ${path}`);
    }
    const counts = {};
    const existing = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
      .map((row) => row.name));
    for (const name of [...personalTables, 'alojamientos', 'alojamiento_imagenes', 'alojamiento_etiquetas']) {
      counts[name] = existing.has(name)
        ? db.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get().count
        : 0;
    }
    return counts;
  } finally {
    db.close();
  }
}

const beforeActive = databaseCounts(activePath);
const beforeDesktop = databaseCounts(desktopPath);
if (beforeActive.alojamientos !== 20 || beforeActive.estadias !== 16 ||
    beforeDesktop.alojamientos !== 12 || beforeDesktop.estadias !== 9) {
  throw new Error('Los conteos cambiaron desde la inspección. Revisar antes de borrar.');
}

const privatePath = join(process.env.LOCALAPPDATA || '', 'RestBlu', '.env.local');
const settings = dotenv.parse(readFileSync(privatePath));
const serviceAccount = JSON.parse(readFileSync(settings.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));
const app = initializeApp({ credential: cert(serviceAccount) });
const store = initializeFirestore(app, { preferRest: true });
const cloudSnapshots = await Promise.all(cloudCollections.map((name) => store.collection(name).get()));
const cloudBefore = Object.fromEntries(cloudCollections.map((name, index) => [name, cloudSnapshots[index].size]));
const propertyCloudBefore = (await store.collection('public_properties').count().get()).data().count;
const configCloudBefore = (await store.collection('public_biometric_config').count().get()).data().count;
if (propertyCloudBefore !== 17 || configCloudBefore !== 1 ||
    cloudSnapshots.reduce((sum, snapshot) => sum + snapshot.size, 0) > 450) {
  throw new Error('Los conteos de Firebase cambiaron o superan el límite de una operación atómica. Revisar antes de borrar.');
}

const backupPaths = {
  active: join(backupDir, `antes-limpieza-activa-${now}.sqlite`),
  desktop: join(backupDir, `antes-limpieza-escritorio-${now}.sqlite`),
  cloud: join(backupDir, `antes-limpieza-firebase-${now}.json`),
};
if (Object.values(backupPaths).some((path) => existsSync(path))) {
  throw new Error('Un respaldo ya existe. No se sobrescribe ni se ha borrado nada.');
}
for (const [source, destination] of [
  [activePath, backupPaths.active],
  [desktopPath, backupPaths.desktop],
]) {
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    db.prepare('VACUUM INTO ?').run(destination);
  } finally {
    db.close();
  }
}
writeFileSync(backupPaths.cloud, JSON.stringify({
  savedAt: new Date().toISOString(),
  documents: cloudSnapshots.flatMap((snapshot) => snapshot.docs.map((document) => ({
    path: document.ref.path,
    data: document.data(),
  }))),
}), 'utf8');

// Primero retirar los documentos de la nube: el gestor sigue apagado y no
// puede volver a publicar. Son menos de 500 escrituras, por lo que el lote
// se confirma entero o no se confirma.
const batch = store.batch();
for (const snapshot of cloudSnapshots) {
  for (const document of snapshot.docs) batch.delete(document.ref);
}
await batch.commit();

function clearDatabase(path, expectedProperties) {
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON; BEGIN IMMEDIATE;');
    try {
      const existing = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
        .map((row) => row.name));
      for (const name of personalTables) if (existing.has(name)) db.exec(`DELETE FROM ${name};`);
      const remaining = db.prepare('SELECT COUNT(*) AS count FROM alojamientos').get().count;
      if (remaining !== expectedProperties) throw new Error('Cambió el catálogo de alojamientos; se revierte esta base.');
      db.exec('COMMIT;');
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' ||
        db.prepare('PRAGMA foreign_key_check').all().length) {
      throw new Error('La base no pasó la verificación de integridad después de la limpieza.');
    }
  } finally {
    db.close();
  }
}
clearDatabase(activePath, beforeActive.alojamientos);
clearDatabase(desktopPath, beforeDesktop.alojamientos);

const cloudAfter = {};
for (const name of cloudCollections) {
  cloudAfter[name] = (await store.collection(name).count().get()).data().count;
}
const propertyCloudAfter = (await store.collection('public_properties').count().get()).data().count;
const configCloudAfter = (await store.collection('public_biometric_config').count().get()).data().count;
const afterActive = databaseCounts(activePath);
const afterDesktop = databaseCounts(desktopPath);
if (Object.values(cloudAfter).some((count) => count !== 0) ||
    personalTables.some((name) => afterActive[name] !== 0 || afterDesktop[name] !== 0) ||
    propertyCloudAfter !== propertyCloudBefore || configCloudAfter !== configCloudBefore ||
    afterActive.alojamiento_imagenes !== beforeActive.alojamiento_imagenes ||
    afterDesktop.alojamiento_imagenes !== beforeDesktop.alojamiento_imagenes) {
  throw new Error('La comprobación final detectó datos restantes o cambios en alojamientos. Mantén el gestor apagado y revisa respaldos.');
}
console.log(JSON.stringify({
  before: { active: beforeActive, desktop: beforeDesktop, cloud: cloudBefore,
    cloudProperties: propertyCloudBefore },
  after: { active: afterActive, desktop: afterDesktop, cloud: cloudAfter,
    cloudProperties: propertyCloudAfter },
  backupPaths,
}, null, 2));
process.exit(0);
