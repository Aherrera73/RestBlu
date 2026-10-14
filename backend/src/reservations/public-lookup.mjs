import { formatRut, validEmail, validRut } from '../shared/normalizers.mjs';

// El RUT sólo inicia un envío. Nunca se devuelven reservas ni correos al navegador.
export function reservationLookupEmailGroups(database, documentId) {
  if (typeof documentId !== 'string' ||
      !/^[0-9.kK-]{8,15}$/.test(documentId) ||
      !validRut(documentId)) {
    throw new Error('Ingresa un RUT chileno válido.');
  }

  const rut = formatRut(documentId);
  const customers = new Map(database.customers.map((customer) => [customer.id, customer]));
  const groups = new Map();
  for (const reservation of database.reservations) {
    const customer = customers.get(reservation.customerId);
    const snapshotRut = reservation.guestDocumentId || customer?.documentId || '';
    if (!snapshotRut || formatRut(snapshotRut) !== rut) continue;
    // Sólo una dirección ya verificada puede recibir el detalle de una reserva.
    if (!reservation.emailVerifiedAt) continue;
    const email = String(reservation.guestEmail || customer?.email || '').trim().toLowerCase();
    if (!validEmail(email)) continue;
    const entries = groups.get(email) || [];
    entries.push({
      reference: String(reservation.id || ''),
      propertyName: reservation.propertyName || 'Alojamiento RestBlu',
      checkIn: reservation.checkIn || '',
      checkOut: reservation.checkOut || '',
      status: reservation.status || 'en revisión',
    });
    groups.set(email, entries);
  }
  for (const entries of groups.values()) {
    entries.sort((left, right) => right.checkIn.localeCompare(left.checkIn));
  }
  return groups;
}
