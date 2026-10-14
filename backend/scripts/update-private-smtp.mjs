import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const configPath = process.env.RESTBLU_ENV_PATH || join(
  process.env.LOCALAPPDATA || '',
  'RestBlu',
  '.env.local',
);

const input = await new Promise((resolve) => {
  const reader = createInterface({ input: process.stdin, terminal: false });
  reader.once('line', (line) => {
    reader.close();
    resolve(line);
  });
});
const { email, appPassword } = JSON.parse(input);
const normalizedEmail = String(email || '').trim().toLowerCase();
const normalizedPassword = String(appPassword || '').replace(/\s+/g, '');

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
  throw new Error('El correo SMTP no es válido.');
}
if (!/^[a-z0-9]{16}$/i.test(normalizedPassword)) {
  throw new Error('La contraseña de aplicación debe tener 16 caracteres.');
}

const replacements = new Map([
  ['SMTP_HOST', 'smtp.gmail.com'],
  ['SMTP_PORT', '465'],
  ['SMTP_SECURE', 'true'],
  ['SMTP_USER', normalizedEmail],
  ['SMTP_PASS', normalizedPassword],
  ['MAIL_FROM', `RestBlu <${normalizedEmail}>`],
]);
const current = await readFile(configPath, 'utf8');
const seen = new Set();
const updated = current.split(/\r?\n/).map((line) => {
  const match = line.match(/^\s*([A-Z0-9_]+)=/);
  if (!match || !replacements.has(match[1])) return line;
  seen.add(match[1]);
  return `${match[1]}=${replacements.get(match[1])}`;
});
for (const [key, value] of replacements) {
  if (!seen.has(key)) updated.push(`${key}=${value}`);
}
await writeFile(configPath, `${updated.join('\n').replace(/\n+$/, '')}\n`, 'utf8');
console.log(JSON.stringify({ updated: true, keys: [...replacements.keys()] }));
