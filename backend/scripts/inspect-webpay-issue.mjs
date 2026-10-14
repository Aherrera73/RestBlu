import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import dotenv from 'dotenv';
import { cert, initializeApp } from 'firebase-admin/app';
import { initializeFirestore } from 'firebase-admin/firestore';

const path = join(process.env.LOCALAPPDATA || '', 'RestBlu', '.env.local');
dotenv.config({ path, quiet: true });
if (!existsSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '')) throw new Error('Falta Firebase.');
const credentials = JSON.parse(await readFile(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));
const store = initializeFirestore(initializeApp({ credential: cert(credentials) }), { preferRest: true });
const ids = process.argv.slice(2);
for (const id of ids) {
  const [intake, status, payments] = await Promise.all([
    store.collection('reservation_intake').doc(id).get(),
    store.collection('reservation_status').doc(id).get(),
    store.collection('reservation_payment_requests').where('reservationId', '==', id).get(),
  ]);
  const summary = (snapshot) => snapshot.exists ? {
    syncStatus: snapshot.data().syncStatus || '',
    status: snapshot.data().status || '',
    paymentStatus: snapshot.data().paymentStatus || '',
    createdAt: snapshot.data().createdAt || '',
    syncedAt: snapshot.data().syncedAt || '',
    expiresAt: snapshot.data().expiresAt || '',
    error: snapshot.data().error || snapshot.data().syncError || '',
    emailVerified: snapshot.data().emailVerified || false,
  } : null;
  console.log(JSON.stringify({ id, intake: summary(intake), status: summary(status),
    ownerUidPresent: Boolean(status.data()?.ownerUid),
    ownerMatchesIntake: Boolean(intake.data()?.ownerUid && intake.data()?.ownerUid === status.data()?.ownerUid),
    paymentRequests: payments.docs.map((document) => ({
      id: document.id,
      syncStatus: document.data().syncStatus,
      createdAt: document.data().createdAt,
      processedAt: document.data().processedAt,
      error: document.data().error || '',
      hasToken: Boolean(document.data().webpayToken),
    })),
  }, null, 2));
}
