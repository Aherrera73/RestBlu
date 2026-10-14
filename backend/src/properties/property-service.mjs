import {
  decimal,
  formatRut,
  integer,
  normalizeTags,
  text,
  validEmail,
  validRut,
} from '../shared/normalizers.mjs';

export function propertyFromInput(input, existing = {}) {
  const name = text(input.name, 100);
  const place = text(input.place, 120);
  const type = text(input.type, 80);
  const image = text(input.image, 1000);
  if (!name || !place || !type || !image) {
    throw new Error('Nombre, ubicación, tipo e imagen principal son obligatorios.');
  }
  const ownerName = text(input.ownerName ?? existing.ownerName, 120);
  const ownerDocumentId = formatRut(input.ownerDocumentId ?? existing.ownerDocumentId);
  const ownerEmail = text(input.ownerEmail ?? existing.ownerEmail, 160).toLowerCase();
  const ownerPhone = text(input.ownerPhone ?? existing.ownerPhone, 60);
  if (!ownerName || !ownerDocumentId || !ownerEmail || !ownerPhone) {
    throw new Error('Nombre, RUT, correo y teléfono del propietario son obligatorios.');
  }
  if (!validRut(ownerDocumentId)) {
    throw new Error('El RUT del propietario no es válido.');
  }
  if (!validEmail(ownerEmail)) {
    throw new Error('El correo del propietario no es válido.');
  }
  // Terminal Dahua del alojamiento (Registration ID del Auto Register, ej. PROP-0001).
  const dahuaRegistrationId = text(input.dahuaRegistrationId ?? existing.dahuaRegistrationId, 64);
  if (dahuaRegistrationId && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(dahuaRegistrationId)) {
    throw new Error('El terminal Dahua debe ser un Registration ID como PROP-0001 (letras, números, punto, guion).');
  }
  const galleryInput = Array.isArray(input.gallery) ? input.gallery : [];
  const fallbackGallery = existing.gallery || [];
  const gallery = [0, 1].map((index) => ({
    src: text(galleryInput[index]?.src || fallbackGallery[index]?.src || image, 1000),
    alt: text(galleryInput[index]?.alt || `${name} fotografía ${index + 2}`, 180),
  }));
  return {
    ...existing,
    name,
    place,
    type,
    address: text(input.address ?? existing.address, 220),
    commune: text(input.commune ?? existing.commune, 100),
    region: text(input.region ?? existing.region, 100),
    description: text(input.description ?? existing.description, 2000),
    ownerName,
    ownerDocumentId,
    ownerEmail,
    ownerPhone,
    dahuaRegistrationId,
    // Manual para Blu: público (cualquier viajero) y del huésped (sólo con
    // estadía confirmada: Wi-Fi, cómo entrar, contacto).
    guidePublic: text(input.guidePublic ?? existing.guidePublic, 3000),
    guidePrivate: text(input.guidePrivate ?? existing.guidePrivate, 3000),
    guests: Math.max(1, integer(input.guests, existing.guests || 1)),
    beds: Math.max(1, integer(input.beds, existing.beds || 1)),
    bedCount: Math.max(1, integer(input.bedCount, existing.bedCount || input.beds || 1)),
    baths: Math.max(1, integer(input.baths, existing.baths || 1)),
    price: Math.max(0, integer(input.price, existing.price || 0)),
    currency: text(input.currency ?? existing.currency, 8) || 'CLP',
    rating: Math.min(5, Math.max(0, decimal(input.rating, existing.rating || 4.8))),
    checkInTime: text(input.checkInTime ?? existing.checkInTime, 5) || '15:00',
    checkOutTime: text(input.checkOutTime ?? existing.checkOutTime, 5) || '11:00',
    latitude: input.latitude === '' || input.latitude == null
      ? existing.latitude ?? null
      : decimal(input.latitude, existing.latitude ?? 0),
    longitude: input.longitude === '' || input.longitude == null
      ? existing.longitude ?? null
      : decimal(input.longitude, existing.longitude ?? 0),
    image,
    gallery,
    tags: normalizeTags(input.tags),
    active: input.active !== false,
    updatedAt: new Date().toISOString(),
  };
}

export function publicProperty(property, unavailableRanges = []) {
  return {
    id: property.id,
    name: property.name,
    place: property.place,
    type: property.type,
    guests: property.guests,
    beds: property.beds,
    baths: property.baths,
    price: `$${Number(property.price || 0).toLocaleString('es-CL')}`,
    rating: Number(property.rating || 0).toFixed(1),
    image: property.image,
    gallery: property.gallery,
    tags: property.tags,
    unavailableRanges,
  };
}
