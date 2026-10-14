// Contexto y resultados de los asistentes de RestBlu (Blu público y RestBlu IA
// del gestor). Todo lo que se puede calcular con certeza (disponibilidad,
// llegadas del día, alertas) lo calcula el código; el modelo sólo lo explica.

const TIME_ZONE = 'America/Santiago';

const NON_BLOCKING = new Set([
  'cancelada', 'cancelado', 'rechazada', 'rechazado', 'anulada', 'anulado', 'error', 'expirada',
]);

export function blocksDates(reservation) {
  return !NON_BLOCKING.has(String(reservation.status || '').toLowerCase());
}

export function paidAndConfirmed(reservation) {
  return reservation.status === 'confirmada' && reservation.paymentStatus === 'aprobado-demo';
}

export function localDate(date = new Date()) {
  return date.toLocaleDateString('sv-SE', { timeZone: TIME_ZONE });
}

const clip = (value, max) => {
  const text = String(value ?? '').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

// Sin tildes ni mayúsculas, para comparar nombres.
export function normalize(value) {
  return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validSearch(search = {}) {
  const checkIn = String(search.checkIn || '');
  const checkOut = String(search.checkOut || '');
  const guests = Math.max(1, Number.parseInt(search.guests, 10) || 1);
  const datesOk = ISO_DATE.test(checkIn) && ISO_DATE.test(checkOut) && checkOut > checkIn;
  return { checkIn: datesOk ? checkIn : '', checkOut: datesOk ? checkOut : '', guests, destination: clip(search.destination, 120) };
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

// Disponibilidad calculada por código para la búsqueda actual.
export function availabilityFor(database, search) {
  const { checkIn, checkOut, guests } = validSearch(search);
  const active = (database.properties || []).filter((property) => property.active !== false);
  if (!checkIn) return { searched: false, available: active.filter((p) => Number(p.guests) >= guests), unavailable: [] };
  const available = [];
  const unavailable = [];
  for (const property of active) {
    const busy = (database.reservations || []).some((reservation) =>
      Number(reservation.propertyId) === Number(property.id) && blocksDates(reservation) &&
      overlaps(checkIn, checkOut, reservation.checkIn, reservation.checkOut));
    const tooSmall = Number(property.guests) < guests;
    if (busy || tooSmall) unavailable.push({ property, reason: busy ? 'ocupado en esas fechas' : `capacidad máxima ${property.guests}` });
    else available.push(property);
  }
  return { searched: true, available, unavailable };
}

export function publicContext(database, search) {
  const { checkIn, checkOut, guests, destination } = validSearch(search);
  const availability = availabilityFor(database, search);
  const catalog = (database.properties || []).filter((property) => property.active !== false).map((property) => ({
    id: property.id,
    nombre: property.name,
    tipo: property.type,
    ubicacion: property.place,
    capacidad: property.guests,
    dormitorios: property.beds,
    banos: property.baths,
    tarifaNocheCLP: property.price,
    calificacion: property.rating,
    etiquetas: property.tags,
    descripcion: clip(property.description, 260),
    ...(property.guidePublic ? { informacionParaViajeros: clip(property.guidePublic, 600) } : {}),
  }));
  return {
    fechaActual: localDate(),
    busqueda: { destino: destination, checkIn, checkOut, huespedes: guests },
    disponibilidad: availability.searched
      ? {
        calculadaPara: `${checkIn} a ${checkOut}, ${guests} huésped(es)`,
        disponibles: availability.available.map((property) => property.name),
        noDisponibles: availability.unavailable.map(({ property, reason }) => `${property.name} (${reason})`),
      }
      : { nota: 'El usuario no eligió fechas: para confirmar disponibilidad debe indicar check-in y check-out.' },
    catalogo: catalog,
  };
}

// Reservas de la cuenta que pregunta (Blu personal). Los datos privados de la
// vivienda (dirección, manual del huésped) sólo van para estadías confirmadas.
export function guestContext(database, ownerUid, now = new Date()) {
  if (!ownerUid) return null;
  const today = localDate(now);
  // Reservas vigentes o futuras de la cuenta (las expiradas o canceladas no).
  const own = (database.reservations || [])
    .filter((reservation) => reservation.ownerUid === ownerUid && reservation.checkOut >= today && blocksDates(reservation))
    .sort((a, b) => String(a.checkIn).localeCompare(String(b.checkIn)))
    .slice(0, 6);
  if (!own.length) return { reservas: [], nota: 'La cuenta no tiene reservas vigentes ni próximas.' };
  const property = (id) => (database.properties || []).find((item) => Number(item.id) === Number(id));
  return {
    reservas: own.map((reservation) => {
      const place = property(reservation.propertyId);
      const confirmed = paidAndConfirmed(reservation);
      return {
        codigo: reservation.id,
        alojamiento: reservation.propertyName || place?.name || '',
        ubicacion: reservation.propertyPlace || place?.place || '',
        checkIn: `${reservation.checkIn} desde las ${reservation.checkInTime || '15:00'}`,
        checkOut: `${reservation.checkOut} hasta las ${reservation.checkOutTime || '11:00'}`,
        huespedes: reservation.guests,
        total: reservation.total,
        estado: confirmed ? 'confirmada y pagada' : reservation.status === 'expirada' ? 'expirada' : `pendiente (${reservation.status}; pago ${reservation.paymentStatus || 'pendiente'})`,
        accesoQR: confirmed
          ? (reservation.dahuaQrStatus === 'activo' ? 'habilitado: se ve en la app (pestaña Acceso) o en la web (Mi cuenta → Reservas)' : 'se está habilitando en el terminal')
          : 'se habilita al confirmar el pago',
        rostro: reservation.dahuaStatus === 'verificado' ? 'registrado' : 'opcional, se registra desde la app',
        ...(confirmed && place ? {
          direccion: [place.address, place.commune, place.region].filter(Boolean).join(', '),
          ...(place.guidePrivate ? { manualDelHuesped: clip(place.guidePrivate, 1500) } : {}),
          ...(place.ownerName ? { anfitrion: place.ownerName, telefonoAnfitrion: place.ownerPhone } : {}),
        } : {}),
      };
    }),
  };
}

// Botones de acción: alojamientos que la respuesta menciona, con la búsqueda
// actual para reservar directamente si están disponibles.
export function suggestionsFromAnswer(answer, database, search, limit = 3) {
  const text = normalize(answer);
  const { checkIn, checkOut, guests } = validSearch(search);
  const availability = availabilityFor(database, search);
  const available = new Set(availability.available.map((property) => property.id));
  const mentioned = (database.properties || [])
    .filter((property) => property.active !== false && property.name && text.includes(normalize(property.name)))
    .map((property) => ({ property, at: text.indexOf(normalize(property.name)) }))
    .sort((a, b) => a.at - b.at)
    .slice(0, limit);
  return mentioned.map(({ property }) => ({
    propertyId: property.id,
    name: property.name,
    checkIn,
    checkOut,
    guests,
    available: availability.searched ? available.has(property.id) : null,
  }));
}

// Fecha y hora local del alojamiento (el gestor corre con la hora de Chile).
function localMs(date, time) {
  return Date.parse(`${date}T${time || '00:00'}:00`);
}

// Resumen operativo del día y alertas de seguridad.
export function dailySummary({ database, accessEvents = [], terminals = [], now = new Date() }) {
  const today = localDate(now);
  const reservations = database.reservations || [];
  const propertyName = (id) => (database.properties || []).find((item) => Number(item.id) === Number(id))?.name || 'Sin vivienda';
  const brief = (reservation) => ({
    codigo: reservation.id,
    huesped: reservation.guestName || '',
    alojamiento: reservation.propertyName || propertyName(reservation.propertyId),
    checkIn: `${reservation.checkIn} ${reservation.checkInTime || '15:00'}`,
    checkOut: `${reservation.checkOut} ${reservation.checkOutTime || '11:00'}`,
  });
  const confirmed = reservations.filter(paidAndConfirmed);
  const arrivals = confirmed.filter((reservation) => reservation.checkIn === today).map(brief);
  const departures = confirmed.filter((reservation) => reservation.checkOut === today).map(brief);
  const inHouse = confirmed.filter((reservation) => reservation.checkIn < today && reservation.checkOut > today).map(brief);
  const soon = now.getTime() + 60 * 60_000;
  const pendingPayments = reservations
    .filter((reservation) => blocksDates(reservation) && !paidAndConfirmed(reservation) && reservation.expiresAt)
    .filter((reservation) => Date.parse(reservation.expiresAt) > now.getTime() && Date.parse(reservation.expiresAt) <= soon)
    .map((reservation) => ({ ...brief(reservation), venceA: reservation.expiresAt }));
  const offlineTerminals = terminals.filter((terminal) => terminal.online === false)
    .map((terminal) => ({ terminal: terminal.registrationId, ultimaVez: terminal.lastDisconnectedAt || terminal.lastConnectedAt || null }));

  // Rechazos seguidos: 3 o más en 10 minutos en el mismo terminal.
  const rejectedBursts = [];
  const rejected = accessEvents.filter((event) => !event.authorized)
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  const byTerminal = new Map();
  for (const event of rejected) {
    const key = event.terminal || 'lan';
    if (!byTerminal.has(key)) byTerminal.set(key, []);
    byTerminal.get(key).push(event);
  }
  const time = (event) => Date.parse(event.occurredAt);
  for (const [terminal, events] of byTerminal) {
    let i = 0;
    while (i < events.length) {
      let j = i;
      while (j + 1 < events.length && time(events[j + 1]) - time(events[i]) <= 10 * 60_000) j += 1;
      if (j - i + 1 >= 3) {
        rejectedBursts.push({
          terminal: terminal === 'lan' ? 'Red local' : terminal,
          vivienda: events[i].propertyId == null ? null : propertyName(events[i].propertyId),
          intentos: j - i + 1,
          desde: events[i].occurredAt,
          hasta: events[j].occurredAt,
        });
        i = j + 1;
      } else {
        i += 1;
      }
    }
  }

  // Entradas autorizadas fuera de la estadía (3 h antes del check-in hasta 1 h
  // después del check-out se considera normal).
  const byId = new Map(reservations.map((reservation) => [reservation.id, reservation]));
  const outsideStay = accessEvents
    .filter((event) => event.authorized && event.reservationId && event.type !== 'Exit')
    .filter((event) => {
      const reservation = byId.get(event.reservationId);
      if (!reservation) return false;
      const at = Date.parse(event.occurredAt);
      return at < localMs(reservation.checkIn, reservation.checkInTime || '15:00') - 3 * 3_600_000 ||
        at > localMs(reservation.checkOut, reservation.checkOutTime || '11:00') + 3_600_000;
    })
    .map((event) => ({
      codigo: event.reservationId,
      persona: event.person || '',
      vivienda: propertyName(event.propertyId),
      fecha: event.occurredAt,
    }));

  const alerts = [
    ...rejectedBursts.map((item) => ({
      tipo: 'rechazos-seguidos',
      nivel: 'alto',
      texto: `${item.intentos} accesos rechazados seguidos en ${item.vivienda || item.terminal} (posible intento indebido).`,
      ...item,
    })),
    ...outsideStay.map((item) => ({
      tipo: 'fuera-de-estadia',
      nivel: 'medio',
      texto: `${item.persona || item.codigo} entró a ${item.vivienda} fuera de su estadía.`,
      ...item,
    })),
    ...offlineTerminals.map((item) => ({
      tipo: 'terminal-desconectado',
      nivel: 'medio',
      texto: `El terminal ${item.terminal} está desconectado: las reservas nuevas no se registran en él.`,
      ...item,
    })),
  ];
  return {
    fecha: today,
    generadoEn: now.toISOString(),
    llegadas: arrivals,
    salidas: departures,
    alojados: inHouse,
    pagosPorVencer: pendingPayments,
    terminalesDesconectados: offlineTerminals,
    accesosHoy: {
      autorizados: accessEvents.filter((event) => event.authorized && localDate(new Date(event.occurredAt)) === today).length,
      rechazados: accessEvents.filter((event) => !event.authorized && localDate(new Date(event.occurredAt)) === today).length,
    },
    alertas: alerts,
  };
}

// Contexto compacto para RestBlu IA del gestor: el resumen del día, las
// estadías cercanas y sólo los clientes que aparecen en ellas.
export function adminContext(database, summary, now = new Date()) {
  const from = localDate(new Date(now.getTime() - 15 * 86_400_000));
  const to = localDate(new Date(now.getTime() + 60 * 86_400_000));
  const reservations = (database.reservations || [])
    .filter((reservation) => reservation.checkOut >= from && reservation.checkIn <= to)
    .sort((a, b) => String(a.checkIn).localeCompare(String(b.checkIn)))
    .slice(-80);
  const customerIds = new Set(reservations.map((reservation) => reservation.customerId));
  return {
    fechaActual: localDate(now),
    resumenDeHoy: summary,
    estadias: reservations.map((reservation) => ({
      codigo: reservation.id,
      clienteId: reservation.customerId,
      huesped: reservation.guestName,
      alojamiento: reservation.propertyName,
      checkIn: `${reservation.checkIn} ${reservation.checkInTime || '15:00'}`,
      checkOut: `${reservation.checkOut} ${reservation.checkOutTime || '11:00'}`,
      huespedes: reservation.guests,
      total: reservation.total,
      estado: reservation.status,
      pago: reservation.paymentStatus,
      qrEnTerminal: reservation.dahuaQrStatus,
      rostro: reservation.dahuaStatus,
      terminal: reservation.dahuaTerminal || '',
      solicitudesEspeciales: clip(reservation.specialRequests, 200),
    })),
    clientes: (database.customers || []).filter((customer) => customerIds.has(customer.id)).map((customer) => ({
      id: customer.id,
      nombre: customer.name,
      rut: customer.documentId,
      correo: customer.email,
      telefono: customer.phone,
      notas: clip(customer.notes, 200),
    })),
    totalClientes: (database.customers || []).length,
    alojamientos: (database.properties || []).map((property) => ({
      id: property.id,
      nombre: property.name,
      ubicacion: property.place,
      capacidad: property.guests,
      tarifaNocheCLP: property.price,
      publicado: property.active !== false,
      terminal: property.dahuaRegistrationId || 'por omisión',
    })),
  };
}

// El modelo es pequeño y tiende a responder en el idioma de las instrucciones
// (español): se detecta el idioma de la pregunta y se le indica explícitamente.
const LANGUAGE_HINTS = [
  ['inglés', 'English', /\b(the|and|you|your|is|are|do|does|have|has|what|where|when|how|which|can|could|would|people|for|with|near|room|price|check|book|need|want|looking|please|thanks?)\b/g],
  ['portugués', 'português', /\b(você|vocês|quero|gostaria|obrigad[oa]|pessoas|perto|praia|quanto|custa|reserva[r]?|noites|não|está|são|onde|com|uma|um)\b/g],
  ['español', 'español', /\b(el|la|los|las|que|para|con|una|un|donde|cuánto|cuanto|quiero|necesito|somos|personas|cerca|playa|reserva|noches|hola|gracias|qué|cómo|está)\b/g],
];

export function detectLanguage(textValue) {
  const sample = ` ${String(textValue || '').toLowerCase()} `;
  let best = { name: 'español', native: 'español', score: 0 };
  for (const [name, native, pattern] of LANGUAGE_HINTS) {
    const score = (sample.match(pattern) || []).length;
    if (score > best.score) best = { name, native, score };
  }
  return best.score >= 2 ? best : { name: 'español', native: 'español', score: 0 };
}

export function languageInstruction(question) {
  const language = detectLanguage(question);
  if (language.name === 'español') return 'IDIOMA DE LA RESPUESTA: español.';
  return `IDIOMA DE LA RESPUESTA: ${language.name}. The user wrote in ${language.native === 'English' ? 'English' : language.native}: answer ONLY in ${language.native}, translating any information from the data.`;
}
