import { FIREBASE_API_KEY, FIRESTORE_DOCUMENTS, LOCAL_DATA_API } from '../config';
import type { CustomerProfile, ReservationProcessingStatus } from '../domain/types';
import { accountSession } from './account';
import { firestoreDocumentData, firestoreFields, usesLocalManager } from './firebase';

// Perfil del cliente: se guarda en Firestore (customer_profiles/{uid}) y sólo
// su dueño puede leerlo o cambiarlo. Sirve para completar el formulario de
// reserva; el gestor recibe los datos con cada reserva.
export async function loadCustomerProfile(): Promise<CustomerProfile | null> {
  const { session } = await accountSession();
  const response = await fetch(
    `${FIRESTORE_DOCUMENTS}/customer_profiles/${encodeURIComponent(session.uid)}?key=${encodeURIComponent(FIREBASE_API_KEY)}`,
    { cache: 'no-store', headers: { Authorization: `Bearer ${session.idToken}` } },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('No fue posible cargar tu perfil.');
  const data = firestoreDocumentData(await response.json());
  const field = (value: unknown) => (typeof value === 'string' ? value : '');
  return {
    name: field(data.name),
    documentId: field(data.documentId),
    phone: field(data.phone),
    birthDate: field(data.birthDate),
    nationality: field(data.nationality),
    emergencyContactName: field(data.emergencyContactName),
    emergencyContactPhone: field(data.emergencyContactPhone),
    favorites: Array.isArray(data.favorites) ? data.favorites.map(Number).filter(Number.isInteger) : [],
  };
}

export const RUT_TAKEN_MESSAGE = 'Este RUT ya está registrado con otra cuenta RestBlu. Ingresa con el correo con que lo registraste.';

function rutKey(documentId: string) {
  return documentId.replace(/[^0-9kK]/g, '').toUpperCase();
}

// Reserva el RUT para la cuenta: rut_index/{RUT} sólo lo puede crear la
// primera cuenta que lo registra (lo exigen las reglas de Firestore).
async function claimRut(documentId: string, session: { uid: string; idToken: string }) {
  const key = rutKey(documentId);
  const base = `${FIRESTORE_DOCUMENTS}/rut_index`;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${session.idToken}` };
  const created = await fetch(`${base}?documentId=${encodeURIComponent(key)}&key=${encodeURIComponent(FIREBASE_API_KEY)}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ fields: firestoreFields({ uid: session.uid, createdAt: new Date().toISOString() }) }),
  });
  if (created.ok) return;
  // Ya existe: sólo se puede leer si es de esta misma cuenta.
  const own = await fetch(`${base}/${encodeURIComponent(key)}?key=${encodeURIComponent(FIREBASE_API_KEY)}`, { headers });
  if (own.ok) return;
  // Sólo un 409 (ya existe) significa que otra cuenta tiene el RUT; un 403 sin
  // documento es un rechazo de las reglas, no un RUT tomado.
  throw new Error(created.status === 409 ? RUT_TAKEN_MESSAGE : 'No fue posible validar el RUT. Inténtalo nuevamente.');
}

async function releaseRut(documentId: string, session: { idToken: string }) {
  await fetch(`${FIRESTORE_DOCUMENTS}/rut_index/${encodeURIComponent(rutKey(documentId))}?key=${encodeURIComponent(FIREBASE_API_KEY)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${session.idToken}` },
  }).catch(() => {});
}

