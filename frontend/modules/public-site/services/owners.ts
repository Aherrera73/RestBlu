import {
  FIREBASE_API_KEY,
  FIRESTORE_DOCUMENTS,
  LOCAL_DATA_API,
} from '../config';
import type { OwnerDashboardData } from '../domain/owner-dashboard';
import { accountSession } from './account';
import {
  firestoreDocumentData,
  firestoreFields,
  usesLocalManager,
} from './firebase';

export class OwnerAccessError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function loadOwnerDashboard(
  signal?: AbortSignal,
): Promise<OwnerDashboardData> {
  const { session } = await accountSession();
  if (!usesLocalManager())
    return loadCloudOwnerDashboard(session.idToken, session.uid, signal);
  let response: Response;
  try {
    response = await fetch(`${LOCAL_DATA_API}/owner/dashboard`, {
      headers: { Authorization: `Bearer ${session.idToken}` },
      cache: 'no-store',
      signal,
    });
  } catch (failure) {
    if (signal?.aborted) throw failure;
    throw new OwnerAccessError(
      'No pudimos conectar con el servicio de propietarios. Inténtalo nuevamente en unos momentos.',
      0,
    );
  }
  const data = (await response
    .json()
    .catch(() => null)) as Partial<OwnerDashboardData> | null;
  if (!response.ok) {
    const message =
      response.status === 403
        ? 'Esta cuenta no tiene un perfil de propietario activo. Solicita a la administración que revise tu correo y tus alojamientos asignados.'
        : response.status === 401
          ? 'Tu sesión ya no es válida. Cierra sesión e ingresa nuevamente.'
          : 'No pudimos cargar tu panel. Inténtalo nuevamente.';
    throw new OwnerAccessError(message, response.status);
  }
  if (
    !data?.owner ||
    !Array.isArray(data.properties) ||
    !Array.isArray(data.reservations)
  ) {
    throw new OwnerAccessError(
      'El servicio no devolvió un panel válido. Inténtalo nuevamente.',
      502,
    );
  }
  return data as OwnerDashboardData;
}

async function loadCloudOwnerDashboard(
  idToken: string,
  uid: string,
  signal?: AbortSignal,
): Promise<OwnerDashboardData> {
  const payload = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  const authTime: unknown = (
    JSON.parse(window.atob(payload)) as { auth_time?: unknown }
  ).auth_time;
  if (!Number.isSafeInteger(authTime))
    throw new OwnerAccessError(
      'Vuelve a iniciar sesión para abrir tu panel.',
      401,
    );
  const id = crypto.randomUUID();
  const endpoint = `${FIRESTORE_DOCUMENTS}/owner_dashboard_requests`;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${idToken}`,
  };
  const response = await fetch(
    `${endpoint}?documentId=${id}&key=${encodeURIComponent(FIREBASE_API_KEY)}`,
    {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({
        fields: {
          ...firestoreFields({
            ownerUid: uid,
            authTime,
            syncStatus: 'pending',
            createdAt: new Date().toISOString(),
          }),
          expiresAt: {
            timestampValue: new Date(Date.now() + 9 * 60_000).toISOString(),
          },
        },
      }),
    },
  );
  if (!response.ok)
    throw new OwnerAccessError(
      'El panel en línea no pudo recibir la consulta. La administración debe revisar la publicación de las reglas de propietarios.',
      response.status,
    );
  for (let attempt = 0; attempt < 15; attempt += 1) {
    if (signal?.aborted)
      throw new DOMException('Consulta cancelada.', 'AbortError');
    await new Promise<void>((resolve) => window.setTimeout(resolve, 1000));
    const result = await fetch(
      `${endpoint}/${id}?key=${encodeURIComponent(FIREBASE_API_KEY)}`,
      { headers, signal, cache: 'no-store' },
    );
    if (!result.ok)
      throw new OwnerAccessError(
        'No pudimos consultar la respuesta del panel.',
        result.status,
      );
    const data = firestoreDocumentData(await result.json()) as {
      syncStatus?: string;
      dashboard?: OwnerDashboardData;
      error?: string;
      status?: number;
    };
    if (data.syncStatus === 'error')
      throw new OwnerAccessError(
        data.error || 'No pudimos cargar tu panel.',
        data.status || 503,
      );
    if (
      data.syncStatus === 'processed' &&
      data.dashboard?.owner &&
      Array.isArray(data.dashboard.properties) &&
      Array.isArray(data.dashboard.reservations)
    )
      return data.dashboard;
  }
  throw new OwnerAccessError(
    'El gestor no responde. Debe estar encendido para consultar tu panel.',
    503,
  );
}
