import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';
import { cert } from 'firebase-admin/app';

const BACKEND_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PRIVATE_CONFIG_PATH = process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, 'RestBlu', '.env.local')
  : join(BACKEND_DIR, '.env.local');
const LEGACY_PRIVATE_CONFIG_PATH = process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, 'LumaStay', '.env.local')
  : join(BACKEND_DIR, '.env.local');
const DEFAULT_FIREBASE_SERVICE_ACCOUNT_PATH = join(
  homedir(),
  'Downloads',
  'lumastay-bab6a-firebase-adminsdk-fbsvc-caa62bc4b1.json',
);

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return '';
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Falta el valor de ${name}.`);
  }
  return value;
}

function selectedConfigPath() {
  const requestedPath = argumentValue('--config');
  if (requestedPath) return resolve(requestedPath);
  const explicitPath = process.env.RESTBLU_ENV_PATH || process.env.LUMASTAY_ENV_PATH;
  if (explicitPath) return resolve(explicitPath);
  if (existsSync(DEFAULT_PRIVATE_CONFIG_PATH)) return DEFAULT_PRIVATE_CONFIG_PATH;
  if (existsSync(LEGACY_PRIVATE_CONFIG_PATH)) return LEGACY_PRIVATE_CONFIG_PATH;
  const projectConfigPath = join(BACKEND_DIR, '.env.local');
  return existsSync(projectConfigPath) ? projectConfigPath : DEFAULT_PRIVATE_CONFIG_PATH;
}

function parseEnvironmentFile(contents) {
  const values = new Map();
  for (const sourceLine of contents.split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values.set(match[1], value);
  }
  return values;
}

function isPlaceholder(value) {
  return /(?:tu[-_ ]?(?:cuenta|correo|usuario|contrasena|contraseña)|tu_usuario|reemplazar|change[-_ ]?me|your[-_ ]?(?:email|user|password)|example\.(?:com|org)|TU_USUARIO)/i.test(
    value,
  );
}

function missingOrPlaceholder(values, names) {
  return names.filter((name) => {
    const value = values.get(name)?.trim() || '';
    return !value || isPlaceholder(value);
  });
}

function safeFileExists(pathname) {
  try {
    return existsSync(pathname) && statSync(pathname).isFile();
  } catch {
    return false;
  }
}

function printResult(ok, label, detail) {
  console.log(`${ok ? '[OK]' : '[PENDIENTE]'} ${label}: ${detail}`);
}

async function main() {
  const configPath = selectedConfigPath();
  console.log('RestBlu - revisión segura de configuración');
  console.log('No se muestran correos, contraseñas, rutas privadas ni contenido de credenciales.');
  console.log('');

  if (!safeFileExists(configPath)) {
    printResult(false, 'Archivo privado', 'todavía no existe. Ejecuta Configurar_Correo_RestBlu.bat.');
    printResult(false, 'Correo SMTP', 'faltan SMTP_HOST, SMTP_USER y SMTP_PASS.');
    printResult(false, 'Firebase', 'falta indicar un archivo JSON de cuenta de servicio.');
    console.log('');
    console.log('Resultado: configuración pendiente. Puedes completarla sin compartir ningún secreto.');
    process.exitCode = 2;
    return;
  }

  const values = parseEnvironmentFile(await readFile(configPath, 'utf8'));
  printResult(true, 'Archivo privado', 'detectado.');

  const smtpMissing = missingOrPlaceholder(values, ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']);
  const smtpPort = values.get('SMTP_PORT')?.trim() || '465';
  const smtpSecure = values.get('SMTP_SECURE')?.trim().toLowerCase() || 'true';
  const smtpPortValid = /^\d+$/.test(smtpPort) && Number(smtpPort) >= 1 && Number(smtpPort) <= 65535;
  const smtpSecureValid = smtpSecure === 'true' || smtpSecure === 'false';
  const mailFrom = values.get('MAIL_FROM')?.trim() || '';
  const mailFromValid = !mailFrom || !isPlaceholder(mailFrom);
  const smtpReady = !smtpMissing.length && smtpPortValid && smtpSecureValid && mailFromValid;
  let smtpConnectionReady = true;

  if (smtpReady) {
    printResult(
      true,
      'Correo SMTP',
      'variables presentes y formato básico válido; no se realizó una conexión ni se leyó la contraseña.',
    );
  } else {
    const issues = [];
    if (smtpMissing.length) issues.push(`completa ${smtpMissing.join(', ')}`);
    if (!smtpPortValid) issues.push('usa un SMTP_PORT entre 1 y 65535');
    if (!smtpSecureValid) issues.push('usa SMTP_SECURE=true o SMTP_SECURE=false');
    if (!mailFromValid) issues.push('vacía MAIL_FROM o reemplaza su valor de ejemplo');
    printResult(false, 'Correo SMTP', `${issues.join('; ')}.`);
  }

  if (smtpReady && process.argv.includes('--smtp-connect')) {
    const transport = nodemailer.createTransport({
      host: values.get('SMTP_HOST').trim(),
      port: Number(smtpPort),
      secure: smtpSecure === 'true',
      auth: {
        user: values.get('SMTP_USER').trim(),
        pass: values.get('SMTP_PASS'),
      },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
    });
    try {
      await transport.verify();
      printResult(true, 'Conexión SMTP', 'el servidor aceptó la autenticación; no se envió ningún correo.');
    } catch (error) {
      smtpConnectionReady = false;
      const code = /^[A-Z_]{2,30}$/.test(String(error?.code || '')) ? ` (${error.code})` : '';
      printResult(false, 'Conexión SMTP', `no se pudo autenticar o conectar${code}.`);
    } finally {
      transport.close();
    }
  }

  const configuredFirebasePath = values.get('FIREBASE_SERVICE_ACCOUNT_PATH')?.trim() || '';
  const firebasePath = configuredFirebasePath || DEFAULT_FIREBASE_SERVICE_ACCOUNT_PATH;
  const firebasePlaceholder = Boolean(configuredFirebasePath && isPlaceholder(configuredFirebasePath));
  const firebasePathValid = isAbsolute(firebasePath) && safeFileExists(firebasePath);
  const firebaseReady = !firebasePlaceholder && firebasePathValid;
  let firebaseConnectionReady = true;

  if (firebaseReady) {
    printResult(
      true,
      'Firebase',
      process.argv.includes('--firebase-connect')
        ? 'el archivo de cuenta de servicio existe; se comprobará la autenticación sin mostrar credenciales.'
        : 'el archivo de cuenta de servicio existe; su contenido no fue abierto ni mostrado.',
    );
  } else if (firebasePlaceholder) {
    printResult(
      false,
      'Firebase',
      'reemplaza FIREBASE_SERVICE_ACCOUNT_PATH por la ruta absoluta de tu JSON privado.',
    );
  } else {
    printResult(
      false,
      'Firebase',
      'no se encontró el JSON indicado. Revisa FIREBASE_SERVICE_ACCOUNT_PATH.',
    );
  }

  if (firebaseReady && process.argv.includes('--firebase-connect')) {
    try {
      const serviceAccount = JSON.parse(await readFile(firebasePath, 'utf8'));
      await cert(serviceAccount).getAccessToken();
      printResult(true, 'Conexión Firebase', 'Google aceptó la cuenta de servicio; no se modificaron datos.');
    } catch {
      firebaseConnectionReady = false;
      let clockHint = '';
      try {
        const response = await fetch('https://oauth2.googleapis.com/token', {
          method: 'HEAD', signal: AbortSignal.timeout(5_000),
        });
        const serverTime = Date.parse(response.headers.get('date') || '');
        if (Number.isFinite(serverTime) && Math.abs(serverTime - Date.now()) > 5 * 60_000) {
          clockHint = ' El reloj de Windows difiere del servidor de Google; sincroniza fecha y hora.';
        }
      } catch { /* la causa puede ser también una conexión a Internet caída */ }
      printResult(false, 'Conexión Firebase', `no se pudo autenticar con Google.${clockHint}`);
    }
  }

  console.log('');
  const firebaseUsable = firebaseReady && firebaseConnectionReady;
  const smtpUsable = smtpReady && smtpConnectionReady;
  if (smtpUsable && firebaseUsable) {
    console.log('Resultado: configuración básica lista. Reinicia el gestor para aplicarla.');
    return;
  }
  console.log('Resultado: configuración pendiente. El gestor puede abrirse en modo limitado.');
  if (firebaseUsable && !smtpUsable) {
    console.log('Puede sincronizar reservas de teléfonos, pero los correos quedarán pendientes hasta configurar SMTP.');
  } else if (!firebaseUsable && smtpUsable) {
    console.log('Puede enviar correos de reservas locales, pero no sincronizará las del teléfono sin Firebase.');
  } else {
    console.log('No sincronizará reservas de teléfonos ni enviará correos hasta completar Firebase y SMTP.');
  }
  process.exitCode = 2;
}

main().catch((error) => {
  console.error(`[ERROR] No fue posible revisar la configuración: ${error.message}`);
  process.exitCode = 1;
});
