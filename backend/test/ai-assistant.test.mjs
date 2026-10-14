import assert from 'node:assert/strict';
import test from 'node:test';
import {
  availabilityFor, dailySummary, guestContext, publicContext, suggestionsFromAnswer,
} from '../src/ai/assistant-context.mjs';

const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });
const plus = (days) => new Date(Date.now() + days * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });

function database() {
  return {
    properties: [
      { id: 1, name: 'Refugio Arrayán', place: 'Pucón', guests: 6, price: 148000, active: true, address: 'Camino 1', guidePublic: 'Se aceptan mascotas.', guidePrivate: 'Wi-Fi: Arrayan / clave 1234' },
      { id: 2, name: 'Loft Puerto Norte', place: 'Puerto Varas', guests: 2, price: 92000, active: true },
      { id: 3, name: 'Villa Dunas', place: 'Concón', guests: 8, price: 238000, active: false },
    ],
    customers: [],
    reservations: [
      { id: 'RB-1', propertyId: 1, propertyName: 'Refugio Arrayán', ownerUid: 'uid-ana', guestName: 'Ana', checkIn: plus(10), checkOut: plus(12), status: 'confirmada', paymentStatus: 'aprobado-demo', dahuaQrStatus: 'activo' },
      { id: 'RB-2', propertyId: 2, propertyName: 'Loft Puerto Norte', ownerUid: 'uid-ana', guestName: 'Ana', checkIn: plus(20), checkOut: plus(21), status: 'correo-verificado-pago-pendiente', paymentStatus: 'pendiente-demo' },
      { id: 'RB-3', propertyId: 2, ownerUid: 'uid-otro', checkIn: plus(30), checkOut: plus(31), status: 'expirada' },
      { id: 'RB-4', propertyId: 1, ownerUid: 'uid-luis', guestName: 'Luis', checkIn: today, checkOut: plus(2), checkInTime: '15:00', status: 'confirmada', paymentStatus: 'aprobado-demo' },
    ],
  };
}

test('la disponibilidad la calcula el código: fechas ocupadas, capacidad y alojamientos no publicados', () => {
  const result = availabilityFor(database(), { checkIn: plus(11), checkOut: plus(13), guests: 2 });
  assert.deepEqual(result.available.map((p) => p.name), ['Loft Puerto Norte']);
  assert.match(result.unavailable[0].reason, /ocupado/);
  const big = availabilityFor(database(), { checkIn: plus(40), checkOut: plus(41), guests: 4 });
  assert.deepEqual(big.available.map((p) => p.name), ['Refugio Arrayán']);
  assert.match(big.unavailable.find((item) => item.property.id === 2).reason, /capacidad máxima 2/);
  // Una reserva expirada ya no bloquea las fechas.
  assert.ok(availabilityFor(database(), { checkIn: plus(30), checkOut: plus(31), guests: 2 }).available.some((p) => p.id === 2));
});

test('el contexto público no incluye datos privados ni alojamientos no publicados', () => {
  const context = JSON.stringify(publicContext(database(), { checkIn: plus(11), checkOut: plus(13), guests: 2 }));
  assert.match(context, /Se aceptan mascotas/);
  assert.doesNotMatch(context, /Wi-Fi|clave 1234|Camino 1|Villa Dunas|uid-|Ana/);
  assert.match(context, /"disponibles":\["Loft Puerto Norte"\]/);
});

test('Blu personal: sólo reservas propias y datos privados sólo de estadías confirmadas', () => {
  const guest = guestContext(database(), 'uid-ana');
  assert.deepEqual(guest.reservas.map((item) => item.codigo), ['RB-1', 'RB-2']);
  const [confirmed, pending] = guest.reservas;
  assert.match(confirmed.manualDelHuesped, /clave 1234/);
  assert.equal(confirmed.direccion, 'Camino 1');
  assert.match(confirmed.accesoQR, /pestaña Acceso/);
  assert.equal(pending.manualDelHuesped, undefined);
  assert.equal(pending.direccion, undefined);
  assert.doesNotMatch(JSON.stringify(guest), /Luis|RB-4|uid-otro/);
  assert.equal(guestContext(database(), ''), null);
  assert.deepEqual(guestContext(database(), 'uid-nuevo').reservas, []);
});

test('los botones salen de los alojamientos que nombra la respuesta, con la búsqueda actual', () => {
  const answer = 'Te recomiendo el loft puerto norte; también está el Refugio Arrayan, pero no está libre.';
  const search = { checkIn: plus(11), checkOut: plus(13), guests: 2 };
  assert.deepEqual(suggestionsFromAnswer(answer, database(), search), [
    { propertyId: 2, name: 'Loft Puerto Norte', checkIn: plus(11), checkOut: plus(13), guests: 2, available: true },
    { propertyId: 1, name: 'Refugio Arrayán', checkIn: plus(11), checkOut: plus(13), guests: 2, available: false },
  ]);
  assert.equal(suggestionsFromAnswer('Villa Dunas es linda', database(), search).length, 0);
  assert.equal(suggestionsFromAnswer('Loft Puerto Norte', database(), {})[0].available, null);
});

test('el resumen del día detecta llegadas, rechazos seguidos y entradas fuera de la estadía', () => {
  const at = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
  const accessEvents = [
    { occurredAt: at(30), authorized: false, terminal: 'PROP-0001', propertyId: null },
    { occurredAt: at(27), authorized: false, terminal: 'PROP-0001', propertyId: null },
    { occurredAt: at(25), authorized: false, terminal: 'PROP-0001', propertyId: null },
    { occurredAt: at(5), authorized: false, terminal: 'PROP-0001', propertyId: null },
    { occurredAt: at(10), authorized: true, type: 'Entry', reservationId: 'RB-1', person: 'Ana', propertyId: 1 },
  ];
  const summary = dailySummary({
    database: database(),
    accessEvents,
    terminals: [{ registrationId: 'PROP-0002', online: false, lastDisconnectedAt: at(60) }],
  });
  assert.deepEqual(summary.llegadas.map((item) => item.codigo), ['RB-4']);
  const types = summary.alertas.map((item) => item.tipo).sort();
  assert.deepEqual(types, ['fuera-de-estadia', 'rechazos-seguidos', 'terminal-desconectado']);
  assert.equal(summary.alertas.find((item) => item.tipo === 'rechazos-seguidos').intentos, 3);
  assert.equal(summary.accesosHoy.rechazados >= 0, true);
});
