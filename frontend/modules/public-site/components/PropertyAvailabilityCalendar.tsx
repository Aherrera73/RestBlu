'use client';

import { useEffect, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, CircleAlert, X } from 'lucide-react';
import type { Property, SearchCriteria } from '../domain/types';
import {
  calendarDateStatus,
  formatDate,
  hasDateConflict,
  hasInvalidAvailabilityRanges,
  todayForInput,
} from '../domain/reservation';

type Selection = 'checkIn' | 'checkOut';

const weekdays = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

function monthFromIso(value: string) {
  const [year, month] = value.slice(0, 7).split('-').map(Number);
  return new Date(`${isoDate(year, month, 1)}T00:00:00Z`);
}

function isoDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function dayDescription(status: ReturnType<typeof calendarDateStatus>) {
  switch (status) {
    case 'occupied': return 'Ocupado';
    case 'checkout-only': return 'Ocupado, salida posible';
    case 'blocked': return 'No disponible para esta salida';
    case 'before-check-in': return 'Debe ser posterior al check-in';
    case 'past': return 'Fecha pasada';
    case 'unknown': return 'Disponibilidad sin verificar';
    default: return 'Disponible';
  }
}

export default function PropertyAvailabilityCalendar({
  property,
  search,
  setSearch,
  onNotice,
}: {
  property: Property;
  search: SearchCriteria;
  setSearch: (search: SearchCriteria) => void;
  onNotice: (message: string) => void;
}) {
  const today = todayForInput();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [month, setMonth] = useState(() => monthFromIso(today));
  const [calendarAlert, setCalendarAlert] = useState('');
  const invalidAvailability = hasInvalidAvailabilityRanges(property.unavailableRanges);
  const selectedConflict = search.checkIn && search.checkOut &&
    hasDateConflict(search.checkIn, search.checkOut, property.unavailableRanges);

  useEffect(() => {
    if (!selection) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setSelection(null);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selection]);

  function openCalendar(nextSelection: Selection) {
    if (nextSelection === 'checkOut' && !search.checkIn) {
      onNotice('Selecciona primero la fecha de check-in.');
      nextSelection = 'checkIn';
    }
    setMonth(monthFromIso(
      nextSelection === 'checkIn' ? search.checkIn || today : search.checkOut || search.checkIn,
    ));
    setCalendarAlert('');
    setSelection(nextSelection);
  }

  function chooseDate(date: string) {
    if (!selection) return;
    const status = calendarDateStatus(
      date, selection, search.checkIn, property.unavailableRanges, today,
    );
    if (status !== 'available' && status !== 'checkout-only') {
      if (status === 'past' || status === 'before-check-in') return;
      const message = status === 'unknown'
        ? 'No se pudo validar la disponibilidad. Reinicia el gestor y vuelve a intentarlo.'
        : status === 'occupied'
          ? `El ${formatDate(date)} ya está ocupado en ${property.name}. Selecciona otro día.`
          : 'Esa salida atravesaría días ya reservados. Elige una fecha anterior o cambia el check-in.';
      setCalendarAlert(message);
      onNotice(message);
      return;
    }
    if (selection === 'checkIn') {
      const keepCheckOut = search.checkOut > date &&
        !hasDateConflict(date, search.checkOut, property.unavailableRanges);
      setSearch({ ...search, checkIn: date, checkOut: keepCheckOut ? search.checkOut : '' });
    } else {
      setSearch({ ...search, checkOut: date });
    }
    setSelection(null);
  }

  const year = month.getUTCFullYear();
  const monthNumber = month.getUTCMonth() + 1;
  const firstWeekday = (month.getUTCDay() + 6) % 7;
  const nextMonth = new Date(month);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const daysInMonth = new Date(nextMonth.getTime() - 86_400_000).getUTCDate();
  const cells = Array.from({ length: Math.ceil((firstWeekday + daysInMonth) / 7) * 7 }, (_, index) => {
    const day = index - firstWeekday + 1;
    return day >= 1 && day <= daysInMonth ? day : null;
  });
  const previousMonth = new Date(month);
  previousMonth.setUTCMonth(previousMonth.getUTCMonth() - 1);
  const canGoBack = previousMonth >= monthFromIso(today);

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        {(['checkIn', 'checkOut'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => openCalendar(kind)}
            className="min-w-0 rounded-lg bg-[#f2f8f7] px-2 py-2 text-left font-bold text-[#173f4b] outline-none hover:bg-[#e3f3ef] focus-visible:ring-2 focus-visible:ring-[#54d9ce]"
            aria-label={`${kind === 'checkIn' ? 'Check-in' : 'Check-out'}: ${search[kind] ? formatDate(search[kind]) : 'seleccionar fecha'}. Abrir calendario de ${property.name}`}
          >
            <span className="block text-[10px] font-bold uppercase text-[#78939a]">
              {kind === 'checkIn' ? 'Check-in' : 'Check-out'}
            </span>
            <span className="mt-1 flex items-center gap-1.5 text-xs sm:text-sm">
              <CalendarDays className="size-4 shrink-0 text-[#0b8e92]" />
              <span className="min-w-0 truncate">{search[kind] ? formatDate(search[kind]) : 'Elegir fecha'}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-[#627e85]">Abre el calendario para ver los días disponibles y ocupados.</p>
      {(invalidAvailability || selectedConflict) && (
        <p role="alert" className="mt-2 flex gap-2 rounded-lg bg-[#fff1ec] px-3 py-2 text-xs font-semibold text-[#9b3f2e]">
          <CircleAlert className="size-4 shrink-0" />
          {invalidAvailability
            ? 'No se pudo comprobar la disponibilidad. Inténtalo de nuevo cuando el gestor sincronice.'
            : 'Las fechas seleccionadas incluyen días ocupados. Elige otro tramo en el calendario.'}
        </p>
      )}
      {selection && (
        <div
          role="presentation"
          className="fixed inset-0 z-[65] flex items-center justify-center bg-[#082b38]/70 p-3 backdrop-blur-sm"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setSelection(null); }}
        >
          <dialog
            open
            aria-modal="true"
            aria-label={`Calendario de ${selection === 'checkIn' ? 'check-in' : 'check-out'} para ${property.name}`}
            className="relative m-0 w-full max-w-md rounded-2xl border-0 bg-white p-4 shadow-2xl sm:p-6"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[#0b8e92]">{property.name}</p>
                <h2 className="mt-1 text-xl font-bold text-[#102d3f]">
                  Elige tu {selection === 'checkIn' ? 'check-in' : 'check-out'}
                </h2>
              </div>
              <button type="button" onClick={() => setSelection(null)} aria-label="Cerrar calendario" className="rounded-lg p-2 text-[#486b74] hover:bg-[#eff7f5]">
                <X className="size-5" />
              </button>
            </div>
            <div className="mt-5 flex items-center justify-between">
              <button type="button" onClick={() => setMonth(previousMonth)} disabled={!canGoBack} aria-label="Mes anterior" className="rounded-lg p-2 hover:bg-[#eff7f5] disabled:cursor-not-allowed disabled:opacity-30"><ChevronLeft className="size-5" /></button>
              <strong className="capitalize">{new Intl.DateTimeFormat('es-CL', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(month)}</strong>
              <button type="button" onClick={() => setMonth(nextMonth)} aria-label="Mes siguiente" className="rounded-lg p-2 hover:bg-[#eff7f5]"><ChevronRight className="size-5" /></button>
            </div>
            <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs font-bold text-[#607e86]">
              {weekdays.map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
            </div>
            <div className="mt-2 grid grid-cols-7 gap-1">
              {cells.map((day, index) => {
                if (day === null) return <span key={`blank-${index}`} aria-hidden="true" />;
                const date = isoDate(year, monthNumber, day);
                const status = calendarDateStatus(date, selection, search.checkIn, property.unavailableRanges, today);
                const selectable = status === 'available' || status === 'checkout-only';
                const selected = selectable && search[selection] === date;
                const dayStyle = selected
                  ? 'bg-[#0b6871] text-white ring-2 ring-[#0b6871]'
                  : status === 'available'
                    ? 'bg-[#e5f7ed] text-[#145d45] hover:bg-[#c5eed8]'
                    : status === 'checkout-only'
                      ? 'bg-[#fff1cb] text-[#795507] hover:bg-[#ffe5a0]'
                      : status === 'occupied' || status === 'blocked'
                        ? 'bg-[#fde9e5] text-[#a84232] hover:bg-[#fbd5cd]'
                        : 'bg-[#f2f4f4] text-[#9aabad]';
                return (
                  <button
                    key={date}
                    type="button"
                    disabled={status === 'past' || status === 'before-check-in'}
                    aria-disabled={!selectable}
                    aria-label={`${formatDate(date)}: ${dayDescription(status)}`}
                    onClick={() => chooseDate(date)}
                    className={`aspect-square min-h-9 rounded-lg text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0b6871] disabled:cursor-not-allowed ${dayStyle}`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs font-semibold text-[#46656c]">
              <span className="flex items-center gap-1.5"><i className="size-3 rounded bg-[#c5eed8]" /> Disponible</span>
              <span className="flex items-center gap-1.5"><i className="size-3 rounded bg-[#fbd5cd]" /> Ocupado</span>
              {selection === 'checkOut' && <span className="flex items-center gap-1.5"><i className="size-3 rounded bg-[#ffe5a0]" /> Salida posible</span>}
            </div>
            {calendarAlert && <p role="alert" className="mt-4 flex gap-2 rounded-lg bg-[#fff1ec] px-3 py-2 text-sm font-semibold text-[#9b3f2e]"><CircleAlert className="size-4 shrink-0" />{calendarAlert}</p>}
            <p className="mt-4 text-xs text-[#627e85]">La salida puede coincidir con la entrada de otra reserva. La disponibilidad se confirma al reservar.</p>
          </dialog>
        </div>
      )}
    </>
  );
}
