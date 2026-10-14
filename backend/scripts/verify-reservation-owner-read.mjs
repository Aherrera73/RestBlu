import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { initializeFirestore } from 'firebase-admin/firestore';

dotenv.config({ path: join(process.env.LOCALAPPDATA || '', 'RestBlu', '.env.local'), quiet: true });
const credentials = JSON.parse(await readFile(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));
const app = initializeApp({ credential: cert(credentials) });
const store = initializeFirestore(app, { preferRest: true });
const id = process.argv[2];
if (!/^(RB|LS)-[A-Z0-9-]+$/.test(id || '')) throw new Error('ID inválido.');
const document = await store.collection('reservation_status').doc(id).get();
if (!document.exists || !document.data().ownerUid) throw new Error('Reserva sin dueño.');
const source = await readFile(fileURLToPath(new URL('../../android-app/app/build.gradle.kts', import.meta.url)), 'utf8');
const apiKey = source.match(/buildConfigField\("String", "FIREBASE_API_KEY", "\\"([^"\\]+)\\""\)/)?.[1];
if (!apiKey) throw new Error('Falta clave pública de Firebase.');
const customToken = await getAuth(app).createCustomToken(document.data().ownerUid);
const signin = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: customToken, returnSecureToken: true }),
});
const session = await signin.json();
if (!signin.ok) throw new Error(`No se pudo crear sesión de diagnóstico: HTTP ${signin.status}`);
const response = await fetch(`https://firestore.googleapis.com/v1/projects/lumastay-bab6a/databases/(default)/documents/reservation_status/${id}?key=${apiKey}`, {
  headers: { Authorization: `Bearer ${session.idToken}` },
});
console.log(JSON.stringify({ reservationId: id, ownerReadHttpStatus: response.status }));
