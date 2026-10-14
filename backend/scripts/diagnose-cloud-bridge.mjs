import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import dotenv from 'dotenv';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

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

async function recent(collectionName) {
  const snapshot = await store.collection(collectionName).limit(100).get();
  return snapshot.docs
    .map((document) => {
      const data = document.data();
      return {
        id: document.id,
        syncStatus: data.syncStatus || '',
        status: data.status || '',
        verified: Boolean(data.verified),
        source: data.source || '',
        propertyName: data.propertyName || '',
        checkIn: data.checkIn || '',
        checkOut: data.checkOut || '',
        verificationEmailSent: Boolean(data.verificationEmailSentAt),
        confirmationPdfEmailSent: Boolean(data.confirmationEmailSentAt),
        createdAt: data.createdAt || data.syncedAt || '',
        hasError: Boolean(data.syncError || data.error),
        errorMessage: String(data.syncError || data.error || '').slice(0, 300),
      };
    })
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    .slice(0, 12);
}

const [intake, statuses, verifications] = await Promise.all([
  recent('reservation_intake'),
  recent('reservation_status'),
  recent('reservation_verification_requests'),
]);

console.log(JSON.stringify({ intake, statuses, verifications }, null, 2));
