export type OwnerProperty = {
  id: number;
  name: string;
  place: string;
  image: string;
  nightlyPrice: number;
  currency: string;
  active: boolean;
  rating: number;
  guests: number;
};

export type OwnerReservation = {
  id: string;
  propertyId: number;
  propertyName: string;
  guestName: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  nights: number;
  total: number;
  currency: string;
  status: string;
  paymentStatus: string;
  createdAt: string;
};

export type OwnerDashboardData = {
  owner: { id: number | string; name: string; email: string; phone: string };
  properties: OwnerProperty[];
  reservations: OwnerReservation[];
  summary?: unknown;
};

export type OwnerMonthMetrics = {
  properties: OwnerProperty[];
  reservations: OwnerReservation[];
  activeProperties: number;
  confirmedReservations: number;
  grossRevenue: number;
  occupancyPercent: number;
  averageRating: number;
  days: number;
};

const DAY_MS = 86_400_000;

function calendarDay(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== value
  )
    return null;
  return timestamp / DAY_MS;
}

function monthRange(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new RangeError('El mes debe tener el formato YYYY-MM.');
  const first = new Date(`${month}-01T00:00:00.000Z`);
  const next = new Date(first);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { start: first.getTime() / DAY_MS, end: next.getTime() / DAY_MS };
}

function stayRange(reservation: OwnerReservation) {
  const start = calendarDay(reservation.checkIn);
  const end = calendarDay(reservation.checkOut);
  return start !== null && end !== null && end > start ? { start, end } : null;
}

export function isConfirmedOwnerReservation(
  reservation: OwnerReservation,
): boolean {
  // Webpay uses this legacy payment label for real approved payments as well.
  return (
    reservation.status === 'confirmada' &&
    reservation.paymentStatus === 'aprobado-demo'
  );
}

export function ownerMonthMetrics(
  data: OwnerDashboardData,
  month: string,
  propertyId: number | null = null,
): OwnerMonthMetrics {
  const { start, end } = monthRange(month);
  const properties = data.properties.filter(
    (property) => propertyId === null || property.id === propertyId,
  );
  const propertyIds = new Set(properties.map((property) => property.id));
  const activeIds = new Set(
    properties
      .filter((property) => property.active)
      .map((property) => property.id),
  );
  const stays = data.reservations.flatMap((reservation) => {
    if (!propertyIds.has(reservation.propertyId)) return [];
    const range = stayRange(reservation);
    return range && range.start < end && range.end > start
      ? [{ reservation, range }]
      : [];
  });
  const confirmed = stays.filter(({ reservation }) =>
    isConfirmedOwnerReservation(reservation),
  );
  const arrivals = confirmed.filter(({ range }) => range.start >= start);
  const grossRevenue = arrivals.reduce(
    (sum, { reservation }) =>
      Number.isFinite(reservation.total) && reservation.total >= 0
        ? sum + reservation.total
        : sum,
    0,
  );

  // Union occupied nights per property so duplicate/overlapping bookings cannot
  // inflate occupancy. Checkout is exclusive; dates are UTC calendar days.
  let occupiedNights = 0;
  for (const id of activeIds) {
    const ranges = confirmed
      .filter(({ reservation }) => reservation.propertyId === id)
      .map(({ range }) => ({
        start: Math.max(start, range.start),
        end: Math.min(end, range.end),
      }))
      .sort((a, b) => a.start - b.start);
    let coveredUntil = start;
    for (const range of ranges) {
      occupiedNights += Math.max(
        0,
        range.end - Math.max(range.start, coveredUntil),
      );
      coveredUntil = Math.max(coveredUntil, range.end);
    }
  }

  const ratings = properties
    .map((property) => property.rating)
    .filter((rating) => Number.isFinite(rating) && rating > 0 && rating <= 5);
  const days = end - start;
  return {
    properties,
    reservations: stays.map(({ reservation }) => reservation),
    activeProperties: activeIds.size,
    confirmedReservations: arrivals.length,
    grossRevenue,
    occupancyPercent: activeIds.size
      ? Math.round((occupiedNights / (activeIds.size * days)) * 1000) / 10
      : 0,
    averageRating: ratings.length
      ? Math.round(
          (ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length) *
            10,
        ) / 10
      : 0,
    days,
  };
}

export function ownerRevenueSeries(
  data: OwnerDashboardData,
  month: string,
): { month: string; label: string; revenue: number }[] {
  monthRange(month);
  const selected = new Date(`${month}-01T00:00:00.000Z`);
  const label = new Intl.DateTimeFormat('es-CL', {
    month: 'short',
    timeZone: 'UTC',
  });
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(selected);
    date.setUTCMonth(date.getUTCMonth() + index - 5);
    const key = date.toISOString().slice(0, 7);
    return {
      month: key,
      label: label.format(date),
      revenue: ownerMonthMetrics(data, key).grossRevenue,
    };
  });
}
