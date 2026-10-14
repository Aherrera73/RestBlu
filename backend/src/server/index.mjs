import { createServer } from 'node:http';
import {
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  privateDecrypt,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, initializeFirestore } from 'firebase-admin/firestore';
import { generateReservationPdf } from '../documents/reservation-document.mjs';
import { createLocalDatabase } from '../database/local-database.mjs';
import { createSqlServerDatabase, sqlServerConfigFromEnv } from '../database/sqlserver-database.mjs';
import { DahuaClient } from '../dahua/device-client.mjs';
import {
  createHubTransport, hubDevices, hubStatus, ngrokTunnel, pushPropertyTerminals, validRegistrationId,
} from '../dahua/hub-transport.mjs';
import {
  DAHUA_QR_VALID_MINUTES, DAHUA_QR_VALID_SECONDS, dahuaDynamicQrContent, dahuaFaceInput, dahuaQrInput, dahuaUserId,
  enrollReservationFace, enrollReservationQr, generateDahuaQrCode, isDahuaQrCode, revokeReservationFace,
} from '../dahua/reservation-access.mjs';
import QRCode from 'qrcode';
import { evaluateWebpayPayment, isWebpayToken, webpayTransactionStatus } from '../payments/transbank.mjs';
import {
  CODE_TTL_MS, MAX_ATTEMPTS, RESEND_INTERVAL_MS, checkVerificationCode, hashVerificationCode, newVerificationCode,
} from '../accounts/verification-code.mjs';
import { customerFromInput } from '../customers/customer-service.mjs';
import { reservationLookupEmailGroups } from '../reservations/public-lookup.mjs';
import { propertyFromInput, publicProperty } from '../properties/property-service.mjs';
import { createAiClient } from '../ai/ai-client.mjs';
import { phoneAccessWithinStay, verifyPhoneAccessSignature } from '../access/phone-access.mjs';
import {
  adminContext, dailySummary, guestContext, languageInstruction, publicContext, suggestionsFromAnswer,
} from '../ai/assistant-context.mjs';
import {
  escapeHtml,
  formatRut,
  integer,
  nextId,
  text,
  validEmail,
  validRut,
} from '../shared/normalizers.mjs';

const HOST = '127.0.0.1';
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const LOCAL_CONFIG_ROOT = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
const DEFAULT_PRIVATE_CONFIG_PATH = join(LOCAL_CONFIG_ROOT, 'RestBlu', '.env.local');
const HOME_PRIVATE_CONFIG_PATH = join(homedir(), 'AppData', 'Local', 'RestBlu', '.env.local');
const USER_PRIVATE_CONFIG_PATH = process.env.USERPROFILE
  ? join(process.env.USERPROFILE, 'AppData', 'Local', 'RestBlu', '.env.local')
  : '';
const LEGACY_PRIVATE_CONFIG_PATH = join(LOCAL_CONFIG_ROOT, 'LumaStay', '.env.local');
const REQUESTED_PRIVATE_CONFIG_PATH = process.env.RESTBLU_ENV_PATH ||
  process.env.LUMASTAY_ENV_PATH || '';
const PRIVATE_CONFIG_PATHS = [...new Set([
  REQUESTED_PRIVATE_CONFIG_PATH,
  DEFAULT_PRIVATE_CONFIG_PATH,
  HOME_PRIVATE_CONFIG_PATH,
  USER_PRIVATE_CONFIG_PATH,
  LEGACY_PRIVATE_CONFIG_PATH,
  join(ROOT, '.env.local'),
])].filter((candidate) => candidate && existsSync(candidate));
const PRIVATE_CONFIG_PATH = PRIVATE_CONFIG_PATHS[0] || DEFAULT_PRIVATE_CONFIG_PATH;
const loadedPrivateSettings = new Set();
// Una variable de entorno con valor siempre prevalece sobre los archivos
// privados (así las pruebas no cargan la cuenta real de Firebase o Dahua).
const environmentSettings = new Set(
  Object.entries(process.env).filter(([, value]) => String(value || '').trim()).map(([name]) => name),
);
for (const configPath of PRIVATE_CONFIG_PATHS) {
  try {
    const settings = dotenv.parse(readFileSync(configPath));
    for (const [name, value] of Object.entries(settings)) {
      // La ruta solicitada tiene prioridad. Las rutas siguientes completan
      // valores ausentes cuando un lanzador hereda una configuración parcial.
      if (environmentSettings.has(name) || loadedPrivateSettings.has(name) || !value.trim()) continue;
      process.env[name] = value;
      loadedPrivateSettings.add(name);
    }
  } catch (error) {
    console.warn(`No se pudo leer la configuración privada en ${configPath}: ${error.message}`);
  }
}
const PORT = Number(process.env.RESTBLU_ADMIN_PORT || process.env.LUMASTAY_ADMIN_PORT || 3100);
const PUBLIC_DIR = join(ROOT, 'public');
const DATA_DIR = join(ROOT, 'data');
const UPLOAD_DIR = join(ROOT, 'uploads');
const LEGACY_JSON_PATH = join(DATA_DIR, 'lumastay-data.json');
const DATABASE_PATH = resolve(
  process.env.RESTBLU_DB_PATH || process.env.LUMASTAY_DB_PATH || join(DATA_DIR, 'lumastay.sqlite'),
);
const SCHEMA_PATH = join(ROOT, 'src', 'database', 'schema.sql');
const SQLSERVER_SCHEMA_PATH = join(ROOT, 'src', 'database', 'schema-sqlserver.sql');
// SQLite por omisión; RESTBLU_DB_ENGINE=sqlserver usa SQL Server y, la primera
// vez, copia allí los datos de la base SQLite.
const DATABASE_ENGINE = String(process.env.RESTBLU_DB_ENGINE || 'sqlite').trim().toLowerCase() === 'sqlserver'
  ? 'sqlserver' : 'sqlite';
const FIREBASE_SERVICE_ACCOUNT_PATH = resolve(
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    join(homedir(), 'Downloads', 'lumastay-bab6a-firebase-adminsdk-fbsvc-caa62bc4b1.json'),
);
const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://lumastay-bab6a.web.app',
  'https://lumastay-bab6a.firebaseapp.com',
  'https://restblu.web.app',
  'https://restblu.firebaseapp.com',
  `http://${HOST}:${PORT}`,
]);
const PUBLIC_WEB_URL = text(process.env.RESTBLU_PUBLIC_URL || process.env.LUMASTAY_PUBLIC_URL, 500) ||
  'https://restblu.web.app/';
const AI_BASE_URL = text(process.env.AI_BASE_URL, 500).replace(/\/+$/, '');
const AI_API_KEY = String(process.env.AI_API_KEY || '');
const AI_MODEL = text(process.env.AI_MODEL, 120) || 'ia-local:latest';
const aiClient = createAiClient({ baseUrl: AI_BASE_URL, apiKey: AI_API_KEY, model: AI_MODEL });
const BIOMETRIC_BASE_URL = text(process.env.BIOMETRIC_BASE_URL, 500).replace(/\/+$/, '');
const BIOMETRIC_API_KEY = String(process.env.BIOMETRIC_API_KEY || '');
const BIOMETRIC_VERIFY_PATH = text(process.env.BIOMETRIC_VERIFY_PATH, 200) || '/verify';
const BIOMETRIC_HEALTH_PATH = text(process.env.BIOMETRIC_HEALTH_PATH, 200) || '/health';
const BIOMETRIC_MATCH_THRESHOLD = Math.min(1, Math.max(0, Number(process.env.BIOMETRIC_MATCH_THRESHOLD || 0.75)));
const BIOMETRIC_DATA_KEY = String(process.env.BIOMETRIC_DATA_KEY || '');
const BIOMETRIC_TRANSPORT_KEY_PATH = join(LOCAL_CONFIG_ROOT, 'RestBlu', 'biometric-transport-private.pem');
const DAHUA_BASE_URL = String(process.env.DAHUA_BASE_URL || '');
const DAHUA_CA_CERT_PATH = String(process.env.DAHUA_CA_CERT_PATH || '');
const DAHUA_USERNAME = String(process.env.DAHUA_USERNAME || '');
const DAHUA_PASSWORD = process.env.DAHUA_PASSWORD_BASE64
  ? Buffer.from(process.env.DAHUA_PASSWORD_BASE64, 'base64').toString('utf8')
  : String(process.env.DAHUA_PASSWORD || '');
const DAHUA_ALLOW_SELF_SIGNED = process.env.DAHUA_ALLOW_SELF_SIGNED === '1';

// Hub Dahua (D:\RB\dahua-hub): llega a los terminales por su conexión de
// Auto Register, aunque estén en otra red. DAHUA_HUB_DEFAULT_DEVICE atiende
// los alojamientos que no tienen un terminal asignado.
const DAHUA_HUB_URL = text(process.env.DAHUA_HUB_URL, 300);
const DAHUA_HUB_API_KEY = String(process.env.DAHUA_HUB_API_KEY || '');
// Terminal del hub que también es el Dahua de la red local (DAHUA_BASE_URL).
// La red local queda como alternativa cuando el canal remoto no responde.
const DAHUA_HUB_LAN_DEVICE = String(process.env.DAHUA_HUB_LAN_DEVICE || '').trim().toUpperCase();
const DAHUA_HUB_DEFAULT_DEVICE = validRegistrationId(String(process.env.DAHUA_HUB_DEFAULT_DEVICE || '').trim())
  ? String(process.env.DAHUA_HUB_DEFAULT_DEVICE).trim() : '';

function lanDahuaConfigured() {
  return process.env.DAHUA_RESERVATION_SYNC === '1' &&
    Boolean(DAHUA_BASE_URL && DAHUA_USERNAME && DAHUA_PASSWORD);
}

function hubDahuaConfigured() {
  return process.env.DAHUA_RESERVATION_SYNC === '1' && Boolean(DAHUA_HUB_URL);
}

// Terminal de cada alojamiento según la última lectura de la base.
const propertyTerminals = new Map();
function rememberPropertyTerminals(database) {
  propertyTerminals.clear();
  for (const property of database.properties || []) {
    if (property.dahuaRegistrationId) propertyTerminals.set(property.id, property.dahuaRegistrationId);
  }
}

// Terminal que atiende una reserva: 'lan' (Dahua de la red local) o el
// Registration ID de un terminal del hub. Una vez que la reserva se registró
// en un terminal queda asociada a él, para que el QR, el rostro y la
// revocación vayan siempre al mismo equipo. Las reservas anteriores al hub se
// registraron en la red local.
function dahuaTerminalFor(reservation) {
  const usable = (terminal) => (terminal === 'lan' ? lanDahuaConfigured() : hubDahuaConfigured());
  const fixed = reservation?.dahuaTerminal || (reservation?.dahuaUserId ? 'lan' : '');
  if (fixed) return usable(fixed) ? fixed : '';
  const assigned = propertyTerminals.get(reservation?.propertyId);
  if (assigned) return hubDahuaConfigured() ? assigned : '';
  if (DAHUA_HUB_DEFAULT_DEVICE && hubDahuaConfigured()) return DAHUA_HUB_DEFAULT_DEVICE;
  return lanDahuaConfigured() ? 'lan' : '';
}

// Sin argumento: hay alguna integración Dahua activa. Con una reserva: hay un
// terminal disponible para ella.
function dahuaConfigured(reservation) {
  if (reservation === undefined) return lanDahuaConfigured() || hubDahuaConfigured();
  return Boolean(dahuaTerminalFor(reservation));
}

function dahuaClientForTerminal(terminal) {
  if (terminal === 'lan') return dahuaClient();
  if (!terminal || !hubDahuaConfigured()) throw new Error('No hay un terminal Dahua disponible para esta reserva.');
  const hub = createHubTransport({ hubUrl: DAHUA_HUB_URL, apiKey: DAHUA_HUB_API_KEY, registrationId: terminal });
  if (terminal.toUpperCase() !== DAHUA_HUB_LAN_DEVICE || !lanDahuaConfigured()) {
    return new DahuaClient({ transport: hub });
  }
  // Mismo equipo que el Dahua de la red local: si el hub no responde, se
  // repite la petición por la red local.
  return new DahuaClient({
    transport: async (input) => {
      try {
        return await hub(input);
      } catch (hubError) {
        try {
          return await dahuaClient().request(input.path, input);
        } catch (lanError) {
          if (lanError?.code === 'DEVICE_UNREACHABLE') throw hubError;
          return { status: 502, text: lanError?.deviceResponse || lanError?.message || '' };
        }
      }
    },
  });
}

// Cliente del terminal de la reserva; la primera vez fija ese terminal.
function reservationDahuaClient(reservation) {
  const terminal = dahuaTerminalFor(reservation);
  if (!terminal) throw new Error('No hay un terminal Dahua disponible para esta reserva.');
  reservation.dahuaTerminal ||= terminal;
  return dahuaClientForTerminal(terminal);
}

function dahuaClient() {
  if (!lanDahuaConfigured()) throw new Error('Configura la dirección y la cuenta CGI de Dahua.');
  return new DahuaClient({
    baseUrl: DAHUA_BASE_URL, caCertPath: DAHUA_CA_CERT_PATH,
    allowSelfSigned: DAHUA_ALLOW_SELF_SIGNED,
    username: DAHUA_USERNAME, password: DAHUA_PASSWORD,
  });
}

const dahuaEnrollmentsInProgress = new Set();

// Un alta que quedó en error puede reintentarse; sólo se bloquea si el
// rostro ya está cargado y vigente en el terminal.
function dahuaEnrollmentActive(reservation) {
  return Boolean(reservation.dahuaUserId) &&
    ['verificado', 'registrado-sin-verificar'].includes(reservation.dahuaStatus);
}

function dahuaQrActive(reservation) {
  return Boolean(reservation.dahuaUserId) && reservation.dahuaQrStatus === 'activo';
}

// La persona existe en el terminal si quedó activo su QR o su rostro.
function dahuaPersonActive(reservation) {
  return dahuaQrActive(reservation) || dahuaEnrollmentActive(reservation);
}

function ensureDahuaQrCode(reservation) {
  if (isDahuaQrCode(reservation.dahuaQrCode)) return false;
  reservation.dahuaQrCode = generateDahuaQrCode();
  return true;
}

// Limpia restos de un intento anterior (o de un guardado que falló después de
// un alta) antes de volver a crear la persona con el mismo UserID.
async function cleanupPartialDahuaPerson(reservation) {
  if (dahuaPersonActive(reservation)) return;
  await revokeReservationFace(reservationDahuaClient(reservation), {
    userId: reservation.dahuaUserId || dahuaUserId(reservation.id),
    recNo: reservation.dahuaRecNo,
    cardNo: reservation.dahuaQrCode,
  }).catch(() => {});
}

// Confirma en el terminal que la persona que el gestor da por registrada sigue
// ahí (pudo borrarse desde el propio equipo). Si no está, olvida esos estados
// para volver a crearla en lugar de fallar al agregarle QR o rostro.
async function confirmDahuaPersonOnDevice(reservation) {
  if (!dahuaPersonActive(reservation)) return false;
  const present = await reservationDahuaClient(reservation).findPerson(reservation.dahuaUserId).catch(() => true);
  if (present) return true;
  if (dahuaQrActive(reservation)) reservation.dahuaQrStatus = 'sin-registrar';
  if (dahuaEnrollmentActive(reservation)) {
    reservation.dahuaStatus = 'sin-registrar';
    reservation.dahuaError = 'La persona ya no estaba en el terminal; vuelve a registrar el rostro.';
  }
  return false;
}

// Registra la persona de la reserva en el Dahua con su QR como credencial,
// vigente desde el check-in hasta el check-out.
async function syncReservationQrToDahua(reservation, customer) {
  if (!dahuaConfigured(reservation)) {
    reservation.dahuaQrStatus = 'pendiente-configuracion';
    reservation.dahuaQrError = 'Falta configurar y activar la integración CGI de Dahua en este gestor.';
    return false;
  }
  try {
    ensureDahuaQrCode(reservation);
    const input = dahuaQrInput({ reservation, customer });
    await confirmDahuaPersonOnDevice(reservation);
    const personExists = dahuaEnrollmentActive(reservation);
    await cleanupPartialDahuaPerson(reservation);
    reservation.dahuaUserId = input.userId;
    const result = await enrollReservationQr(reservationDahuaClient(reservation), input, {
      personExists,
      onPersonInserted: (inserted) => { reservation.dahuaRecNo = inserted.recNo || ''; },
    });
    if (!personExists) reservation.dahuaRecNo = result.recNo;
    reservation.dahuaQrStatus = 'activo';
    reservation.dahuaQrError = '';
    reservation.dahuaQrEnrolledAt = new Date().toISOString();
    reservation.dahuaRevokedAt = null;
    return true;
  } catch (error) {
    reservation.dahuaQrStatus = 'error';
    reservation.dahuaQrError = text(
      error instanceof Error ? error.message : 'No fue posible registrar el QR en Dahua.', 500,
    );
    return false;
  } finally {
    reservation.updatedAt = new Date().toISOString();
  }
}

async function syncReservationFaceToDahua(reservation, customer, image) {
  if (!dahuaConfigured(reservation)) {
    reservation.dahuaStatus = 'pendiente-configuracion';
    reservation.dahuaError = 'Falta configurar y activar la integración CGI de Dahua en este gestor.';
    return;
  }
  try {
    const input = dahuaFaceInput({ reservation, customer, image });
    // Si el QR aún no quedó en el terminal (por ejemplo, estaba apagado al
    // confirmar), se crea primero la persona con su QR y luego se agrega el rostro.
    if (!dahuaQrActive(reservation) || !(await confirmDahuaPersonOnDevice(reservation))) {
      await syncReservationQrToDahua(reservation, customer);
    }
    const personExists = dahuaPersonActive(reservation);
    if (!personExists) await cleanupPartialDahuaPerson(reservation);
    // Conserva el ID aun si el equipo falla tras crear una persona: así una
    // revocación posterior puede limpiar un alta parcial.
    reservation.dahuaUserId = input.userId;
    const result = await enrollReservationFace(reservationDahuaClient(reservation), input, (inserted) => {
      reservation.dahuaRecNo = inserted.recNo || '';
    }, { personExists });
    if (!personExists) reservation.dahuaRecNo = result.recNo;
    reservation.dahuaStatus = result.verified ? 'verificado' : 'registrado-sin-verificar';
    reservation.dahuaError = result.verificationError;
    reservation.dahuaEnrolledAt = new Date().toISOString();
    reservation.dahuaVerifiedAt = result.verified ? reservation.dahuaEnrolledAt : null;
    reservation.dahuaRevokedAt = null;
  } catch (error) {
    reservation.dahuaStatus = 'error';
    reservation.dahuaError = text(faceEnrollmentError(reservation, error), 500);
  }
  reservation.updatedAt = new Date().toISOString();
}

function faceEnrollmentError(reservation, error) {
  const message = error instanceof Error ? error.message : 'No fue posible registrar el rostro en Dahua.';
  const terminal = dahuaTerminalFor(reservation);
  const viaInternet = terminal && terminal !== 'lan';
  if (viaInternet && error?.code === 'DEVICE_UNREACHABLE') {
    return `No se pudo enviar la foto al terminal Dahua por el hub: ${message}. Tu QR de acceso sigue funcionando.`;
  }
  return message;
}

async function enrollReservationDirectlyOnDahua(reservation, customer, image) {
  const now = new Date().toISOString();
  // Dahua genera y conserva la referencia facial. No hace falta crear una
  // plantilla paralela en el comparador externo para dar de alta el acceso.
  reservation.biometricStatus = 'activa';
  reservation.biometricConsentAt = now;
  reservation.biometricEnrolledAt = now;
  reservation.biometricExpiresAt = `${reservation.checkOut}T${reservation.checkOutTime || '11:00'}:00`;
  reservation.biometricRevokedAt = null;
  reservation.biometricLastError = null;
  reservation.updatedAt = now;
  await syncReservationFaceToDahua(reservation, customer, image);
  if (reservation.dahuaStatus !== 'verificado' &&
      reservation.dahuaStatus !== 'registrado-sin-verificar') {
    reservation.biometricStatus = 'error';
    reservation.biometricLastError = reservation.dahuaError || 'Dahua no confirmó el registro facial.';
    return false;
  }
  reservation.biometricTemplateEncrypted = '';
  reservation.biometricProfileId = '';
  return true;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
};

const IMAGE_EXTENSIONS = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
]);

