'use client';

import type { ReactNode } from 'react';
import Image from 'next/image';
import { ArrowRight, KeyRound, MapPin } from 'lucide-react';
import type { Property } from '../domain/types';

type StayLandingProps = {
  searchBox: ReactNode;
  featured: ReactNode;
  highlight?: Property;
  onExplore: () => void;
  onLookup: () => void;
  onSelectHighlight: () => void;
};

const arrivalSteps = [
  { title: 'Elige tu lugar', description: 'Explora los alojamientos y encuentra fechas disponibles.' },
  { title: 'Confirma tu reserva', description: 'Revisa los datos de tu estadía y continúa al pago desde tu cuenta.' },
  { title: 'Lleva tu pase contigo', description: 'Con el pago confirmado, consulta tu reserva y las indicaciones de acceso.' },
];

export default function StayLanding({ searchBox, featured, highlight, onExplore, onLookup, onSelectHighlight }: StayLandingProps) {
  return (
    <>
      <section className="restblu-hero" aria-labelledby="welcome-title">
        <div className="restblu-container restblu-hero-grid">
          <div className="restblu-hero-copy">
            <h1 id="welcome-title" className="restblu-display">Tu próxima<br />escapada.</h1>
            <p className="restblu-hero-description">Alojamientos en Chile para cambiar de aire. Encuentra tu lugar y lleva tu reserva contigo.</p>
            <div className="restblu-hero-search">{searchBox}</div>
            <p className="restblu-hero-note"><KeyRound aria-hidden="true" size={16} /> De la reserva a tu pase digital.</p>
          </div>
          {highlight && (
            <figure className="restblu-hero-place">
              <button type="button" onClick={onSelectHighlight} aria-label={`Explorar ${highlight.name}`} className="restblu-hero-photo">
                <Image unoptimized src={highlight.image} alt={`${highlight.name}, alojamiento en ${highlight.place}`} fetchPriority="high" width={1200} height={1100} />
              </button>
              <figcaption>
                <div><span className="restblu-place-location"><MapPin aria-hidden="true" size={14} />{highlight.place}</span><p>{highlight.name}</p></div>
                <button type="button" onClick={onSelectHighlight} aria-label={`Ver detalles de ${highlight.name}`} className="restblu-icon-button"><ArrowRight aria-hidden="true" size={21} /></button>
              </figcaption>
            </figure>
          )}
        </div>
      </section>

      <section className="restblu-container restblu-featured" aria-labelledby="featured-title">
        <div className="restblu-section-heading">
          <div><h2 id="featured-title" className="restblu-display">Lugares para quedarse.</h2><p>Conoce los espacios. Imagina tu próxima estadía.</p></div>
          <button type="button" onClick={onExplore} className="restblu-text-action">Ver alojamientos <ArrowRight aria-hidden="true" size={18} /></button>
        </div>
        <div className="restblu-property-grid">{featured}</div>
      </section>

      <section className="restblu-arrival" aria-labelledby="arrival-title">
        <div className="restblu-container restblu-arrival-grid">
          <div className="restblu-arrival-intro"><h2 id="arrival-title" className="restblu-display">De la reserva<br />a tu llegada.</h2><p>Tu estadía, paso a paso. Encuentra el alojamiento, confirma los detalles y consulta tu pase desde un mismo lugar.</p><button type="button" onClick={onLookup} className="restblu-text-action">Consultar mi reserva <ArrowRight aria-hidden="true" size={18} /></button></div>
          <ol className="restblu-arrival-steps">{arrivalSteps.map(({ title, description }) => <li key={title}><h3>{title}</h3><p>{description}</p></li>)}</ol>
        </div>
      </section>
    </>
  );
}
