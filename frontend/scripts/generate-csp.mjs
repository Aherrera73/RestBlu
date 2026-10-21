import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const publicDir = join(process.cwd(), 'dist', 'client');
const configPath = join(process.cwd(), 'firebase.json');
const htmlFiles = readdirSync(publicDir).filter((name) => name.endsWith('.html'));
if (htmlFiles.length === 0) throw new Error('No HTML files found in dist/client');

function inlineHashes(html, tag) {
  const pattern = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}\\s*>`, 'gi');
  const hashes = [];
  for (const match of html.matchAll(pattern)) {
    if (tag === 'script' && /\bsrc\s*=/.test(match[1])) continue;
    if (!match[2]) continue;
    hashes.push(`'sha256-${createHash('sha256').update(match[2], 'utf8').digest('base64')}'`);
  }
  return hashes;
}

const scriptHashes = new Set();
const styleHashes = new Set();
for (const file of htmlFiles) {
  const html = readFileSync(join(publicDir, file), 'utf8');
  for (const hash of inlineHashes(html, 'script')) scriptHashes.add(hash);
  for (const hash of inlineHashes(html, 'style')) styleHashes.add(hash);
}

const policy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "script-src 'self' https://apis.google.com " + [...scriptHashes].join(' '),
  "script-src-attr 'none'",
  "style-src 'self' " + [...styleHashes].join(' '),
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' https://images.unsplash.com https://quickchart.io data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://restblu-pagos.restblu.workers.dev https://lumastay-bab6a.firebaseapp.com",
  "frame-src 'self' https://lumastay-bab6a.firebaseapp.com https://accounts.google.com",
  "form-action 'self' https://webpay3gint.transbank.cl https://webpay3g.transbank.cl",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
  'upgrade-insecure-requests',
].join('; ');

const config = JSON.parse(readFileSync(configPath, 'utf8'));
const headers = config.hosting.headers.find((entry) => entry.source === '**')?.headers;
if (!headers) throw new Error('Firebase Hosting headers for ** not found');
const csp = headers.find((header) => header.key === 'Content-Security-Policy');
if (!csp) throw new Error('Content-Security-Policy header not found');
if (process.argv.includes('--check')) {
  if (csp.value !== policy) throw new Error('CSP is stale: run node scripts/generate-csp.mjs before deploying');
  console.log('CSP matches the current HTML build');
  process.exit(0);
}
csp.value = policy;
config.hosting.headers[0].headers = headers.filter(
  (header) => header.key !== 'Content-Security-Policy-Report-Only',
);
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`CSP generated from ${htmlFiles.length} HTML files: ${scriptHashes.size} script hashes, ${styleHashes.size} style hashes`);
