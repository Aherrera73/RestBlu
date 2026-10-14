import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import dotenv from 'dotenv';
import { GoogleAuth } from 'google-auth-library';

dotenv.config({ path: join(process.env.LOCALAPPDATA || '', 'RestBlu', '.env.local'), quiet: true });
const auth = new GoogleAuth({ keyFile: process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
  scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
const client = await auth.getClient();
const base = 'https://firebaserules.googleapis.com/v1/projects/lumastay-bab6a';
const release = (await client.request({ url: `${base}/releases/cloud.firestore` })).data;
const ruleset = (await client.request({ url: `https://firebaserules.googleapis.com/v1/${release.rulesetName}` })).data;
const live = ruleset.source.files.map((file) => file.content).join('\n');
const local = await readFile(fileURLToPath(new URL('../../frontend/firestore.rules', import.meta.url)), 'utf8');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const block = (value) => value.match(/match \/reservation_status\/\{reservationId\} \{[\s\S]*?\n    \}/)?.[0] || '(missing)';
console.log(JSON.stringify(process.argv.includes('--brief')
  ? { project: 'lumastay-bab6a', localRulePublished: hash(live) === hash(local) }
  : { rulesetName: release.rulesetName,
    liveHash: hash(live), localHash: hash(local), liveReservationStatusRule: block(live) }, null, 2));
