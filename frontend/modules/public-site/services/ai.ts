import { LOCAL_DATA_API } from '../config';
import { accountSession, currentAccount } from './account';
import { askCloudPublicAssistant, sendCloudAssistantFeedback } from './cloudBridge';
import type { Property, SearchCriteria } from '../domain/types';

export type PublicAiMessage = {
  role: 'user' | 'assistant';
  content: string;
};

// Alojamiento que Blu propone. available es null si no había fechas.
export type PublicAiSuggestion = {
  propertyId: number;
  name: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  available: boolean | null;
};

export type PublicAiResult = {
  answer: string;
  suggestions: PublicAiSuggestion[];
  // Sólo en la nube: id del documento public_ai_requests (para valorar).
  requestId?: string;
};

export type PublicAiRating = 'up' | 'down';

type PublicAiInput = {
  question: string;
  history: PublicAiMessage[];
  search: SearchCriteria;
  properties: Property[];
  selectedProperty?: Property | null;
};

function isLocalBrowser() {
  if (typeof window === 'undefined') return false;
  return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
}

function publicCatalog(properties: Property[]) {
  return properties.map((property) => ({
    id: property.id,
    nombre: property.name,
    ubicacion: property.place,
    tipo: property.type,
    capacidad: property.guests,
    dormitorios: property.beds,
    banos: property.baths,
    tarifa: property.price,
    calificacion: property.rating,
    etiquetas: property.tags,
    rangosOcupados: property.unavailableRanges || [],
  }));
}

// Las sugerencias vienen del gestor: se descartan las mal formadas.
function normalizeSuggestions(value: unknown): PublicAiSuggestion[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const raw = item as Record<string, unknown>;
    const propertyId = Number(raw.propertyId);
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!Number.isFinite(propertyId) || !name) return [];
    const date = (field: unknown) =>
      typeof field === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(field) ? field : '';
    return [{
      propertyId,
      name,
      checkIn: date(raw.checkIn),
      checkOut: date(raw.checkOut),
      guests: Math.max(0, Math.floor(Number(raw.guests) || 0)),
      available: typeof raw.available === 'boolean' ? raw.available : null,
    }];
  }).slice(0, 3);
}

// Con una cuenta iniciada, el gestor local usa el token para responder
// sobre las reservas propias. Sin cuenta no se envía encabezado.
async function accountAuthorization(): Promise<Record<string, string>> {
  if (!currentAccount()) return {};
  try {
    const { session } = await accountSession();
    return { Authorization: `Bearer ${session.idToken}` };
  } catch {
    return {};
  }
}

export async function askPublicAssistant(
  input: PublicAiInput,
  onPartial?: (text: string) => void,
): Promise<PublicAiResult> {
  const local = isLocalBrowser();
  if (!local) {
    const result = await askCloudPublicAssistant(input, onPartial);
    return { ...result, suggestions: normalizeSuggestions(result.suggestions) };
  }
  const endpoint = `${LOCAL_DATA_API}/ai/public-chat`;
  const authorization = await accountAuthorization();

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authorization },
      body: JSON.stringify({
        action: 'public-ai-chat',
        question: input.question,
        history: input.history.slice(-6),
        search: input.search,
        selectedPropertyId: input.selectedProperty?.id || null,
        catalog: publicCatalog(input.properties),
      }),
      signal: controller.signal,
    });
    const data = (await response.json().catch(() => ({}))) as {
      answer?: string;
      suggestions?: unknown;
      error?: string;
    };
    if (!response.ok || !data.answer) {
      throw new Error(data.error || 'RestBlu IA no pudo responder en este momento.');
    }
    return { answer: data.answer, suggestions: normalizeSuggestions(data.suggestions) };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('La respuesta tardó demasiado. Inténtalo nuevamente.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

// Valoración de una respuesta: en la nube se marca la solicitud original;
// con el gestor local se envía la pregunta y la respuesta valoradas.
export async function sendPublicAssistantFeedback(input: {
  requestId?: string;
  question: string;
  answer: string;
  rating: PublicAiRating;
}) {
  if (input.requestId) {
    await sendCloudAssistantFeedback(input.requestId, input.rating);
    return;
  }
  const response = await fetch(`${LOCAL_DATA_API}/ai/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: input.question.slice(0, 1500),
      answer: input.answer,
      rating: input.rating,
    }),
  });
  if (!response.ok) throw new Error('No fue posible enviar tu opinión.');
}
