'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Bot,
  CalendarCheck,
  Eye,
  LoaderCircle,
  MessageCircleMore,
  Send,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  X,
} from 'lucide-react';
import type { Property, SearchCriteria } from '../domain/types';
import {
  askPublicAssistant,
  sendPublicAssistantFeedback,
  type PublicAiMessage,
  type PublicAiRating,
  type PublicAiSuggestion,
} from '../services/ai';

// Mensaje del chat: además del texto guarda lo necesario para las acciones
// (sugerencias, valoración). Al gestor sólo se envían role y content.
type ChatMessage = PublicAiMessage & {
  id: string;
  question?: string;
  requestId?: string;
  suggestions?: PublicAiSuggestion[];
  streaming?: boolean;
  feedback?: PublicAiRating;
  feedbackStatus?: 'sending' | 'sent' | 'error';
};

export type AssistantStay = { checkIn: string; checkOut: string; guests: number };

const welcome: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content:
    '¡Hola! Soy Blu, el asistente de RestBlu. Puedo ayudarte a comparar alojamientos, revisar fechas y entender cómo reservar. ¿Qué estás buscando?',
};

const starterQuestions = [
  '¿Qué alojamiento me recomiendas?',
  '¿Cómo hago una reserva?',
  'Muéstrame opciones según mis fechas',
];

// Fecha corta para los botones: "12 oct".
function shortDate(value: string) {
  return new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short' })
    .format(new Date(`${value}T12:00:00`))
    .replace('.', '');
}

