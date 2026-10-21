'use client';

import Image from 'next/image';
import { ArrowRight, CalendarDays, CircleHelp, KeyRound, MapPin, MessageSquareMore, ShieldCheck } from 'lucide-react';
import type { Property } from '../domain/types';
import { formatCurrency, priceToNumber } from '../domain/reservation';

export function Destinations({ properties, onChoose }: { properties: Property[]; onChoose: (place: string) => void }) {
  const groups = new Map<string, Property[]>();
  for (const property of properties) groups.set(property.place, [...(groups.get(property.place) || []), property]);
  const destinations = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right, 'es'));
  return (
    <section className="mx-auto max-w-7xl px-5 py-12 lg:px-8 lg:py-16" aria-labelledby="destinations-title">
      <p className="restblu-eyebrow">EXPLORA CHILE CON RESTBLU</p>
      <h1 id="destinations-title" className="restblu-display mt-3 max-w-2xl text-4xl leading-tight tracking-[-.035em] sm:text-5xl">El destino cambia.<br />Las ganas de descansar, no.</h1>
      <p className="mt-4 max-w-xl text-base leading-7 text-[#567586]">Encuentra un lugar junto al mar, entre montañas o cerca de la ciudad. Elige tu destino y consulta las fechas de tu próxima estadía.</p>
      <div className="mt-9 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
        {destinations.map(([place, stays]) => {
          const lowestPrice = Math.min(...stays.map((stay) => priceToNumber(stay.price)).filter((price) => price > 0));
          return (
            <button key={place} type="button" onClick={() => onChoose(place)} className="group overflow-hidden rounded-2xl border border-[#d7e7ef] bg-white text-left transition-shadow hover:shadow-lg">
              <div className="h-48 overflow-hidden"><Image unoptimized src={stays[0].image} alt={`Alojamiento en ${place}`} width={800} height={500} loading="lazy" className="restblu-property-image size-full object-cover" /></div>
              <div className="p-5"><h2 className="flex items-center gap-2 text-lg font-semibold text-[#153d56]"><MapPin aria-hidden="true" size={17} />{place}</h2><p className="mt-2 text-sm text-[#58788b]">{stays.length} {stays.length === 1 ? 'alojamiento' : 'alojamientos'}{Number.isFinite(lowestPrice) ? ` · desde ${formatCurrency(lowestPrice)} / noche` : ''}</p><span className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[#0b6871]">Explorar destino <ArrowRight aria-hidden="true" size={16} /></span></div>
            </button>
          );
        })}
      </div>
      {!destinations.length && <div className="mt-8 rounded-2xl border border-[#d7e7ef] bg-white p-8"><p className="text-[#567586]">Todavía no hay destinos publicados en el catálogo.</p><button type="button" onClick={() => onChoose('')} className="restblu-outline-button mt-4">Volver a alojamientos</button></div>}
    </section>
  );
}

const questions = [
  { question: '¿Cómo hago una reserva?', answer: 'Busca un alojamiento, elige tus fechas y la cantidad de huéspedes. Inicia sesión con tu correo verificado y completa tus datos. El gestor comprueba el precio y la disponibilidad antes de continuar al pago con Webpay.' },
  { question: '¿Dónde encuentro mis reservas y mi pase?', answer: 'Entra a Mi cuenta con el mismo correo que utilizaste al reservar. En Mis reservas encontrarás tus estadías y podrás abrir el pase de una reserva confirmada. También puedes solicitar el detalle desde Consultar mi reserva.' },
  { question: '¿Qué hago si el pago sigue en verificación?', answer: 'No inicies otro pago. Conserva la pestaña y recarga la página para volver a consultar el mismo intento. Revisa el estado en Mi cuenta; el pase se habilita cuando el gestor verifica la aprobación de Webpay.' },
  { question: '¿Cómo funciona el acceso digital?', answer: 'Una reserva confirmada puede habilitar su pase digital con QR y PIN. El acceso físico requiere que el alojamiento tenga un terminal configurado y conectado. Revisa las indicaciones del pase y la vigencia de tu estadía antes de llegar.' },
  { question: '¿Puedo registrar mi rostro?', answer: 'Cuando la reserva está confirmada y el alojamiento tiene el servicio habilitado, el pase permite registrar el rostro para el terminal Dahua. El registro requiere tu consentimiento y la confirmación del equipo de acceso.' },
  { question: '¿Cómo contacto con soporte?', answer: 'Blu puede orientarte sobre el catálogo, las fechas y el proceso de reserva. Para contactar con una persona, entra a Mi cuenta y abre Seguridad y ayuda, donde encontrarás el canal de correo disponible.' },
];

export function SupportCenter({ onChat, onAccount, onLookup }: { onChat: () => void; onAccount: () => void; onLookup: () => void }) {
  return (
    <section className="mx-auto max-w-7xl px-5 py-12 lg:px-8 lg:py-16" aria-labelledby="support-title">
      <p className="restblu-eyebrow">AYUDA RESTBLU</p>
      <h1 id="support-title" className="restblu-display mt-3 max-w-2xl text-4xl leading-tight tracking-[-.035em] sm:text-5xl">Te acompañamos<br />en cada paso.</h1>
      <p className="mt-4 max-w-xl leading-7 text-[#567586]">Encuentra respuestas sobre tu reserva, el pago y el acceso a tu alojamiento.</p>
      <div className="mt-8 grid gap-5 md:grid-cols-3">
        {[
          { title: 'Hablar con Blu', text: 'Orientación con IA para encontrar tu lugar y entender cómo reservar.', icon: MessageSquareMore, action: onChat, label: 'Abrir asistente' },
          { title: 'Mis reservas', text: 'Revisa tus próximas estadías, su estado y el pase de acceso.', icon: CalendarDays, action: onAccount, label: 'Ir a mi cuenta' },
          { title: 'Consultar una reserva', text: 'Solicita el detalle al correo verificado asociado a tus reservas.', icon: KeyRound, action: onLookup, label: 'Consultar mi reserva' },
        ].map(({ title, text, icon: Icon, action, label }) => <article key={title} className="rounded-2xl border border-[#d7e7ef] bg-white p-6"><span className="grid size-11 place-items-center rounded-xl bg-[#eaf4fa] text-[#0b6871]"><Icon aria-hidden="true" size={22} /></span><h2 className="mt-4 text-lg font-semibold text-[#153d56]">{title}</h2><p className="mt-2 text-sm leading-6 text-[#58788b]">{text}</p><button type="button" onClick={action} className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[#0b6871]">{label}<ArrowRight aria-hidden="true" size={16} /></button></article>)}
      </div>
      <div className="mt-12 max-w-3xl"><h2 className="flex items-center gap-2 text-2xl font-semibold text-[#153d56]"><CircleHelp aria-hidden="true" size={23} />Preguntas frecuentes</h2><div className="mt-5 divide-y divide-[#d7e7ef] border-y border-[#d7e7ef]">{questions.map(({ question, answer }) => <details key={question} className="group py-1"><summary className="cursor-pointer py-5 pr-3 text-sm font-semibold text-[#17465e] focus-visible:outline-2 focus-visible:outline-[#087b8c]">{question}</summary><p className="pb-5 pr-5 text-sm leading-7 text-[#567586]">{answer}</p></details>)}</div><p className="mt-5 flex items-start gap-2 text-xs leading-6 text-[#58788b]"><ShieldCheck aria-hidden="true" className="mt-1 size-4 shrink-0" />Por tu seguridad, no compartas tu PIN, tu QR ni tus credenciales en conversaciones públicas.</p></div>
    </section>
  );
}
