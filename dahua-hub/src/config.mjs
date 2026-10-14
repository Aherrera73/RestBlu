import { join } from 'node:path';
import dotenv from 'dotenv';

// Configuración privada: primero la propia del hub y después la de RestBlu,
// de la que se toman las credenciales de SQL Server. Una variable de entorno
// ya definida siempre prevalece.
export function loadPrivateConfig(env = process.env) {
  const root = env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'RestBlu') : '';
  const files = [
    env.DAHUA_HUB_ENV_PATH,
    root && join(root, 'dahua-hub.env.local'),
    env.RESTBLU_ENV_PATH,
    root && join(root, '.env.local'),
  ].filter(Boolean);
  for (const path of files) dotenv.config({ path, quiet: true, processEnv: env });
}

function text(env, name, fallback = '') {
  const value = env[name];
  return value === undefined || String(value).trim() === '' ? fallback : String(value).trim();
}

function number(env, name, fallback) {
  const parsed = Number.parseInt(text(env, name, ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function flag(env, name, fallback) {
  const value = text(env, name, '').toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'si', 'sí', 'yes'].includes(value);
}

function base64(env, name) {
  const value = text(env, name, '');
  return value ? Buffer.from(value, 'base64').toString('utf8') : '';
}

export function readConfig(env = process.env) {
  const sql = (name, fallback = '') => text(env, `DAHUA_HUB_SQLSERVER_${name}`, text(env, `RESTBLU_SQLSERVER_${name}`, fallback));
  return {
    tcp: {
      // ngrok entrega las conexiones en localhost; 0.0.0.0 también acepta
      // terminales de la misma red local.
      host: text(env, 'DAHUA_HUB_TCP_HOST', '127.0.0.1'),
      port: number(env, 'DAHUA_HUB_TCP_PORT', 9500),
      registrationTimeoutMs: number(env, 'DAHUA_HUB_REGISTRATION_TIMEOUT_MS', 90_000),
      // 0 = una conexión registrada puede quedar en silencio indefinidamente.
      idleTimeoutMs: number(env, 'DAHUA_HUB_IDLE_TIMEOUT_MS', 0),
      keepAliveMs: number(env, 'DAHUA_HUB_TCP_KEEPALIVE_MS', 30_000),
      maxConnections: number(env, 'DAHUA_HUB_MAX_CONNECTIONS', 200),
      allowUnknownDevices: flag(env, 'DAHUA_HUB_ALLOW_UNKNOWN_DEVICES', false),
      // Certificado para los terminales con HTTPS (scripts/generate-certificates.mjs).
      tlsCertPath: text(env, 'DAHUA_HUB_TLS_CERT', ''),
      tlsKeyPath: text(env, 'DAHUA_HUB_TLS_KEY', ''),
    },
    api: {
      host: text(env, 'DAHUA_HUB_API_HOST', '127.0.0.1'),
      port: number(env, 'DAHUA_HUB_API_PORT', 3200),
      apiKey: text(env, 'DAHUA_HUB_API_KEY', ''),
    },
    // Cuenta CGI con la que el hub inicia sesión en los terminales. Si no se
    // define, se usa la del gestor RestBlu (DAHUA_USERNAME / DAHUA_PASSWORD_BASE64).
    device: {
      username: text(env, 'DAHUA_HUB_DEVICE_USERNAME', text(env, 'DAHUA_USERNAME', '')),
      password: text(env, 'DAHUA_HUB_DEVICE_PASSWORD', '') || base64(env, 'DAHUA_HUB_DEVICE_PASSWORD_BASE64')
        || base64(env, 'DAHUA_PASSWORD_BASE64') || text(env, 'DAHUA_PASSWORD', ''),
      keepAliveMs: number(env, 'DAHUA_HUB_DEVICE_KEEPALIVE_MS', 40_000),
      // Zona horaria del reloj de los terminales, para la vigencia de los usuarios.
      timeZone: text(env, 'DAHUA_HUB_DEVICE_TIMEZONE', 'America/Santiago'),
      door: number(env, 'DAHUA_HUB_DEVICE_DOOR', 1),
    },
    store: text(env, 'DAHUA_HUB_STORE', 'sqlserver').toLowerCase(),
    client: text(env, 'DAHUA_HUB_CLIENT', 'fake').toLowerCase(),
    commands: {
      intervalMs: number(env, 'DAHUA_HUB_COMMAND_INTERVAL_MS', 2_000),
      batchSize: number(env, 'DAHUA_HUB_COMMAND_BATCH', 10),
    },
    sqlserver: {
      server: sql('HOST', 'localhost'),
      port: number(env, 'DAHUA_HUB_SQLSERVER_PORT', number(env, 'RESTBLU_SQLSERVER_PORT', 1433)),
      database: sql('DATABASE', 'RestBlu'),
      user: sql('USER', 'restblu_app'),
      password: sql('PASSWORD', ''),
      options: {
        encrypt: sql('ENCRYPT', 'true') !== 'false',
        trustServerCertificate: sql('TRUST_CERTIFICATE', 'true') !== 'false',
      },
      pool: { max: 10, min: 0, idleTimeoutMillis: 30_000 },
      connectionTimeout: 15_000,
      requestTimeout: 30_000,
    },
  };
}
