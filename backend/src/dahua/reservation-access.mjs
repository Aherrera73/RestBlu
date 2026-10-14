import { createCipheriv, createHash, randomBytes } from 'node:crypto';

export function dahuaUserId(reservationId) {
  const id = String(reservationId || '');
  if (!id || id.length > 80) throw new Error('Código de reserva inválido para Dahua.');
  return `RB${createHash('sha256').update(id).digest('hex').slice(0, 20)}`;
}

// Número de tarjeta que el Dahua asocia a la persona. El lector entrega el
// contenido descifrado del QR como hexadecimal en mayúsculas: 5 bytes → 10
// caracteres, igual que una tarjeta de proximidad.
export function generateDahuaQrCode() {
  let bytes;
  do bytes = randomBytes(5); while (bytes.every((byte) => byte === 0));
  return bytes.toString('hex').toUpperCase();
}

export function isDahuaQrCode(value) {
  return /^[0-9A-F]{10}$/.test(String(value || ''));
}

// Minutos que el lector acepta un QR desde que se generó (QRCode.ValidTime).
// 1440 (24 horas) es el máximo que admite el DHI-ASI6214S-PW; el gestor lo
// configura en el equipo para que el QR del PDF sirva un día completo.
export const DAHUA_QR_VALID_MINUTES = 1440;
export const DAHUA_QR_VALID_SECONDS = DAHUA_QR_VALID_MINUTES * 60;

// Formato verificado en el DHI-ASI6214S-PW con QRCodeDecode.cipher=0: el
// lector decodifica Base64, descifra con AES-256-CFB (clave QRCodeDecode.key,
// IV en cero) y obtiene [hora Unix de emisión, 4 bytes big-endian][tarjeta].
// Si la hora tiene más de ValidTime minutos, rechaza el QR: por eso se genera
// de nuevo cada pocos minutos y nunca se imprime en el PDF.
export function dahuaDynamicQrContent(key, cardNo, issuedAtSeconds = Math.floor(Date.now() / 1000)) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Clave QR del Dahua inválida.');
  if (!isDahuaQrCode(cardNo)) throw new Error('Número de tarjeta QR inválido.');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(issuedAtSeconds >>> 0);
  const cipher = createCipheriv('aes-256-cfb', key, Buffer.alloc(16));
  return Buffer.concat([
    cipher.update(Buffer.concat([header, Buffer.from(cardNo, 'hex')])),
    cipher.final(),
  ]).toString('base64');
}

export function reservationAccessWindow(reservation) {
  const start = `${reservation.checkIn} ${reservation.checkInTime || '15:00'}:00`;
  const end = `${reservation.checkOut} ${reservation.checkOutTime || '11:00'}:00`;
  const pattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  if (!pattern.test(start) || !pattern.test(end) ||
      Number.isNaN(Date.parse(start.replace(' ', 'T'))) ||
      Number.isNaN(Date.parse(end.replace(' ', 'T'))) || end <= start) {
    throw new Error('La reserva no tiene una vigencia de acceso válida.');
  }
  return {
    validFrom: start.replace(/[-:]/g, ''),
    validTo: end.replace(/[-:]/g, ''),
    expiresAt: end.replace(' ', 'T'),
  };
}

