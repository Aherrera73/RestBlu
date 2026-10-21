import { randomUUID } from 'node:crypto';
import { text, validEmail } from '../shared/normalizers.mjs';

export class OwnerError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Estos propietarios son titulares de alojamientos. reservation.ownerUid sigue
// identificando al huésped y nunca concede acceso al panel de propietarios.
export function ownerFromInput(input, { existing = null, owners = [], properties = [] } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new OwnerError('Datos de propietario inválidos.');
  const name = text(input.name, 120);
  const email = text(input.email, 160).toLowerCase();
  const phone = text(input.phone, 60);
  if (!name || !validEmail(email)) throw new OwnerError('Nombre y correo válido del propietario son obligatorios.');
  if (existing && email !== existing.email.toLowerCase()) {
    throw new OwnerError('El correo está vinculado a la cuenta del propietario y no se puede cambiar aquí.');
  }
  if (input.active !== undefined && typeof input.active !== 'boolean') throw new OwnerError('El estado del propietario debe ser activo o inactivo.');
  if (!Array.isArray(input.propertyIds)) throw new OwnerError('Selecciona las propiedades asignadas.');
  const propertyIds = [...new Set(input.propertyIds.map((value) => {
    if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
      throw new OwnerError('Una propiedad seleccionada no es válida.');
    }
    return Number(value);
  }))].sort((a, b) => a - b);
  if (propertyIds.some((id) => !properties.some((property) => property.id === id))) {
    throw new OwnerError('Una propiedad seleccionada ya no existe.');
  }
  if (owners.some((owner) => owner.id !== existing?.id && owner.email.toLowerCase() === email)) {
    throw new OwnerError('Este correo ya tiene un propietario registrado.', 409);
  }
  if (owners.some((owner) => owner.id !== existing?.id && owner.propertyIds.some((id) => propertyIds.includes(id)))) {
    throw new OwnerError('Una propiedad seleccionada ya está asignada a otro propietario. Edita primero su asignación.', 409);
  }
  const now = new Date().toISOString();
  return {
    id: existing?.id || randomUUID(),
    uid: existing?.uid || '',
    name, email, phone,
    active: input.active ?? existing?.active ?? true,
    propertyIds,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
}

// Firebase genera la identidad. El gestor no elige UID ni recibe contraseñas.
// No se envían invitaciones ni correos al registrar el propietario.
export async function ownerFirebaseUser(auth, owner) {
  let user;
  try {
    user = owner.uid ? await auth.getUser(owner.uid) : await auth.getUserByEmail(owner.email);
  } catch (error) {
    if (error?.code !== 'auth/user-not-found' || owner.uid) throw error;
    try {
      user = await auth.createUser({ email: owner.email, displayName: owner.name, emailVerified: false });
    } catch (createError) {
      if (createError?.code !== 'auth/email-already-exists') throw createError;
      user = await auth.getUserByEmail(owner.email);
    }
  }
  if (user.disabled) throw new OwnerError('La cuenta de Firebase está deshabilitada. Revisa la cuenta antes de asignarla.', 409);
  if (!user.uid || String(user.email || '').toLowerCase() !== owner.email) {
    throw new OwnerError('La identidad vinculada ya no coincide con el correo del propietario.', 409);
  }
  return user;
}

export async function verifiedOwnerIdentity(auth, token) {
  if (!token) throw new OwnerError('Inicia sesión con tu cuenta de propietario.', 401);
  try {
    const identity = await auth.verifyIdToken(token, true);
    const user = await auth.getUser(identity.uid);
    if (!identity.email || identity.email_verified !== true || user.disabled || !user.emailVerified || !user.email ||
        user.email.toLowerCase() !== identity.email.toLowerCase()) throw new Error('Cuenta no verificada.');
    return { uid: user.uid, email: user.email.toLowerCase() };
  } catch {
    throw new OwnerError('Tu sesión debe estar vigente y tu correo verificado. Vuelve a iniciar sesión.', 401);
  }
}

// Lista blanca de datos: no devolver documentos, contactos del huésped, claves,
// QR/PIN, biometría, tokens de pago ni credenciales o terminales de acceso.
export function ownerDashboard(database, owners, identity) {
  const owner = owners.find((item) => item.uid === identity.uid && item.active === true);
  if (!owner || owner.email.toLowerCase() !== identity.email.toLowerCase()) {
    throw new OwnerError('Esta cuenta no tiene un acceso de propietario activo. Solicita el alta al administrador.', 403);
  }
  const allowed = new Set(owner.propertyIds);
  const properties = database.properties.filter((item) => allowed.has(item.id)).map((item) => ({
    id: item.id, name: item.name, place: item.place, image: item.image || '',
    nightlyPrice: Number(item.price || 0), currency: item.currency || 'CLP',
    active: item.active !== false, rating: Number(item.rating || 0), guests: Number(item.guests || 0),
  }));
  const existing = new Set(properties.map((item) => item.id));
  const reservations = database.reservations.filter((item) => existing.has(Number(item.propertyId))).map((item) => ({
    id: item.id, propertyId: Number(item.propertyId), propertyName: item.propertyName,
    guestName: item.guestName || '', checkIn: item.checkIn, checkOut: item.checkOut,
    guests: Number(item.guests || 0), nights: Number(item.nights || 0), total: Number(item.total || 0),
    currency: item.currency || 'CLP', status: item.status, paymentStatus: item.paymentStatus || '', createdAt: item.createdAt,
  }));
  return { owner: { id: owner.id, name: owner.name, email: owner.email, phone: owner.phone }, properties, reservations };
}

export function ownerFromRow(row, propertyIds = []) {
  return {
    id: row.id, uid: row.firebase_uid, name: row.nombre, email: row.correo,
    phone: row.telefono, active: row.activo === true || Number(row.activo) === 1,
    propertyIds: propertyIds.map(Number), createdAt: row.creado_at, updatedAt: row.actualizado_at,
  };
}
