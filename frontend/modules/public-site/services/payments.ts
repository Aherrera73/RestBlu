import { FIREBASE_API_KEY, FIRESTORE_DOCUMENTS, LOCAL_DATA_API, PAYMENTS_API } from '../config';
import { ensureFirebaseSession, firestoreDocumentData, firestoreFields } from './firebase';

// Pago con Webpay Plus (ambiente de integración de Transbank). El servicio de
// pagos (Cloudflare Worker) crea la transacción y confirma el pago al volver;
// el gestor verifica después con Transbank antes de dar la reserva por pagada.

// Inicia el pago: Transbank exige enviar el token por POST a su formulario.
export async function startWebpayPayment(reservationId: string, amount: number) {
  let response: Response;
  try {
    response = await fetch(`${PAYMENTS_API}/webpay/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reservationId, amount, returnTo: `${window.location.origin}/` }),
    });
  } catch {
    throw new Error('No fue posible conectar con el servicio de pagos. Revisa tu conexión.');
  }
  const data = await response.json().catch(() => ({})) as { token?: string; url?: string; error?: string };
  if (!response.ok || !data.token || !data.url) {
    throw new Error(data.error || 'Transbank no pudo iniciar el pago. Inténtalo nuevamente.');
  }
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = data.url;
  const input = document.createElement('input');
  input.type = 'hidden';
  input.name = 'token_ws';
  input.value = data.token;
  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
}

// Entrega al gestor el token del pago aprobado para que lo verifique con
// Transbank: directo al gestor local o, en la web publicada, a través de Firestore.
export async function confirmWebpayPayment(reservationId: string, webpayToken: string, cloud: boolean) {
  if (!cloud) {
    const response = await fetch(`${LOCAL_DATA_API}/reservations/${encodeURIComponent(reservationId)}/webpay-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webpayToken }),
    });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(result.error || 'El gestor no pudo confirmar el pago.');
    return;
  }
  const session = await ensureFirebaseSession();
  const id = crypto.randomUUID();
  const endpoint = `${FIRESTORE_DOCUMENTS}/reservation_payment_requests`;
  const response = await fetch(`${endpoint}?documentId=${encodeURIComponent(id)}&key=${encodeURIComponent(FIREBASE_API_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.idToken}` },
    body: JSON.stringify({ fields: firestoreFields({
      reservationId,
      webpayToken,
      ownerUid: session.uid,
      syncStatus: 'pending',
      createdAt: new Date().toISOString(),
    }) }),
  });
  if (!response.ok) throw new Error('No fue posible registrar el pago. Consulta tu reserva en Mi cuenta.');
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 2_000));
    const result = await fetch(`${endpoint}/${encodeURIComponent(id)}?key=${encodeURIComponent(FIREBASE_API_KEY)}`, {
      cache: 'no-store', headers: { Authorization: `Bearer ${session.idToken}` },
    });
    if (!result.ok) continue;
    const data = firestoreDocumentData(await result.json()) as { syncStatus?: string; error?: string };
    if (data.syncStatus === 'error') throw new Error(data.error || 'El gestor no pudo confirmar el pago.');
    if (data.syncStatus === 'processed') return;
  }
  throw new Error('El pago quedó registrado y el gestor lo confirmará en cuanto esté en línea. Revisa tu reserva en Mi cuenta.');
}
