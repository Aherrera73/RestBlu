'use client';

import { useState, type FormEvent } from 'react';
import { Mail, Search, ShieldCheck } from 'lucide-react';
import { LOCAL_DATA_API } from '../config';
import { formatRut, isValidRut } from '../domain/reservation';
import { usesLocalManager } from '../services/firebase';
import { lookupCloudReservationsByRut } from '../services/cloudBridge';

export default function ReservationLookup() {
  const [documentId, setDocumentId] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const valid = isValidRut(documentId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || loading) return;
    setLoading(true);
    setError('');
    setSubmitted(false);
    try {
      if (usesLocalManager()) {
        const response = await fetch(`${LOCAL_DATA_API}/public/reservations/lookup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documentId: formatRut(documentId) }),
        });
        const data = await response.json() as { error?: string };
        if (!response.ok) throw new Error(data.error || 'No fue posible consultar las reservas.');
      } else {
        await lookupCloudReservationsByRut(formatRut(documentId));
      }
      setSubmitted(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible consultar las reservas.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mx-auto max-w-5xl px-5 py-10 lg:px-8">
      <p className="text-xs font-bold uppercase tracking-[.16em] text-[#07888d]">MIS RESERVAS</p>
      <h1 className="mt-2 text-3xl font-bold">Consulta tus estadías</h1>
      <p className="mt-2 max-w-2xl text-[#58747d]">
        Ingresa el RUT usado al reservar. Si hay reservas asociadas a un correo verificado, enviaremos allí el resumen de tus estadías.
      </p>
      <form onSubmit={submit} className="mt-7 rounded-3xl border border-[#d9e8e6] bg-white p-6 shadow-sm">
        <label htmlFor="reservation-lookup-rut" className="block text-sm font-bold">RUT del huésped principal</label>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <input
            id="reservation-lookup-rut"
            type="text"
            inputMode="text"
            autoComplete="off"
            maxLength={12}
            value={documentId}
            onChange={(event) => {
              setDocumentId(formatRut(event.target.value));
              setSubmitted(false);
              setError('');
            }}
            placeholder="Ej.: 12.345.678-5"
            aria-invalid={Boolean(documentId) && !valid}
            className="min-w-0 flex-1 rounded-xl border border-[#c9dcda] px-4 py-3 outline-none focus:border-[#0b8e92]"
          />
          <button type="submit" disabled={!valid || loading} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#0b6871] px-6 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
            <Search size={17} /> {loading ? 'Consultando…' : 'Consultar reservas'}
          </button>
        </div>
        <p className="mt-3 flex items-start gap-2 text-xs text-[#66818a]"><ShieldCheck size={15} className="shrink-0" /> Por privacidad, esta página no revela si el RUT tiene reservas ni muestra datos de alojamiento. Si el gestor está apagado, la respuesta puede demorar.</p>
      </form>

      <div className="mt-6" aria-live="polite">
        {error && <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
        {submitted && <p className="flex items-start gap-3 rounded-2xl border border-[#cce8df] bg-[#f0fcf7] p-5 text-sm text-[#175a4d]"><Mail size={20} className="shrink-0" /> Si hay reservas asociadas a este RUT y el correo fue verificado, enviaremos los detalles a la dirección registrada. Revisa también la carpeta de spam.</p>}
      </div>
    </section>
  );
}