const SECURITY_HEADERS = {
  'Content-Security-Policy': "base-uri 'self'; object-src 'none'; frame-ancestors 'none'",
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

const RATE_LIMIT_RULES = [
  { method: 'POST', pattern: /^\/api\/admin\/properties\/\d+\/open-door$/, bucket: 'manual-door', limit: 12, windowMs: 60_000 },
  { method: 'POST', pattern: /^\/api\/uploads$/, bucket: 'uploads', limit: 20, windowMs: 10 * 60_000 },
  { method: 'POST', pattern: /^\/api\/reservations$/, bucket: 'reservations', limit: 60, windowMs: 10 * 60_000 },
  { method: 'POST', pattern: /^\/api\/public\/reservations\/lookup$/, bucket: 'reservation-lookup', limit: 8, windowMs: 10 * 60_000 },
  { method: 'POST', pattern: /^\/api\/reservations\/[^/]+\/webpay-payment$/, bucket: 'webpay-payment', limit: 20, windowMs: 10 * 60_000 },
  { method: 'POST', pattern: /^\/api\/ai\/(chat|public-chat)$/, bucket: 'ai', limit: 30, windowMs: 60_000 },
  { method: 'POST', pattern: /^\/api\/(admin\/)?biometrics\/(enroll|verify)$/, bucket: 'biometrics', limit: 12, windowMs: 10 * 60_000 },
  { method: 'GET', pattern: /^\/api\/reservations\/[^/]+\/verify$/, bucket: 'verification', limit: 30, windowMs: 10 * 60_000 },
  { method: 'GET', pattern: /^\/api\/reservations\/[^/]+\/pdf$/, bucket: 'pdf', limit: 60, windowMs: 60_000 },
  { method: 'GET', pattern: /^\/api\/backup$/, bucket: 'backup', limit: 6, windowMs: 60_000 },
];

const rateLimitBuckets = new Map();
const manualDoorAttempts = new Map();
const MANUAL_DOOR_COOLDOWN_MS = 10_000;
const cloudLookupBuckets = new Map();
const reservationLookupDeliveryBuckets = new Map();

let localDatabase;
let reservationCreationQueue = Promise.resolve();
const PENDING_RESERVATION_TTL_MS = Math.min(24 * 60, Math.max(5,
  Number.parseInt(process.env.RESTBLU_PENDING_RESERVATION_MINUTES || '60', 10) || 60,
)) * 60_000;

async function readDatabase() {
  const database = await localDatabase.readDatabase();
  rememberPropertyTerminals(database);
  return database;
}

async function saveDatabase(database) {
  await localDatabase.saveDatabase(database);
}

function corsHeaders(request) {
  const origin = request.headers.origin;
  return origin && ALLOWED_ORIGINS.has(origin)
    ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
    : {};
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    'Cache-Control': 'no-store',
    ...headers,
  });
  response.end(body);
}

function sendJson(request, response, status, data, headers = {}) {
  send(response, status, JSON.stringify(data), {
    'Content-Type': MIME['.json'],
    ...corsHeaders(request),
    ...headers,
  });
}

function publicRequestErrorMessage(error) {
  const message = error instanceof Error ? error.message : 'Solicitud inválida.';
  if (/UNIQUE constraint failed:\s*clientes\.(correo|documento)/i.test(message)) {
    return 'El RUT o el correo ya pertenece a otra ficha de cliente. Revisa los datos antes de reservar.';
  }
  if (/\bSQLITE\b|constraint failed|no such (table|column)/i.test(message)) {
    return 'No fue posible guardar los datos. Revisa la información e inténtalo nuevamente.';
  }
  return message;
}

function enforceRateLimit(request, response, url) {
  const rule = RATE_LIMIT_RULES.find(
    (candidate) => candidate.method === request.method && candidate.pattern.test(url.pathname),
  );
  if (!rule) return true;

  const now = Date.now();
  const address = request.socket.remoteAddress || 'local';
  const key = `${rule.bucket}:${address}`;
  let bucket = rateLimitBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + rule.windowMs };
    rateLimitBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count <= rule.limit) return true;

  const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  sendJson(
    request,
    response,
    429,
    { error: 'Demasiadas solicitudes. Espera unos minutos antes de volver a intentarlo.' },
    { 'Retry-After': String(retryAfter) },
  );
  return false;
}

async function readJsonBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 6_000_000) throw new Error('La solicitud es demasiado grande.');
  }
  if (!body) return {};
  return JSON.parse(body);
}

async function readBinaryBody(request, maximumBytes = 8_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBytes) throw new Error('La imagen supera el máximo de 8 MB.');
    chunks.push(chunk);
  }
  if (!size) throw new Error('No se recibió ningún archivo.');
  return Buffer.concat(chunks);
}

function hasImageSignature(contentType, content) {
  if (contentType === 'image/jpeg') {
    return content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
  }
  if (contentType === 'image/png') {
    return content.length >= 8 && content.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  }
  if (contentType === 'image/gif') {
    const signature = content.subarray(0, 6).toString('ascii');
    return signature === 'GIF87a' || signature === 'GIF89a';
  }
  if (contentType === 'image/webp') {
    return content.length >= 12 &&
      content.subarray(0, 4).toString('ascii') === 'RIFF' &&
      content.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
}

let firebaseAuthInstance;
let firebaseAppInstance;
let firestoreInstance;
let mailTransport;

async function firebaseApp() {
  if (firebaseAppInstance) return firebaseAppInstance;
  // Pruebas automáticas: con el emulador de Firebase Auth (variable estándar
  // del SDK) y sin cuenta de servicio, se verifican tokens del emulador.
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.RESTBLU_FIREBASE_EMULATOR_PROJECT &&
      !existsSync(FIREBASE_SERVICE_ACCOUNT_PATH)) {
    firebaseAppInstance = initializeApp({ projectId: process.env.RESTBLU_FIREBASE_EMULATOR_PROJECT }, 'restblu-emulator');
    return firebaseAppInstance;
  }
  if (!existsSync(FIREBASE_SERVICE_ACCOUNT_PATH)) {
    throw new Error(
      'No se encontró la cuenta de servicio de Firebase. Configura FIREBASE_SERVICE_ACCOUNT_PATH.',
    );
  }
  const serviceAccount = JSON.parse(await readFile(FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));
  const appName = 'lumastay-local-reservations';
  firebaseAppInstance = getApps().find((item) => item.name === appName) ||
    initializeApp({ credential: cert(serviceAccount) }, appName);
  return firebaseAppInstance;
}

async function firebaseAuth() {
  if (firebaseAuthInstance) return firebaseAuthInstance;
  firebaseAuthInstance = getAuth(await firebaseApp());
  return firebaseAuthInstance;
}

// Una ficha de cliente puede seguir apuntando a una cuenta ya eliminada; en
// ese caso su RUT queda libre para la cuenta nueva que lo registró.
async function firebaseAccountExists(uid) {
  if (!uid || !existsSync(FIREBASE_SERVICE_ACCOUNT_PATH)) return true;
  try {
    await (await firebaseAuth()).getUser(uid);
    return true;
  } catch (error) {
    if (error?.code === 'auth/user-not-found') return false;
    throw error;
  }
}

async function firebaseStore() {
  if (firestoreInstance) return firestoreInstance;
  firestoreInstance = initializeFirestore(await firebaseApp(), { preferRest: true });
  return firestoreInstance;
}

function mailer() {
  if (mailTransport) return mailTransport;
  const host = text(process.env.SMTP_HOST, 200);
  const user = text(process.env.SMTP_USER, 200);
  const pass = String(process.env.SMTP_PASS || '');
  if (!host || !user || !pass) {
    throw new Error(
      'El correo saliente no está configurado. Completa SMTP_HOST, SMTP_USER y SMTP_PASS en .env.local.',
    );
  }
  mailTransport = nodemailer.createTransport({
    host,
    port: integer(process.env.SMTP_PORT, 465),
    secure: String(process.env.SMTP_SECURE ?? 'true').toLowerCase() !== 'false',
    auth: { user, pass },
  });
  return mailTransport;
}

function mailFrom() {
  return text(process.env.MAIL_FROM, 300) || `RestBlu <${text(process.env.SMTP_USER, 200)}>`;
}

const RESERVATION_LOOKUP_ACK = 'Si hay reservas asociadas a este RUT y el correo fue verificado, enviaremos los detalles a la dirección registrada.';

function canDeliverReservationLookup(documentId) {
  const key = createHash('sha256').update(formatRut(documentId)).digest('hex');
  const now = Date.now();
  const previous = reservationLookupDeliveryBuckets.get(key);
  const bucket = previous && previous.resetAt > now
    ? previous
    : { count: 0, resetAt: now + 60 * 60_000 };
  bucket.count += 1;
  reservationLookupDeliveryBuckets.set(key, bucket);
  if (reservationLookupDeliveryBuckets.size > 5000) {
    for (const [candidate, value] of reservationLookupDeliveryBuckets) {
      if (value.resetAt <= now) reservationLookupDeliveryBuckets.delete(candidate);
    }
  }
  return bucket.count <= 3;
}

async function sendReservationLookupEmail(database, documentId) {
  const groups = reservationLookupEmailGroups(database, documentId);
  const transport = mailer();
  if (!canDeliverReservationLookup(documentId)) return;
  for (const [email, reservations] of groups) {
    const lines = reservations.map((item) =>
      `${item.reference} · ${item.propertyName} · ${item.checkIn} al ${item.checkOut} · ${item.status}`);
    const rows = reservations.map((item) =>
      `<li style="padding:8px 0">` +
      `<strong>${escapeHtml(item.propertyName)}</strong><br>` +
      `Reserva ${escapeHtml(item.reference)} · ${escapeHtml(item.checkIn)} al ${escapeHtml(item.checkOut)} · ` +
      `${escapeHtml(item.status)}</li>`).join('');
    await transport.sendMail({
      from: mailFrom(),
      to: email,
      subject: 'Consulta de tus reservas RestBlu',
      text: `Estas son las reservas asociadas a tu correo verificado:\n\n${lines.join('\n')}\n\nEste resumen no incluye códigos de acceso. Si no solicitaste esta consulta, puedes ignorar el mensaje.`,
      html: `<div style="font-family:Arial,sans-serif;color:#173f4b;max-width:600px;margin:auto;padding:24px"><h1>RestBlu · Tus reservas</h1><p>Estas son las reservas asociadas a tu correo verificado:</p><ul>${rows}</ul><p style="font-size:12px;color:#58747d">Este resumen no incluye QR, PIN ni códigos de acceso. Si no solicitaste esta consulta, puedes ignorar el mensaje.</p></div>`,
    });
  }
}

function aiConfigured() {
  return Boolean(AI_BASE_URL && AI_API_KEY && AI_MODEL);
}

function biometricConfigured() {
  return Boolean(BIOMETRIC_BASE_URL && BIOMETRIC_API_KEY && biometricEncryptionKey());
}

function biometricEncryptionKey() {
  if (!BIOMETRIC_DATA_KEY) return null;
  const key = /^[a-f\d]{64}$/i.test(BIOMETRIC_DATA_KEY)
    ? Buffer.from(BIOMETRIC_DATA_KEY, 'hex')
    : Buffer.from(BIOMETRIC_DATA_KEY, 'base64');
  return key.length === 32 ? key : null;
}

