import { X509Certificate } from 'node:crypto';
import { readFile, writeFile, copyFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import dotenv from 'dotenv';
import { DahuaClient } from '../src/dahua/device-client.mjs';

const directory = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'RestBlu');
const envPath = process.env.RESTBLU_ENV_PATH || join(directory, '.env.local');

function mergeEnv(original, updates) {
  const seen = new Set();
  const lines = original.replace(/\r\n/g, '\n').split('\n');
  const result = lines.map((line) => {
    const key = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line)?.[1];
    if (!key || !Object.hasOwn(updates, key)) return line;
    if (seen.has(key)) return '';
    seen.add(key);
    return `${key}=${updates[key]}`;
  });
  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) result.push(`${key}=${value}`);
  }
  return `${result.filter(Boolean).join('\r\n')}\r\n`;
}

function prompt(label, hidden = false) {
  if (!process.stdin.isTTY) throw new Error('Ejecuta el configurador desde una ventana interactiva.');
  process.stdout.write(label);
  const bytes = [];
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(Buffer.concat(bytes).toString('utf8').trim());
    };
    const onData = (chunk) => {
      for (const byte of chunk) {
        if (byte === 13 || byte === 10) return finish();
        if (byte === 3) return finish(new Error('Configuración cancelada.'));
        if (byte === 8 || byte === 127) {
          bytes.pop();
          continue;
        }
        bytes.push(Buffer.from([byte]));
        if (!hidden) process.stdout.write(Buffer.from([byte]));
      }
    };
    process.stdin.on('data', onData);
  });
}

async function main() {
  const original = existsSync(envPath) ? await readFile(envPath, 'utf8') : '';
  const prior = dotenv.parse(original);
  process.stdout.write('Se verificará la cuenta CGI sin abrir la puerta.\n');
  const suggestedUrl = prior.DAHUA_BASE_URL || 'http://172.26.10.160';
  const typedUrl = await prompt(`Dirección del terminal [${suggestedUrl}]: `);
  const rawUrl = typedUrl || suggestedUrl;
  let baseUrl;
  try {
    const parsed = new URL(rawUrl.includes('://') ? rawUrl : `http://${rawUrl}`);
    parsed.pathname = '/';
    baseUrl = parsed.origin + '/';
  } catch {
    throw new Error('La dirección del terminal no es válida.');
  }
  let caCertPath = '';
  let allowSelfSigned = false;
  if (baseUrl.startsWith('https:')) {
    const suggestedCa = prior.DAHUA_CA_CERT_PATH || '';
    const typedCa = await prompt(`Ruta del certificado CA Dahua (Enter = aceptar certificado autofirmado) [${suggestedCa || 'ninguno'}]: `);
    caCertPath = typedCa || suggestedCa;
    if (caCertPath) {
      if (!existsSync(caCertPath)) throw new Error('El certificado CA indicado no existe.');
      const certificate = new X509Certificate(await readFile(caCertPath));
      if (!certificate.ca) throw new Error('El archivo indicado no es un certificado CA.');
    } else {
      allowSelfSigned = true;
    }
  }
  const username = await prompt(`Usuario CGI [${prior.DAHUA_USERNAME || 'sin configurar'}]: `);
  const password = await prompt('Contraseña CGI (oculta; Enter conserva la anterior): ', true);
  const resolvedUsername = username || prior.DAHUA_USERNAME;
  const resolvedPassword = password ||
    (prior.DAHUA_PASSWORD_BASE64
      ? Buffer.from(prior.DAHUA_PASSWORD_BASE64, 'base64').toString('utf8') : '');
  if (!/^[A-Za-z0-9_.@-]{1,31}$/.test(resolvedUsername || '') || !resolvedPassword) {
    throw new Error('Faltan usuario o contraseña de la cuenta CGI.');
  }
  const client = new DahuaClient({
    baseUrl, caCertPath, allowSelfSigned, username: resolvedUsername, password: resolvedPassword,
  });
  process.stdout.write('Consultando el CGI de sólo lectura (puede tardar hasta 30 segundos)...\n');
  let info;
  try {
    info = await client.getDeviceInfo();
  } catch (error) {
    if (/no respondió a tiempo/i.test(error?.message || '')) {
      throw new Error('El Dahua no respondió en 30 segundos. Revisa que el equipo siga encendido y en la misma red; vuelve a intentarlo.');
    }
    throw error;
  }
  process.stdout.write(`Cuenta CGI verificada. Equipo: ${info.deviceType || 'Dahua'} ${info.serialNumber || ''}\n`);
  process.stdout.write('ATENCIÓN: esto permitirá que reservas con pago FICTICIO habiliten una cerradura REAL durante su estadía. Sólo laboratorio.\n');
  const confirmation = await prompt('Escribe ACTIVAR para habilitar esta prueba: ');
  if (confirmation !== 'ACTIVAR') throw new Error('No se activó la sincronización con la cerradura.');
  const updates = {
    DAHUA_BASE_URL: baseUrl,
    DAHUA_CA_CERT_PATH: caCertPath,
    DAHUA_ALLOW_SELF_SIGNED: allowSelfSigned ? '1' : '0',
    DAHUA_USERNAME: resolvedUsername,
    DAHUA_PASSWORD_BASE64: Buffer.from(resolvedPassword, 'utf8').toString('base64'),
    DAHUA_RESERVATION_SYNC: '1',
  };
  await mkdir(dirname(envPath), { recursive: true });
  if (existsSync(envPath)) await copyFile(envPath, `${envPath}.bak`);
  const temporary = join(directory, `.env.local.${process.pid}.tmp`);
  await writeFile(temporary, mergeEnv(original, updates), { flag: 'wx', mode: 0o600 });
  await rename(temporary, envPath);
  process.stdout.write('Cuenta Dahua verificada y guardada de forma local. Reinicia el gestor.\n');
}

main().catch((error) => {
  process.stderr.write(`No se completó la configuración: ${error.message}\n`);
  process.exitCode = 1;
});
