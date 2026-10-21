import { OwnerError, ownerDashboard } from './owner-service.mjs';

// El cliente sólo puede crear solicitudes con su UID y auth_time del token:
// firestore.rules los compara con request.auth. Nunca decide su rol ni envía
// asignaciones. Se vuelve a consultar el registro local y la cuenta actual.
export async function processOwnerDashboardRequests(store, { auth, readDatabase, listOwners, now = Date.now }) {
  const requests = await store.collection('owner_dashboard_requests').where('syncStatus', '==', 'pending').limit(10).get();
  if (requests.empty) return;
  for (const document of requests.docs) {
    const input = document.data();
    let result;
    try {
      const age = now() - Date.parse(input.createdAt);
      if (!Number.isFinite(age) || age > 120_000 || age < -30_000 || !Number.isSafeInteger(input.authTime)) {
        throw new OwnerError('La solicitud venció. Actualiza el panel para intentarlo nuevamente.', 401);
      }
      const owners = await listOwners();
      if (!owners.some((owner) => owner.uid === input.ownerUid && owner.active)) {
        throw new OwnerError('Esta cuenta no tiene un acceso de propietario activo.', 403);
      }
      const user = await auth.getUser(input.ownerUid);
      const validAfter = Date.parse(user.tokensValidAfterTime || '') || 0;
      if (user.disabled || !user.emailVerified || !user.email || input.authTime * 1000 < validAfter) {
        throw new OwnerError('Tu sesión debe estar vigente y tu correo verificado. Vuelve a iniciar sesión.', 401);
      }
      const dashboard = ownerDashboard(await readDatabase(), owners, { uid: user.uid, email: user.email });
      if (Buffer.byteLength(JSON.stringify(dashboard), 'utf8') > 700_000) {
        throw new OwnerError('El historial es demasiado grande para esta consulta. Contacta con la administración.', 413);
      }
      result = { syncStatus: 'processed', dashboard };
    } catch (error) {
      result = {
        syncStatus: 'error',
        status: error instanceof OwnerError ? error.status : 503,
        error: error instanceof OwnerError ? error.message : 'No se pudo cargar el panel de propietarios. Inténtalo nuevamente.',
      };
    }
    await document.ref.set({ ...result, processedAt: new Date(now()).toISOString() }, { merge: true });
  }
}

export async function removeExpiredOwnerDashboardRequests(store) {
  const expired = await store.collection('owner_dashboard_requests').where('expiresAt', '<=', new Date()).limit(50).get();
  await Promise.all(expired.docs.map((document) => document.ref.delete()));
}
