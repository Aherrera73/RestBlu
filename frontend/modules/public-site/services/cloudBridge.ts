import { FIREBASE_API_KEY, FIRESTORE_DOCUMENTS } from '../config';
import type { PublicAiMessage } from './ai';
import type { SearchCriteria } from '../domain/types';
import {
  ensureFirebaseSession,
  firestoreDocumentData,
  firestoreFields,
} from './firebase';

type BridgeResult = {
  syncStatus?: string;
  answer?: string;
  partialAnswer?: string;
  suggestions?: unknown;
  error?: string;
  status?: string;
  enrolledAt?: string;
  expiresAt?: string;
  dahuaStatus?: string;
  dahuaError?: string;
};

function endpoint(collection: string, id: string) {
  return `${FIRESTORE_DOCUMENTS}/${collection}/${encodeURIComponent(id)}?key=${encodeURIComponent(FIREBASE_API_KEY)}`;
}

async function createRequest(collection: string, id: string, input: Record<string, unknown>) {
  const session = await ensureFirebaseSession();
  const response = await fetch(
    `${FIRESTORE_DOCUMENTS}/${collection}?documentId=${encodeURIComponent(id)}&key=${encodeURIComponent(FIREBASE_API_KEY)}`,
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
          createdAt: new Date().toISOString(),
        }),
      }),
    },
  );
  if (!response.ok) {
    throw new Error(response.status === 429
      ? 'Firebase alcanzó su límite gratuito. Inténtalo más tarde.'
      : 'Firebase no pudo recibir la solicitud. Revisa tu conexión e inténtalo de nuevo.');
  }
}

// intervalMs y onProgress sólo los usa la IA: consulta más seguido para
// mostrar el texto parcial mientras el gestor lo escribe.
async function awaitRequest(
  collection: string,
  id: string,
  timeoutMs: number,
  options: { intervalMs?: number; onProgress?: (result: BridgeResult) => void } = {},
): Promise<BridgeResult> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, options.intervalMs ?? 2500));
    const session = await ensureFirebaseSession();
    const response = await fetch(endpoint(collection, id), {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${session.idToken}` },
    });
    if (!response.ok) {
      throw new Error('No fue posible consultar la respuesta del gestor.');
    }
    const result = firestoreDocumentData(await response.json()) as BridgeResult;
    if (result.syncStatus === 'processed') return result;
    if (result.syncStatus === 'error') {
      throw new Error(result.error || 'El gestor no pudo procesar la solicitud.');
    }
    options.onProgress?.(result);
  }
  throw new Error('El gestor aún no responde. La solicitud quedó en espera y se procesará cuando esté encendido.');
}

export async function askCloudPublicAssistant(input: {
  question: string;
  history: PublicAiMessage[];
  search: SearchCriteria;
}, onPartial?: (text: string) => void) {
  const id = crypto.randomUUID();
  await createRequest('public_ai_requests', id, {
    question: input.question.slice(0, 1500),
    history: input.history.slice(-6).map((item) => ({
      role: item.role,
      content: item.content.slice(0, 1500),
    })),
    search: {
      destination: input.search.destination.slice(0, 120),
      checkIn: input.search.checkIn.slice(0, 20),
      checkOut: input.search.checkOut.slice(0, 20),
      guests: input.search.guests,
    },
  });
  let shown = '';
  const result = await awaitRequest('public_ai_requests', id, 120_000, {
    intervalMs: 1000,
    onProgress: (progress) => {
      const partial = progress.partialAnswer || '';
      if (!onPartial || !partial || partial === shown) return;
      shown = partial;
      onPartial(partial);
    },
  });
  if (!result.answer) throw new Error('El servidor de IA no devolvió una respuesta.');
  return { answer: result.answer, suggestions: result.suggestions, requestId: id };
}

// Valoración de una respuesta ya procesada. Las reglas sólo permiten al
// dueño de la solicitud escribir estos tres campos.
export async function sendCloudAssistantFeedback(requestId: string, rating: 'up' | 'down') {
  const session = await ensureFirebaseSession();
  const mask = ['feedback', 'feedbackPending', 'feedbackAt']
    .map((field) => `updateMask.fieldPaths=${field}`)
    .join('&');
  const response = await fetch(
    `${FIRESTORE_DOCUMENTS}/public_ai_requests/${encodeURIComponent(requestId)}?${mask}&key=${encodeURIComponent(FIREBASE_API_KEY)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.idToken}` },
      body: JSON.stringify({
        fields: firestoreFields({
          feedback: rating,
          feedbackPending: true,
          feedbackAt: new Date().toISOString(),
        }),
      }),
    },
  );
  if (!response.ok) throw new Error('No fue posible enviar tu opinión.');
}

export async function lookupCloudReservationsByRut(documentId: string) {
  const id = crypto.randomUUID();
  await createRequest('public_reservation_lookup_requests', id, { documentId });
  await awaitRequest('public_reservation_lookup_requests', id, 120_000);
}

function fromBase64(value: string) {
  return Uint8Array.from(window.atob(value), (character) => character.charCodeAt(0));
}

function toBase64(bytes: Uint8Array) {
  let output = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    output += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return window.btoa(output);
}

export async function enrollCloudBiometrics(input: {
  reservationId: string;
  documentId: string;
  image: string;
}): Promise<BridgeResult> {
  const keyResponse = await fetch(endpoint('public_biometric_config', 'current'), {
    cache: 'no-store',
  });
  if (!keyResponse.ok) {
    throw new Error('El gestor todavía no ha publicado la clave de transporte biométrica. Ábrelo e inténtalo nuevamente.');
  }
  const publicConfig = firestoreDocumentData(await keyResponse.json()) as {
    publicKey?: string;
    keyId?: string;
  };
  if (!publicConfig.publicKey || !publicConfig.keyId) {
    throw new Error('La clave de transporte biométrica no está disponible.');
  }
  const der = fromBase64(publicConfig.publicKey.replace(/-----[^-]+-----|\s/g, ''));
  const transportKey = await crypto.subtle.importKey(
    'spki', der, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt'],
  );
  const imageMatch = input.image.match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/);
  if (!imageMatch) throw new Error('La captura facial no tiene un formato válido.');
  const imageBytes = fromBase64(imageMatch[2]);
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
  const [ciphertext, wrappedKey] = await Promise.all([
    crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, imageBytes),
    crypto.subtle.encrypt({ name: 'RSA-OAEP' }, transportKey, rawKey),
  ]);
  const encryptedImage = toBase64(new Uint8Array(ciphertext));
  if (encryptedImage.length > 700_000) {
    throw new Error('La captura es demasiado grande para el envío seguro. Repite la foto con menor resolución.');
  }
  const id = crypto.randomUUID();
  await createRequest('public_biometric_requests', id, {
    reservationId: input.reservationId,
    documentId: input.documentId,
    consent: true,
    dahuaConsent: true,
    mimeType: `image/${imageMatch[1]}`,
    encryptedImage,
    encryptedKey: toBase64(new Uint8Array(wrappedKey)),
    iv: toBase64(iv),
    keyId: publicConfig.keyId,
  });
  return awaitRequest('public_biometric_requests', id, 120_000);
}