function decryptBiometricTemplate(value) {
  const key = biometricEncryptionKey();
  if (!key) throw new Error('La clave local de cifrado biométrico no está configurada.');
  const [version, ivValue, tagValue, encryptedValue] = String(value || '').split('.');
  if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) {
    throw new Error('La plantilla biométrica guardada no tiene un formato válido.');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivValue, 'base64'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

let biometricTransportIdentity;
async function getBiometricTransportIdentity() {
  if (biometricTransportIdentity) return biometricTransportIdentity;
  await mkdir(join(LOCAL_CONFIG_ROOT, 'RestBlu'), { recursive: true });
  if (!existsSync(BIOMETRIC_TRANSPORT_KEY_PATH)) {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    try {
      await writeFile(BIOMETRIC_TRANSPORT_KEY_PATH, privateKey, { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
  const privateKey = createPrivateKey(await readFile(BIOMETRIC_TRANSPORT_KEY_PATH, 'utf8'));
  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
  biometricTransportIdentity = {
    privateKey,
    publicKey,
    keyId: createHash('sha256').update(publicKey).digest('hex').slice(0, 24),
  };
  return biometricTransportIdentity;
}

function decryptCloudBiometricImage(input, identity) {
  if (input.keyId !== identity.keyId ||
      typeof input.encryptedKey !== 'string' ||
      typeof input.encryptedImage !== 'string' ||
      typeof input.iv !== 'string') {
    throw new Error('La captura cifrada no usa la clave biométrica actual. Repite el registro.');
  }
  const aesKey = privateDecrypt(
    { key: identity.privateKey, oaepHash: 'sha256' },
    Buffer.from(input.encryptedKey, 'base64'),
  );
  const iv = Buffer.from(input.iv, 'base64');
  const sealed = Buffer.from(input.encryptedImage, 'base64');
  if (aesKey.length !== 32 || iv.length !== 12 || sealed.length < 17 || sealed.length > 600_000) {
    throw new Error('La captura cifrada no tiene un tamaño válido.');
  }
  const decipher = createDecipheriv('aes-256-gcm', aesKey, iv);
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  const image = Buffer.concat([
    decipher.update(sealed.subarray(0, -16)),
    decipher.final(),
  ]);
  const mimeType = input.mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
  return biometricImage(`data:${mimeType};base64,${image.toString('base64')}`);
}

async function biometricFetch(pathname, payload, timeoutMs = 45_000) {
  if (!biometricConfigured()) {
    throw new Error(
      'El servidor biométrico todavía no está configurado. Completa BIOMETRIC_BASE_URL en la configuración privada.',
    );
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${BIOMETRIC_BASE_URL}${pathname}`, {
      method: payload == null ? 'GET' : 'POST',
      signal: controller.signal,
      headers: {
        ...(BIOMETRIC_API_KEY ? { Authorization: `Bearer ${BIOMETRIC_API_KEY}` } : {}),
        ...(payload == null ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(payload == null ? {} : { body: JSON.stringify(payload) }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        text(result?.error?.message || result?.error || result?.message, 500) ||
        `El servidor biométrico respondió con HTTP ${response.status}.`,
      );
    }
    return result;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('El servidor biométrico tardó demasiado en responder.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function biometricImage(value) {
  const match = String(value || '').match(/^data:(image\/(?:jpeg|png));base64,([a-zA-Z0-9+/=]+)$/);
  if (!match) throw new Error('La captura biométrica no contiene una imagen JPG o PNG válida.');
  const content = Buffer.from(match[2], 'base64');
  if (!content.length || content.length > 1_500_000) {
    throw new Error('Cada captura biométrica debe pesar menos de 1,5 MB.');
  }
  if (!hasImageSignature(match[1], content)) {
    throw new Error('La captura biométrica no coincide con una imagen válida.');
  }
  return { mimeType: match[1], base64: match[2] };
}

async function aiFetch(pathname, options = {}, timeoutMs = 60_000) {
  if (!aiConfigured()) {
    throw new Error('La IA no está configurada. Completa AI_BASE_URL, AI_API_KEY y AI_MODEL.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${AI_BASE_URL}${pathname}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${AI_API_KEY}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = text(payload?.error?.message || payload?.error || payload?.message, 500);
      throw new Error(detail || `El servidor de IA respondió con HTTP ${response.status}.`);
    }
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('El servidor de IA tardó demasiado en responder.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function cleanAiHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(-6).flatMap((message) => {
    const role = message?.role === 'assistant' ? 'assistant' : 'user';
    const content = text(message?.content, 1_500);
    return content ? [{ role, content }] : [];
  });
}

const LANGUAGE_RULE = 'Responde en el mismo idioma en que escribe el usuario (español si no está claro).';

// Terminales que atienden alguna vivienda (el por omisión o uno asignado).
async function terminalsInUse(database) {
  if (!hubDahuaConfigured()) return [];
  const used = new Set(database.properties.map((property) => String(property.dahuaRegistrationId || '').toUpperCase()).filter(Boolean));
  if (DAHUA_HUB_DEFAULT_DEVICE) used.add(DAHUA_HUB_DEFAULT_DEVICE.toUpperCase());
  try {
    const devices = await hubDevices({ hubUrl: DAHUA_HUB_URL, apiKey: DAHUA_HUB_API_KEY });
    return devices.filter((device) => used.has(device.registrationId.toUpperCase()));
  } catch {
    return [];
  }
}

async function currentDailySummary(database) {
  const since = new Date(Date.now() - 36 * 3_600_000).toISOString();
  const [accessEvents, terminals] = await Promise.all([
    localDatabase.listAccessEvents({ since, limit: 3000 }),
    terminalsInUse(database),
  ]);
  return dailySummary({ database, accessEvents, terminals });
}

async function askAdminAi(database, question, history = [], { onDelta } = {}) {
  const summary = await currentDailySummary(database);
  return aiClient.chat([
    {
      role: 'system',
      content: [
        'Eres RestBlu IA, asistente interno del gestor de alojamientos RestBlu.',
        LANGUAGE_RULE,
        'Sé breve, claro y práctico; usa listas cortas cuando ayuden.',
        'Usa sólo los datos de abajo. No inventes reservas, clientes, pagos, accesos ni disponibilidades.',
        'resumenDeHoy lo calculó el sistema: úsalo tal cual para llegadas, salidas, pagos por vencer, terminales y alertas de seguridad.',
        'Este chat es de solo lectura: no afirmes que modificaste datos; indica el módulo del gestor donde hacerlo.',
        'Muestra datos personales de un cliente sólo si la pregunta lo requiere.',
        `DATOS ACTUALES:\n${JSON.stringify(adminContext(database, summary))}`,
        languageInstruction(question),
      ].join('\n'),
    },
    ...cleanAiHistory(history),
    { role: 'user', content: question },
  ], { temperature: 0.2, maxTokens: 600, onDelta });
}

// Blu: catálogo público con la disponibilidad ya calculada y, si la cuenta
// tiene sesión, sus propias reservas (Blu personal).
async function askPublicAi(database, question, history = [], search = {}, { ownerUid = '', onDelta } = {}) {
  const guest = guestContext(database, ownerUid);
  const result = await aiClient.chat([
    {
      role: 'system',
      content: [
        'Eres Blu, asistente de reservas de RestBlu.',
        LANGUAGE_RULE,
        'Tono amable, simple y breve (máximo unas 6 frases o una lista corta).',
        'Ayuda a elegir alojamiento: compara tarifas (CLP por noche), capacidad, ubicación y características.',
        'La disponibilidad ya está calculada en el campo disponibilidad: úsala tal cual, nunca la deduzcas tú.',
        'Si el usuario no eligió fechas, pídele check-in, check-out y número de huéspedes para confirmar disponibilidad.',
        'Cuando recomiendes alojamientos escribe su nombre exacto del catálogo (así aparece el botón para reservarlo).',
        'No puedes crear ni confirmar reservas: indica que use el botón Reservar.',
        'Nunca reveles datos de otras personas (RUT, correos, teléfonos, reservas ajenas).',
        guest
          ? 'RESERVAS DEL USUARIO (sólo de esta cuenta): úsalas para preguntas como su check-in, su QR, cómo llegar o el manual de la vivienda. ' +
            'El QR no lo puedes mostrar: indica dónde verlo. La dirección y el manual del huésped sólo existen para estadías confirmadas.'
          : 'El usuario no tiene sesión iniciada: si pregunta por su reserva o su QR, pídele que inicie sesión en RestBlu.',
        guest ? `RESERVAS DEL USUARIO: ${JSON.stringify(guest)}` : '',
        `CATÁLOGO Y DISPONIBILIDAD: ${JSON.stringify(publicContext(database, search))}`,
        languageInstruction(question),
      ].filter(Boolean).join('\n'),
    },
    ...cleanAiHistory(history),
    { role: 'user', content: question },
  ], { temperature: 0.25, maxTokens: 450, onDelta });
  return { ...result, suggestions: suggestionsFromAnswer(result.answer, database, search) };
}

// Mantiene el modelo cargado en la GPU (ver ai-client.mjs). AI_KEEP_WARM=0 lo desactiva.
let aiWarmLogged = false;
async function keepAiWarm() {
  if (process.env.AI_KEEP_WARM === '0' || !aiClient.configured()) return;
  const started = Date.now();
  try {
    await aiClient.warm();
    if (!aiWarmLogged) console.log(`[IA] Modelo ${AI_MODEL} cargado y listo (${Date.now() - started} ms).`);
    aiWarmLogged = true;
  } catch (error) {
    aiWarmLogged = false;
    console.warn('[IA] No se pudo mantener el modelo cargado:', error instanceof Error ? error.message : error);
  }
}

function newReservationVerificationToken() {
  return `${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;
}

function hashReservationVerificationToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

// Enlace al pase de la reserva en la web (lo abre el QR del PDF).
function reservationPassLink(reservationId) {
  const link = new URL(PUBLIC_WEB_URL);
  link.searchParams.set('pase', reservationId);
  return link.toString();
}

function reservationVerificationLink(reservationId, token) {
  const link = new URL(PUBLIC_WEB_URL);
  link.searchParams.set('verifyReservation', reservationId);
  link.searchParams.set('token', token);
  return link.toString();
}

function localReservationVerificationLink(reservationId, token) {
  const link = new URL(`http://127.0.0.1:${PORT}/api/reservations/${encodeURIComponent(reservationId)}/verify`);
  link.searchParams.set('token', token);
  return link.toString();
}

function matchesReservationVerificationToken(reservation, token) {
  const expectedHex = String(reservation.verificationTokenHash || '');
  const actualHex = hashReservationVerificationToken(token);
  if (!/^[a-f0-9]{64}$/.test(expectedHex)) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = Buffer.from(actualHex, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function firebaseUserForReservation(customer) {
  const auth = await firebaseAuth();
  try {
    return await auth.getUserByEmail(customer.email);
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error;
    return auth.createUser({
      email: customer.email,
      displayName: customer.name,
      emailVerified: false,
    });
  }
}

async function sendVerificationEmail(customer, reservation, verificationLink) {
  const transport = mailer();
  const localVerificationLink = localReservationVerificationLink(
    reservation.id,
    new URL(verificationLink).searchParams.get('token') || '',
  );
  await transport.sendMail({
    from: mailFrom(),
    to: customer.email,
    subject: `Verifica tu correo para continuar con ${reservation.id}`,
    text: [
      `Hola ${customer.name},`,
      '',
      `Recibimos tu reserva ${reservation.id} para ${reservation.propertyName}.`,
      'Verifica tu correo abriendo este enlace:',
      verificationLink,
      '',
      'Este enlace es exclusivo para esta reserva. Después de abrirlo, vuelve a RestBlu para pagar con Webpay. Tu QR de acceso se habilita apenas se apruebe el pago.',
    ].join('\n'),
    html: `
      <div style="display:none;max-height:0;overflow:hidden;color:transparent">Verifica tu correo para continuar con la reserva RestBlu.</div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#edf5f4;margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;color:#173f4b">
        <tr><td align="center" style="padding:30px 14px">
          <table role="presentation" width="620" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:620px;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 12px 34px rgba(16,61,80,.12)">
            <tr><td style="background:#103d50;padding:30px 34px">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
                <td>
                  <div style="font-size:28px;line-height:1;font-weight:800;color:#ffffff">Rest<span style="color:#55d8cb">Blu</span></div>
                  <div style="margin-top:7px;font-size:10px;font-weight:700;letter-spacing:2.2px;color:#b8d9dc">ESTADÍAS INTELIGENTES</div>
                </td>
                <td align="right"><span style="display:inline-block;border:1px solid rgba(255,255,255,.26);border-radius:999px;padding:8px 12px;font-size:10px;font-weight:700;letter-spacing:.8px;color:#d9f7f3">VERIFICACIÓN SEGURA</span></td>
              </tr></table>
            </td></tr>
            <tr><td style="padding:38px 34px 18px">
              <div style="display:inline-block;margin-bottom:18px;border-radius:14px;background:#e4f7f3;padding:11px 14px;font-size:20px;line-height:1;color:#087b80">✓</div>
              <div style="font-size:12px;font-weight:800;letter-spacing:1.4px;color:#0b8e92">FALTA UN ÚLTIMO PASO</div>
              <h1 style="margin:8px 0 14px;font-size:30px;line-height:1.18;color:#102d3f">Verifica tu correo</h1>
              <p style="margin:0;font-size:16px;line-height:1.65;color:#496b74">Hola <strong style="color:#173f4b">${escapeHtml(customer.name)}</strong>. Confirma que esta dirección te pertenece para continuar con tu reserva.</p>
            </td></tr>
            <tr><td style="padding:0 34px 24px">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f5faf9;border:1px solid #d8e8e5;border-radius:16px">
                <tr><td style="padding:18px 20px;border-bottom:1px solid #dfecea;font-size:12px;color:#66818a">CÓDIGO DE RESERVA</td><td align="right" style="padding:18px 20px;border-bottom:1px solid #dfecea;font-size:15px;font-weight:800;color:#0b6871">${escapeHtml(reservation.id)}</td></tr>
                <tr><td style="padding:18px 20px;font-size:12px;color:#66818a">ALOJAMIENTO</td><td align="right" style="padding:18px 20px;font-size:14px;font-weight:700;color:#173f4b">${escapeHtml(reservation.propertyName)}</td></tr>
              </table>
            </td></tr>
            <tr><td align="center" style="padding:0 34px 28px">
              <a href="${escapeHtml(verificationLink)}" style="display:inline-block;background:#0b6871;color:#ffffff;text-decoration:none;border-radius:13px;padding:16px 25px;font-size:15px;font-weight:800;box-shadow:0 7px 18px rgba(11,104,113,.22)">Verificar esta reserva</a>
            </td></tr>
            <tr><td style="padding:0 34px 32px">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#eaf6f4;border-radius:15px"><tr>
                <td style="padding:17px 18px;font-size:13px;line-height:1.55;color:#3f6870"><strong style="color:#0b6871">¿Qué ocurrirá después?</strong><br>Vuelve a RestBlu para pagar con Webpay. Al aprobarse el pago recibirás el comprobante con tu QR de acceso.</td>
              </tr></table>
              <p style="margin:22px 0 7px;font-size:11px;color:#789098">Enlace único para la reserva ${escapeHtml(reservation.id)}:</p>
              <p style="margin:0;word-break:break-all;font-size:11px;line-height:1.5;color:#0b7d82">${escapeHtml(verificationLink)}</p>
              <p style="margin:22px 0 7px;font-size:11px;color:#789098">Si Firebase está temporalmente sin cuota, abre este enlace desde el PC donde está ejecutándose el gestor RestBlu:</p>
              <p style="margin:0;word-break:break-all;font-size:11px;line-height:1.5;color:#0b7d82">${escapeHtml(localVerificationLink)}</p>
            </td></tr>
            <tr><td align="center" style="background:#f4f8f7;padding:22px 28px;border-top:1px solid #e0ecea;font-size:11px;line-height:1.6;color:#789098">RestBlu · Pago procesado por Webpay (Transbank). El QR de acceso está en la web o la app RestBlu y habilita la puerta solo durante la estadía.<br>Si no solicitaste esta reserva, puedes ignorar este mensaje.</td></tr>
          </table>
        </td></tr>
      </table>`,
  });
}

async function sendConfirmationEmail(customer, reservation, pdf) {
  const transport = mailer();
  await transport.sendMail({
    from: mailFrom(),
    to: customer.email,
    subject: `Reserva RestBlu confirmada - ${reservation.id}`,
    text: `El pago en Webpay de la reserva ${reservation.id} fue aprobado y la reserva está confirmada. Adjuntamos el comprobante PDF con tu QR de acceso.`,
    html: `
      <div style="display:none;max-height:0;overflow:hidden;color:transparent">Tu reserva RestBlu está confirmada. Adjuntamos el comprobante con QR y PIN.</div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#edf5f4;margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;color:#173f4b">
        <tr><td align="center" style="padding:30px 14px">
          <table role="presentation" width="620" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:620px;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 12px 34px rgba(16,61,80,.12)">
            <tr><td style="background:#103d50;padding:30px 34px">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
                <td><div style="font-size:28px;line-height:1;font-weight:800;color:#ffffff">Rest<span style="color:#55d8cb">Blu</span></div><div style="margin-top:7px;font-size:10px;font-weight:700;letter-spacing:2.2px;color:#b8d9dc">ESTADÍAS INTELIGENTES</div></td>
                <td align="right"><span style="display:inline-block;border-radius:999px;background:#dcf7ee;padding:8px 12px;font-size:10px;font-weight:800;letter-spacing:.7px;color:#087759">CONFIRMADA</span></td>
              </tr></table>
            </td></tr>
            <tr><td style="padding:38px 34px 20px;text-align:center">
              <div style="display:inline-block;width:54px;height:54px;border-radius:50%;background:#dcf7ee;color:#087759;font-size:27px;line-height:54px;font-weight:800">✓</div>
              <div style="margin-top:20px;font-size:12px;font-weight:800;letter-spacing:1.4px;color:#0a8f68">CORREO VERIFICADO</div>
              <h1 style="margin:8px 0 13px;font-size:30px;line-height:1.18;color:#102d3f">Tu reserva está lista</h1>
              <p style="margin:0;font-size:16px;line-height:1.65;color:#496b74">Hola <strong style="color:#173f4b">${escapeHtml(customer.name)}</strong>. Confirmamos correctamente tu reserva en ${escapeHtml(reservation.propertyName)}.</p>
            </td></tr>
            <tr><td style="padding:0 34px 24px">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f5faf9;border:1px solid #d8e8e5;border-radius:16px">
                <tr><td style="padding:17px 20px;border-bottom:1px solid #dfecea;font-size:12px;color:#66818a">RESERVA</td><td align="right" style="padding:17px 20px;border-bottom:1px solid #dfecea;font-size:15px;font-weight:800;color:#0b6871">${escapeHtml(reservation.id)}</td></tr>
                <tr><td style="padding:17px 20px;border-bottom:1px solid #dfecea;font-size:12px;color:#66818a">CHECK-IN</td><td align="right" style="padding:17px 20px;border-bottom:1px solid #dfecea;font-size:14px;font-weight:700;color:#173f4b">${escapeHtml(reservation.checkIn)} · ${escapeHtml(reservation.checkInTime || '15:00')}</td></tr>
                <tr><td style="padding:17px 20px;font-size:12px;color:#66818a">CHECK-OUT</td><td align="right" style="padding:17px 20px;font-size:14px;font-weight:700;color:#173f4b">${escapeHtml(reservation.checkOut)} · ${escapeHtml(reservation.checkOutTime || '11:00')}</td></tr>
              </table>
            </td></tr>
            <tr><td style="padding:0 34px 34px">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#103d50;border-radius:17px"><tr>
                <td style="padding:21px 22px;color:#ffffff"><div style="font-size:14px;font-weight:800">Tu comprobante va adjunto</div><div style="margin-top:6px;font-size:12px;line-height:1.55;color:#b8d9dc">Abre el PDF para consultar el QR, el PIN temporal y todos los datos de la reserva.</div></td>
                <td align="center" width="85" style="padding:18px"><div style="border-radius:12px;background:#55d8cb;padding:13px 9px;font-size:12px;font-weight:900;color:#073b45">PDF</div></td>
              </tr></table>
            </td></tr>
            <tr><td align="center" style="background:#f4f8f7;padding:22px 28px;border-top:1px solid #e0ecea;font-size:11px;line-height:1.6;color:#789098">RestBlu · Comprobante de reserva.<br>Conserva este mensaje para consultar los datos de tu estadía.</td></tr>
          </table>
        </td></tr>
      </table>`,
    attachments: [
      {
        filename: `RestBlu-${reservation.id}.pdf`,
        content: pdf,
        contentType: MIME['.pdf'],
      },
    ],
  });
}

// La reserva enlaza al cliente (customerId) y al alojamiento (propertyId).
// Nombre, RUT, correo y teléfono salen de la ficha actual del cliente; las
// copias guardadas en la reserva sólo se usan si la ficha faltara.
function reservationCustomer(database, reservation) {
  const customer = database.customers.find((item) => item.id === reservation.customerId);
  if (!customer) return null;
  return {
    ...customer,
    name: customer.name || reservation.guestName,
    documentId: customer.documentId || reservation.guestDocumentId,
    email: customer.email || reservation.guestEmail,
    phone: customer.phone || reservation.guestPhone,
  };
}

// Vista de la reserva para mostrarla (PDF, correos, web, app y gestor): datos
// del cliente y del alojamiento actuales. Fechas, huéspedes y valores quedan
// fijos en la reserva porque son lo que se acordó y pagó.
function reservationView(database, reservation) {
  const customer = reservationCustomer(database, reservation);
  const property = database.properties.find((item) => item.id === reservation.propertyId);
  return {
    ...reservation,
    guestName: customer?.name || reservation.guestName || '',
    guestDocumentId: customer?.documentId || reservation.guestDocumentId || '',
    guestEmail: customer?.email || reservation.guestEmail || '',
    guestPhone: customer?.phone || reservation.guestPhone || '',
    propertyName: property?.name || reservation.propertyName || '',
    propertyPlace: property?.place || reservation.propertyPlace || '',
  };
}

function reservationWithoutPrivateVerificationToken(reservation) {
  const {
    verificationTokenHash: _verificationTokenHash,
    verificationTokenPending: _verificationTokenPending,
    biometricProfileId: _biometricProfileId,
    biometricTemplateEncrypted: _biometricTemplateEncrypted,
    ...publicReservation
  } = reservation;
  return {
    ...publicReservation,
    biometricVerificationAvailable: Boolean(reservation.biometricTemplateEncrypted),
  };
}

function pendingVerificationToken(reservation) {
  const current = text(reservation.verificationTokenPending, 160);
  if (current && matchesReservationVerificationToken(reservation, current)) return current;
  const token = newReservationVerificationToken();
  reservation.verificationTokenHash = hashReservationVerificationToken(token);
  reservation.verificationTokenPending = token;
  reservation.updatedAt = new Date().toISOString();
  return token;
}

async function deliverPendingVerificationEmail(database, reservation) {
  if (reservation.verificationEmailSentAt || reservation.status !== 'pendiente-verificacion') {
    return Boolean(reservation.verificationEmailSentAt);
  }
  const customer = reservationCustomer(database, reservation);
  if (!customer) throw new Error('No se encontró el cliente de la reserva.');

  const verificationToken = pendingVerificationToken(reservation);
  // El token debe quedar durable antes de cualquier efecto externo. Así un fallo
  // o reinicio puede reintentar exactamente el mismo enlace sin invalidarlo.
  await saveDatabase(database);
  try {
    await sendVerificationEmail(
      customer,
      reservationView(database, reservation),
      reservationVerificationLink(reservation.id, verificationToken),
    );
    reservation.verificationEmailSentAt = new Date().toISOString();
    reservation.updatedAt = reservation.verificationEmailSentAt;
    delete reservation.verificationEmailError;
    delete reservation.verificationTokenPending;
    await saveDatabase(database);
    return true;
  } catch (error) {
    reservation.verificationEmailError = text(
      error instanceof Error ? error.message : 'No fue posible enviar el correo de verificación.',
      1_000,
    );
    reservation.updatedAt = new Date().toISOString();
    await saveDatabase(database);
    return false;
  }
}

async function finalizeVerifiedReservation(database, reservation, customer) {
  if (reservation.status === 'expirada') {
    throw new Error('El plazo para completar esta reserva venció.');
  }
  reservation.emailVerifiedAt ||= new Date().toISOString();
  if (reservation.ownerUid) {
    await localDatabase.rememberVerifiedEmailSession(
      reservation.ownerUid, customer.email, customer.documentId,
    );
  }
  // Si el transporte devolvió un resultado incierto pero el huésped abrió el
  // enlace, la entrega queda demostrada y ya no debe seguir reintentándose.
  reservation.verificationEmailSentAt ||= reservation.emailVerifiedAt;
  delete reservation.verificationEmailError;
  delete reservation.verificationTokenPending;
  reservation.updatedAt = new Date().toISOString();
  const profile = database.customers.find((item) => item.id === reservation.customerId);
  if (profile && profile.email === customer.email) {
    profile.emailVerified = true;
    profile.updatedAt = new Date().toISOString();
  }
  if (reservation.paymentStatus !== 'aprobado-demo') {
    reservation.status = 'correo-verificado-pago-pendiente';
    return;
  }
  reservation.status = 'confirmada';
  if (reservation.confirmationEmailSentAt) return;
  try {
    const pdf = await reservationPdf(database, reservation, customer);
    await sendConfirmationEmail(customer, reservationView(database, reservation), pdf);
    reservation.confirmationEmailSentAt = new Date().toISOString();
    delete reservation.confirmationEmailError;
  } catch (error) {
    reservation.confirmationEmailError = error instanceof Error ? error.message : 'No se pudo enviar el PDF.';
  }
}

async function refreshReservationVerification(database, reservation) {
  if (reservation.status === 'expirada') return false;
  if (reservation.verificationTokenHash || reservation.emailVerifiedAt) return false;
  const customer = reservationCustomer(database, reservation);
  if (!customer) throw new Error('No se encontró el cliente de la reserva.');
  const user = await firebaseUserForReservation(customer);
  if (user.emailVerified) {
    await finalizeVerifiedReservation(database, reservation, customer);
    return true;
  }
  return false;
}

// Imagen del QR de acceso. Se genera en el gestor para que el código, que
// abre la puerta, no pase por servicios externos de generación de QR.
// La clave QR se lee del propio Dahua y se conserva sólo en memoria.
// Cada terminal tiene su propia clave, así que se guarda una por terminal.
const dahuaQrKeyCache = new Map();
async function dahuaQrKey(terminal) {
  const cached = dahuaQrKeyCache.get(terminal);
  if (cached && Date.now() - cached.readAt < 60 * 60_000) return cached.key;
  const client = dahuaClientForTerminal(terminal);
  const key = await client.getQrDecodeKey();
  await client.ensureQrValidTime(DAHUA_QR_VALID_MINUTES).catch((error) => {
    console.warn('[Dahua] No se pudo ajustar la vigencia del QR:', error instanceof Error ? error.message : error);
  });
  dahuaQrKeyCache.set(terminal, { key, readAt: Date.now() });
  return key;
}

// PDF de la reserva. Si el QR ya está en el Dahua, el PDF lleva el QR que abre
// la puerta, vigente 24 horas desde que se descarga; si no, un QR que abre el
// pase en la web.
async function reservationPdf(database, reservation, customer) {
  const view = reservationView(database, reservation);
  const access = await accessQrFields(reservation, paidAndConfirmed(reservation));
  return generateReservationPdf(view, customer, {
    passUrl: reservationPassLink(reservation.id),
    accessQrContent: access.accessQrContent || '',
    accessQrExpiresAt: access.accessQrExpiresAt || '',
  });
}

// QR dinámico de acceso: el lector lo acepta durante DAHUA_QR_VALID_SECONDS
// desde su emisión, así que la web y la app piden uno nuevo cada pocos
// minutos. Sólo se entrega si la reserva está confirmada, su tarjeta quedó
// registrada en el Dahua y la estadía no terminó.
async function accessQrFields(reservation, verified) {
  if (!verified || !dahuaConfigured(reservation) || !dahuaQrActive(reservation) ||
      !isDahuaQrCode(reservation.dahuaQrCode) || !(reservationAccessEnd(reservation) > Date.now())) {
    return {};
  }
  let key;
  try {
    key = await dahuaQrKey(dahuaTerminalFor(reservation));
  } catch (error) {
    console.warn('[Dahua] No se pudo leer la clave QR del terminal:',
      error instanceof Error ? error.message : error);
    return {};
  }
  const issuedAt = Math.floor(Date.now() / 1000);
  const content = dahuaDynamicQrContent(key, reservation.dahuaQrCode, issuedAt);
  return {
    accessQrContent: content,
    accessQrImage: await QRCode.toDataURL(content, { errorCorrectionLevel: 'M', margin: 2, width: 360 }),
    accessQrIssuedAt: new Date(issuedAt * 1000).toISOString(),
    accessQrExpiresAt: new Date((issuedAt + DAHUA_QR_VALID_SECONDS) * 1000).toISOString(),
  };
}

// El contenido en texto del QR queda en el gestor (PDF); se publica la imagen.
function publicAccessQr({ accessQrContent: _content, ...fields }) {
  return fields;
}

// Renueva en Firestore el QR dinámico de las reservas vigentes, para que la
// web publicada y la app siempre tengan uno dentro de su ventana de validez.
async function refreshCloudAccessQrs() {
  if (!dahuaConfigured() || !existsSync(FIREBASE_SERVICE_ACCOUNT_PATH)) return;
  const database = await readDatabase();
  const active = database.reservations.filter((reservation) => reservation.ownerUid &&
    paidAndConfirmed(reservation) && dahuaQrActive(reservation) &&
    reservationAccessEnd(reservation) > Date.now());
  if (!active.length) return;
  const store = await firebaseStore();
  for (const reservation of active) {
    const fields = publicAccessQr(await accessQrFields(reservation, true));
    if (!fields.accessQrImage) continue;
    await store.collection('reservation_status').doc(reservation.id).set({
      ...fields,
      dahuaQrStatus: reservation.dahuaQrStatus,
    }, { merge: true });
  }
}

async function publicReservationStatus(reservation) {
  const verified = paidAndConfirmed(reservation);
  const emailPending = !reservation.verificationEmailSentAt && !reservation.emailVerifiedAt;
  return {
    id: reservation.id,
    status: reservation.status,
    verified,
    emailVerified: Boolean(reservation.emailVerifiedAt),
    paymentStatus: reservation.paymentStatus || 'no-realizado-demo',
    paymentReference: reservation.paymentReference || null,
    expiresAt: reservation.expiresAt || null,
    expiredAt: reservation.expiredAt || null,
    pdfUrl: verified ? `/api/reservations/${encodeURIComponent(reservation.id)}/pdf` : null,
    verificationEmailSentAt: reservation.verificationEmailSentAt || null,
    verificationEmailError: reservation.verificationEmailError || null,
    emailPending,
    confirmationEmailSentAt: verified ? reservation.confirmationEmailSentAt || null : null,
    confirmationEmailError: verified ? reservation.confirmationEmailError || null : null,
    biometricStatus: verified ? reservation.biometricStatus || 'sin-registrar' : 'bloqueada',
    biometricEnrolledAt: verified ? reservation.biometricEnrolledAt || null : null,
    biometricExpiresAt: verified ? reservation.biometricExpiresAt || null : null,
    dahuaStatus: verified ? reservation.dahuaStatus || 'sin-registrar' : 'bloqueado',
    dahuaQrStatus: verified ? reservation.dahuaQrStatus || 'sin-registrar' : 'bloqueado',
    dahuaUserId: verified ? reservation.dahuaUserId || dahuaUserId(reservation.id) : '',
    ...publicAccessQr(await accessQrFields(reservation, verified)),
  };
}

function paidAndConfirmed(reservation) {
  return reservation.status === 'confirmada' && reservation.paymentStatus === 'aprobado-demo';
}

const NON_BLOCKING_RESERVATION_STATUSES = new Set([
  'cancelada',
  'cancelado',
  'rechazada',
  'rechazado',
  'anulada',
  'anulado',
  'error',
  'expirada',
]);

const PENDING_RESERVATION_STATUSES = new Set([
  'pendiente-verificacion',
  'correo-verificado-pago-pendiente',
]);

function expirePendingReservation(reservation, currentTime = Date.now()) {
  if (!PENDING_RESERVATION_STATUSES.has(reservation.status)) return false;
  if (!reservation.expiresAt) {
    // Reservas previas a la migración reciben una hora desde el primer arranque.
    reservation.expiresAt = new Date(currentTime + PENDING_RESERVATION_TTL_MS).toISOString();
    reservation.updatedAt = new Date(currentTime).toISOString();
    return true;
  }
  if (Date.parse(reservation.expiresAt) > currentTime) return false;
  reservation.status = 'expirada';
  reservation.expiredAt = new Date(currentTime).toISOString();
  reservation.updatedAt = reservation.expiredAt;
  reservation.verificationTokenHash = '';
  reservation.verificationTokenPending = '';
  return true;
}

async function expirePendingReservations(database) {
  let changed = false;
  for (const reservation of database.reservations) {
    if (expirePendingReservation(reservation)) changed = true;
  }
  if (!changed) return false;
  await saveDatabase(database);
  return true;
}

function reservationDate(value, label) {
  const date = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`${label} no contiene una fecha válida.`);
  }
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`${label} no contiene una fecha válida.`);
  }
  return date;
}

function conflictingReservation(database, propertyId, checkIn, checkOut) {
  return database.reservations.find((reservation) =>
    Number(reservation.propertyId) === propertyId &&
    !NON_BLOCKING_RESERVATION_STATUSES.has(
      text(reservation.status, 40).toLowerCase(),
    ) &&
    checkIn < reservation.checkOut &&
    checkOut > reservation.checkIn
  );
}

function unavailableRangesForProperty(database, propertyId) {
  return database.reservations
    .filter((reservation) =>
      Number(reservation.propertyId) === Number(propertyId) &&
      !NON_BLOCKING_RESERVATION_STATUSES.has(
        text(reservation.status, 40).toLowerCase(),
      )
    )
    .map((reservation) => ({
      checkIn: reservation.checkIn,
      checkOut: reservation.checkOut,
    }));
}

// Cuenta RestBlu verificada: correo y contraseña de Firebase con el correo
// confirmado. Las sesiones anónimas no pueden reservar.
async function verifiedAccountFromToken(bearer) {
  if (!bearer) return null;
  try {
    const identity = await (await firebaseAuth()).verifyIdToken(bearer);
    if (!identity.email || identity.email_verified !== true) return null;
    return { uid: identity.uid, email: identity.email.toLowerCase() };
  } catch {
    return null;
  }
}

async function verifiedAccountFromUid(uid) {
  if (!uid) return null;
  try {
    const user = await (await firebaseAuth()).getUser(uid);
    if (!user.email || !user.emailVerified) return null;
    return { uid: user.uid, email: user.email.toLowerCase() };
  } catch {
    return null;
  }
}

// El RUT identifica a la persona en el Dahua y en los comprobantes: una vez
// que tiene una reserva confirmada sólo puede corregirlo el administrador.
function customerRutLocked(database, customer) {
  return database.reservations.some((reservation) =>
    reservation.customerId === customer.id && paidAndConfirmed(reservation));
}

function bearerToken(request) {
  return String(request.headers.authorization || '').match(/^Bearer (\S+)$/i)?.[1] || '';
}

async function createReservationLocked(database, input, options = {}) {
  await expirePendingReservations(database);
  const reservationId = text(input.id, 80);
  if (!reservationId || !input.propertyId || !input.checkIn || !input.checkOut) {
    throw new Error('La reserva no contiene todos los datos requeridos.');
  }
  const existingReservation = database.reservations.find((item) => item.id === reservationId);
  if (existingReservation) {
    await deliverPendingVerificationEmail(database, existingReservation);
    return {
      reservation: existingReservation,
      customer: reservationCustomer(database, existingReservation),
      duplicated: true,
    };
  }
  const propertyId = integer(input.propertyId);
  const property = database.properties.find(
    (item) => Number(item.id) === propertyId && item.active !== false,
  );
  if (!property) {
    throw new Error('El alojamiento no existe o no está disponible para reservas.');
  }
  const checkIn = reservationDate(input.checkIn, 'El check-in');
  const checkOut = reservationDate(input.checkOut, 'El check-out');
  if (checkOut <= checkIn) {
    throw new Error('El check-out debe ser posterior al check-in.');
  }
  const nights = Math.round(
    (Date.parse(`${checkOut}T12:00:00Z`) - Date.parse(`${checkIn}T12:00:00Z`)) / 86_400_000,
  );
  const guests = Math.max(1, integer(input.guests, 1));
  if (guests > Math.max(1, integer(property.guests, 1))) {
    throw new Error(`El alojamiento admite un máximo de ${property.guests} huéspedes.`);
  }
  const nightlyPrice = Math.max(0, integer(property.price, 0));
  const subtotal = nightlyPrice * nights;
  const conflict = conflictingReservation(database, propertyId, checkIn, checkOut);
  if (conflict) {
    throw new Error(
      `El alojamiento ya está reservado del ${conflict.checkIn} al ${conflict.checkOut}. ` +
      'Selecciona días que no estén ocupados.',
    );
  }
  // El pago se hace después en Webpay: la creación no recibe datos de pago.
  const paymentDemoCard = text(input.paymentDemoCard, 40);
  const schemaVersion = integer(input.schemaVersion, 1);
  if (schemaVersion === 2) {
    throw new Error('Esta versión de la reserva ya no es compatible. Actualiza la web antes de reservar.');
  }
  if (paymentDemoCard) {
    throw new Error('El pago se realiza en Webpay después de crear la reserva. Actualiza la web.');
  }
  const customerDraft = customerFromInput(input);
  customerDraft.documentId = formatRut(customerDraft.documentId);
  if (!validRut(customerDraft.documentId)) {
    throw new Error('El RUT ingresado no es válido. Revisa el número y el dígito verificador.');
  }
  if (!validEmail(customerDraft.email)) {
    throw new Error('El correo electrónico ingresado no es válido.');
  }
  const ownerUid = text(input.ownerUid, 128);
  // Una cuenta RestBlu con el correo ya verificado por Firebase no necesita
  // volver a verificarlo en cada reserva.
  const verifiedAccount = Boolean(options.verifiedAccountEmail) && ownerUid &&
    options.verifiedAccountEmail === customerDraft.email.toLowerCase();
  const reusableEmailVerification = verifiedAccount || (schemaVersion >= 3 && ownerUid &&
    await localDatabase.hasVerifiedEmailSession(ownerUid, customerDraft.email, customerDraft.documentId));
  const customerByDocument = database.customers.find(
    (item) => customerDraft.documentId && item.documentId === customerDraft.documentId,
  );
  const customerByEmail = database.customers.find(
    (item) => customerDraft.email && item.email === customerDraft.email,
  );
  if (customerByDocument && customerByEmail && customerByDocument.id !== customerByEmail.id) {
    throw new Error(
      'El RUT y el correo pertenecen a fichas de cliente distintas. ' +
      'Usa el correo asociado a este RUT o corrige los datos antes de reservar.',
    );
  }
  const customerByAccount = verifiedAccount
    ? database.customers.find((item) => item.ownerUid === ownerUid)
    : null;
  if (verifiedAccount) {
    const rutOwner = customerByDocument && customerByDocument.ownerUid && customerByDocument.ownerUid !== ownerUid &&
      await firebaseAccountExists(customerByDocument.ownerUid);
    if (rutOwner) throw new Error('Ese RUT ya está asociado a otra cuenta RestBlu.');
    if (customerByAccount && customerByAccount.documentId !== customerDraft.documentId &&
        customerRutLocked(database, customerByAccount)) {
      throw new Error('El RUT de tu cuenta ya no se puede cambiar porque tienes reservas confirmadas. Escríbenos si está incorrecto.');
    }
  }
  let customer = customerByAccount || customerByDocument || customerByEmail;
  if (customer) {
    const emailChanged = customer.email !== customerDraft.email;
    // Sólo se actualizan los datos de contacto: notas, contacto de emergencia
    // y demás antecedentes de la ficha se conservan.
    Object.assign(customer, {
      name: customerDraft.name,
      documentId: customerDraft.documentId,
      email: customerDraft.email,
      phone: customerDraft.phone,
      updatedAt: new Date().toISOString(),
    });
    if (emailChanged) customer.emailVerified = false;
    if (verifiedAccount) customer.ownerUid = ownerUid;
  } else {
    customer = {
      ...customerDraft,
      id: nextId(database.customers),
      ...(verifiedAccount ? { ownerUid } : {}),
      createdAt: new Date().toISOString(),
    };
    database.customers.push(customer);
  }
  customer.lastReservationAt = new Date().toISOString();
  if (reusableEmailVerification) customer.emailVerified = true;
  const reservation = {
    id: reservationId,
    customerId: customer.id,
    propertyId,
    guestName: customerDraft.name,
    guestDocumentId: customerDraft.documentId,
    guestEmail: customerDraft.email,
    guestPhone: customerDraft.phone,
    propertyName: text(property.name, 120),
    propertyPlace: text(property.place, 160),
    checkIn,
    checkOut,
    checkInTime: text(property.checkInTime, 5) || '15:00',
    checkOutTime: text(property.checkOutTime, 5) || '11:00',
    guests,
    adults: Math.min(guests, Math.max(1, integer(input.adults, guests))),
    children: Math.max(0, integer(input.children, 0)),
    nights,
    nightlyPrice,
    subtotal,
    cleaningFee: 0,
    serviceFee: 0,
    taxes: 0,
    total: subtotal,
    // El pago se autoriza exclusivamente en confirmWebpayPayment.
    // No aceptar una aprobación enviada dentro de la creación, ni de clientes antiguos.
    paymentStatus: 'pendiente-demo',
    paymentReference: '',
    ownerUid,
    currency: text(property.currency, 8) || 'CLP',
    accessPin: text(input.accessPin, 12),
    specialRequests: text(input.specialRequests, 1000),
    status: reusableEmailVerification ? 'correo-verificado-pago-pendiente' : 'pendiente-verificacion',
    expiresAt: new Date(Date.now() + PENDING_RESERVATION_TTL_MS).toISOString(),
    expiredAt: '',
    emailVerifiedAt: reusableEmailVerification ? new Date().toISOString() : '',
    verificationTokenHash: '',
    createdAt: text(input.createdAt, 40) || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (!reservation.accessPin) throw new Error('No se pudo generar el PIN de acceso.');

  if (!reusableEmailVerification) {
    const verificationToken = newReservationVerificationToken();
    reservation.verificationTokenHash = hashReservationVerificationToken(verificationToken);
    reservation.verificationTokenPending = verificationToken;
  }
  database.reservations.unshift(reservation);
  await saveDatabase(database);
  await deliverPendingVerificationEmail(database, reservation);
  return { reservation, customer, duplicated: false };
}

async function createReservation(_database, input, options = {}) {
  const creation = reservationCreationQueue.then(async () => {
    // Volver a leer dentro de la cola evita que dos solicitudes simultáneas
    // validen la misma disponibilidad antes de que la primera sea guardada.
    const latestDatabase = await readDatabase();
    return createReservationLocked(latestDatabase, input, options);
  });
  reservationCreationQueue = creation.catch(() => undefined);
  return creation;
}

// Confirma una reserva pagada en Webpay Plus. El token llega del navegador,
// pero el pago sólo se acepta si Transbank confirma que autorizó esa orden por
// el total que calculó el gestor.
async function confirmWebpayPayment(reservationId, webpayToken) {
  if (!isWebpayToken(webpayToken)) throw new Error('El token de Webpay no es válido.');
  // La consulta a Transbank se hace fuera de la cola de reservas.
  const webpayStatus = await webpayTransactionStatus(webpayToken);
  const payment = reservationCreationQueue.then(async () => {
    const database = await readDatabase();
    const reservation = database.reservations.find((item) => item.id === reservationId);
    if (!reservation) throw new Error('Reserva no encontrada en el gestor.');
    if (reservation.paymentStatus === 'aprobado-demo' && reservation.status === 'confirmada') {
      return { reservation, database };
    }
    const result = evaluateWebpayPayment(webpayStatus, { buyOrder: reservation.id, amount: reservation.total });
    if (!result.approved) throw new Error(result.reason);
    expirePendingReservation(reservation);
    if (reservation.status === 'expirada') {
      // El pago se aprobó, pero la reserva había vencido: se recupera si las
      // fechas siguen libres; si no, queda marcada para reembolso.
      const conflict = conflictingReservation(database, Number(reservation.propertyId), reservation.checkIn, reservation.checkOut);
      if (conflict && conflict.id !== reservation.id) {
        reservation.paymentStatus = 'reembolso-pendiente';
        reservation.paymentToken = webpayToken;
        reservation.paymentReference = result.authorizationCode;
        reservation.updatedAt = new Date().toISOString();
        await saveDatabase(database);
        throw new Error('El pago fue aprobado, pero la reserva había vencido y las fechas ya no están disponibles. Se gestionará el reembolso.');
      }
      reservation.status = 'correo-verificado-pago-pendiente';
      reservation.expiredAt = '';
    }
    if (!reservation.emailVerifiedAt || reservation.status !== 'correo-verificado-pago-pendiente') {
      throw new Error('Primero debes verificar el correo de esta reserva.');
    }
    reservation.paymentStatus = 'aprobado-demo';
    reservation.paymentReference = result.authorizationCode;
    reservation.paymentToken = webpayToken;
    reservation.paymentDetail = `Webpay${result.cardLast4 ? ` · tarjeta terminada en ${result.cardLast4}` : ''}`;
    reservation.status = 'confirmada';
    reservation.updatedAt = new Date().toISOString();
    // Un correo final enviado erróneamente antes del pago no demuestra que
    // esta confirmación nueva se haya entregado.
    reservation.confirmationEmailSentAt = '';
    reservation.confirmationEmailError = '';
    const customer = reservationCustomer(database, reservation);
    if (!customer) throw new Error('No se encontró el cliente de la reserva.');
    // El código del QR de acceso se crea aquí, en el gestor, para que el PDF,
    // la web y la app muestren el mismo código que se registra en el Dahua.
    ensureDahuaQrCode(reservation);
    if (dahuaConfigured(reservation) && !dahuaEnrollmentsInProgress.has(reservation.id)) {
      dahuaEnrollmentsInProgress.add(reservation.id);
      try {
        if (await syncReservationQrToDahua(reservation, customer)) {
          console.log(`[Dahua] QR de ${reservation.id} habilitado en el terminal.`);
        }
      } finally {
        dahuaEnrollmentsInProgress.delete(reservation.id);
      }
    }
    // Preparar el PDF con QR antes de registrar la aprobación evita un estado
    // «pagado» sin comprobante si falla su generación.
    const pdf = await reservationPdf(database, reservation, customer);
    await saveDatabase(database);
    try {
      await sendConfirmationEmail(customer, reservationView(database, reservation), pdf);
      reservation.confirmationEmailSentAt = new Date().toISOString();
      delete reservation.confirmationEmailError;
    } catch (error) {
      reservation.confirmationEmailError = error instanceof Error ? error.message : 'No se pudo enviar el PDF.';
    }
    await saveDatabase(database);
    return { reservation, database };
  });
  reservationCreationQueue = payment.catch(() => undefined);
  // Registrar el QR en el Dahua apenas termina la confirmación, sin esperar al
  // siguiente ciclo. Va después para no competir con el guardado del pago.
  payment.then(() => { void runBackgroundJob('Dahua QR', syncDahuaQrAccess); }, () => {});
  return payment;
}

async function handleApi(request, response, url) {
  if (request.method === 'OPTIONS') {
    send(response, 204, '', {
      ...corsHeaders(request),
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    });
    return true;
  }

  if (!enforceRateLimit(request, response, url)) return true;

  if (request.method === 'POST' && url.pathname === '/api/uploads') {
    const contentType = text(request.headers['content-type'], 100).split(';')[0].toLowerCase();
    const extension = IMAGE_EXTENSIONS.get(contentType);
    if (!extension) {
      throw new Error('Formato no permitido. Usa JPG, PNG, WEBP o GIF.');
    }
    const sourceName = text(url.searchParams.get('name'), 100)
      .replace(/\.[^.]+$/, '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'alojamiento';
    const filename = `${Date.now()}-${sourceName}-${randomUUID().slice(0, 8)}${extension}`;
    const content = await readBinaryBody(request);
    if (!hasImageSignature(contentType, content)) {
      throw new Error('El contenido del archivo no coincide con una imagen válida.');
    }
    await writeFile(join(UPLOAD_DIR, filename), content);
    sendJson(request, response, 201, {
      url: `http://${HOST}:${PORT}/uploads/${encodeURIComponent(filename)}`,
      filename,
      size: content.length,
    });
    return true;
  }

  const database = await readDatabase();
  const segments = url.pathname.split('/').filter(Boolean);

  if (request.method === 'POST' && url.pathname === '/api/public/reservations/lookup') {
    const input = await readJsonBody(request);
    try {
      reservationLookupEmailGroups(database, input.documentId);
    } catch {
      sendJson(request, response, 400, { error: 'Ingresa un RUT chileno válido.' });
      return true;
    }
    try {
      await sendReservationLookupEmail(database, input.documentId);
      sendJson(request, response, 200, { message: RESERVATION_LOOKUP_ACK });
    } catch {
      sendJson(request, response, 503, { error: 'La consulta por correo no está disponible en este momento. Inténtalo más tarde.' });
    }
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(request, response, 200, {
      ok: true,
      storage: localDatabase.storage,
      databasePath: localDatabase.path,
      firebaseConfigured: existsSync(FIREBASE_SERVICE_ACCOUNT_PATH),
      emailConfigured: Boolean(
        process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS,
      ),
      aiConfigured: aiConfigured(),
      aiModel: AI_MODEL,
      biometricConfigured: biometricConfigured(),
      dahuaConfigured: dahuaConfigured(),
      dahuaEnrollmentMode: 'direct',
      dahuaLanConfigured: lanDahuaConfigured(),
      dahuaHub: hubDahuaConfigured() ? { url: DAHUA_HUB_URL, defaultDevice: DAHUA_HUB_DEFAULT_DEVICE } : null,
      properties: database.properties.length,
      customers: database.customers.length,
      reservations: database.reservations.length,
      updatedAt: database.meta?.updatedAt,
    });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/ai/status') {
    if (!aiConfigured()) {
      sendJson(request, response, 200, {
        configured: false,
        connected: false,
        model: AI_MODEL,
      });
      return true;
    }
    try {
      const models = await aiFetch('/models', { method: 'GET' }, 12_000);
      const availableModels = Array.isArray(models.data)
        ? models.data.map((model) => text(model.id, 120)).filter(Boolean)
        : [];
      sendJson(request, response, 200, {
        configured: true,
        connected: true,
        model: AI_MODEL,
        modelAvailable: availableModels.includes(AI_MODEL),
      });
    } catch (error) {
      sendJson(request, response, 200, {
        configured: true,
        connected: false,
        model: AI_MODEL,
        error: error instanceof Error ? error.message : 'No fue posible conectar con la IA.',
      });
    }
    return true;
  }

  // Terminales Dahua disponibles en el hub, para la sección Terminales.
  if (request.method === 'GET' && url.pathname === '/api/dahua/terminals') {
    const result = {
      hub: { configured: hubDahuaConfigured(), connected: false, url: DAHUA_HUB_URL || '' },
      lanConfigured: lanDahuaConfigured(),
      defaultDevice: DAHUA_HUB_DEFAULT_DEVICE,
      tunnel: await ngrokTunnel(
        process.env.NGROK_API_URL || 'http://127.0.0.1:4040',
        Number(process.env.DAHUA_HUB_TCP_PORT || 9500),
      ),
      terminals: [],
    };
    const propertiesFor = (registrationId) => database.properties
      .filter((property) => String(property.dahuaRegistrationId || '').toUpperCase() === registrationId.toUpperCase())
      .map((property) => ({ id: property.id, name: property.name }));
    const defaultCount = database.properties.filter((property) => !property.dahuaRegistrationId).length;
    if (hubDahuaConfigured()) {
      try {
        const devices = await hubDevices({ hubUrl: DAHUA_HUB_URL, apiKey: DAHUA_HUB_API_KEY });
        result.hub.connected = true;
        result.terminals = devices.map((device) => {
          const isDefault = device.registrationId.toUpperCase() === DAHUA_HUB_DEFAULT_DEVICE.toUpperCase();
          return {
            registrationId: device.registrationId,
            name: device.name,
            deviceClass: device.deviceClass,
            online: device.online,
            tls: Boolean(device.session?.tls),
            connectedSeconds: device.session?.connectedSeconds ?? null,
            heartbeats: device.session?.heartbeats ?? null,
            remoteAddress: device.session?.remoteAddress || device.lastRemoteAddress || '',
            lastConnectedAt: device.lastConnectedAt,
            lastDisconnectedAt: device.lastDisconnectedAt,
            lastSeenAt: device.lastSeenAt,
            enabled: device.enabled,
            properties: propertiesFor(device.registrationId),
            isDefault,
            defaultFor: isDefault ? defaultCount : 0,
          };
        }).sort((a, b) => Number(b.online) - Number(a.online) || a.registrationId.localeCompare(b.registrationId));
      } catch (error) {
        result.hub.error = error instanceof Error ? error.message : 'No fue posible consultar el hub.';
      }
    }
    sendJson(request, response, 200, result);
    return true;
  }

  // Prueba en vivo de un terminal del hub: le pide su modelo, serie y hora.
  const terminalTest = request.method === 'POST' && /^\/api\/dahua\/terminals\/([^/]+)\/test$/.exec(url.pathname);
  if (terminalTest) {
    const registrationId = decodeURIComponent(terminalTest[1]);
    if (!validRegistrationId(registrationId) || !hubDahuaConfigured()) {
      sendJson(request, response, 400, { error: 'Terminal inválido o hub sin configurar.' });
      return true;
    }
    const started = Date.now();
    try {
      const info = await dahuaClientForTerminal(registrationId).getDeviceInfo();
      sendJson(request, response, 200, {
        registrationId,
        latencyMs: Date.now() - started,
        model: info.deviceType || '',
        serialNumber: info.serialNumber || '',
        firmware: info.version || '',
        deviceTime: info.result || '',
      });
    } catch (error) {
      sendJson(request, response, 502, { error: error instanceof Error ? error.message : 'El terminal no respondió.' });
    }
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/dahua/hub') {
    if (!hubDahuaConfigured()) {
      sendJson(request, response, 200, { configured: false });
      return true;
    }
    const assignments = database.properties.map((property) => ({
      propertyId: property.id,
      name: property.name,
      terminal: property.dahuaRegistrationId || DAHUA_HUB_DEFAULT_DEVICE || (lanDahuaConfigured() ? 'lan' : ''),
      assigned: Boolean(property.dahuaRegistrationId),
    }));
    try {
      const status = await hubStatus({ hubUrl: DAHUA_HUB_URL, apiKey: DAHUA_HUB_API_KEY });
      sendJson(request, response, 200, {
        configured: true, connected: true, url: DAHUA_HUB_URL, defaultDevice: DAHUA_HUB_DEFAULT_DEVICE,
        online: status.online, assignments,
      });
    } catch (error) {
      sendJson(request, response, 200, {
        configured: true, connected: false, url: DAHUA_HUB_URL, defaultDevice: DAHUA_HUB_DEFAULT_DEVICE, assignments,
        error: error instanceof Error ? error.message : 'No fue posible consultar el hub.',
      });
    }
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/biometrics/status') {
    if (!biometricConfigured()) {
      sendJson(request, response, 200, {
        configured: false, connected: false, directDahuaConfigured: dahuaConfigured(),
      });
      return true;
    }
    try {
      const result = await biometricFetch(BIOMETRIC_HEALTH_PATH, null, 10_000);
      sendJson(request, response, 200, {
        configured: true, connected: true, directDahuaConfigured: dahuaConfigured(), service: result,
      });
    } catch (error) {
      sendJson(request, response, 200, {
        configured: true,
        connected: false,
        directDahuaConfigured: dahuaConfigured(),
        error: error instanceof Error ? error.message : 'No fue posible consultar el servidor biométrico.',
      });
    }
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/biometrics/enroll') {
    const input = await readJsonBody(request);
    const reservationId = text(input.reservationId, 80);
    const reservation = database.reservations.find((item) => item.id === reservationId);
    if (!reservation) {
      sendJson(request, response, 404, { error: 'Reserva no encontrada.' });
      return true;
    }
    if (!paidAndConfirmed(reservation)) {
      sendJson(request, response, 409, {
        error: 'Primero debes verificar el correo y pagar la reserva en Webpay.',
      });
      return true;
    }
    const customer = reservationCustomer(database, reservation);
    if (!customer) {
      sendJson(request, response, 404, { error: 'No encontramos al huésped de esta reserva.' });
      return true;
    }
    if (!validRut(input.documentId) || formatRut(input.documentId) !== formatRut(customer.documentId)) {
      sendJson(request, response, 403, { error: 'El RUT no corresponde al huésped de la reserva.' });
      return true;
    }
    if (input.consent !== true || input.dahuaConsent !== true) {
      sendJson(request, response, 400, {
        error: 'Debes usar la versión actualizada y autorizar expresamente el registro facial en Dahua.',
      });
      return true;
    }
    if (!dahuaConfigured(reservation)) {
      sendJson(request, response, 503, { error: 'La integración Dahua no está configurada en el gestor.' });
      return true;
    }
    const image = biometricImage(input.image);
    if (dahuaEnrollmentActive(reservation)) {
      sendJson(request, response, 409, {
        error: 'Esta reserva ya tiene un registro Dahua; revisa su estado en el gestor.',
      });
      return true;
    }
    if (dahuaEnrollmentsInProgress.has(reservation.id)) {
      sendJson(request, response, 409, { error: 'Ya hay un registro facial en curso para esta reserva.' });
      return true;
    }
    dahuaEnrollmentsInProgress.add(reservation.id);
    try {
      const enrolled = await enrollReservationDirectlyOnDahua(reservation, customer, image);
      await saveDatabase(database);
      sendJson(request, response, enrolled ? 201 : 502, enrolled ? {
        reservationId: reservation.id,
        status: reservation.biometricStatus,
        enrolledAt: reservation.biometricEnrolledAt,
        expiresAt: reservation.biometricExpiresAt,
        livenessChecked: false,
        dahuaStatus: reservation.dahuaStatus,
      } : { error: reservation.biometricLastError, dahuaStatus: reservation.dahuaStatus });
    } catch (error) {
      reservation.biometricStatus = 'error';
      reservation.biometricLastError = text(
        error instanceof Error ? error.message : 'No fue posible registrar la biometría.',
        1_000,
      );
      reservation.updatedAt = new Date().toISOString();
      await saveDatabase(database);
      sendJson(request, response, 502, { error: reservation.biometricLastError });
    } finally {
      dahuaEnrollmentsInProgress.delete(reservation.id);
    }
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/admin/biometrics/verify') {
    const input = await readJsonBody(request);
    const reservationId = text(input.reservationId, 80);
    const reservation = database.reservations.find((item) => item.id === reservationId);
    if (!reservation) {
      sendJson(request, response, 404, { error: 'Reserva no encontrada.' });
      return true;
    }
    if (!paidAndConfirmed(reservation)) {
      sendJson(request, response, 409, { error: 'La reserva todavía no está confirmada.' });
      return true;
    }
    if (reservation.biometricStatus !== 'activa' || !reservation.biometricTemplateEncrypted) {
      sendJson(request, response, 409, {
        error: 'Esta reserva no tiene una plantilla biométrica activa.',
      });
      return true;
    }
    if (reservation.biometricExpiresAt && Date.now() > new Date(reservation.biometricExpiresAt).getTime()) {
      reservation.biometricStatus = 'expirada';
      reservation.updatedAt = new Date().toISOString();
      await saveDatabase(database);
      sendJson(request, response, 410, { error: 'La biometría de esta reserva ya expiró.' });
      return true;
    }
    const image = biometricImage(input.image);
    try {
      const template = JSON.parse(decryptBiometricTemplate(reservation.biometricTemplateEncrypted));
      const result = await biometricFetch(BIOMETRIC_VERIFY_PATH, {
        template,
        probe_image_base64: image.base64,
      });
      const numericScore = Number(result.score ?? result.similarity ?? result.confidence);
      const score = Number.isFinite(numericScore) ? numericScore : null;
      const explicitMatch = result.match ?? result.verified ?? result.is_match ?? result.isMatch;
      if (typeof explicitMatch !== 'boolean' && score == null) {
        throw new Error('El servidor biométrico no devolvió un resultado de comparación válido.');
      }
      const match = typeof explicitMatch === 'boolean'
        ? explicitMatch
        : score >= BIOMETRIC_MATCH_THRESHOLD;
      reservation.biometricLastVerifiedAt = new Date().toISOString();
      reservation.biometricLastScore = score;
      reservation.biometricLastError = null;
      reservation.updatedAt = reservation.biometricLastVerifiedAt;
      await saveDatabase(database);
      sendJson(request, response, 200, {
        match,
        score,
        threshold: BIOMETRIC_MATCH_THRESHOLD,
        checkedAt: reservation.biometricLastVerifiedAt,
        livenessChecked: false,
        reservation: {
          id: reservation.id,
          propertyName: reservation.propertyName,
          checkIn: reservation.checkIn,
          checkOut: reservation.checkOut,
          customerName: reservationCustomer(database, reservation)?.name || '',
        },
      });
    } catch (error) {
      reservation.biometricLastVerifiedAt = new Date().toISOString();
      reservation.biometricLastError = text(
        error instanceof Error ? error.message : 'No fue posible verificar el rostro.',
        1_000,
      );
      reservation.updatedAt = reservation.biometricLastVerifiedAt;
      await saveDatabase(database);
      sendJson(request, response, 502, { error: reservation.biometricLastError });
    }
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/admin/daily-summary') {
    sendJson(request, response, 200, await currentDailySummary(database));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/admin/ai-feedback') {
    sendJson(request, response, 200, { feedback: await localDatabase.listAiFeedback({ limit: 300 }) });
    return true;
  }

  // 👍 / 👎 en las respuestas de RestBlu IA del gestor.
  if (request.method === 'POST' && url.pathname === '/api/ai/feedback') {
    const input = await readJsonBody(request);
    if (!['up', 'down'].includes(input.rating) || text(input.answer, 10).length < 1) {
      sendJson(request, response, 400, { error: 'Valoración inválida.' });
      return true;
    }
    await localDatabase.saveAiFeedback({
      requestId: text(input.requestId, 80) || `gestor-${randomUUID()}`,
      channel: 'gestor',
      question: text(input.question, 1_500),
      answer: text(input.answer, 6_000),
      rating: input.rating,
    });
    sendJson(request, response, 200, { saved: true });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/ai/chat') {
    const input = await readJsonBody(request);
    const question = text(input.question, 1_500);
    if (question.length < 2) {
      sendJson(request, response, 400, { error: 'Escribe una pregunta para RestBlu IA.' });
      return true;
    }
    try {
      sendJson(
        request,
        response,
        200,
        await askAdminAi(database, question, input.history),
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'No fue posible consultar la IA.';
      sendJson(request, response, 502, {
        error: `No fue posible consultar el servidor de IA. ${detail}`,
      });
    }
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/ai/public-chat') {
    const input = await readJsonBody(request);
    const question = text(input.question, 1_500);
    if (question.length < 2) {
      sendJson(request, response, 400, { error: 'Escribe una pregunta para Blu.' });
      return true;
    }
    try {
      const account = await verifiedAccountFromToken(bearerToken(request));
      sendJson(
        request,
        response,
        200,
        await askPublicAi(database, question, input.history, input.search, { ownerUid: account?.uid || '' }),
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'No fue posible consultar la IA.';
      sendJson(request, response, 502, {
        error: `El asistente no está disponible en este momento. ${detail}`,
      });
    }
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/database/info') {
    sendJson(request, response, 200, {
      engine: localDatabase.engine,
      path: localDatabase.path,
      schemaVersion: database.meta?.version || 2,
      tables: await localDatabase.tableCounts(),
      updatedAt: database.meta?.updatedAt,
    });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/properties') {
    const includeInactive = url.searchParams.get('includeInactive') === '1';
    const properties = database.properties
      .filter((property) => includeInactive || property.active !== false)
      .map((property) =>
        publicProperty(property, unavailableRangesForProperty(database, property.id)),
      );
    sendJson(request, response, 200, { properties });
    return true;
  }

  // Cuentas RestBlu (Firebase Auth) con su perfil, RUT y reservas del gestor.
  if (request.method === 'GET' && url.pathname === '/api/admin/accounts') {
    if (!existsSync(FIREBASE_SERVICE_ACCOUNT_PATH)) {
      sendJson(request, response, 503, { error: 'Firebase no está configurado en el gestor.' });
      return true;
    }
    const auth = await firebaseAuth();
    const store = await firebaseStore();
    const users = [];
    let pageToken;
    do {
      const page = await auth.listUsers(1000, pageToken);
      users.push(...page.users);
      pageToken = page.pageToken;
    } while (pageToken);
    const [profiles, ruts] = await Promise.all([
      store.collection('customer_profiles').get(),
      store.collection('rut_index').get(),
    ]);
    const profileByUid = new Map(profiles.docs.map((doc) => [doc.id, doc.data()]));
    const rutByUid = new Map(ruts.docs.map((doc) => [doc.data().uid, doc.id]));
    const accounts = users.map((user) => {
      const profile = profileByUid.get(user.uid) || {};
      const reservations = database.reservations.filter((reservation) => reservation.ownerUid === user.uid);
      return {
        uid: user.uid,
        email: user.email || '',
        emailVerified: user.emailVerified,
        anonymous: !user.providerData.length,
        providers: user.providerData.map((item) => item.providerId),
        disabled: user.disabled,
        name: profile.name || user.displayName || '',
        documentId: profile.documentId || '',
        phone: profile.phone || '',
        rutRegistered: rutByUid.has(user.uid),
        profileComplete: Boolean(profile.documentId),
        createdAt: user.metadata.creationTime ? new Date(user.metadata.creationTime).toISOString() : null,
        lastSignInAt: user.metadata.lastSignInTime ? new Date(user.metadata.lastSignInTime).toISOString() : null,
        reservations: reservations.length,
        activeReservations: reservations.filter((reservation) => paidAndConfirmed(reservation) &&
          reservationAccessEnd(reservation) > Date.now()).map((reservation) => reservation.id),
      };
    }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    sendJson(request, response, 200, { accounts });
    return true;
  }

  // Elimina una cuenta: su usuario de Firebase, perfil, RUT registrado y
  // códigos pendientes. Las reservas del gestor se conservan como historial.
  // No se permite si tiene una estadía confirmada en curso o futura.
  const accountDelete = request.method === 'DELETE' && /^\/api\/admin\/accounts\/([A-Za-z0-9]{1,128})$/.exec(url.pathname);
  if (accountDelete) {
    if (!existsSync(FIREBASE_SERVICE_ACCOUNT_PATH)) {
      sendJson(request, response, 503, { error: 'Firebase no está configurado en el gestor.' });
      return true;
    }
    const uid = accountDelete[1];
    const active = database.reservations.filter((reservation) => reservation.ownerUid === uid &&
      paidAndConfirmed(reservation) && reservationAccessEnd(reservation) > Date.now());
    if (active.length) {
      sendJson(request, response, 409, {
        error: `La cuenta tiene ${active.length} estadía(s) confirmada(s) vigente(s) (${active.map((item) => item.id).join(', ')}). Cancélalas antes de eliminarla.`,
      });
      return true;
    }
    const auth = await firebaseAuth();
    const store = await firebaseStore();
    let email = '';
    try {
      email = (await auth.getUser(uid)).email || '';
    } catch (error) {
      if (error?.code !== 'auth/user-not-found') throw error;
    }
    const batch = store.batch();
    batch.delete(store.collection('customer_profiles').doc(uid));
    batch.delete(store.collection('account_verification_codes').doc(uid));
    const [ruts, requests] = await Promise.all([
      store.collection('rut_index').where('uid', '==', uid).get(),
      store.collection('account_verification_requests').where('ownerUid', '==', uid).get(),
    ]);
    for (const doc of [...ruts.docs, ...requests.docs]) batch.delete(doc.ref);
    await batch.commit();
    await auth.deleteUser(uid).catch((error) => {
      if (error?.code !== 'auth/user-not-found') throw error;
    });
    // Las fichas de cliente quedan como historial, sin cuenta: así su RUT puede
    // asociarse a la cuenta nueva que se registre.
    let unlinked = false;
    for (const customer of database.customers) {
      if (customer.ownerUid !== uid) continue;
      customer.ownerUid = '';
      customer.updatedAt = new Date().toISOString();
      unlinked = true;
    }
    if (unlinked) await saveDatabase(database);
    console.log(`[Cuentas] Cuenta ${email || uid} eliminada desde el gestor (RUT liberado: ${ruts.size ? 'sí' : 'no'}).`);
    sendJson(request, response, 200, { uid, email, rutReleased: ruts.size > 0 });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/admin/properties') {
    sendJson(request, response, 200, { properties: database.properties });
    return true;
  }

  // Apertura manual desde el gestor local. Cada vivienda debe tener un terminal
  // propio para evitar que el botón de otra vivienda abra la misma puerta.
  if (request.method === 'POST' && /^\/api\/admin\/properties\/\d+\/open-door$/.test(url.pathname)) {
    const localOrigins = new Set([`http://${HOST}:${PORT}`, `http://localhost:${PORT}`]);
    const origin = request.headers.origin;
    if (!localOrigins.has(`http://${request.headers.host}`) ||
        (origin && !localOrigins.has(origin)) ||
        (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin') ||
        request.headers['x-restblu-manager-action'] !== 'open-door') {
      sendJson(request, response, 403, { error: 'Abre la puerta únicamente desde el gestor local.' });
      return true;
    }
    const id = integer(segments[3]);
    const property = database.properties.find((item) => item.id === id);
    if (!property) {
      sendJson(request, response, 404, { error: 'Alojamiento no encontrado.' });
      return true;
    }
    const terminal = String(property.dahuaRegistrationId || '').trim();
    if (!terminal || !validRegistrationId(terminal)) {
      sendJson(request, response, 409, { error: 'Asigna un terminal Dahua propio a este alojamiento antes de abrir la puerta.' });
      return true;
    }
    if (database.properties.some((item) => item.id !== id &&
      String(item.dahuaRegistrationId || '').toUpperCase() === terminal.toUpperCase())) {
      sendJson(request, response, 409, { error: 'Este terminal está asignado a más de un alojamiento. Corrige la asignación antes de abrir.' });
      return true;
    }
    if (!hubDahuaConfigured()) {
      sendJson(request, response, 503, { error: 'El hub Dahua no está configurado en este gestor.' });
      return true;
    }
    const lastAttempt = manualDoorAttempts.get(terminal.toUpperCase());
    if (lastAttempt && (lastAttempt.inProgress || Date.now() - lastAttempt.at < MANUAL_DOOR_COOLDOWN_MS)) {
      sendJson(request, response, 429, { error: 'Ya se envió una apertura a esta puerta. Espera 10 segundos antes de repetirla.' });
      return true;
    }
    manualDoorAttempts.set(terminal.toUpperCase(), { at: Date.now(), inProgress: true });
    try {
      await dahuaClientForTerminal(terminal).openDoor({ channel: 1 });
      console.log(`[Dahua] Apertura manual confirmada: alojamiento ${id}, terminal ${terminal}.`);
      sendJson(request, response, 200, { opened: true, propertyId: id, terminal });
    } catch (error) {
      console.error(`[Dahua] Apertura manual sin confirmación: alojamiento ${id}, terminal ${terminal}: ${error.message}`);
      sendJson(request, response, 502, { error: 'El terminal no confirmó la apertura. Comprueba su conexión antes de reintentar.' });
    } finally {
      manualDoorAttempts.set(terminal.toUpperCase(), { at: Date.now(), inProgress: false });
    }
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/admin/access-events') {
    const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 30));
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const terminals = [...accessEventsSyncStatus.entries()].map(([terminal, status]) => ({ terminal, ...status }));
    const synced = terminals.map((item) => item.lastSyncAt).filter(Boolean).sort();
    sendJson(request, response, 200, {
      events: await localDatabase.listAccessEvents({ since, limit: 5000 }),
      terminals,
      lastSyncAt: synced.at(-1) || null,
      lastSyncError: terminals.filter((item) => item.error).map((item) => `${item.terminal}: ${item.error}`).join(' · '),
      dahuaConfigured: dahuaConfigured(),
    });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/properties') {
    const input = await readJsonBody(request);
    const property = propertyFromInput(input);
    property.id = nextId(database.properties);
    property.createdAt = new Date().toISOString();
    database.properties.push(property);
    await saveDatabase(database);
    sendJson(request, response, 201, { property });
    return true;
  }

  if (request.method === 'PUT' && segments[1] === 'properties' && segments[2]) {
    const id = integer(segments[2]);
    const index = database.properties.findIndex((property) => property.id === id);
    if (index < 0) {
      sendJson(request, response, 404, { error: 'Alojamiento no encontrado.' });
      return true;
    }
    const input = await readJsonBody(request);
    database.properties[index] = propertyFromInput(input, database.properties[index]);
    await saveDatabase(database);
    sendJson(request, response, 200, { property: database.properties[index] });
    return true;
  }

  if (request.method === 'POST' && /^\/api\/properties\/\d+\/toggle$/.test(url.pathname)) {
    const id = integer(segments[2]);
    const property = database.properties.find((item) => item.id === id);
    if (!property) {
      sendJson(request, response, 404, { error: 'Alojamiento no encontrado.' });
      return true;
    }
    property.active = property.active === false;
    property.updatedAt = new Date().toISOString();
    await saveDatabase(database);
    sendJson(request, response, 200, { property });
    return true;
  }

  if (request.method === 'DELETE' && /^\/api\/properties\/\d+$/.test(url.pathname)) {
    const id = integer(segments[2]);
    const index = database.properties.findIndex((property) => property.id === id);
    if (index < 0) {
      sendJson(request, response, 404, { error: 'Alojamiento no encontrado.' });
      return true;
    }
    const reservationCount = database.reservations.filter(
      (reservation) => reservation.propertyId === id,
    ).length;
    if (reservationCount > 0) {
      sendJson(request, response, 409, {
        error: `Este alojamiento tiene ${reservationCount} reserva${reservationCount === 1 ? '' : 's'} registrada${reservationCount === 1 ? '' : 's'}. Ocúltalo para conservar el historial.`,
      });
      return true;
    }
    const [property] = database.properties.splice(index, 1);
    await saveDatabase(database);
    try {
      if (existsSync(FIREBASE_SERVICE_ACCOUNT_PATH)) {
        const store = await firebaseStore();
        await store.collection('public_properties').doc(String(id)).delete();
      }
    } catch (error) {
      console.error(
        'Eliminación pendiente en Firestore:',
        error instanceof Error ? error.message : error,
      );
    }
    sendJson(request, response, 200, { deleted: true, property });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/customers') {
    sendJson(request, response, 200, { customers: database.customers });
    return true;
  }

  if (request.method === 'PUT' && segments[1] === 'customers' && segments[2]) {
    const id = integer(segments[2]);
    const index = database.customers.findIndex((customer) => customer.id === id);
    if (index < 0) {
      sendJson(request, response, 404, { error: 'Cliente no encontrado.' });
      return true;
    }
    const input = await readJsonBody(request);
    const previousName = database.customers[index].name;
    database.customers[index] = customerFromInput(input, database.customers[index]);
    const customer = database.customers[index];
    // Republicar sus reservas: la web, la app y el PDF muestran los datos nuevos.
    for (const reservation of database.reservations) {
      if (reservation.customerId !== customer.id) continue;
      reservation.updatedAt = customer.updatedAt;
      publishedReservationVersions.delete(reservation.id);
    }
    await saveDatabase(database);
    if (customer.name !== previousName) void renameCustomerOnDahua(database, customer);
    sendJson(request, response, 200, { customer });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/reservations') {
    sendJson(request, response, 200, {
      reservations: database.reservations
        .map((reservation) => reservationWithoutPrivateVerificationToken(reservationView(database, reservation))),
    });
    return true;
  }

  if (
    request.method === 'GET' &&
    segments[1] === 'reservations' &&
    segments[2] &&
    segments[3] === 'verify'
  ) {
    const reservation = database.reservations.find((item) => item.id === segments[2]);
    const token = text(url.searchParams.get('token'), 160);
    let succeeded = false;
    let message = '';
    if (reservation && expirePendingReservation(reservation)) await saveDatabase(database);
    if (!reservation) {
      message = 'No encontramos esta reserva en el gestor local.';
    } else if (reservation.status === 'expirada') {
      message = 'El plazo para completar esta reserva venció. Las fechas ya están disponibles nuevamente.';
    } else if (!matchesReservationVerificationToken(reservation, token)) {
      message = 'El enlace no corresponde a esta reserva.';
    } else {
      const customer = reservationCustomer(database, reservation);
      if (!customer) {
        message = 'No encontramos al huésped de esta reserva.';
      } else {
        if (reservation.status !== 'confirmada') {
          await finalizeVerifiedReservation(database, reservation, customer);
          await saveDatabase(database);
        }
        succeeded = true;
        message = reservation.status === 'correo-verificado-pago-pendiente'
          ? 'Correo verificado. Vuelve a RestBlu para pagar con Webpay; el PDF y el QR se generarán después.'
          : reservation.confirmationEmailError
          ? `La reserva quedó confirmada, pero el correo final presentó este problema: ${reservation.confirmationEmailError}`
          : 'La reserva quedó confirmada. Revisa tu correo para descargar el comprobante.';
      }
    }
    const color = succeeded ? '#087759' : '#c32626';
    const title = succeeded ? 'Reserva verificada' : 'No pudimos verificarla';
    send(response, succeeded ? 200 : 400, `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · RestBlu</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#edf5f4;font-family:Arial,sans-serif;color:#173f4b"><main style="width:min(520px,calc(100% - 32px));box-sizing:border-box;background:white;border-radius:24px;padding:36px;box-shadow:0 16px 45px rgba(16,61,80,.16);text-align:center"><div style="font-size:28px;font-weight:800">Rest<span style="color:#0b8e92">Blu</span></div><div style="width:58px;height:58px;margin:28px auto 18px;border-radius:50%;display:grid;place-items:center;background:${succeeded ? '#dcf7ee' : '#fee2e2'};color:${color};font-size:30px;font-weight:800">${succeeded ? '✓' : '!'}</div><h1 style="margin:0;font-size:28px">${title}</h1><p style="margin:12px 0 6px;font-weight:700;color:#0b6871">${escapeHtml(segments[2])}</p><p style="margin:16px 0 0;line-height:1.6;color:#496b74">${escapeHtml(message)}</p></main></body></html>`, {
      'Content-Type': MIME['.html'],
    });
    return true;
  }

  if (
    request.method === 'POST' &&
    segments[1] === 'reservations' &&
    segments[2] &&
    segments[3] === 'webpay-payment'
  ) {
    const input = await readJsonBody(request);
    try {
      const result = await confirmWebpayPayment(segments[2], text(input.webpayToken, 100));
      sendJson(request, response, 200, await publicReservationStatus(result.reservation));
    } catch (error) {
      sendJson(request, response, 409, { error: error instanceof Error ? error.message : 'No fue posible confirmar el pago.' });
    }
    return true;
  }

  if (
    request.method === 'GET' &&
    segments[1] === 'reservations' &&
    segments[2] &&
    segments[3] === 'verification'
  ) {
    const reservation = database.reservations.find((item) => item.id === segments[2]);
    if (!reservation) {
      sendJson(request, response, 404, { error: 'Reserva no encontrada.' });
      return true;
    }
    if (expirePendingReservation(reservation)) await saveDatabase(database);
    if (reservation.status !== 'confirmada' && !reservation.verificationTokenHash) {
      await refreshReservationVerification(database, reservation);
      await saveDatabase(database);
    }
    sendJson(request, response, 200, await publicReservationStatus(reservation));
    return true;
  }

  if (
    request.method === 'GET' &&
    segments[1] === 'reservations' &&
    segments[2] &&
    segments[3] === 'pdf'
  ) {
    const reservation = database.reservations.find((item) => item.id === segments[2]);
    if (!reservation) {
      sendJson(request, response, 404, { error: 'Reserva no encontrada.' });
      return true;
    }
    if (!paidAndConfirmed(reservation)) {
      sendJson(request, response, 409, { error: 'El PDF estará disponible después de verificar el correo y pagar en Webpay.' });
      return true;
    }
    const customer = reservationCustomer(database, reservation);
    if (!customer) throw new Error('No se encontró el cliente de la reserva.');
    const pdf = await reservationPdf(database, reservation, customer);
    send(response, 200, pdf, {
      'Content-Type': MIME['.pdf'],
      'Content-Disposition': `attachment; filename="RestBlu-${reservation.id}.pdf"`,
      ...corsHeaders(request),
    });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/reservations') {
    const input = await readJsonBody(request);
    const account = await verifiedAccountFromToken(bearerToken(request));
    if (!account) {
      sendJson(request, response, 401, {
        error: 'Inicia sesión con tu cuenta RestBlu y verifica tu correo para reservar.',
      });
      return true;
    }
    if (String(input.email || '').trim().toLowerCase() !== account.email) {
      sendJson(request, response, 403, { error: 'La reserva debe usar el correo de tu cuenta.' });
      return true;
    }
    input.ownerUid = account.uid;
    const result = await createReservation(database, input, { verifiedAccountEmail: account.email });
    sendJson(request, response, 201, {
      ...result,
      reservation: reservationWithoutPrivateVerificationToken(result.reservation),
      verification: await publicReservationStatus(result.reservation),
    });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/my/reservations') {
    const account = await verifiedAccountFromToken(bearerToken(request));
    if (!account) {
      sendJson(request, response, 401, { error: 'Inicia sesión con tu cuenta RestBlu para ver tus reservas.' });
      return true;
    }
    const own = database.reservations.filter((reservation) => reservation.ownerUid === account.uid);
    const reservations = [];
    for (const reservation of own) {
      const view = reservationView(database, reservation);
      const verified = paidAndConfirmed(reservation);
      reservations.push({
        ...(await publicReservationStatus(reservation)),
        booking: {
          id: reservation.id,
          propertyId: reservation.propertyId,
          propertyName: view.propertyName,
          propertyPlace: view.propertyPlace,
          guestName: view.guestName,
          email: view.guestEmail,
          phone: view.guestPhone,
          documentId: view.guestDocumentId,
          checkIn: reservation.checkIn,
          checkOut: reservation.checkOut,
          guests: reservation.guests,
          nights: reservation.nights,
          nightlyPrice: reservation.nightlyPrice,
          total: reservation.total,
          createdAt: reservation.createdAt,
          ...(verified ? { accessPin: reservation.accessPin } : {}),
        },
      });
    }
    sendJson(request, response, 200, { reservations });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/backup') {
    send(response, 200, `${JSON.stringify(database, null, 2)}\n`, {
      'Content-Type': MIME['.json'],
      'Content-Disposition': `attachment; filename="restblu-respaldo-${new Date().toISOString().slice(0, 10)}.json"`,
    });
    return true;
  }

  return false;
}

async function serveFromDirectory(response, directory, pathname, defaultFile = '') {
  const rootDirectory = resolve(directory);
  const requested = pathname === '/' && defaultFile
    ? defaultFile
    : pathname.replace(/^[/\\]+/, '');
  const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, '');
  const filePath = resolve(rootDirectory, safePath);
  if (filePath !== rootDirectory && !filePath.startsWith(`${rootDirectory}${sep}`)) return false;
  try {
    const content = await readFile(filePath);
    send(response, 200, content, { 'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    return true;
  } catch {
    return false;
  }
}

await mkdir(DATA_DIR, { recursive: true });
await mkdir(UPLOAD_DIR, { recursive: true });
localDatabase = DATABASE_ENGINE === 'sqlserver'
  ? await createSqlServerDatabase({
    config: sqlServerConfigFromEnv(),
    schemaPath: SQLSERVER_SCHEMA_PATH,
    importFrom: { sqlitePath: DATABASE_PATH, sqliteSchemaPath: SCHEMA_PATH, legacyJsonPath: LEGACY_JSON_PATH },
  })
  : createLocalDatabase({
    databasePath: DATABASE_PATH,
    legacyJsonPath: LEGACY_JSON_PATH,
    schemaPath: SCHEMA_PATH,
  });

let backgroundVerificationRunning = false;
let cloudSyncRunning = false;
let nextCloudSyncAttemptAt = 0;
let publishedCatalogFingerprint = '';
const publishedReservationVersions = new Map();

async function publishCloudReservationStatus(store, database, reservation, ownerUid = '') {
  const customer = reservationCustomer(database, reservation);
  const view = reservationView(database, reservation);
  const verified = paidAndConfirmed(reservation);
  const verificationEmailSentAt = reservation.verificationEmailSentAt || '';
  const verificationEmailError = reservation.verificationEmailError || '';
  const emailPending = !verificationEmailSentAt && !reservation.emailVerifiedAt;
  const confirmationEmailSentAt = verified ? reservation.confirmationEmailSentAt || '' : '';
  const confirmationEmailError = verified ? reservation.confirmationEmailError || '' : '';
  const biometricStatus = verified ? reservation.biometricStatus || 'sin-registrar' : 'bloqueada';
  const biometricEnrolledAt = verified ? reservation.biometricEnrolledAt || '' : '';
  const biometricExpiresAt = verified ? reservation.biometricExpiresAt || '' : '';
  const dahuaStatus = verified ? reservation.dahuaStatus || 'sin-registrar' : 'bloqueado';
  const dahuaQrStatus = verified ? reservation.dahuaQrStatus || 'sin-registrar' : 'bloqueado';
  const cached = publishedReservationVersions.get(reservation.id);
  if (
    cached?.updatedAt === reservation.updatedAt &&
    (!ownerUid || cached.ownerUid === ownerUid)
  ) {
    return;
  }
  const reference = store.collection('reservation_status').doc(reservation.id);
  const current = await reference.get();
  const currentData = current.data() || {};
  const resolvedOwnerUid = ownerUid || currentData.ownerUid || '';
  if (
    current.exists &&
    currentData.localUpdatedAt === reservation.updatedAt &&
    currentData.ownerUid === resolvedOwnerUid &&
    currentData.verificationEmailSentAt === verificationEmailSentAt &&
    currentData.verificationEmailError === verificationEmailError &&
    currentData.emailPending === emailPending &&
    currentData.confirmationEmailSentAt === confirmationEmailSentAt &&
    currentData.confirmationEmailError === confirmationEmailError &&
    currentData.biometricStatus === biometricStatus &&
    currentData.biometricEnrolledAt === biometricEnrolledAt &&
    currentData.biometricExpiresAt === biometricExpiresAt &&
    currentData.dahuaStatus === dahuaStatus &&
    currentData.dahuaQrStatus === dahuaQrStatus &&
    currentData.paymentStatus === (reservation.paymentStatus || 'no-realizado-demo') &&
    currentData.expiresAt === (reservation.expiresAt || '') &&
    currentData.expiredAt === (reservation.expiredAt || '') &&
    currentData.emailVerified === Boolean(reservation.emailVerifiedAt) &&
    currentData.booking?.id === reservation.id &&
    (!verified || currentData.pdfBase64)
  ) {
    publishedReservationVersions.set(reservation.id, {
      updatedAt: reservation.updatedAt,
      ownerUid: resolvedOwnerUid,
    });
    return;
  }
  const status = {
    id: reservation.id,
    status: reservation.status,
    verified,
    emailVerified: Boolean(reservation.emailVerifiedAt),
    verificationEmailSentAt,
    verificationEmailError,
    emailPending,
    confirmationEmailSentAt,
    confirmationEmailError,
    biometricStatus,
    biometricEnrolledAt,
    biometricExpiresAt,
    dahuaStatus,
    dahuaQrStatus,
    dahuaUserId: verified ? reservation.dahuaUserId || dahuaUserId(reservation.id) : '',
    ...publicAccessQr(await accessQrFields(reservation, verified)),
    paymentStatus: reservation.paymentStatus || 'no-realizado-demo',
    paymentReference: reservation.paymentReference || '',
    expiresAt: reservation.expiresAt || '',
    expiredAt: reservation.expiredAt || '',
    localUpdatedAt: reservation.updatedAt || new Date().toISOString(),
    syncedAt: new Date().toISOString(),
    ownerUid: resolvedOwnerUid,
    // Sólo el dueño de la sesión puede leer reservation_status en Firestore.
    // Esta copia permite retomar el pago tras recargar la web sin crear otra reserva.
    booking: {
      id: reservation.id,
      propertyId: reservation.propertyId,
      propertyName: view.propertyName,
      propertyPlace: view.propertyPlace,
      guestName: view.guestName,
      email: view.guestEmail,
      phone: view.guestPhone,
      documentId: view.guestDocumentId,
      checkIn: reservation.checkIn,
      checkOut: reservation.checkOut,
      guests: reservation.guests,
      nights: reservation.nights,
      nightlyPrice: reservation.nightlyPrice,
      total: reservation.total,
      createdAt: reservation.createdAt,
      // El PIN sólo se entrega después de que el pago fue aprobado.
      ...(verified ? { accessPin: reservation.accessPin } : {}),
    },
  };
  if (verified && customer) {
    const pdf = await reservationPdf(database, reservation, customer);
    status.pdfBase64 = pdf.toString('base64');
    status.pdfFileName = `RestBlu-${reservation.id}.pdf`;
  }
  await reference.set(status);
  publishedReservationVersions.set(reservation.id, {
    updatedAt: reservation.updatedAt,
    ownerUid: resolvedOwnerUid,
  });
}

async function processCloudVerificationRequests(store) {
  const requests = await store
    .collection('reservation_verification_requests')
    .where('syncStatus', '==', 'pending')
    .limit(20)
    .get();
  for (const document of requests.docs) {
    const requestData = document.data();
    try {
      const reservationId = text(requestData.reservationId, 80);
      const token = text(requestData.token, 160);
      const database = await readDatabase();
      const reservation = database.reservations.find((item) => item.id === reservationId);
      if (!reservation) continue;
      if (expirePendingReservation(reservation)) await saveDatabase(database);
      if (reservation.status === 'expirada') {
        throw new Error('El plazo para completar esta reserva venció.');
      }
      if (!matchesReservationVerificationToken(reservation, token)) {
        throw new Error('El enlace de verificación no es válido para esta reserva.');
      }
      const customer = reservationCustomer(database, reservation);
      if (!customer) throw new Error('No se encontró el cliente de la reserva.');
      if (reservation.status !== 'confirmada') {
        await finalizeVerifiedReservation(database, reservation, customer);
        await saveDatabase(database);
      }
      await document.ref.set(
        {
          syncStatus: 'processed',
          processedAt: new Date().toISOString(),
        },
        { merge: true },
      );
      await publishCloudReservationStatus(store, database, reservation);
    } catch (error) {
      await document.ref.set(
        {
          syncStatus: 'error',
          syncError: error instanceof Error ? error.message : 'No fue posible verificar la reserva.',
          processedAt: new Date().toISOString(),
        },
        { merge: true },
      );
    }
  }
}

async function sendAccountCodeEmail(email, code) {
  const transport = mailer();
  await transport.sendMail({
    from: mailFrom(),
    to: email,
    subject: `${code} es tu código de verificación RestBlu`,
    text: `Tu código de verificación RestBlu es ${code}.\n\nEscríbelo en la pantalla de registro. Vence en 10 minutos.\nSi no creaste una cuenta en RestBlu, ignora este mensaje.`,
    html: `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#edf5f4;margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;color:#173f4b">
        <tr><td align="center" style="padding:30px 14px">
          <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;background:#ffffff;border-radius:24px;overflow:hidden">
            <tr><td style="background:#103d50;padding:28px 32px">
              <div style="font-size:28px;line-height:1;font-weight:800;color:#ffffff">Rest<span style="color:#55d8cb">Blu</span></div>
              <div style="margin-top:7px;font-size:10px;font-weight:700;letter-spacing:2.2px;color:#b8d9dc">ESTADÍAS INTELIGENTES</div>
            </td></tr>
            <tr><td style="padding:34px 32px 10px">
              <div style="font-size:12px;font-weight:800;letter-spacing:1.4px;color:#0b8e92">VERIFICA TU CORREO</div>
              <h1 style="margin:8px 0 12px;font-size:26px;line-height:1.2;color:#102d3f">Tu código de verificación</h1>
              <p style="margin:0;font-size:15px;line-height:1.6;color:#496b74">Escríbelo en la pantalla de registro de RestBlu para activar tu cuenta.</p>
            </td></tr>
            <tr><td align="center" style="padding:18px 32px 26px">
              <div style="display:inline-block;border-radius:18px;background:#f2fbf9;border:1px solid #cfe9e4;padding:18px 26px;font-size:36px;font-weight:800;letter-spacing:10px;color:#0b6871">${escapeHtml(code)}</div>
              <p style="margin:14px 0 0;font-size:13px;color:#789098">Vence en 10 minutos.</p>
            </td></tr>
            <tr><td style="background:#f4f8f7;padding:20px 32px;border-top:1px solid #e0ecea;font-size:11px;line-height:1.6;color:#789098">Si no creaste una cuenta en RestBlu, puedes ignorar este mensaje.</td></tr>
          </table>
        </td></tr>
      </table>`,
  });
}

// Verificación del correo con un código de 6 dígitos. La web y la app crean
// solicitudes en account_verification_requests (send o verify); el gestor
// envía el código por correo y, si es correcto, marca la cuenta como
// verificada en Firebase. Los hashes viven en account_verification_codes,
// colección que las reglas no dejan leer a nadie.
async function processAccountVerificationRequests(store) {
  const requests = await store.collection('account_verification_requests')
    .where('syncStatus', '==', 'pending').limit(20).get();
  if (requests.empty) return;
  const auth = await firebaseAuth();
  for (const document of requests.docs) {
    const input = document.data();
    const uid = text(input.ownerUid, 128);
    let result = { syncStatus: 'processed' };
    try {
      const user = await auth.getUser(uid);
      if (!user.email) throw new Error('La cuenta no tiene correo.');
      const codeRef = store.collection('account_verification_codes').doc(uid);
      if (user.emailVerified) {
        result.verified = true;
      } else if (input.action === 'send') {
        const current = (await codeRef.get()).data();
        if (current?.sentAt && Date.now() - Date.parse(current.sentAt) < RESEND_INTERVAL_MS) {
          throw new Error('Espera un minuto antes de pedir otro código.');
        }
        const code = newVerificationCode();
        await codeRef.set({
          hash: hashVerificationCode(uid, code),
          expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(),
          attempts: 0,
          sentAt: new Date().toISOString(),
        });
        await sendAccountCodeEmail(user.email, code);
        result.sentTo = user.email.replace(/^(.{2}).*(@.*)$/, '$1•••$2');
      } else if (input.action === 'verify') {
        const record = (await codeRef.get()).data();
        const outcome = checkVerificationCode(record, uid, text(input.code, 6));
        if (outcome !== 'ok') {
          if (outcome === 'invalid' && record) {
            await codeRef.set({ attempts: Number(record.attempts || 0) + 1 }, { merge: true });
          }
          throw new Error({
            missing: 'Pide un código nuevo para verificar tu correo.',
            expired: 'El código venció. Pide uno nuevo.',
            locked: `Superaste los ${MAX_ATTEMPTS} intentos. Pide un código nuevo.`,
            invalid: 'El código no es correcto.',
          }[outcome]);
        }
        await auth.updateUser(uid, { emailVerified: true });
        await codeRef.delete();
        result.verified = true;
      } else {
        throw new Error('Solicitud inválida.');
      }
    } catch (error) {
      result = { syncStatus: 'error', error: error instanceof Error ? error.message : 'No fue posible verificar el correo.' };
    }
    await document.ref.set({ ...result, processedAt: new Date().toISOString() }, { merge: true });
  }
}

async function processCloudPaymentRequests(store) {
  const requests = await store.collection('reservation_payment_requests')
    .where('syncStatus', '==', 'pending').limit(20).get();
  for (const document of requests.docs) {
    const input = document.data();
    try {
      const reservationId = text(input.reservationId, 80);
      const intake = await store.collection('reservation_intake').doc(reservationId).get();
      if (!intake.exists || intake.data()?.ownerUid !== input.ownerUid) {
        throw new Error('La solicitud de pago no pertenece a esta reserva.');
      }
      const result = await confirmWebpayPayment(reservationId, text(input.webpayToken, 100));
      await publishCloudReservationStatus(store, result.database, result.reservation, input.ownerUid);
      await document.ref.set({ syncStatus: 'processed', processedAt: new Date().toISOString() }, { merge: true });
    } catch (error) {
      await document.ref.set({
        syncStatus: 'error',
        error: error instanceof Error ? error.message : 'No fue posible confirmar el pago.',
        processedAt: new Date().toISOString(),
      }, { merge: true });
    }
  }
}

const phoneAccessLastOpened = new Map();
async function authorizedDoorReservation(ownerUid, reservationId) {
  const account = await verifiedAccountFromUid(ownerUid);
  const database = await readDatabase();
  const reservation = database.reservations.find((item) => item.id === reservationId);
  if (!account || !reservation || reservation.ownerUid !== ownerUid || !paidAndConfirmed(reservation)) {
    throw new Error('Esta cuenta no tiene una reserva confirmada para abrir la puerta.');
  }
  if (!phoneAccessWithinStay(reservation)) {
    throw new Error('La apertura con el teléfono funciona desde el check-in hasta el check-out.');
  }
  if (!dahuaConfigured(reservation) || !dahuaQrActive(reservation)) {
    throw new Error('El acceso del terminal aún no está habilitado para esta reserva.');
  }
  return reservation;
}

async function openReservationDoor(reservation) {
  const lastOpened = phoneAccessLastOpened.get(reservation.id) || 0;
  if (Date.now() - lastOpened < 20_000) {
    throw new Error('Espera unos segundos antes de volver a abrir esta puerta.');
  }
  // Se consume antes del CGI: si se pierde la respuesta, no se repite una
  // orden que pudo haber abierto la puerta.
  phoneAccessLastOpened.set(reservation.id, Date.now());
  await reservationDahuaClient(reservation).openDoor({ channel: 1 });
}

async function processCloudPhoneAccessRequests(store) {
  const pending = await store.collection('phone_access_requests')
    .where('syncStatus', '==', 'pending').limit(10).get();
  for (const document of pending.docs) {
    try {
      // La toma es irreversible: un reinicio nunca debe repetir una apertura.
      await document.ref.update({ syncStatus: 'processing', startedAt: new Date().toISOString() },
        { lastUpdateTime: document.updateTime });
    } catch {
      continue;
    }
    const input = document.data();
    try {
      const reservationId = String(input.reservationId || '');
      const ownerUid = String(input.ownerUid || '');
      const signedAt = String(input.signedAt || '');
      const publicKey = String(input.publicKey || '');
      const signature = String(input.signature || '');
      const signedAtMs = Date.parse(signedAt);
      if (!document.createTime || Date.now() - document.createTime.toMillis() > 90_000 ||
          !Number.isFinite(signedAtMs) || Math.abs(Date.now() - signedAtMs) > 90_000) {
        throw new Error('La solicitud de apertura venció. Vuelve a usar la huella.');
      }
      const reservation = await authorizedDoorReservation(ownerUid, reservationId);
      if (!verifyPhoneAccessSignature({ ownerUid, reservationId, requestId: document.id,
        signedAt, publicKey, signature })) {
        throw new Error('El teléfono no pudo acreditar la autorización biométrica.');
      }
      const keyRef = store.collection('phone_access_keys').doc(ownerUid);
      await store.runTransaction(async (transaction) => {
        const saved = await transaction.get(keyRef);
        if (saved.exists && saved.data()?.publicKey !== publicKey) {
          throw new Error('Este teléfono no es el que se vinculó a la cuenta. Usa el QR o solicita restablecer el teléfono.');
        }
        if (!saved.exists) transaction.create(keyRef, {
          publicKey, ownerUid, registeredAt: new Date().toISOString(),
        });
      });
      await openReservationDoor(reservation);
      await document.ref.update({ syncStatus: 'processed', openedAt: new Date().toISOString() });
      console.log(`[Dahua] Apertura desde teléfono autorizada para ${reservationId}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No fue posible abrir la puerta.';
      await document.ref.update({ syncStatus: 'error', error: text(message, 300),
        processedAt: new Date().toISOString() });
      console.warn(`[Dahua] Apertura desde teléfono rechazada: ${message}`);
    }
  }
}

async function processCloudTapAccessRequests(store) {
  const pending = await store.collection('tap_access_requests')
    .where('syncStatus', '==', 'pending').limit(10).get();
  for (const document of pending.docs) {
    try {
      // Una solicitud tomada nunca se reenvía tras reiniciar el gestor.
      await document.ref.update({ syncStatus: 'processing', startedAt: new Date().toISOString() },
        { lastUpdateTime: document.updateTime });
    } catch {
      continue;
    }
    const input = document.data();
    try {
      const reservationId = String(input.reservationId || '');
      const ownerUid = String(input.ownerUid || '');
      if (!document.createTime || Date.now() - document.createTime.toMillis() > 90_000) {
        throw new Error('La solicitud de apertura venció. Vuelve a pulsar el botón.');
      }
      const reservation = await authorizedDoorReservation(ownerUid, reservationId);
      await openReservationDoor(reservation);
      await document.ref.update({ syncStatus: 'processed', openedAt: new Date().toISOString() });
      console.log(`[Dahua] Apertura directa autorizada para ${reservationId}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No fue posible abrir la puerta.';
      await document.ref.update({ syncStatus: 'error', error: text(message, 300),
        processedAt: new Date().toISOString() });
      console.warn(`[Dahua] Apertura directa rechazada: ${message}`);
    }
  }
}

let tapAccessListener = null;
async function startTapAccessListener() {
  if (tapAccessListener || !existsSync(FIREBASE_SERVICE_ACCOUNT_PATH)) return;
  const store = await firebaseStore();
  tapAccessListener = store.collection('tap_access_requests').where('syncStatus', '==', 'pending')
    .onSnapshot((snapshot) => {
      if (!snapshot.empty) void runBackgroundJob('Apertura directa', () => processCloudTapAccessRequests(store));
    }, (error) => {
      console.warn('[Firebase] Listener de apertura detenido; se reintenta en 1 minuto:', error.message);
      tapAccessListener = null;
      setTimeout(() => void startTapAccessListener().catch(() => {}), 60_000).unref();
    });
}

let publishedBiometricTransportKeyId = '';
async function publishBiometricTransportKey(store) {
  const identity = await getBiometricTransportIdentity();
  if (publishedBiometricTransportKeyId === identity.keyId) return;
  const reference = store.collection('public_biometric_config').doc('current');
  const current = await reference.get();
  if (current.data()?.keyId !== identity.keyId) {
    await reference.set({
      keyId: identity.keyId,
      publicKey: identity.publicKey,
      updatedAt: new Date().toISOString(),
    });
  }
  publishedBiometricTransportKeyId = identity.keyId;
}

// Solicitudes a Blu desde la web y la app. Se toman al instante con un
// listener de Firestore (y, por si acaso, en cada ciclo de sincronización).
// La respuesta se publica a medida que se escribe (partialAnswer).
const aiRequestsInFlight = new Set();
let aiProcessingChain = Promise.resolve();

function processCloudAiRequests(store) {
  aiProcessingChain = aiProcessingChain.then(() => processPendingAiRequests(store)).catch((error) => {
    console.error('[Firebase] IA pública:', error instanceof Error ? error.message : error);
  });
  return aiProcessingChain;
}

async function processPendingAiRequests(store) {
  const pending = await store.collection('public_ai_requests')
    .where('syncStatus', '==', 'pending').limit(5).get();
  if (pending.empty) return;
  const database = await readDatabase();
  for (const document of pending.docs) {
    if (aiRequestsInFlight.has(document.id)) continue;
    aiRequestsInFlight.add(document.id);
    try {
      // Reclama la solicitud: si otro proceso la tomó antes, falla y se omite.
      await document.ref.update({ syncStatus: 'processing', startedAt: new Date().toISOString() },
        { lastUpdateTime: document.updateTime });
    } catch {
      aiRequestsInFlight.delete(document.id);
      continue;
    }
    const input = document.data();
    let lastWrite = 0;
    let pendingWrite = Promise.resolve();
    try {
      if (typeof input.ownerUid !== 'string' || !input.ownerUid ||
          typeof input.question !== 'string' || input.question.length > 1_500) {
        throw new Error('La pregunta no es válida.');
      }
      const result = await askPublicAi(database, text(input.question, 1_500), input.history, input.search, {
        ownerUid: input.ownerUid,
        onDelta: (partial) => {
          if (Date.now() - lastWrite < 700) return;
          lastWrite = Date.now();
          pendingWrite = pendingWrite.then(() => document.ref.update({ partialAnswer: partial })).catch(() => {});
        },
      });
      await pendingWrite;
      await document.ref.set({
        syncStatus: 'processed',
        answer: result.answer,
        partialAnswer: result.answer,
        suggestions: result.suggestions,
        elapsedMs: result.elapsedMs,
        processedAt: new Date().toISOString(),
      }, { merge: true });
    } catch (error) {
      console.error('[Firebase] IA pública:', error instanceof Error ? error.message : error);
      await pendingWrite;
      await document.ref.set({
        syncStatus: 'error',
        error: 'El servidor de IA no respondió. Comprueba que esté encendido y vuelve a intentar.',
        processedAt: new Date().toISOString(),
      }, { merge: true });
    } finally {
      aiRequestsInFlight.delete(document.id);
    }
  }
}

let aiRequestsListener = null;
async function startAiRequestsListener() {
  if (aiRequestsListener || !existsSync(FIREBASE_SERVICE_ACCOUNT_PATH)) return;
  const store = await firebaseStore();
  aiRequestsListener = store.collection('public_ai_requests').where('syncStatus', '==', 'pending')
    .onSnapshot((snapshot) => {
      if (!snapshot.empty) void processCloudAiRequests(store);
    }, (error) => {
      console.warn('[Firebase] Listener de la IA detenido; se reintenta en 1 minuto:', error.message);
      aiRequestsListener = null;
      setTimeout(() => void startAiRequestsListener().catch(() => {}), 60_000).unref();
    });
}

// Valoraciones 👍 / 👎 que los usuarios dejan en las respuestas de Blu.
async function syncAiFeedback() {
  if (!existsSync(FIREBASE_SERVICE_ACCOUNT_PATH)) return;
  const store = await firebaseStore();
  const rated = await store.collection('public_ai_requests').where('feedbackPending', '==', true).limit(50).get();
  for (const document of rated.docs) {
    const item = document.data();
    if (item.feedback === 'up' || item.feedback === 'down') {
      await localDatabase.saveAiFeedback({
        requestId: document.id,
        channel: 'blu',
        question: text(item.question, 1_500),
        answer: text(item.answer, 6_000),
        rating: item.feedback,
        ownerUid: text(item.ownerUid, 128),
        createdAt: text(item.feedbackAt, 40) || new Date().toISOString(),
      });
    }
    await document.ref.update({ feedbackPending: false });
  }
}

function consumeCloudLookupQuota(ownerUid) {
  const now = Date.now();
  const current = cloudLookupBuckets.get(ownerUid);
  const bucket = current && current.resetAt > now
    ? current
    : { count: 0, resetAt: now + 10 * 60_000 };
  bucket.count += 1;
  cloudLookupBuckets.set(ownerUid, bucket);
  if (bucket.count > 8) throw new Error('Demasiadas consultas. Espera diez minutos.');
}

async function processCloudReservationLookupRequests(store, database) {
  const pending = await store.collection('public_reservation_lookup_requests')
    .where('syncStatus', '==', 'pending').limit(10).get();
  for (const document of pending.docs) {
    const input = document.data();
    try {
      const ownerUid = text(input.ownerUid, 128);
      const createdAt = Date.parse(input.createdAt);
      if (!ownerUid || !Number.isFinite(createdAt) ||
          Math.abs(Date.now() - createdAt) > 10 * 60_000) {
        throw new Error('La consulta venció. Vuelve a intentarlo.');
      }
      consumeCloudLookupQuota(ownerUid);
      await sendReservationLookupEmail(database, input.documentId);
      await document.ref.update({
        syncStatus: 'processed',
        documentId: FieldValue.delete(),
        processedAt: new Date().toISOString(),
      });
    } catch (error) {
      await document.ref.update({
        syncStatus: 'error',
        // El proveedor SMTP puede incluir la dirección del destinatario en su error.
        // Nunca publicarla en un documento que puede leer quien sólo conoce el RUT.
        error: 'No fue posible enviar la consulta en este momento. Inténtalo más tarde.',
        documentId: FieldValue.delete(),
        processedAt: new Date().toISOString(),
      });
    }
  }
}

async function processCloudBiometricRequests(store) {
  const identity = await getBiometricTransportIdentity();
  const pending = await store.collection('public_biometric_requests')
    .where('syncStatus', '==', 'pending').limit(5).get();
  for (const document of pending.docs) {
    const input = document.data();
    let status = 'error';
    let errorMessage = '';
    let enrolledAt = '';
    let expiresAt = '';
    let dahuaStatus = '';
    try {
      const database = await readDatabase();
      const reservationId = text(input.reservationId, 80);
      const intake = await store.collection('reservation_intake').doc(reservationId).get();
      if (!intake.exists || !input.ownerUid || intake.data()?.ownerUid !== input.ownerUid) {
        throw new Error('La reserva no pertenece a esta sesión.');
      }
      const reservation = database.reservations.find((item) => item.id === reservationId);
      const customer = reservation && reservationCustomer(database, reservation);
      if (!reservation || !customer || !paidAndConfirmed(reservation)) {
        throw new Error('La reserva todavía no está confirmada.');
      }
      if (dahuaEnrollmentActive(reservation)) {
        throw new Error('Esta reserva ya tiene un registro Dahua; revisa su estado en el gestor.');
      }
      if (!validRut(input.documentId) ||
          formatRut(input.documentId) !== formatRut(customer.documentId) || input.consent !== true) {
        throw new Error('El RUT o el consentimiento no corresponden a la reserva.');
      }
      if (input.dahuaConsent !== true) {
        throw new Error('Actualiza la aplicación y autoriza el registro facial en Dahua.');
      }
      if (!dahuaConfigured(reservation)) {
        throw new Error('La integración Dahua no está configurada en el gestor.');
      }
      if (dahuaEnrollmentsInProgress.has(reservation.id)) {
        throw new Error('Ya hay un registro facial en curso para esta reserva.');
      }
      const image = decryptCloudBiometricImage(input, identity);
      dahuaEnrollmentsInProgress.add(reservation.id);
      let enrolled;
      try {
        enrolled = await enrollReservationDirectlyOnDahua(reservation, customer, image);
        await saveDatabase(database);
      } finally {
        dahuaEnrollmentsInProgress.delete(reservation.id);
      }
      enrolledAt = reservation.biometricEnrolledAt || '';
      expiresAt = reservation.biometricExpiresAt || '';
      dahuaStatus = reservation.dahuaStatus;
      status = enrolled ? 'processed' : 'error';
      if (!enrolled) errorMessage = reservation.biometricLastError;
      try {
        await publishCloudReservationStatus(store, database, reservation, input.ownerUid);
      } catch (publishError) {
        console.warn('[Firebase] La publicación del estado Dahua se reintentará:',
          publishError instanceof Error ? publishError.message : publishError);
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'No fue posible registrar la biometría.';
      console.error('[Firebase] Biometría:', errorMessage);
    }
    // Eliminar siempre la foto y la clave envuelta, incluso si la comparación falla.
    await document.ref.update({
      syncStatus: status,
      status: status === 'processed' ? 'activa' : 'error',
      error: status === 'error' ? errorMessage : '',
      enrolledAt,
      expiresAt,
      dahuaStatus: status === 'processed' ? dahuaStatus : '',
      encryptedImage: FieldValue.delete(),
      encryptedKey: FieldValue.delete(),
      iv: FieldValue.delete(),
      documentId: FieldValue.delete(),
      processedAt: new Date().toISOString(),
    });
  }
}

async function syncCloudBridge() {
  if (
    cloudSyncRunning ||
    Date.now() < nextCloudSyncAttemptAt ||
    !existsSync(FIREBASE_SERVICE_ACCOUNT_PATH)
  ) return;
  cloudSyncRunning = true;
  try {
    const store = await firebaseStore();
    let database = await readDatabase();

    await publishBiometricTransportKey(store);
    await processCloudBiometricRequests(store);
    await processCloudPhoneAccessRequests(store);
    await processCloudTapAccessRequests(store);
    database = await readDatabase();
    await processCloudAiRequests(store);
    await processCloudReservationLookupRequests(store, database);

    const intake = await store
      .collection('reservation_intake')
      .where('syncStatus', '==', 'pending')
      .limit(20)
      .get();
    for (const document of intake.docs) {
      let reservationCreated = false;
      try {
        const intakeData = document.data();
        const account = await verifiedAccountFromUid(text(intakeData.ownerUid, 128));
        if (!account || String(intakeData.email || '').trim().toLowerCase() !== account.email) {
          throw new Error('La reserva debe hacerse con una cuenta RestBlu con el correo verificado.');
        }
        const result = await createReservation(database, intakeData, { verifiedAccountEmail: account.email });
        reservationCreated = true;
        database = await readDatabase();
        await publishCloudReservationStatus(
          store,
          database,
          result.reservation,
          text(document.data().ownerUid, 128),
        );
        await document.ref.set(
          {
            syncStatus: 'processed',
            emailPending: !result.reservation.verificationEmailSentAt && !result.reservation.emailVerifiedAt,
            verificationEmailError: result.reservation.verificationEmailError || '',
            processedAt: new Date().toISOString(),
          },
          { merge: true },
        );
        if (result.duplicated) {
          console.log(`[Firebase] Reserva ${document.id} ya existía en SQLite; estado actualizado.`);
        } else if (result.reservation.emailVerifiedAt) {
          console.log(`[Firebase] Reserva ${document.id} importada; correo ya verificado en esta sesión.`);
        } else if (result.reservation.verificationEmailSentAt) {
          console.log(`[Firebase] Reserva ${document.id} importada en SQLite; correo de verificación enviado.`);
        } else {
          console.warn(
            `[Firebase] Reserva ${document.id} importada en SQLite; correo pendiente de reintento: ${result.reservation.verificationEmailError || 'transporte no disponible'}`,
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No fue posible sincronizar la reserva.';
        if (reservationCreated) {
          // Ya se guardó (y quizá se envió el correo): conservar la solicitud pendiente
          // permite reintentar la publicación del estado sin duplicar la reserva.
          console.error(`[Firebase] Estado de ${document.id} pendiente de publicación: ${message}`);
        } else {
          await document.ref.set(
            {
              syncStatus: 'error',
              syncError: message,
              processedAt: new Date().toISOString(),
            },
            { merge: true },
          );
          await store.collection('reservation_status').doc(document.id).set({
            id: document.id,
            ownerUid: text(document.data().ownerUid, 128),
            status: 'error',
            verified: false,
            error: message,
            syncedAt: new Date().toISOString(),
          });
          console.error(`[Firebase] Reserva ${document.id} rechazada: ${message}`);
        }
      }
      database = await readDatabase();
    }

    await processCloudVerificationRequests(store);
    await processCloudPaymentRequests(store);
    database = await readDatabase();

    for (const reservation of database.reservations.slice(0, 100)) {
      await publishCloudReservationStatus(store, database, reservation);
    }

    const propertyCollection = store.collection('public_properties');
    const publishedProperties = new Map(
      database.properties
        .filter((property) => property.active !== false)
        .map((property) => [
          String(property.id),
          publicProperty(property, unavailableRangesForProperty(database, property.id)),
        ]),
    );
    const catalogFingerprint = JSON.stringify([...publishedProperties]);
    if (catalogFingerprint !== publishedCatalogFingerprint) {
      const cloudProperties = await propertyCollection.get();
      const cloudById = new Map(cloudProperties.docs.map((document) => [document.id, document]));
      const propertyBatch = store.batch();
      let changes = 0;
      for (const [id, property] of publishedProperties) {
        const cloudDocument = cloudById.get(id);
        if (cloudDocument && JSON.stringify(cloudDocument.data()) === JSON.stringify(property)) {
          continue;
        }
        propertyBatch.set(propertyCollection.doc(id), property);
        changes += 1;
      }
      for (const document of cloudProperties.docs) {
        if (publishedProperties.has(document.id)) continue;
        propertyBatch.delete(document.ref);
        changes += 1;
      }
      if (changes) await propertyBatch.commit();
      publishedCatalogFingerprint = catalogFingerprint;
    }
  } catch (error) {
    if (
      error?.code === 8 ||
      error?.code === 429 ||
      /RESOURCE_EXHAUSTED|Quota exceeded|rateLimitExceeded/i.test(String(error?.message || ''))
    ) {
      nextCloudSyncAttemptAt = Date.now() + 15 * 60_000;
    }
    console.error(
      'Sincronización Firestore:',
      error instanceof Error ? error.message : error,
    );
  } finally {
    cloudSyncRunning = false;
  }
}

async function checkPendingReservations() {
  if (
    backgroundVerificationRunning ||
    !process.env.SMTP_HOST ||
    !process.env.SMTP_USER ||
    !process.env.SMTP_PASS
  ) {
    return;
  }
  backgroundVerificationRunning = true;
  try {
    const database = await readDatabase();
    const pending = database.reservations.filter(
      (reservation) =>
        (!reservation.verificationEmailSentAt &&
          reservation.status === 'pendiente-verificacion') ||
        (paidAndConfirmed(reservation) && !reservation.confirmationEmailSentAt),
    );
    if (!pending.length) return;
    for (const reservation of pending.slice(0, 20)) {
      try {
        if (reservation.status === 'confirmada') {
          const customer = reservationCustomer(database, reservation);
          if (!customer) throw new Error('No se encontró el cliente de la reserva.');
          await finalizeVerifiedReservation(database, reservation, customer);
          await saveDatabase(database);
        } else {
          const previousError = reservation.verificationEmailError || '';
          const sent = await deliverPendingVerificationEmail(database, reservation);
          if (sent) {
            console.log(`[Correo] Verificación de ${reservation.id} enviada por el worker.`);
          } else if (reservation.verificationEmailError !== previousError) {
            console.warn(
              `[Correo] Verificación de ${reservation.id} pendiente: ${reservation.verificationEmailError}`,
            );
          }
        }
      } catch (error) {
        // Con un conflicto, la copia leída ya no es válida: se corta el ciclo
        // y se vuelve a leer la base en el siguiente.
        if (/^Conflicto de /.test(error instanceof Error ? error.message : '')) throw error;
        if (reservation.status === 'confirmada') {
          reservation.confirmationEmailError =
            error instanceof Error ? error.message : 'No fue posible enviar el comprobante.';
        } else {
          reservation.verificationEmailError =
            error instanceof Error ? error.message : 'No fue posible enviar la verificación.';
        }
        reservation.updatedAt = new Date().toISOString();
        await saveDatabase(database);
      }
    }
  } finally {
    backgroundVerificationRunning = false;
  }
}

let customerProfilesSyncedUntil = '';

// Copia a la ficha del cliente los cambios que hace en su perfil (Firestore
// customer_profiles/{uid}). Como las reservas enlazan a la ficha, el nombre
// nuevo aparece en todas: comprobante, PDF, panel del gestor y terminal Dahua.
async function syncCustomerProfiles() {
  if (!existsSync(FIREBASE_SERVICE_ACCOUNT_PATH)) return;
  const store = await firebaseStore();
  let query = store.collection('customer_profiles');
  if (customerProfilesSyncedUntil) query = query.where('updatedAt', '>', customerProfilesSyncedUntil);
  const snapshot = await query.limit(200).get();
  if (snapshot.empty) return;
  const database = await readDatabase();
  const renamed = [];
  let newest = customerProfilesSyncedUntil;
  let changed = false;
  for (const document of snapshot.docs) {
    const profile = document.data();
    if (String(profile.updatedAt || '') > newest) newest = String(profile.updatedAt);
    const customer = database.customers.find((item) => item.ownerUid === document.id);
    if (!customer) continue;
    const name = text(profile.name, 120);
    const phone = text(profile.phone, 60);
    const documentId = formatRut(text(profile.documentId, 20));
    let customerChanged = false;
    if (name.length >= 2 && name !== customer.name) {
      customer.name = name;
      renamed.push(customer);
      customerChanged = true;
    }
    if (phone && phone !== customer.phone) {
      customer.phone = phone;
      customerChanged = true;
    }
    // Datos adicionales del perfil: se copian tal cual a la ficha.
    for (const [field, max] of [['birthDate', 20], ['nationality', 80], ['emergencyContactName', 120], ['emergencyContactPhone', 60]]) {
      if (!(field in profile)) continue;
      const value = text(profile[field], max);
      if (value !== (customer[field] || '')) {
        customer[field] = value;
        customerChanged = true;
      }
    }
    // El RUT sólo cambia si es válido, no pertenece a otra ficha y la persona
    // aún no tiene reservas confirmadas.
    if (documentId && documentId !== customer.documentId && validRut(documentId) &&
        !customerRutLocked(database, customer) &&
        !database.customers.some((item) => item.id !== customer.id && item.documentId === documentId)) {
      customer.documentId = documentId;
      customerChanged = true;
    }
    if (!customerChanged) continue;
    changed = true;
    customer.updatedAt = new Date().toISOString();
    // Republicar sus reservas para que el estado en la nube y el PDF usen los
    // datos nuevos.
    for (const reservation of database.reservations) {
      if (reservation.customerId !== customer.id) continue;
      reservation.updatedAt = customer.updatedAt;
      publishedReservationVersions.delete(reservation.id);
    }
  }
  if (changed) await saveDatabase(database);
  customerProfilesSyncedUntil = newest;
  for (const customer of renamed) await renameCustomerOnDahua(database, customer);
}

// Lleva el nombre actual del cliente a sus personas vigentes en el Dahua.
async function renameCustomerOnDahua(database, customer) {
  if (!dahuaConfigured()) return;
  for (const reservation of database.reservations) {
    if (reservation.customerId !== customer.id || !dahuaPersonActive(reservation) ||
        !paidAndConfirmed(reservation) || !(reservationAccessEnd(reservation) > Date.now())) continue;
    try {
      await reservationDahuaClient(reservation).updatePersonValidity(
        dahuaQrInput({ reservation, customer: reservationCustomer(database, reservation) }),
      );
      console.log(`[Dahua] Nombre actualizado en el terminal para ${reservation.id}.`);
    } catch (error) {
      console.warn(`[Dahua] No se pudo actualizar el nombre de ${reservation.id}:`,
        error instanceof Error ? error.message : error);
    }
  }
}

// Personas de reservas borradas de la base que siguen en el Dahua (por ejemplo,
// si el equipo no respondía durante una limpieza). Se eliminan apenas el
// terminal responde, y el archivo desaparece cuando ya no queda ninguna.
const DAHUA_PENDING_REMOVALS_PATH = join(DATA_DIR, 'dahua-pendientes-de-borrar.json');
async function removePendingDahuaPersons() {
  if (!dahuaConfigured() || !existsSync(DAHUA_PENDING_REMOVALS_PATH)) return;
  const pending = JSON.parse(await readFile(DAHUA_PENDING_REMOVALS_PATH, 'utf8'));
  const remaining = [];
  for (const person of pending) {
    try {
      // Las anotadas antes del hub estaban en el terminal de la red local.
      await revokeReservationFace(dahuaClientForTerminal(person.terminal || 'lan'), person);
      console.log(`[Dahua] Persona de ${person.codigo || person.userId} eliminada del terminal.`);
    } catch (error) {
      remaining.push(person);
      if (remaining.length === 1) throw Object.assign(error, { pendingRemaining: true });
    }
  }
  if (remaining.length) await writeFile(DAHUA_PENDING_REMOVALS_PATH, JSON.stringify(remaining, null, 2));
  else await rm(DAHUA_PENDING_REMOVALS_PATH, { force: true });
}

// Estado de la copia del registro de accesos, por terminal ('lan' o el
// Registration ID de un terminal del hub).
const accessEventsSyncStatus = new Map();

// Terminales de los que se copia el registro: el de la red local y los que
// están conectados al hub en este momento.
async function accessEventTerminals() {
  const terminals = [];
  if (lanDahuaConfigured()) terminals.push('lan');
  if (hubDahuaConfigured()) {
    try {
      const status = await hubStatus({ hubUrl: DAHUA_HUB_URL, apiKey: DAHUA_HUB_API_KEY });
      accessEventsSyncStatus.delete('hub');
      terminals.push(...status.online);
    } catch (error) {
      accessEventsSyncStatus.set('hub', { lastSyncAt: null, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return terminals;
}

// Alojamiento de un terminal del hub, si está asignado a uno solo. Así un
// rechazo o el botón de salida, que no traen reserva, quedan en su vivienda.
function terminalPropertyId(database, terminal) {
  if (terminal === 'lan') return null;
  const owners = database.properties.filter((property) =>
    String(property.dahuaRegistrationId || '').toUpperCase() === terminal.toUpperCase());
  return owners.length === 1 ? owners[0].id : null;
}

async function syncTerminalAccessEvents(terminal, database, byUserId) {
  const last = await localDatabase.lastAccessEventAt(terminal);
  const since = await localDatabase.accessEventsSince();
  // Se relee un margen de 10 minutos: los registros repetidos se descartan.
  // Tras una limpieza no se vuelve a traer lo anterior a ella.
  let startMs = last ? Date.parse(last) - 10 * 60_000 : Date.now() - 30 * 86_400_000;
  if (since && Date.parse(since) > startMs) startMs = Date.parse(since);
  const records = await dahuaClientForTerminal(terminal).listAccessRecords({
    startTime: Math.floor(startMs / 1000),
    endTime: Math.floor(Date.now() / 1000) + 3600,
    count: 1000,
  });
  const terminalProperty = terminalPropertyId(database, terminal);
  const events = records.map((record) => {
    const reservation = byUserId.get(record.userId);
    const customer = reservation && reservationCustomer(database, reservation);
    return {
      recNo: record.recNo,
      occurredAt: new Date(record.createTime * 1000).toISOString(),
      type: record.type,
      method: record.method,
      authorized: record.authorized,
      errorCode: record.errorCode,
      userId: record.userId,
      person: reservation ? (customer?.name || reservation.guestName || '') : record.cardName,
      reservationId: reservation?.id || null,
      propertyId: reservation?.propertyId ?? terminalProperty,
      terminal,
    };
  });
  return localDatabase.saveAccessEvents(events);
}

// Copia de cada Dahua su registro de movimientos y lo asocia a la estadía y a
// la vivienda por el UserID de cada reserva (o por el terminal). El historial
// queda en la base aunque la persona se elimine del terminal al terminar la
// estadía. Un terminal que no responde no detiene la copia de los demás.
async function syncDahuaAccessEvents() {
  const terminals = await accessEventTerminals();
  if (!terminals.length) return;
  const database = await readDatabase();
  const byUserId = new Map(database.reservations
    .filter((reservation) => reservation.dahuaUserId)
    .map((reservation) => [reservation.dahuaUserId, reservation]));
  const failures = [];
  for (const terminal of terminals) {
    const previous = accessEventsSyncStatus.get(terminal);
    try {
      const inserted = await syncTerminalAccessEvents(terminal, database, byUserId);
      accessEventsSyncStatus.set(terminal, { lastSyncAt: new Date().toISOString(), error: '' });
      if (inserted) {
        console.log(`[Dahua] ${inserted} movimiento(s) nuevo(s) de ${terminal === 'lan' ? 'la red local' : terminal}.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      accessEventsSyncStatus.set(terminal, { lastSyncAt: previous?.lastSyncAt || null, error: message });
      failures.push(`${terminal}: ${message}`);
    }
  }
  if (failures.length === terminals.length) throw new Error(failures.join(' · '));
}

function reservationAccessEnd(reservation) {
  return Date.parse(`${reservation.checkOut}T${reservation.checkOutTime || '11:00'}:00`);
}

const DAHUA_QR_RETRY_MS = 2 * 60_000;
const dahuaQrLastAttempt = new Map();
const dahuaPinSynced = new Set();

// Registra en el Dahua el QR de cada reserva confirmada y vigente. Si el
// terminal no respondía, se reintenta en ciclos siguientes.
async function syncDahuaQrAccess() {
  if (!dahuaConfigured()) return;
  const database = await readDatabase();
  for (const reservation of database.reservations) {
    if (!paidAndConfirmed(reservation) || dahuaEnrollmentsInProgress.has(reservation.id)) continue;
    if (!(reservationAccessEnd(reservation) > Date.now())) continue;
    const lastAttempt = dahuaQrLastAttempt.get(reservation.id) || 0;
    if (dahuaQrActive(reservation)) {
      if (dahuaPinSynced.has(reservation.id) || Date.now() - lastAttempt < DAHUA_QR_RETRY_MS) continue;
      const customer = reservationCustomer(database, reservation);
      if (!customer) continue;
      dahuaQrLastAttempt.set(reservation.id, Date.now());
      try {
        if (await confirmDahuaPersonOnDevice(reservation)) {
          await reservationDahuaClient(reservation).updatePersonValidity(dahuaQrInput({ reservation, customer }));
          dahuaPinSynced.add(reservation.id);
          console.log(`[Dahua] PIN de ${reservation.id} actualizado en el terminal.`);
          continue;
        }
        await saveDatabase(database);
        console.warn(`[Dahua] Persona de ${reservation.id} ausente; se volverá a registrar su acceso.`);
      } catch (error) {
        console.warn(`[Dahua] No se pudo actualizar el PIN de ${reservation.id}:`,
          error instanceof Error ? error.message : error);
        continue;
      }
    }
    if (reservation.dahuaQrStatus === 'error' && Date.now() - lastAttempt < DAHUA_QR_RETRY_MS) continue;
    const customer = reservationCustomer(database, reservation);
    if (!customer) continue;
    dahuaQrLastAttempt.set(reservation.id, Date.now());
    dahuaEnrollmentsInProgress.add(reservation.id);
    try {
      const registered = await syncReservationQrToDahua(reservation, customer);
      await saveDatabase(database);
      if (registered) {
        console.log(`[Dahua] QR de ${reservation.id} habilitado en el terminal.`);
        dahuaPinSynced.add(reservation.id);
        publishedReservationVersions.delete(reservation.id);
      } else {
        console.warn(`[Dahua] QR de ${reservation.id} pendiente: ${reservation.dahuaQrError}`);
      }
    } finally {
      dahuaEnrollmentsInProgress.delete(reservation.id);
    }
  }
}

// Informa al hub qué terminal atiende cada alojamiento, sólo cuando cambia.
let pushedTerminalsFingerprint = '';
async function syncHubPropertyTerminals() {
  if (!hubDahuaConfigured()) return;
  const database = await readDatabase();
  const properties = database.properties.map(({ id, name, dahuaRegistrationId }) => ({
    id, name, dahuaRegistrationId: dahuaRegistrationId || '',
  }));
  const fingerprint = JSON.stringify(properties);
  if (fingerprint === pushedTerminalsFingerprint) return;
  await pushPropertyTerminals({ hubUrl: DAHUA_HUB_URL, apiKey: DAHUA_HUB_API_KEY, properties });
  pushedTerminalsFingerprint = fingerprint;
  console.log(`[Dahua] Asignación de terminales enviada al hub (${properties.filter((item) => item.dahuaRegistrationId).length} alojamiento(s) con terminal propio).`);
}

let biometricExpiryRunning = false;
async function expireBiometricTemplates() {
  if (biometricExpiryRunning) return;
  biometricExpiryRunning = true;
  try {
  const database = await readDatabase();
  await expirePendingReservations(database);
  const now = new Date();
  let changed = false;
  for (const reservation of database.reservations) {
    if (
      reservation.biometricStatus !== 'activa' ||
      !reservation.biometricExpiresAt ||
      Number.isNaN(new Date(reservation.biometricExpiresAt).getTime()) ||
      new Date(reservation.biometricExpiresAt) > now
    ) continue;
    reservation.biometricTemplateEncrypted = '';
    reservation.biometricProfileId = '';
    reservation.biometricStatus = 'expirada';
    reservation.biometricRevokedAt = now.toISOString();
    reservation.updatedAt = reservation.biometricRevokedAt;
    changed = true;
  }
  if (changed) await saveDatabase(database);
  for (const reservation of database.reservations) {
    if (!reservation.dahuaUserId || reservation.dahuaStatus === 'revocado' ||
        dahuaEnrollmentsInProgress.has(reservation.id)) continue;
    // Mientras la reserva confirmada esté vigente, la persona sigue en el
    // terminal con su QR (y su rostro, si lo registró).
    const end = reservationAccessEnd(reservation);
    if (paidAndConfirmed(reservation) && Number.isFinite(end) && end > Date.now()) continue;
    if (!dahuaConfigured(reservation)) {
      if (reservation.dahuaStatus !== 'revocacion-pendiente') {
        reservation.dahuaStatus = 'revocacion-pendiente';
        reservation.dahuaError = 'El gestor necesita la cuenta CGI para revocar el acceso.';
        reservation.updatedAt = new Date().toISOString();
        await saveDatabase(database);
      }
      continue;
    }
    try {
      await revokeReservationFace(reservationDahuaClient(reservation), {
        userId: reservation.dahuaUserId, recNo: reservation.dahuaRecNo,
        cardNo: reservation.dahuaQrCode,
      });
      reservation.dahuaStatus = 'revocado';
      reservation.dahuaError = '';
      if (reservation.dahuaQrStatus !== 'sin-registrar') reservation.dahuaQrStatus = 'revocado';
      reservation.dahuaRevokedAt = new Date().toISOString();
    } catch (error) {
      reservation.dahuaStatus = 'revocacion-pendiente';
      reservation.dahuaError = text(
        error instanceof Error ? error.message : 'No fue posible revocar el acceso Dahua.', 500,
      );
    }
    reservation.updatedAt = new Date().toISOString();
    await saveDatabase(database);
  }
  } finally {
    biometricExpiryRunning = false;
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || `${HOST}:${PORT}`}`);
    if (url.pathname.startsWith('/api/')) {
      if (!(await handleApi(request, response, url))) {
        sendJson(request, response, 404, { error: 'Ruta no encontrada.' });
      }
      return;
    }
    if (url.pathname.startsWith('/uploads/')) {
      const uploadPath = decodeURIComponent(url.pathname.slice('/uploads/'.length));
      if (!(await serveFromDirectory(response, UPLOAD_DIR, uploadPath))) {
        send(response, 404, 'Imagen no encontrada', { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      return;
    }
    if (!(await serveFromDirectory(response, PUBLIC_DIR, url.pathname, 'index.html'))) {
      send(response, 404, 'No encontrado', { 'Content-Type': 'text/plain; charset=utf-8' });
    }
  } catch (error) {
    sendJson(request, response, 400, { error: publicRequestErrorMessage(error) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Gestor local RestBlu: http://${HOST}:${PORT}`);
  console.log(`Base ${localDatabase.engine}: ${localDatabase.path}`);
  console.log(`Configuración privada: ${PRIVATE_CONFIG_PATH}`);
  console.log(`Firebase: ${existsSync(FIREBASE_SERVICE_ACCOUNT_PATH) ? 'configurado' : 'pendiente'}`);
  console.log(
    `Correo: ${process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS ? 'configurado' : 'pendiente'}`,
  );
});

// Las tareas de fondo leen la base completa y la guardan después; si corren a
// la vez, la segunda detecta un conflicto al guardar. Se ejecutan en fila y un
// error nunca debe detener el gestor: se registra y se reintenta en el
// siguiente ciclo.
let backgroundJobQueue = Promise.resolve();
// Último error de cada tarea: un mismo fallo repetido (p. ej. el Dahua sin
// red) se informa una vez, y otra vez cuando la tarea vuelve a funcionar.
const backgroundJobErrors = new Map();
function runBackgroundJob(label, job) {
  backgroundJobQueue = backgroundJobQueue.then(job).then(() => {
    if (backgroundJobErrors.has(label)) {
      backgroundJobErrors.delete(label);
      console.log(`[${label}] Funcionando nuevamente.`);
    }
  }, (error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (/^Conflicto de /.test(message)) {
      console.warn(`[${label}] ${message} Se reintentará en el próximo ciclo.`);
      return;
    }
    if (backgroundJobErrors.get(label) === message) return;
    backgroundJobErrors.set(label, message);
    console.error(`[${label}]`, message, '(se reintenta automáticamente)');
  });
  return backgroundJobQueue;
}

process.on('unhandledRejection', (error) => {
  console.error('[Gestor] Error no controlado:', error instanceof Error ? error.message : error);
});

const verificationTimer = setInterval(() => {
  void runBackgroundJob('Correo', checkPendingReservations);
}, 15_000);
verificationTimer.unref();
const cloudSyncTimer = setInterval(() => {
  void runBackgroundJob('Firebase', syncCloudBridge);
}, 30_000);
cloudSyncTimer.unref();
const dahuaQrTimer = setInterval(() => {
  void runBackgroundJob('Dahua QR', syncDahuaQrAccess);
}, 30_000);
dahuaQrTimer.unref();
const customerProfilesTimer = setInterval(() => {
  void runBackgroundJob('Perfiles de clientes', syncCustomerProfiles);
}, 60_000);
customerProfilesTimer.unref();
const dahuaPendingRemovalTimer = setInterval(() => {
  void runBackgroundJob('Limpieza Dahua', removePendingDahuaPersons);
}, 60_000);
dahuaPendingRemovalTimer.unref();
// Los pagos de Webpay se confirman en pocos segundos para que el huésped vea
// su QR apenas vuelve de pagar.
const webpayPaymentsTimer = setInterval(() => {
  if (!existsSync(FIREBASE_SERVICE_ACCOUNT_PATH)) return;
  void runBackgroundJob('Pagos Webpay', async () => processCloudPaymentRequests(await firebaseStore()));
}, 10_000);
// Los códigos de verificación se responden en pocos segundos.
const accountVerificationTimer = setInterval(() => {
  if (!existsSync(FIREBASE_SERVICE_ACCOUNT_PATH)) return;
  void runBackgroundJob('Verificación de cuentas', async () => processAccountVerificationRequests(await firebaseStore()));
}, 4_000);
accountVerificationTimer.unref();
webpayPaymentsTimer.unref();
const phoneAccessTimer = setInterval(() => {
  if (!existsSync(FIREBASE_SERVICE_ACCOUNT_PATH)) return;
  void runBackgroundJob('Apertura desde teléfono', async () => processCloudPhoneAccessRequests(await firebaseStore()));
}, 4_000);
phoneAccessTimer.unref();
const tapAccessTimer = setInterval(() => {
  if (!existsSync(FIREBASE_SERVICE_ACCOUNT_PATH)) return;
  void runBackgroundJob('Apertura directa', async () => processCloudTapAccessRequests(await firebaseStore()));
}, 4_000);
tapAccessTimer.unref();
const accessEventsTimer = setInterval(() => {
  void runBackgroundJob('Registro de accesos', syncDahuaAccessEvents);
}, 60_000);
accessEventsTimer.unref();
const cloudAccessQrTimer = setInterval(() => {
  void runBackgroundJob('QR dinámico', refreshCloudAccessQrs);
}, 4 * 60_000);
cloudAccessQrTimer.unref();
const biometricExpiryTimer = setInterval(() => {
  void runBackgroundJob('Expiración biométrica', expireBiometricTemplates);
}, 60_000);
biometricExpiryTimer.unref();
// La IA queda cargada en la GPU y las preguntas de la web/app se toman al instante.
void keepAiWarm();
const aiWarmTimer = setInterval(() => void keepAiWarm(), 4 * 60_000);
aiWarmTimer.unref();
void startAiRequestsListener().catch((error) => {
  console.warn('[Firebase] No se pudo iniciar el listener de la IA:', error instanceof Error ? error.message : error);
});
void startTapAccessListener().catch((error) => {
  console.warn('[Firebase] No se pudo iniciar el listener de apertura:', error instanceof Error ? error.message : error);
});
const aiFeedbackTimer = setInterval(() => {
  void runBackgroundJob('Valoraciones de la IA', syncAiFeedback);
}, 60_000);
aiFeedbackTimer.unref();
const hubTerminalsTimer = setInterval(() => {
  void runBackgroundJob('Terminales del hub', syncHubPropertyTerminals);
}, 60_000);
hubTerminalsTimer.unref();
void runBackgroundJob('Correo', checkPendingReservations);
void runBackgroundJob('Firebase', syncCloudBridge);
void runBackgroundJob('Expiración biométrica', expireBiometricTemplates);
void runBackgroundJob('Dahua QR', syncDahuaQrAccess);
void runBackgroundJob('Registro de accesos', syncDahuaAccessEvents);
void runBackgroundJob('Perfiles de clientes', syncCustomerProfiles);
void runBackgroundJob('Limpieza Dahua', removePendingDahuaPersons);