export async function saveCustomerProfile(profile: CustomerProfile, previousDocumentId = '') {
  const { session } = await accountSession();
  await claimRut(profile.documentId, session);
  const response = await fetch(
    `${FIRESTORE_DOCUMENTS}/customer_profiles/${encodeURIComponent(session.uid)}?key=${encodeURIComponent(FIREBASE_API_KEY)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.idToken}` },
      body: JSON.stringify({
        fields: firestoreFields({
          name: profile.name.trim(),
          documentId: profile.documentId.trim(),
          phone: profile.phone.trim(),
          birthDate: (profile.birthDate || '').trim(),
          nationality: (profile.nationality || '').trim(),
          emergencyContactName: (profile.emergencyContactName || '').trim(),
          emergencyContactPhone: (profile.emergencyContactPhone || '').trim(),
          favorites: profile.favorites || [],
          updatedAt: new Date().toISOString(),
        }),
      }),
    },
  );
  if (!response.ok) throw new Error('No fue posible guardar tu perfil.');
  // Al cambiar el RUT se libera el anterior para que no quede tomado.
  if (previousDocumentId && rutKey(previousDocumentId) !== rutKey(profile.documentId)) {
    await releaseRut(previousDocumentId, session);
  }
}

// Favoritos: sólo cambia esa lista del perfil (el RUT ya está registrado).
export async function saveFavorites(favorites: number[]) {
  const { session } = await accountSession();
  const mask = 'updateMask.fieldPaths=favorites&updateMask.fieldPaths=updatedAt';
  const response = await fetch(
    `${FIRESTORE_DOCUMENTS}/customer_profiles/${encodeURIComponent(session.uid)}?${mask}&key=${encodeURIComponent(FIREBASE_API_KEY)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.idToken}` },
      body: JSON.stringify({ fields: firestoreFields({ favorites, updatedAt: new Date().toISOString() }) }),
    },
  );
  if (!response.ok) throw new Error('No fue posible guardar tus favoritos.');
}

// Elimina el perfil y libera el RUT (la cuenta se borra después en account.ts).
export async function deleteCustomerData(documentId: string) {
  const { session } = await accountSession();
  const headers = { Authorization: `Bearer ${session.idToken}` };
  await fetch(`${FIRESTORE_DOCUMENTS}/customer_profiles/${encodeURIComponent(session.uid)}?key=${encodeURIComponent(FIREBASE_API_KEY)}`, { method: 'DELETE', headers });
  if (documentId) await releaseRut(documentId, session);
}

export type CustomerReservation = ReservationProcessingStatus & {
  booking: NonNullable<ReservationProcessingStatus['booking']>;
};

const LIST_FIELDS = [
  'id', 'status', 'verified', 'emailVerified', 'paymentStatus', 'expiresAt', 'expiredAt',
  'dahuaQrStatus', 'biometricStatus', 'booking',
];

// Reservas de la cuenta, desde cualquier dispositivo. En la nube se leen de
// reservation_status (las reglas sólo entregan las del propio uid); con el
// gestor local, desde su API con el token de la cuenta.
export async function loadCustomerReservations(): Promise<CustomerReservation[]> {
  const { session } = await accountSession();
  let items: ReservationProcessingStatus[];
  if (usesLocalManager()) {
    const response = await fetch(`${LOCAL_DATA_API}/my/reservations`, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${session.idToken}` },
    });
    const data = await response.json().catch(() => ({})) as { reservations?: ReservationProcessingStatus[]; error?: string };
    if (!response.ok) throw new Error(data.error || 'No fue posible cargar tus reservas.');
    items = data.reservations || [];
  } else {
    const response = await fetch(`${FIRESTORE_DOCUMENTS}:runQuery?key=${encodeURIComponent(FIREBASE_API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.idToken}` },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'reservation_status' }],
          where: { fieldFilter: { field: { fieldPath: 'ownerUid' }, op: 'EQUAL', value: { stringValue: session.uid } } },
          select: { fields: LIST_FIELDS.map((fieldPath) => ({ fieldPath })) },
          limit: 100,
        },
      }),
    });
    if (!response.ok) throw new Error('No fue posible cargar tus reservas.');
    const rows = await response.json() as { document?: { fields?: Record<string, never> } }[];
    items = rows.filter((row) => row.document)
      .map((row) => firestoreDocumentData(row.document!) as ReservationProcessingStatus);
  }
  return items
    .filter((item): item is CustomerReservation => Boolean(item.booking?.id))
    .sort((left, right) => String(right.booking.createdAt).localeCompare(String(left.booking.createdAt)));
}
