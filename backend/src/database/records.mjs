// Traducción entre las filas de la base y los objetos que usa el gestor. Es
// común a SQLite y SQL Server: cada motor sólo se encarga de leer y escribir.

export function now() {
  return new Date().toISOString();
}

export function integer(value, fallback = 0) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function decimal(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

// SQLite devuelve 1/0 y SQL Server true/false en las columnas lógicas.
export function flag(value) {
  return value === true || Number(value) === 1;
}

export const SCHEMA_VERSION = '9';

export const CUSTOMER_COLUMNS = [
  'id', 'nombre_completo', 'rut', 'correo', 'telefono', 'correo_verificado',
  'nacionalidad', 'fecha_nacimiento', 'contacto_emergencia_nombre',
  'contacto_emergencia_telefono', 'notas', 'estado', 'ultima_estadia_at',
  'owner_uid', 'creado_at', 'actualizado_at',
];

export const PROPERTY_COLUMNS = [
  'id', 'nombre', 'tipo', 'ubicacion', 'direccion', 'comuna', 'region', 'descripcion',
  'propietario_nombre', 'propietario_rut', 'propietario_correo', 'propietario_telefono',
  'huespedes_max', 'dormitorios', 'camas', 'banos', 'precio_noche', 'moneda',
  'calificacion', 'hora_check_in', 'hora_check_out', 'latitud', 'longitud',
  'dahua_registration_id', 'manual_publico', 'manual_huesped', 'publicado', 'creado_at', 'actualizado_at',
];

export const RESERVATION_COLUMNS = [
  'codigo', 'cliente_id', 'alojamiento_id', 'huesped_nombre', 'huesped_rut',
  'huesped_correo', 'huesped_telefono', 'alojamiento_nombre',
  'alojamiento_ubicacion', 'fecha_check_in', 'fecha_check_out', 'hora_check_in',
  'hora_check_out', 'huespedes', 'adultos', 'ninos', 'noches', 'tarifa_noche',
  'subtotal', 'tarifa_limpieza', 'tarifa_servicio', 'impuestos', 'total', 'moneda',
  'estado', 'vence_at', 'vencida_at', 'owner_uid', 'pago_estado', 'pago_referencia',
  'pin_acceso', 'solicitudes_especiales', 'token_verificacion_hash',
  'token_verificacion_pendiente', 'correo_verificacion_enviado_at',
  'error_correo_verificacion', 'correo_verificado_at',
  'comprobante_enviado_at', 'error_comprobante', 'error_verificacion',
  'biometria_perfil_id', 'biometria_plantilla_cifrada', 'biometria_estado', 'biometria_consentimiento_at',
  'biometria_registrada_at', 'biometria_expira_at', 'biometria_revocada_at',
  'biometria_ultima_verificacion_at', 'biometria_ultimo_puntaje',
  'biometria_ultimo_error',
  'dahua_user_id', 'dahua_rec_no', 'dahua_estado', 'dahua_error',
  'dahua_registrado_at', 'dahua_verificado_at', 'dahua_revocado_at',
  'dahua_qr_codigo', 'dahua_qr_estado', 'dahua_qr_error', 'dahua_qr_registrado_at',
  'dahua_terminal', 'pago_token', 'pago_detalle',
  'creado_at', 'actualizado_at',
];

// images: filas de alojamiento_imagenes ordenadas (principal primero).
export function propertyFromRow(row, images, tags) {
  const primary = images.find((image) => flag(image.es_principal)) || images[0];
  const secondary = images.filter((image) => image !== primary).slice(0, 2);
  while (secondary.length < 2 && primary) secondary.push(primary);
  return {
    id: row.id,
    name: row.nombre,
    place: row.ubicacion,
    type: row.tipo,
    address: row.direccion,
    commune: row.comuna,
    region: row.region,
    description: row.descripcion,
    ownerName: row.propietario_nombre,
    ownerDocumentId: row.propietario_rut,
    ownerEmail: row.propietario_correo,
    ownerPhone: row.propietario_telefono,
    guests: row.huespedes_max,
    beds: row.dormitorios,
    bedCount: row.camas,
    baths: row.banos,
    price: row.precio_noche,
    currency: row.moneda,
    rating: row.calificacion,
    checkInTime: row.hora_check_in,
    checkOutTime: row.hora_check_out,
    latitude: row.latitud,
    longitude: row.longitud,
    // Registration ID del terminal Dahua (hub) que atiende este alojamiento.
    dahuaRegistrationId: row.dahua_registration_id || '',
    // Información para Blu: la pública la ve cualquier viajero; la del
    // huésped sólo quien tiene una estadía confirmada en la vivienda.
    guidePublic: row.manual_publico || '',
    guidePrivate: row.manual_huesped || '',
    image: primary?.url || '',
    gallery: secondary.map((image, index) => ({
      src: image.url,
      alt: image.texto_alternativo || `${row.nombre} fotografía ${index + 2}`,
    })),
    tags,
    active: flag(row.publicado),
    createdAt: row.creado_at,
    updatedAt: row.actualizado_at,
  };
}

export function customerFromRow(row) {
  return {
    id: row.id,
    name: row.nombre_completo,
    documentId: row.rut,
    email: row.correo,
    phone: row.telefono,
    emailVerified: flag(row.correo_verificado),
    nationality: row.nacionalidad,
    birthDate: row.fecha_nacimiento || '',
    emergencyContactName: row.contacto_emergencia_nombre,
    emergencyContactPhone: row.contacto_emergencia_telefono,
    notes: row.notas,
    status: row.estado,
    lastReservationAt: row.ultima_estadia_at,
    ownerUid: row.owner_uid || '',
    createdAt: row.creado_at,
    updatedAt: row.actualizado_at,
  };
}

export function reservationFromRow(row) {
  return {
    id: row.codigo,
    customerId: row.cliente_id,
    propertyId: row.alojamiento_id,
    guestName: row.huesped_nombre || '',
    guestDocumentId: row.huesped_rut || '',
    guestEmail: row.huesped_correo || '',
    guestPhone: row.huesped_telefono || '',
    propertyName: row.alojamiento_nombre,
    propertyPlace: row.alojamiento_ubicacion,
    checkIn: row.fecha_check_in,
    checkOut: row.fecha_check_out,
    checkInTime: row.hora_check_in,
    checkOutTime: row.hora_check_out,
    guests: row.huespedes,
    adults: row.adultos,
    children: row.ninos,
    nights: row.noches,
    nightlyPrice: row.tarifa_noche,
    subtotal: row.subtotal,
    cleaningFee: row.tarifa_limpieza,
    serviceFee: row.tarifa_servicio,
    taxes: row.impuestos,
    total: row.total,
    currency: row.moneda,
    status: row.estado,
    expiresAt: row.vence_at || '',
    expiredAt: row.vencida_at || '',
    ownerUid: row.owner_uid || '',
    paymentStatus: row.pago_estado || 'no-realizado-demo',
    paymentReference: row.pago_referencia || '',
    accessPin: row.pin_acceso,
    specialRequests: row.solicitudes_especiales,
    verificationTokenHash: row.token_verificacion_hash || '',
    verificationTokenPending: row.token_verificacion_pendiente || '',
    verificationEmailSentAt: row.correo_verificacion_enviado_at,
    verificationEmailError: row.error_correo_verificacion,
    emailVerifiedAt: row.correo_verificado_at,
    confirmationEmailSentAt: row.comprobante_enviado_at,
    confirmationEmailError: row.error_comprobante,
    verificationCheckError: row.error_verificacion,
    biometricProfileId: row.biometria_perfil_id || '',
    biometricTemplateEncrypted: row.biometria_plantilla_cifrada || '',
    biometricStatus: row.biometria_estado || 'sin-registrar',
    biometricConsentAt: row.biometria_consentimiento_at,
    biometricEnrolledAt: row.biometria_registrada_at,
    biometricExpiresAt: row.biometria_expira_at,
    biometricRevokedAt: row.biometria_revocada_at,
    biometricLastVerifiedAt: row.biometria_ultima_verificacion_at,
    biometricLastScore: row.biometria_ultimo_puntaje,
    biometricLastError: row.biometria_ultimo_error,
    dahuaUserId: row.dahua_user_id || '',
    dahuaRecNo: row.dahua_rec_no || '',
    dahuaStatus: row.dahua_estado || 'sin-registrar',
    dahuaError: row.dahua_error || '',
    dahuaEnrolledAt: row.dahua_registrado_at,
    dahuaVerifiedAt: row.dahua_verificado_at,
    dahuaRevokedAt: row.dahua_revocado_at,
    dahuaQrCode: row.dahua_qr_codigo || '',
    dahuaQrStatus: row.dahua_qr_estado || 'sin-registrar',
    dahuaQrError: row.dahua_qr_error || '',
    dahuaQrEnrolledAt: row.dahua_qr_registrado_at,
    // Terminal donde quedó la persona: 'lan' (red local) o un Registration ID del hub.
    dahuaTerminal: row.dahua_terminal || '',
    paymentToken: row.pago_token || '',
    paymentDetail: row.pago_detalle || '',
    createdAt: row.creado_at,
    updatedAt: row.actualizado_at,
  };
}

export function customerValues(customer, updatedAt) {
  return [
    customer.id,
    customer.name || '',
    customer.documentId || '',
    String(customer.email || '').toLowerCase(),
    customer.phone || '',
    customer.emailVerified ? 1 : 0,
    customer.nationality || 'Chile',
    customer.birthDate || null,
    customer.emergencyContactName || '',
    customer.emergencyContactPhone || '',
    customer.notes || '',
    customer.status === 'inactivo' ? 'inactivo' : 'activo',
    customer.lastReservationAt || null,
    customer.ownerUid || '',
    customer.createdAt || updatedAt,
    customer.updatedAt || updatedAt,
  ];
}

export function propertyValues(property, updatedAt) {
  return [
    property.id,
    property.name || '',
    property.type || '',
    property.place || '',
    property.address || '',
    property.commune || '',
    property.region || '',
    property.description || '',
    property.ownerName || '',
    property.ownerDocumentId || '',
    String(property.ownerEmail || '').toLowerCase(),
    property.ownerPhone || '',
    Math.max(1, integer(property.guests, 1)),
    Math.max(1, integer(property.beds, 1)),
    Math.max(1, integer(property.bedCount, property.beds || 1)),
    Math.max(1, integer(property.baths, 1)),
    Math.max(0, integer(property.price, 0)),
    property.currency || 'CLP',
    Math.min(5, Math.max(0, decimal(property.rating, 0))),
    property.checkInTime || '15:00',
    property.checkOutTime || '11:00',
    property.latitude ?? null,
    property.longitude ?? null,
    property.dahuaRegistrationId || '',
    property.guidePublic || '',
    property.guidePrivate || '',
    property.active === false ? 0 : 1,
    property.createdAt || updatedAt,
    property.updatedAt || updatedAt,
  ];
}

// Filas de alojamiento_imagenes: [url, texto_alternativo, es_principal, orden].
export function propertyImages(property) {
  const images = [];
  if (property.image) images.push([property.image, `${property.name} imagen principal`, 1, 0]);
  for (const [index, image] of (property.gallery || []).entries()) {
    if (image?.src) images.push([image.src, image.alt || '', 0, index + 1]);
  }
  return images;
}

// Sin repetir etiquetas que sólo difieren en mayúsculas: SQL Server las
// considera iguales en la clave primaria.
export function propertyTags(property) {
  const tags = new Map();
  for (const tag of property.tags || []) {
    const value = String(tag).trim();
    if (value && !tags.has(value.toLowerCase())) tags.set(value.toLowerCase(), value);
  }
  return [...tags.values()];
}

export function reservationValues(reservation, customers, updatedAt) {
  const legacyGuest = (customers || []).find((customer) => customer.id === reservation.customerId);
  const subtotal = Math.max(0, integer(reservation.subtotal, reservation.nightlyPrice * reservation.nights || reservation.total));
  return [
    reservation.id,
    reservation.customerId,
    reservation.propertyId,
    reservation.guestName || legacyGuest?.name || '',
    reservation.guestDocumentId || legacyGuest?.documentId || '',
    reservation.guestEmail || legacyGuest?.email || '',
    reservation.guestPhone || legacyGuest?.phone || '',
    reservation.propertyName || '',
    reservation.propertyPlace || '',
    reservation.checkIn || '',
    reservation.checkOut || '',
    reservation.checkInTime || '15:00',
    reservation.checkOutTime || '11:00',
    Math.max(1, integer(reservation.guests, 1)),
    Math.max(0, integer(reservation.adults, reservation.guests || 1)),
    Math.max(0, integer(reservation.children, 0)),
    Math.max(1, integer(reservation.nights, 1)),
    Math.max(0, integer(reservation.nightlyPrice, subtotal / Math.max(1, reservation.nights || 1))),
    subtotal,
    Math.max(0, integer(reservation.cleaningFee, 0)),
    Math.max(0, integer(reservation.serviceFee, 0)),
    Math.max(0, integer(reservation.taxes, 0)),
    Math.max(0, integer(reservation.total, 0)),
    reservation.currency || 'CLP',
    reservation.status || 'pendiente-verificacion',
    reservation.expiresAt || null,
    reservation.expiredAt || null,
    reservation.ownerUid || '',
    reservation.paymentStatus || 'no-realizado-demo',
    reservation.paymentReference || '',
    reservation.accessPin || '',
    reservation.specialRequests || '',
    reservation.verificationTokenHash || null,
    reservation.verificationTokenPending || null,
    reservation.verificationEmailSentAt || null,
    reservation.verificationEmailError || null,
    reservation.emailVerifiedAt || null,
    reservation.confirmationEmailSentAt || null,
    reservation.confirmationEmailError || null,
    reservation.verificationCheckError || null,
    reservation.biometricProfileId || null,
    reservation.biometricTemplateEncrypted || null,
    reservation.biometricStatus || 'sin-registrar',
    reservation.biometricConsentAt || null,
    reservation.biometricEnrolledAt || null,
    reservation.biometricExpiresAt || null,
    reservation.biometricRevokedAt || null,
    reservation.biometricLastVerifiedAt || null,
    reservation.biometricLastScore ?? null,
    reservation.biometricLastError || null,
    reservation.dahuaUserId || null,
    reservation.dahuaRecNo || null,
    reservation.dahuaStatus || 'sin-registrar',
    reservation.dahuaError || null,
    reservation.dahuaEnrolledAt || null,
    reservation.dahuaVerifiedAt || null,
    reservation.dahuaRevokedAt || null,
    reservation.dahuaQrCode || null,
    reservation.dahuaQrStatus || 'sin-registrar',
    reservation.dahuaQrError || null,
    reservation.dahuaQrEnrolledAt || null,
    reservation.dahuaTerminal || '',
    reservation.paymentToken || '',
    reservation.paymentDetail || '',
    reservation.createdAt || updatedAt,
    reservation.updatedAt || updatedAt,
  ];
}

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

// Compara lo que se leyó (snapshot), lo que hay guardado ahora (latest) y lo
// que se quiere guardar (database). Combina cambios de distintos campos y
// rechaza los que pisarían una modificación concurrente del mismo campo.
export function planCollection(name, snapshot, latest, database) {
  const before = new Map((snapshot[name] || []).map((item) => [item.id, item]));
  const stored = new Map((latest[name] || []).map((item) => [item.id, item]));
  const wanted = new Map((database[name] || []).map((item) => [item.id, item]));
  const upserts = [];
  const removals = [];
  for (const [id, item] of wanted) {
    const original = before.get(id);
    if (original && same(item, original)) continue;
    const current = stored.get(id);
    if (!original) {
      if (current) throw new Error(`Conflicto de ${name}: el identificador ${id} ya existe.`);
      upserts.push({ item, value: item, existing: false });
      continue;
    }
    if (!current) throw new Error(`Conflicto de ${name}: el registro ${id} fue eliminado.`);
    const merged = { ...current };
    for (const key of new Set([...Object.keys(original), ...Object.keys(item)])) {
      if (same(item[key], original[key])) continue;
      if (key === 'updatedAt' || key === 'lastReservationAt') {
        merged[key] = [current[key], item[key]].filter(Boolean).sort().at(-1) || '';
        continue;
      }
      if (!same(current[key], original[key]) && !same(current[key], item[key])) {
        throw new Error(`Conflicto de ${name}: ${id} cambió mientras se guardaba. Reintenta la operación.`);
      }
      if (Object.hasOwn(item, key)) merged[key] = item[key];
      else delete merged[key];
    }
    upserts.push({ item, value: merged, existing: true });
  }
  for (const [id, original] of before) {
    if (wanted.has(id)) continue;
    if (!stored.has(id) || !same(stored.get(id), original)) {
      throw new Error(`Conflicto de ${name}: ${id} cambió antes de eliminarse.`);
    }
    removals.push(id);
  }
  return { upserts, removals };
}

// Tras guardar, el objeto en memoria queda igual a lo persistido.
export function refreshFromPersisted(database, persisted) {
  for (const name of ['customers', 'properties', 'reservations']) {
    const rows = new Map(persisted[name].map((row) => [row.id, row]));
    for (const item of database[name] || []) {
      const value = rows.get(item.id);
      if (!value) continue;
      for (const key of Object.keys(item)) {
        if (!Object.hasOwn(value, key)) delete item[key];
      }
      Object.assign(item, value);
    }
  }
}

export function accessEventFromRow(row) {
  return { ...row, authorized: flag(row.authorized) };
}
