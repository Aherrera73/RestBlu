import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import dotenv from 'dotenv';
import { cert } from 'firebase-admin/app';

const root = resolve(import.meta.dirname, '..');
const privateConfigPath = process.env.RESTBLU_ENV_PATH || process.env.LUMASTAY_ENV_PATH ||
  (process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'RestBlu', '.env.local')
    : join(root, '.env.local'));

dotenv.config({
  path: existsSync(privateConfigPath) ? privateConfigPath : join(root, '.env.local'),
  quiet: true,
});

const serviceAccountPath = resolve(
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    join(homedir(), 'Downloads', 'lumastay-bab6a-firebase-adminsdk-fbsvc-caa62bc4b1.json'),
);

if (!existsSync(serviceAccountPath)) {
  throw new Error('No se encontró la cuenta de servicio configurada para Firebase.');
}

const serviceAccount = JSON.parse(await readFile(serviceAccountPath, 'utf8'));
const credential = cert(serviceAccount);
const accessToken = await credential.getAccessToken();
const response = await fetch(
  `https://cloudbilling.googleapis.com/v1/projects/${encodeURIComponent(serviceAccount.project_id)}/billingInfo`,
  { headers: { Authorization: `Bearer ${accessToken.access_token}` } },
);

if (!response.ok) {
  console.log(JSON.stringify({
    projectId: serviceAccount.project_id,
    billingStatus: 'unavailable',
    httpStatus: response.status,
  }, null, 2));
  process.exit(0);
}

const billing = await response.json();
console.log(JSON.stringify({
  projectId: serviceAccount.project_id,
  billingStatus: billing.billingEnabled ? 'enabled' : 'disabled',
}, null, 2));
