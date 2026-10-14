import {
  FIREBASE_API_KEY,
  FIREBASE_SESSION_KEY,
  FIRESTORE_DOCUMENTS,
} from '../config';
import type {
  FirebaseSession,
  FirestoreValue,
  Property,
  ReservationProcessingStatus,
} from '../domain/types';

export function usesLocalManager() {
  return typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
}

export async function ensureFirebaseSession(): Promise<FirebaseSession> {
  let cached: FirebaseSession | null = null;
  try {
    cached = JSON.parse(localStorage.getItem(FIREBASE_SESSION_KEY) || 'null');
  } catch {
    cached = null;
  }
  if (cached?.idToken && cached.expiresAt > Date.now() + 60_000) return cached;

  const requestSession = async (refreshToken?: string) => {
    try {
      if (refreshToken) {
        return await fetch(
          `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(FIREBASE_API_KEY)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'refresh_token',
              refresh_token: refreshToken,
            }),
          },
        );
      }
      return await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(FIREBASE_API_KEY)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ returnSecureToken: true }),
        },
      );
    } catch {
      throw new Error(
        'No fue posible conectar con Firebase. Revisa tu conexión y vuelve a intentarlo.',
      );
    }
  };

  let response = await requestSession(cached?.refreshToken);
  if (!response.ok && cached?.refreshToken) {
    localStorage.removeItem(FIREBASE_SESSION_KEY);
    cached = null;
    response = await requestSession();
  }
  const data = (await response.json()) as {
    idToken?: string;
    id_token?: string;
    refreshToken?: string;
    refresh_token?: string;
    localId?: string;
    user_id?: string;
    expiresIn?: string;
    expires_in?: string;
  };
  if (!response.ok) throw new Error('No fue posible crear una sesión segura para la reserva.');
  const session: FirebaseSession = {
    idToken: data.idToken || data.id_token || '',
    refreshToken: data.refreshToken || data.refresh_token || cached?.refreshToken || '',
    uid: data.localId || data.user_id || cached?.uid || '',
    expiresAt: Date.now() + Number(data.expiresIn || data.expires_in || 3600) * 1000,
  };
  if (!session.idToken || !session.uid) throw new Error('Firebase no entregó una sesión válida.');
  localStorage.setItem(FIREBASE_SESSION_KEY, JSON.stringify(session));
  return session;
}

function toFirestoreValue(value: unknown): FirestoreValue {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }
  const fields = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      toFirestoreValue(item),
    ]),
  );
  return { mapValue: { fields } };
}

function fromFirestoreValue(value: FirestoreValue): unknown {
  if ('stringValue' in value) return value.stringValue || '';
  if ('integerValue' in value) return Number(value.integerValue || 0);
  if ('doubleValue' in value) return Number(value.doubleValue || 0);
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('arrayValue' in value) return (value.arrayValue?.values || []).map(fromFirestoreValue);
  if ('mapValue' in value) {
    return Object.fromEntries(
      Object.entries(value.mapValue?.fields || {}).map(([key, item]) => [
        key,
        fromFirestoreValue(item),
      ]),
    );
  }
  return null;
}

export function firestoreFields(input: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, toFirestoreValue(value)]),
  );
}

export function firestoreDocumentData(document: { fields?: Record<string, FirestoreValue> }) {
  return Object.fromEntries(
    Object.entries(document.fields || {}).map(([key, value]) => [
      key,
      fromFirestoreValue(value),
    ]),
  ) as Record<string, unknown>;
}

export async function loadCloudProperties() {
  const response = await fetch(
    `${FIRESTORE_DOCUMENTS}/public_properties?pageSize=100&key=${encodeURIComponent(FIREBASE_API_KEY)}`,
    { cache: 'no-store' },
  );
  if (!response.ok) throw new Error('No fue posible consultar el catálogo en la nube.');
  const data = (await response.json()) as {
    documents?: { fields?: Record<string, FirestoreValue> }[];
  };
  return (data.documents || []).map((document) => firestoreDocumentData(document)) as Property[];
}

export async function createCloudReservation(input: Record<string, unknown>) {
  const session = await ensureFirebaseSession();
  const id = typeof input.id === 'string' || typeof input.id === 'number'
    ? String(input.id)
    : '';
  const response = await fetch(
    `${FIRESTORE_DOCUMENTS}/reservation_intake?documentId=${encodeURIComponent(id)}&key=${encodeURIComponent(FIREBASE_API_KEY)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.idToken}`,
      },
      body: JSON.stringify({
        fields: firestoreFields({
          ...input,
          ownerUid: session.uid,
          syncStatus: 'pending',
          source: 'firebase-hosting',
          schemaVersion: 3,
          createdAt: new Date().toISOString(),
        }),
      }),
    },
  );
  if (response.status === 409) return;
  if (response.status === 429) {
    throw new Error(
      'Firebase alcanzó su límite de uso. La reserva no se guardó ni se envió un correo. Inténtalo cuando se restablezca la cuota.',
    );
  }
  if (!response.ok) throw new Error('No fue posible guardar la reserva en la base de datos en línea.');
}

export async function getCloudReservationStatus(
  id: string,
): Promise<ReservationProcessingStatus | null> {
  const session = await ensureFirebaseSession();
  const response = await fetch(
    `${FIRESTORE_DOCUMENTS}/reservation_status/${encodeURIComponent(id)}?key=${encodeURIComponent(FIREBASE_API_KEY)}`,
    {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${session.idToken}` },
    },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('No fue posible consultar el estado de la reserva.');
  const status = firestoreDocumentData(await response.json()) as ReservationProcessingStatus;
  // Un gestor antiguo pudo publicar "confirmada" tras verificar el correo,
  // sin registrar pago. Jamás entregar QR/PDF/PIN por ese estado heredado.
  status.emailVerified ??= Boolean(status.verified && status.confirmationEmailSentAt);
  if (status.paymentStatus !== 'aprobado-demo') {
    status.verified = false;
    status.pdfUrl = null;
    delete status.pdfBase64;
    delete status.pdfFileName;
    if (status.booking) delete status.booking.accessPin;
    delete status.accessQr;
    delete status.accessQrImage;
    delete status.accessQrExpiresAt;
  }
  return status;
}

export async function submitReservationVerification(reservationId: string, token: string) {
  const session = await ensureFirebaseSession();
  let response: Response;
  try {
    response = await fetch(
      `${FIRESTORE_DOCUMENTS}/reservation_verification_requests?documentId=${encodeURIComponent(reservationId)}&key=${encodeURIComponent(FIREBASE_API_KEY)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.idToken}`,
        },
        body: JSON.stringify({
          fields: firestoreFields({
            reservationId,
            token,
            syncStatus: 'pending',
            createdAt: new Date().toISOString(),
            ownerUid: session.uid,
          }),
        }),
      },
    );
  } catch {
    throw new Error('No fue posible enviar la verificación. Revisa tu conexión e inténtalo nuevamente.');
  }
  if (response.status === 429) {
    throw new Error(
      'Firebase agotó temporalmente su cuota. El enlace sigue siendo válido y puedes verificarlo con el gestor local.',
    );
  }
  if (response.status !== 409 && !response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    const detail = payload?.error?.message || '';
    throw new Error(
      detail.includes('PERMISSION_DENIED')
        ? 'Firebase rechazó la solicitud por sus reglas de seguridad. El enlace no ha vencido.'
        : 'Firebase no pudo recibir la verificación. El enlace no ha vencido; vuelve a intentarlo o usa el gestor local.',
    );
  }
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
    const statusResponse = await fetch(
      `${FIRESTORE_DOCUMENTS}/reservation_verification_requests/${encodeURIComponent(reservationId)}?key=${encodeURIComponent(FIREBASE_API_KEY)}`,
      {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${session.idToken}` },
      },
    );
    if (statusResponse.status === 404) continue;
    if (!statusResponse.ok) throw new Error('No fue posible consultar la verificación de la reserva.');
    const status = firestoreDocumentData(await statusResponse.json()) as {
      syncStatus?: string;
      syncError?: string;
    };
    if (status.syncStatus === 'processed') return;
    if (status.syncStatus === 'error') {
      throw new Error(status.syncError || 'El enlace no pudo validar esta reserva.');
    }
  }
  throw new Error(
    'La verificación fue recibida y continúa procesándose. Revisa tu correo en unos momentos.',
  );
}
