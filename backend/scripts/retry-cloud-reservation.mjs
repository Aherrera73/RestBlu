import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import dotenv from 'dotenv';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const reservationId = String(process.argv[2] || '');
if (!/^(LS|RB)-[A-Z0-9-]{10,50}$/.test(reservationId)) {
  throw new Error('Debes indicar un código de reserva RestBlu válido.');
}

const configPath = process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, 'RestBlu', '.env.local')
  : join(process.cwd(), '.env.local');
dotenv.config({ path: configPath, quiet: true, override: true });

const credentialsPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (!credentialsPath || !existsSync(credentialsPath)) {
  throw new Error('No se encontró la credencial Firebase configurada.');
}

const credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
const app = getApps()[0] || initializeApp({ credential: cert(credentials) });
const store = getFirestore(app);
const intakeReference = store.collection('reservation_intake').doc(reservationId);
const intake = await intakeReference.get();
if (!intake.exists) throw new Error('La reserva no existe en reservation_intake.');
if (intake.data()?.syncStatus !== 'error') {
  throw new Error('La reserva no está en estado de error y no necesita reintento.');
}

await intakeReference.update({
  syncStatus: 'pending',
  syncError: FieldValue.delete(),
  processedAt: FieldValue.delete(),
  retryRequestedAt: new Date().toISOString(),
});

const statusReference = store.collection('reservation_status').doc(reservationId);
const status = await statusReference.get();
if (status.exists) {
  await statusReference.update({
    status: 'pendiente-sincronizacion',
    verified: false,
    error: FieldValue.delete(),
    syncedAt: new Date().toISOString(),
  });
}

console.log(JSON.stringify({ reservationId, retryQueued: true }));