export default function PublicAiAssistant({
  properties,
  search,
  selectedProperty,
  onOpenProperty,
  onReserveProperty,
}: {
  properties: Property[];
  search: SearchCriteria;
  selectedProperty?: Property | null;
  onOpenProperty: (property: Property) => void;
  onReserveProperty: (property: Property, stay: AssistantStay) => void;
}) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([welcome]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, open]);

  function updateMessage(id: string, patch: Partial<ChatMessage>) {
    setMessages((current) =>
      current.map((message) => (message.id === id ? { ...message, ...patch } : message)),
    );
  }

  async function sendQuestion(value: string) {
    const cleanQuestion = value.trim();
    if (cleanQuestion.length < 2 || loading) return;
    // La respuesta parte vacía y crece con el texto parcial del gestor.
    const answerId = crypto.randomUUID();
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: 'user', content: cleanQuestion },
      { id: answerId, role: 'assistant', content: '', question: cleanQuestion, streaming: true },
    ]);
    setQuestion('');
    setError('');
    setLoading(true);
    try {
      const result = await askPublicAssistant(
        {
          question: cleanQuestion,
          history: messages
            .slice(1)
            .filter((message) => message.content)
            .map(({ role, content }) => ({ role, content })),
          search,
          properties,
          selectedProperty,
        },
        (partial) => updateMessage(answerId, { content: partial }),
      );
      updateMessage(answerId, {
        content: result.answer,
        suggestions: result.suggestions,
        requestId: result.requestId,
        streaming: false,
      });
    } catch (caught) {
      setMessages((current) => current.filter((message) => message.id !== answerId));
      setError(caught instanceof Error ? caught.message : 'No fue posible consultar a RestBlu IA.');
    } finally {
      setLoading(false);
    }
  }

  async function rateAnswer(message: ChatMessage, rating: PublicAiRating) {
    if (message.feedbackStatus === 'sending' || message.feedbackStatus === 'sent') return;
    updateMessage(message.id, { feedback: rating, feedbackStatus: 'sending' });
    try {
      await sendPublicAssistantFeedback({
        requestId: message.requestId,
        question: message.question || '',
        answer: message.content,
        rating,
      });
      updateMessage(message.id, { feedbackStatus: 'sent' });
    } catch {
      updateMessage(message.id, { feedback: undefined, feedbackStatus: 'error' });
    }
  }

  // Las acciones navegan por el sitio; en pantallas chicas el chat lo tapa
  // todo, así que se cierra (la conversación se conserva).
  function runSuggestion(suggestion: PublicAiSuggestion) {
    const property = properties.find((item) => item.id === suggestion.propertyId);
    if (!property) {
      setError(`No encontramos ${suggestion.name} en el catálogo actual.`);
      return;
    }
    setError('');
    if (suggestion.available === true && suggestion.checkIn && suggestion.checkOut) {
      onReserveProperty(property, {
        checkIn: suggestion.checkIn,
        checkOut: suggestion.checkOut,
        guests: suggestion.guests,
      });
    } else {
      onOpenProperty(property);
    }
    if (window.matchMedia('(max-width: 639px)').matches) setOpen(false);
  }

  return (
    <section className="fixed bottom-5 right-4 z-[65] sm:bottom-7 sm:right-7" aria-label="Asistente RestBlu IA">
      {open && (
        <div className="mb-3 flex h-[min(630px,calc(100dvh-7rem))] w-[calc(100vw-2rem)] max-w-[390px] flex-col overflow-hidden rounded-[1.6rem] border border-[#bcded9] bg-white shadow-[0_24px_80px_rgba(8,43,56,.30)]">
          <header className="flex items-center gap-3 bg-[#0d4558] px-4 py-4 text-white">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#55d7cb] text-[#073642]">
              <Bot className="size-6" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-sm font-black">
                RestBlu IA <Sparkles className="size-3.5 text-[#d6ff56]" />
              </p>
              <p className="text-xs text-[#c8e1e3]">Asistente de reservas</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="grid size-9 place-items-center rounded-full bg-white/10 hover:bg-white/20"
              aria-label="Cerrar asistente"
            >
              <X className="size-5" />
            </button>
          </header>

          <div className="flex items-center gap-2 border-b border-[#dceae8] bg-[#edf9f7] px-4 py-2 text-[11px] font-semibold text-[#38636d]">
            <ShieldCheck className="size-4 text-[#0d9488]" />
            Sólo usa catálogo y disponibilidad pública
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto bg-[#f5f8f7] p-4" aria-live="polite">
            {messages.map((message) => !message.content ? null : (
              <div
                key={message.id}
                className={message.role === 'user' ? 'flex justify-end' : 'flex flex-col items-start'}
              >
                <p
                  aria-busy={message.streaming || undefined}
                  className={
                    message.role === 'user'
                      ? 'max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[#0b6871] px-3.5 py-2.5 text-sm leading-relaxed text-white'
                      : 'max-w-[92%] whitespace-pre-wrap rounded-2xl rounded-bl-md border border-[#d8e8e5] bg-white px-3.5 py-2.5 text-sm leading-relaxed text-[#173f4b] shadow-sm'
                  }
                >
                  {message.content}
                  {message.streaming && (
                    <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-[#0d9488] align-middle" />
                  )}
                </p>
                {!message.streaming && !!message.suggestions?.length && (
                  <div className="mt-2 flex max-w-[92%] flex-col items-start gap-1.5">
                    {message.suggestions.map((suggestion) => {
                      const bookable = suggestion.available === true && !!suggestion.checkIn && !!suggestion.checkOut;
                      return (
                        <button
                          key={`${suggestion.propertyId}-${suggestion.checkIn}`}
                          type="button"
                          onClick={() => runSuggestion(suggestion)}
                          className={
                            bookable
                              ? 'flex items-center gap-1.5 rounded-full bg-[#0b6871] px-3 py-1.5 text-left text-xs font-bold text-white transition hover:bg-[#07565e]'
                              : suggestion.available === false
                                ? 'flex items-center gap-1.5 rounded-full border border-dashed border-[#c9d6d8] bg-[#f1f4f4] px-3 py-1.5 text-left text-xs font-semibold text-[#789098] hover:bg-[#e8eded]'
                                : 'flex items-center gap-1.5 rounded-full border border-[#bcded9] bg-white px-3 py-1.5 text-left text-xs font-bold text-[#0b6871] hover:bg-[#e4f6f3]'
                          }
                        >
                          {bookable
                            ? <CalendarCheck className="size-3.5 shrink-0" />
                            : <Eye className="size-3.5 shrink-0" />}
                          {bookable
                            ? `Reservar ${suggestion.name} · ${shortDate(suggestion.checkIn)} → ${shortDate(suggestion.checkOut)}`
                            : suggestion.available === false
                              ? `${suggestion.name} · no disponible en esas fechas`
                              : `Ver ${suggestion.name}`}
                        </button>
                      );
                    })}
                  </div>
                )}
                {!message.streaming && message.question !== undefined && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] font-semibold text-[#52717a]">
                    {(['up', 'down'] as const).map((rating) => {
                      const Icon = rating === 'up' ? ThumbsUp : ThumbsDown;
                      const chosen = message.feedback === rating;
                      return (
                        <button
                          key={rating}
                          type="button"
                          onClick={() => void rateAnswer(message, rating)}
                          disabled={message.feedbackStatus === 'sending' || message.feedbackStatus === 'sent'}
                          aria-pressed={chosen}
                          aria-label={rating === 'up' ? 'Respuesta útil' : 'Respuesta no útil'}
                          className={
                            chosen
                              ? 'grid size-7 place-items-center rounded-full bg-[#0b6871] text-white disabled:cursor-default'
                              : 'grid size-7 place-items-center rounded-full text-[#789098] transition hover:bg-[#e4f6f3] hover:text-[#0b6871] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[#789098]'
                          }
                        >
                          <Icon className="size-3.5" />
                        </button>
                      );
                    })}
                    {message.feedbackStatus === 'sent' && <span className="pl-1">¡Gracias por tu opinión!</span>}
                    {message.feedbackStatus === 'error' && (
                      <span className="pl-1 text-[#a63d35]">No se pudo enviar tu opinión. Inténtalo otra vez.</span>
                    )}
                  </div>
                )}
              </div>
            ))}
            {messages.length === 1 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {starterQuestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void sendQuestion(suggestion)}
                    className="rounded-full border border-[#bcded9] bg-white px-3 py-2 text-left text-xs font-bold text-[#0b6871] hover:bg-[#e4f6f3]"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
            {loading && !messages[messages.length - 1]?.content && (
              <div className="flex justify-start">
                <p className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-[#d8e8e5] bg-white px-3.5 py-2.5 text-sm text-[#52717a]">
                  <LoaderCircle className="size-4 animate-spin text-[#0d9488]" />
                  Blu está revisando las opciones…
                </p>
              </div>
            )}
            {error && (
              <p className="rounded-xl border border-[#efc8c4] bg-[#fff2f0] px-3 py-2 text-xs font-semibold leading-relaxed text-[#a63d35]">
                {error}
              </p>
            )}
            <div ref={endRef} />
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void sendQuestion(question);
            }}
            className="border-t border-[#dceae8] bg-white p-3"
          >
            <div className="flex items-end gap-2 rounded-2xl border border-[#bdd7d4] bg-white p-1.5 focus-within:ring-2 focus-within:ring-[#55d7cb]">
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void sendQuestion(question);
                  }
                }}
                rows={1}
                maxLength={1_500}
                placeholder="Escribe tu pregunta…"
                className="max-h-28 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-[#173f4b] outline-none placeholder:text-[#789098]"
                aria-label="Pregunta para RestBlu IA"
              />
              <button
                type="submit"
                disabled={loading || question.trim().length < 2}
                className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#0b6871] text-white transition hover:bg-[#07565e] disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Enviar pregunta"
              >
                <Send className="size-4" />
              </button>
            </div>
            <p className="pt-2 text-center text-[10px] text-[#789098]">
              La respuesta es orientativa; la disponibilidad se valida al reservar.
            </p>
          </form>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="ml-auto flex items-center gap-2 rounded-full bg-[#0b6871] px-4 py-3.5 font-black text-white shadow-[0_14px_35px_rgba(8,72,80,.35)] transition hover:-translate-y-0.5 hover:bg-[#07565e]"
        aria-expanded={open}
        aria-label={open ? 'Cerrar asistente RestBlu IA' : 'Abrir asistente RestBlu IA'}
      >
        {open ? <X className="size-5" /> : <MessageCircleMore className="size-5" />}
        <span className="text-sm">{open ? 'Cerrar' : 'Pregúntale a Blu'}</span>
      </button>
    </section>
  );
}
