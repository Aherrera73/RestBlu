import type { Reservation } from './types';

export function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function priceToNumber(price: string) {
  return Number(price.replace(/[^0-9]/g, ''));
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(value);
}

export function getNightCount(checkIn: string, checkOut: string) {
  if (!checkIn || !checkOut) return 0;
  const start = new Date(`${checkIn}T12:00:00`).getTime();
  const end = new Date(`${checkOut}T12:00:00`).getTime();
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

export function hasDateConflict(
  checkIn: string,
  checkOut: string,
  unavailableRanges: unknown = [],
) {
  if (!checkIn || !checkOut) return false;
  if (hasInvalidAvailabilityRanges(unavailableRanges)) return true;
  const ranges = unavailableRanges === undefined ? [] : unavailableRanges as {
    checkIn: string;
    checkOut: string;
  }[];
  return ranges.some(
    (range) => checkIn < range.checkOut && checkOut > range.checkIn,
  );
}

export function hasInvalidAvailabilityRanges(value: unknown) {
  return value !== undefined && (
    !Array.isArray(value) || value.some(
      (range) => !range || typeof range.checkIn !== 'string' ||
        typeof range.checkOut !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(range.checkIn) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(range.checkOut) ||
        range.checkOut <= range.checkIn,
    )
  );
}

export type CalendarDateStatus =
  | 'available'
  | 'occupied'
  | 'checkout-only'
  | 'blocked'
  | 'before-check-in'
  | 'past'
  | 'unknown';

// El check-out no ocupa esa noche: se permite salir el día en que entra otra reserva.
export function calendarDateStatus(
  date: string,
  selection: 'checkIn' | 'checkOut',
  checkIn: string,
  unavailableRanges: unknown,
  earliestDate: string,
): CalendarDateStatus {
  if (hasInvalidAvailabilityRanges(unavailableRanges)) return 'unknown';
  if (date < earliestDate) return 'past';
  const ranges = (unavailableRanges || []) as { checkIn: string; checkOut: string }[];
  const occupied = ranges.some((range) => date >= range.checkIn && date < range.checkOut);
  if (selection === 'checkIn') return occupied ? 'occupied' : 'available';
  if (!checkIn || date <= checkIn) return 'before-check-in';
  if (hasDateConflict(checkIn, date, ranges)) return 'blocked';
  return occupied ? 'checkout-only' : 'available';
}

export function formatDate(value: string) {
  if (!value) return 'Por definir';
  return new Intl.DateTimeFormat('es-CL', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00`));
}

export function todayForInput() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

export function makeReservationCode() {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  return `RB-${Date.now().toString(36).slice(-6).toUpperCase()}-${suffix}`;
}

export function makeAccessPin() {
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  return (100000 + random[0] % 900000).toString();
}

function cleanRut(value: string) {
  return value.replace(/[^0-9kK]/g, '').toUpperCase().slice(0, 9);
}

export function formatRut(value: string) {
  const clean = cleanRut(value);
  if (clean.length < 2) return clean;
  const body = clean.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${body}-${clean.slice(-1)}`;
}

export function isValidRut(value: string) {
  const clean = cleanRut(value);
  if (clean.length < 8) return false;
  const body = clean.slice(0, -1);
  if (!/^\d+$/.test(body)) return false;
  let sum = 0;
  let multiplier = 2;
  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += Number(body[index]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const result = 11 - (sum % 11);
  const expected = result === 11 ? '0' : result === 10 ? 'K' : String(result);
  return clean.slice(-1) === expected;
}

function reservationQrText(reservation: Reservation) {
  return [
    'RESTBLU - PASE DIGITAL',
    `Reserva: ${reservation.id}`,
    `Alojamiento: ${reservation.property.name}`,
    `Ubicacion: ${reservation.property.place}`,
    `Check-in: ${reservation.checkIn}`,
    `Check-out: ${reservation.checkOut}`,
    `Huespedes: ${reservation.guests}`,
    'Estado: CONFIRMADA',
    'Verificacion: Presentar el comprobante RestBlu',
  ].join('\n');
}

export function reservationQrUrl(reservation: Reservation) {
  const content = encodeURIComponent(reservationQrText(reservation));
  return `https://quickchart.io/qr?text=${content}&size=360&margin=3&dark=0b6871&light=ffffff&ecLevel=M&format=png`;
}
