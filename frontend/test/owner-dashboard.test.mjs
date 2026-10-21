import assert from 'node:assert/strict';
import test from 'node:test';
import { isConfirmedOwnerReservation, ownerMonthMetrics, ownerRevenueSeries } from '../modules/public-site/domain/owner-dashboard.ts';

const property = (id, overrides = {}) => ({
  id, name: `Alojamiento ${id}`, place: 'Destino de prueba', image: '', nightlyPrice: 100,
  currency: 'CLP', active: true, rating: 4, guests: 2, ...overrides,
});
const reservation = (id, checkIn, checkOut, overrides = {}) => ({
  id, propertyId: 1, propertyName: 'Alojamiento 1', guestName: 'Huésped de prueba',
  checkIn, checkOut, guests: 2, nights: 999, total: 500, currency: 'CLP',
  status: 'confirmada', paymentStatus: 'aprobado-demo', createdAt: `${checkIn}T12:00:00Z`, ...overrides,
});
const dashboard = (properties, reservations) => ({
  owner: { id: 'owner-test', name: 'Propietario de prueba', email: 'owner@example.test', phone: '' }, properties, reservations,
});

test('sólo una reserva confirmada y pagada cuenta como confirmada', () => {
  const paid = reservation('paid', '2026-10-01', '2026-10-03');
  assert.equal(isConfirmedOwnerReservation(paid), true);
  assert.equal(isConfirmedOwnerReservation({ ...paid, status: 'expirada' }), false);
  assert.equal(isConfirmedOwnerReservation({ ...paid, paymentStatus: 'pendiente-demo' }), false);
  assert.equal(isConfirmedOwnerReservation({ ...paid, paymentStatus: 'reembolso-pendiente' }), false);
});

test('atribuye ingresos a la entrada y recorta las noches al mes sin contar dos veces solapamientos', () => {
  const data = dashboard([property(1), property(2, { rating: 5 }), property(3, { active: false })], [
    reservation('prior', '2026-09-29', '2026-10-03', { total: 1000 }),
    reservation('overlap', '2026-10-02', '2026-10-06', { total: 2000 }),
    reservation('checkout', '2026-10-31', '2026-11-03', { total: 3000 }),
    reservation('second', '2026-10-01', '2026-10-04', { propertyId: 2, total: 4000 }),
    reservation('inactive', '2026-10-01', '2026-11-01', { propertyId: 3, total: 5000 }),
    reservation('unpaid', '2026-10-10', '2026-10-20', { paymentStatus: 'pendiente-demo' }),
    reservation('expired', '2026-10-10', '2026-10-20', { status: 'expirada' }),
    reservation('ends-before', '2026-09-29', '2026-10-01'),
    reservation('starts-after', '2026-11-01', '2026-11-02'),
    reservation('not-owned', '2026-10-01', '2026-11-01', { propertyId: 99 }),
  ]);
  const result = ownerMonthMetrics(data, '2026-10');
  assert.equal(result.days, 31);
  assert.equal(result.activeProperties, 2);
  assert.equal(result.confirmedReservations, 4);
  assert.equal(result.grossRevenue, 14_000);
  // First property: Oct 1–5 + Oct 31 = 6 nights. Second: Oct 1–3 = 3.
  assert.equal(result.occupancyPercent, 14.5);
  assert.deepEqual(result.reservations.map((item) => item.id), ['prior', 'overlap', 'checkout', 'second', 'inactive', 'unpaid', 'expired']);
  assert.equal(result.averageRating, 4.3);
  assert.deepEqual(ownerMonthMetrics(data, '2026-10', 2).reservations.map((item) => item.id), ['second']);
  assert.equal(ownerMonthMetrics(data, '2026-10', 2).grossRevenue, 4000);
  assert.equal(ownerMonthMetrics(data, '2026-10', 2).occupancyPercent, 9.7);
});

test('rechaza fechas inexistentes, rangos vacíos o invertidos y usa días de calendario al cruzar cambios horarios', () => {
  const data = dashboard([property(1)], [
    reservation('dst', '2026-09-05', '2026-09-08', { total: 300 }),
    reservation('invalid', '2026-09-31', '2026-10-02'),
    reservation('inverted', '2026-09-10', '2026-09-09'),
    reservation('empty', '2026-09-10', '2026-09-10'),
    reservation('timestamp', '2026-09-01T00:00:00Z', '2026-09-02'),
  ]);
  const result = ownerMonthMetrics(data, '2026-09');
  assert.equal(result.days, 30);
  assert.equal(result.occupancyPercent, 10);
  assert.equal(result.grossRevenue, 300);
  assert.deepEqual(result.reservations.map((item) => item.id), ['dst']);
  assert.equal(ownerMonthMetrics(data, '2024-02').days, 29);
  assert.throws(() => ownerMonthMetrics(data, '2026-13'), RangeError);
});

test('sin propiedades activas evita dividir por cero e ignora importes y notas no válidos', () => {
  const data = dashboard([property(1, { active: false, rating: Number.NaN })], [
    reservation('bad-amount', '2026-10-01', '2026-10-03', { total: Number.NaN }),
    reservation('negative', '2026-10-04', '2026-10-06', { total: -100 }),
  ]);
  const result = ownerMonthMetrics(data, '2026-10');
  assert.equal(result.occupancyPercent, 0);
  assert.equal(result.grossRevenue, 0);
  assert.equal(result.averageRating, 0);
  const empty = ownerMonthMetrics(data, '2026-10', 99);
  assert.equal(empty.activeProperties, 0);
  assert.deepEqual(empty.reservations, []);
});

test('la serie incluye seis meses hasta el seleccionado y atraviesa el año', () => {
  const data = dashboard([property(1)], [
    reservation('november', '2025-11-30', '2025-12-02', { total: 1200 }),
    reservation('february', '2026-02-10', '2026-02-12', { total: 800 }),
    reservation('outside', '2025-08-31', '2025-09-02', { total: 999 }),
  ]);
  const result = ownerRevenueSeries(data, '2026-02');
  assert.deepEqual(result.map(({ month, revenue }) => ({ month, revenue })), [
    { month: '2025-09', revenue: 0 }, { month: '2025-10', revenue: 0 },
    { month: '2025-11', revenue: 1200 }, { month: '2025-12', revenue: 0 },
    { month: '2026-01', revenue: 0 }, { month: '2026-02', revenue: 800 },
  ]);
  assert.ok(result.every((point) => point.label.length > 0));
});