function dahuaLocalTime(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())} ` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

// Vigencia en el Dahua: desde que se registra el acceso (al confirmarse el
// pago) hasta el check-out, para que el huésped pueda entrar apenas confirma.
// La hora es la local del gestor, que debe coincidir con la del terminal.
function activeAccessWindow(reservation, what, now = new Date()) {
  const window = reservationAccessWindow(reservation);
  window.validFrom = dahuaLocalTime(now);
  if (Date.parse(window.expiresAt) <= Date.now()) {
    throw new Error(`La reserva ya terminó; no se enviará ${what} al Dahua.`);
  }
  return window;
}

function terminalName(reservation, customer) {
  const name = String(customer?.name || reservation.guestName || '').trim().slice(0, 32);
  if (!name || /[\r\n\0]/.test(name)) throw new Error('Nombre inválido para el terminal.');
  return name;
}

export function dahuaQrInput({ reservation, customer }) {
  if (reservation.status !== 'confirmada' || reservation.paymentStatus !== 'aprobado-demo') {
    throw new Error('La reserva no está confirmada; no se habilita su QR en el Dahua.');
  }
  if (!isDahuaQrCode(reservation.dahuaQrCode)) {
    throw new Error('La reserva no tiene un código QR de acceso válido.');
  }
  if (!/^\d{4,8}$/.test(String(reservation.accessPin || ''))) {
    throw new Error('La reserva no tiene un PIN de acceso válido para Dahua.');
  }
  const window = activeAccessWindow(reservation, 'el QR');
  return {
    userId: dahuaUserId(reservation.id),
    name: terminalName(reservation, customer),
    cardNo: reservation.dahuaQrCode,
    pin: reservation.accessPin,
    validFrom: window.validFrom,
    validTo: window.validTo,
    door: 1,
  };
}

export function dahuaFaceInput({ reservation, customer, image }) {
  if (reservation.status !== 'confirmada' ||
      reservation.paymentStatus !== 'aprobado-demo' ||
      reservation.biometricConsentAt == null ||
      reservation.biometricStatus !== 'activa') {
    throw new Error('La reserva no está autorizada para el acceso biométrico.');
  }
  const window = activeAccessWindow(reservation, 'un rostro');
  const name = terminalName(reservation, customer);
  if (image?.mimeType !== 'image/jpeg') {
    throw new Error('El terminal Dahua requiere una captura JPEG.');
  }
  const jpeg = Buffer.from(String(image.base64 || ''), 'base64');
  if (jpeg.length < 10_000 || jpeg.length > 200_000 ||
      jpeg[0] !== 0xff || jpeg[1] !== 0xd8 ||
      jpeg.at(-2) !== 0xff || jpeg.at(-1) !== 0xd9) {
    throw new Error('La foto Dahua debe ser JPEG válido de 10 a 200 KB.');
  }
  return {
    userId: dahuaUserId(reservation.id),
    name,
    photoBase64: image.base64,
    validFrom: window.validFrom,
    validTo: window.validTo,
    door: 1,
  };
}

// Crea la persona con su vigencia y le asocia el QR. Si la persona ya existe
// (por ejemplo, porque antes se registró su rostro) sólo agrega el QR.
export async function enrollReservationQr(client, input, { personExists = false, onPersonInserted = () => {} } = {}) {
  let inserted = { recNo: '', apiVersion: 2 };
  if (!personExists) {
    inserted = await client.insertPerson(input);
    await onPersonInserted(inserted);
  } else {
    // Si el rostro ya creó a la persona, se actualiza el PIN sin borrar el rostro.
    await client.updatePersonValidity(input);
  }
  // En CGI V1 el número de tarjeta viaja dentro del propio registro de persona.
  if (inserted.apiVersion === 1) return { recNo: inserted.recNo || '' };
  try {
    await client.addCard(input);
  } catch (error) {
    if (!personExists) await client.removePerson(inserted.recNo, input.userId).catch(() => {});
    throw error;
  }
  return { recNo: inserted.recNo || '' };
}

export async function enrollReservationFace(client, input, onPersonInserted = () => {}, { personExists = false } = {}) {
  let inserted = { recNo: '' };
  if (personExists) {
    // La persona ya existe con su QR: sólo se reemplaza el rostro, sin tocar
    // la persona ni su código.
    await client.removeFace(input.userId).catch(() => {});
    await client.addFace(input);
  } else {
    inserted = await client.insertPerson(input);
    await onPersonInserted(inserted);
    try {
      await client.addFace(input);
    } catch (error) {
      await client.removePerson(inserted.recNo, input.userId).catch(() => {});
      throw error;
    }
  }
  let verified = false;
  let verificationError = '';
  try {
    verified = await client.findFace(input.userId);
    if (!verified) verificationError = 'El Dahua aceptó el alta, pero aún no mostró el rostro en su consulta.';
  } catch (error) {
    verificationError = error instanceof Error ? error.message : String(error);
  }
  return {
    userId: input.userId,
    recNo: inserted.recNo || '',
    verified,
    verificationError,
  };
}

export async function revokeReservationFace(client, { userId, recNo, cardNo = '' }) {
  if (!/^RB[a-f0-9]{20}$/.test(String(userId || ''))) {
    throw new Error('El identificador Dahua de la reserva es inválido.');
  }
  // El rostro y el QR se quitan primero; pueden no existir (una reserva sólo
  // con QR no tiene rostro). Lo que decide el resultado es eliminar la persona.
  await Promise.allSettled([
    client.removeFace(userId),
    ...(cardNo ? [client.removeCard(cardNo)] : []),
  ]);
  try {
    await client.removePerson(recNo, userId);
  } catch (error) {
    if (!/(not found|not exist|no record|no data|no such user)/i.test(String(error?.message || error))) throw error;
  }
}
