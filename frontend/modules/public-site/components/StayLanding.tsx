'use client';

import type { ReactNode } from 'react';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { ArrowRight, Check, Compass, KeyRound, MapPin, MessageSquareMore, ShieldCheck, Sparkles } from 'lucide-react';

type StayLandingProps = {
  searchBox: ReactNode;
  featured: ReactNode;
  onExplore: () => void;
  onLookup: () => void;
};

const arrivalSteps = [
  { number: '01', title: 'Encuentra tu lugar', description: 'Elige el destino y las fechas que van contigo.', icon: Compass },
  { number: '02', title: 'Confirma tu estadía', description: 'Reserva y paga desde tu cuenta, en un solo recorrido.', icon: ShieldCheck },
  { number: '03', title: 'Llega y disfruta', description: 'Recibe tu pase digital con la reserva confirmada.', icon: KeyRound },
];

export default function StayLanding({ searchBox, featured, onExplore, onLookup }: StayLandingProps) {
  return (
    <>
      <section className="restblu-hero" aria-labelledby="welcome-title">
        <div className="mx-auto max-w-7xl px-5 pb-10 pt-10 sm:pt-14 lg:px-8 lg:pb-14 lg:pt-16">
          <div className="grid items-center gap-10 lg:grid-cols-[1fr_1.02fr] lg:gap-16">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.45 }} className="order-1">
              <p className="restblu-eyebrow"><span className="size-1.5 rounded-full bg-[#087b8c]" /> ESTADÍAS EN CHILE, A TU RITMO</p>
              <h1 id="welcome-title" className="restblu-display mt-6 max-w-xl text-[clamp(2.65rem,4.6vw,4.15rem)] leading-[1.04] tracking-[-.045em]">
                Descansa mejor.<br />Tu estadía, <em className="font-semibold text-[#087b8c]">más simple.</em>
              </h1>
              <p className="mt-6 max-w-md text-base leading-7 text-[#567586] sm:text-lg sm:leading-8">
                Descubre tu próxima escapada. Alojamientos con encanto y una llegada sencilla, desde el primer momento.
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3 text-xs font-medium text-[#436679] sm:text-sm">
                <span className="flex items-center gap-2"><Check aria-hidden="true" className="size-4 text-[#087b8c]" /> Reserva desde tu cuenta</span>
                <span className="flex items-center gap-2"><KeyRound aria-hidden="true" className="size-4 text-[#087b8c]" /> Acceso digital</span>
              </div>
              <button type="button" onClick={onExplore} className="restblu-text-link mt-8 inline-flex min-h-11 items-center gap-3 text-sm font-semibold">
                Conoce los alojamientos <ArrowRight aria-hidden="true" size={17} />
              </button>
            </motion.div>
            <div className="relative z-10 order-2 lg:order-3 lg:col-span-2">
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-[#436679]"><Compass aria-hidden="true" size={15} /> ¿Dónde te gustaría despertar?</div>
              {searchBox}
            </div>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.65, delay: 0.1 }} className="relative order-3 pb-7 lg:order-2 lg:pb-5">
              <div className="overflow-hidden rounded-[24px_24px_80px_24px] bg-[#e2edf2]">
                <Image
                  unoptimized
                  src="https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=1200&q=88"
                  alt="Un interior luminoso y abierto al jardín, ideal para descansar"
                  fetchPriority="high"
                  width={1200}
                  height={1100}
                  className="h-[340px] w-full object-cover sm:h-[440px] lg:h-[490px]"
                />
              </div>
              <span className="absolute left-5 top-5 inline-flex items-center gap-2 rounded-full bg-white/95 px-4 py-2.5 text-xs font-medium text-[#17465e] shadow-sm">
                <MapPin aria-hidden="true" size={14} /> Tu próxima escapada
              </span>
              <div className="absolute bottom-0 left-4 right-8 flex items-center gap-4 rounded-2xl border border-[#d7e7ef] bg-white px-5 py-4 shadow-[0_12px_35px_-16px_rgba(20,57,47,.3)] sm:left-auto sm:right-8 sm:min-w-72">
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#e8f4f7] text-[#0b6871]"><KeyRound aria-hidden="true" size={20} /></span>
                <div><p className="text-sm font-semibold text-[#102d3f]">Tu llegada, sin esperas</p><p className="mt-1 text-xs text-[#607c8b]">Tu pase, con la reserva confirmada.</p></div>
                <Check aria-hidden="true" className="ml-auto size-4 text-[#087b8c]" />
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      <section className="border-y border-[#dce8ef] bg-white/60" aria-label="Una estadía más simple">
        <div className="mx-auto grid max-w-7xl gap-6 px-5 py-7 sm:grid-cols-3 lg:gap-10 lg:px-8">
          {[
            { icon: ShieldCheck, title: 'Detalles claros', text: 'Conoce tu alojamiento antes de reservar.' },
            { icon: KeyRound, title: 'Llegadas más simples', text: 'Tu acceso, disponible durante la estadía.' },
            { icon: MessageSquareMore, title: 'Ayuda a un mensaje', text: 'Blu te orienta mientras encuentras tu lugar.' },
          ].map(({ icon: Icon, title, text }) => (
            <div key={title} className="flex items-start gap-3.5">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#eaf4fa] text-[#246783]"><Icon aria-hidden="true" size={19} /></span>
              <div><h2 className="text-sm font-semibold text-[#123c55]">{title}</h2><p className="mt-1 text-xs leading-5 text-[#5c7787]">{text}</p></div>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-14 lg:px-8 lg:py-20" aria-labelledby="featured-title">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div><p className="restblu-eyebrow">LUGARES PARA QUEDARSE</p><h2 id="featured-title" className="restblu-display mt-3 max-w-xl text-4xl leading-[1.15] tracking-[-.03em] sm:text-5xl">Tu próxima pausa<br className="hidden sm:block" /> empieza aquí.</h2></div>
          <button type="button" onClick={onExplore} className="restblu-outline-button inline-flex items-center gap-3">Ver todos los alojamientos <ArrowRight aria-hidden="true" size={16} /></button>
        </div>
        <div className="mt-8 grid gap-6 md:grid-cols-2 xl:grid-cols-3">{featured}</div>
      </section>

      <section className="mx-auto max-w-7xl px-5 pb-14 lg:px-8 lg:pb-20" aria-labelledby="arrival-title">
        <div className="overflow-hidden rounded-[28px] bg-[#0a2d48] text-white">
          <div className="grid lg:grid-cols-[1.15fr_.85fr]">
            <div className="p-7 sm:p-10 lg:p-12">
              <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[.18em] text-[#a9d9e9]"><Sparkles aria-hidden="true" size={14} /> LA EXPERIENCIA RESTBLU</p>
              <h2 id="arrival-title" className="restblu-display mt-5 text-4xl leading-[1.1] tracking-[-.025em] sm:text-5xl">Menos gestiones.<br /><em className="font-normal text-[#8edce5]">Más vacaciones.</em></h2>
              <p className="mt-5 max-w-md text-sm leading-7 text-[#c8dfeb]">De la búsqueda a la puerta, todo conectado. Elige tu alojamiento, confirma tu reserva y lleva tu pase contigo.</p>
              <button type="button" onClick={onLookup} className="mt-7 inline-flex min-h-11 items-center gap-3 rounded-full bg-[#b6eaf0] px-6 py-3 text-sm font-semibold text-[#102d3f] transition-colors hover:bg-white">Consultar mi reserva <ArrowRight aria-hidden="true" size={16} /></button>
            </div>
            <Image unoptimized src="https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=1000&q=85" alt="Casa de descanso con piscina y espacios abiertos" loading="lazy" width={1000} height={850} className="h-64 w-full object-cover lg:h-full lg:min-h-96" />
          </div>
          <div className="grid gap-7 border-t border-white/15 px-7 py-8 sm:grid-cols-3 sm:px-10 lg:px-12">
            {arrivalSteps.map(({ number, title, description, icon: Icon }) => (
              <div key={number}><div className="mb-3 flex items-center gap-3 text-[#9edce7]"><span className="text-xs tracking-wider">{number}</span><span className="h-px w-8 bg-white/20" /><Icon aria-hidden="true" size={18} /></div><h3 className="text-sm font-semibold">{title}</h3><p className="mt-2 max-w-64 text-xs leading-6 text-[#c8dfeb]">{description}</p></div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
