'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Image from 'next/image';
import {
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Home,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { motion } from 'framer-motion';
import type { CustomerAccount } from '../domain/types';
import {
  isConfirmedOwnerReservation,
  ownerMonthMetrics,
  ownerRevenueSeries,
  type OwnerDashboardData,
  type OwnerReservation,
} from '../domain/owner-dashboard';
import {
  loginAccount,
  logoutAccount,
  sendPasswordReset,
} from '../services/account';
import { loadOwnerDashboard } from '../services/owners';
import { VerifyEmail } from './AccountScreen';
import GoogleSignInButton from './GoogleSignInButton';

const field =
  'mt-2 min-h-11 w-full rounded-xl border border-[#cbdbe8] bg-white px-3 py-2 text-sm text-[#183b56] outline-none focus:border-[#1672aa] focus:ring-2 focus:ring-[#b8def5]';
const button =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#115678] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#0c405c] disabled:cursor-wait disabled:opacity-60';
const outline =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#cbdbe8] bg-white px-4 py-2 text-sm font-semibold text-[#224b68] transition hover:bg-[#edf5fb] disabled:opacity-60';
const money = (value: number) =>
  new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(value);
const date = (value: string) =>
  new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString('es-CL', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
const monthNow = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};
const monthLabel = (month: string) =>
  new Date(`${month}-01T12:00:00Z`).toLocaleDateString('es-CL', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

export default function OwnerPortal({
  account,
  onGuestAccount,
}: {
  account: CustomerAccount | null;
  onGuestAccount: () => void;
}) {
  if (!account) return <OwnerLogin />;
  if (!account.emailVerified)
    return <VerifyEmail account={account} codeSent={false} />;
  return <OwnerPanelLoader key={account.uid} onGuestAccount={onGuestAccount} />;
}

function OwnerLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  async function submit(event: { preventDefault: () => void }) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setInfo('');
    try {
      await loginAccount(email, password);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'No pudimos iniciar sesión.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function reset() {
    if (!email.trim()) {
      setError('Escribe el correo registrado por la administración.');
      return;
    }
    setBusy(true);
    setError('');
    setInfo('');
    try {
      await sendPasswordReset(email);
      setInfo(
        'Si existe una cuenta con ese correo, recibirás un enlace para establecer tu contraseña. Revisa también Spam.',
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'No pudimos enviar el enlace.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mx-auto grid max-w-6xl gap-8 px-5 py-10 lg:grid-cols-[1.1fr_.9fr] lg:gap-14 lg:py-16">
      <div className="rounded-[2rem] bg-[#0b2d49] p-7 text-white sm:p-10">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-2 text-xs font-semibold tracking-wide text-[#b9def6]">
          <Home aria-hidden="true" className="size-4" /> RESTBLU PROPIETARIOS
        </span>
        <h1 className="restblu-display mt-7 text-4xl leading-tight sm:text-5xl">
          Tu propiedad.
          <br />
          <span className="text-[#91d5f5]">Todo bajo control.</span>
        </h1>
        <p className="mt-5 max-w-lg leading-7 text-[#c1d8e8]">
          Consulta tus alojamientos, sus reservas y el rendimiento de cada
          estadía desde tu espacio privado.
        </p>
        <ul className="mt-8 grid gap-5 text-sm text-[#d7e7f3]">
          <li className="flex items-center gap-3">
            <CalendarDays
              aria-hidden="true"
              className="size-5 shrink-0 text-[#91d5f5]"
            />{' '}
            Calendario y reservas de tus alojamientos.
          </li>
          <li className="flex items-center gap-3">
            <BarChart3
              aria-hidden="true"
              className="size-5 shrink-0 text-[#91d5f5]"
            />{' '}
            Ocupación e importes de reservas pagadas.
          </li>
          <li className="flex items-center gap-3">
            <ShieldCheck
              aria-hidden="true"
              className="size-5 shrink-0 text-[#91d5f5]"
            />{' '}
            Acceso individual, habilitado por la administración.
          </li>
        </ul>
      </div>
      <form
        onSubmit={submit}
        className="self-center rounded-3xl border border-[#dce7ef] bg-white p-6 shadow-sm sm:p-8"
      >
        <LockKeyhole aria-hidden="true" className="size-8 text-[#1672aa]" />
        <h2 className="mt-4 text-2xl font-semibold tracking-tight text-[#13334d]">
          Ingresa a tu panel
        </h2>
        <p className="mt-2 text-sm leading-6 text-[#536f84]">
          Usa el correo que la administración registró como propietario.
        </p>
        <label className="mt-6 block text-sm font-medium text-[#254b66]">
          Correo electrónico
          <input
            className={field}
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="mt-4 block text-sm font-medium text-[#254b66]">
          Contraseña
          <input
            className={field}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && (
          <p
            role="alert"
            className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800"
          >
            {error}
          </p>
        )}
        {info && (
          <output className="mt-4 block rounded-xl bg-[#edf5fb] p-3 text-sm leading-6 text-[#254b66]">
            {info}
          </output>
        )}
        <button
          className={`${button} mt-6 w-full`}
          disabled={busy}
          type="submit"
        >
          {busy ? 'Un momento…' : 'Ingresar como propietario'}
        </button>
        <button
          type="button"
          className="mt-2 min-h-11 w-full text-sm font-semibold text-[#145f8b] disabled:opacity-60"
          disabled={busy}
          onClick={() => void reset()}
        >
          Establecer o recuperar contraseña
        </button>
        <div className="my-4 border-t border-[#e1ebf2]" />
        <GoogleSignInButton onError={setError} />
        <p className="mt-5 text-xs leading-5 text-[#536f84]">
          ¿Aún no tienes acceso? La administración debe registrar tu correo y
          asignarte tus propiedades desde el gestor. Si usas Google, el correo
          debe coincidir.
        </p>
      </form>
    </section>
  );
}

function OwnerPanelLoader({ onGuestAccount }: { onGuestAccount: () => void }) {
  const [data, setData] = useState<OwnerDashboardData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [revision, setRevision] = useState(0);
  function refresh() {
    setBusy(true);
    setError('');
    setData(null);
    setRevision((value) => value + 1);
  }
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    loadOwnerDashboard(controller.signal)
      .then((result) => {
        if (active && !controller.signal.aborted) setData(result);
      })
      .catch((failure) => {
        if (active)
          setError(
            controller.signal.aborted
              ? 'El servicio tarda en responder. Inténtalo nuevamente.'
              : failure instanceof Error
                ? failure.message
                : 'No pudimos cargar tu panel.',
          );
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (active) setBusy(false);
      });
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [revision]);
  if (busy)
    return (
      <output className="flex min-h-96 items-center justify-center gap-3 p-8 text-[#416581]">
        <LoaderCircle
          aria-hidden="true"
          className="size-5 motion-safe:animate-spin"
        />{' '}
        Cargando tu panel de propietario…
      </output>
    );
  if (!data)
    return (
      <section className="mx-auto max-w-2xl px-5 py-14">
        <div className="rounded-3xl border border-[#dce7ef] bg-white p-7">
          <CircleAlert aria-hidden="true" className="size-8 text-[#1672aa]" />
          <h1 className="mt-4 text-2xl font-semibold">
            No pudimos abrir tu panel
          </h1>
          <p role="alert" className="mt-3 leading-7 text-[#536f84]">
            {error}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button className={button} onClick={refresh}>
              Volver a intentar
            </button>
            <button className={outline} onClick={logoutAccount}>
              Usar otra cuenta
            </button>
            <button className={outline} onClick={onGuestAccount}>
              Ir a mi cuenta
            </button>
          </div>
        </div>
      </section>
    );
  return (
    <OwnerDashboardView
      data={data}
      onRefresh={refresh}
      onLogout={logoutAccount}
    />
  );
}

type Panel = 'resumen' | 'calendario' | 'reservas' | 'propiedades' | 'ingresos';
const tabs = [
  { id: 'resumen', label: 'Resumen', icon: LayoutDashboard },
  { id: 'calendario', label: 'Calendario', icon: CalendarDays },
  { id: 'reservas', label: 'Reservas', icon: CalendarDays },
  { id: 'propiedades', label: 'Propiedades', icon: Home },
  { id: 'ingresos', label: 'Importes pagados', icon: Wallet },
] as const;

export function OwnerDashboardView({
  data,
  onRefresh,
  onLogout,
}: {
  data: OwnerDashboardData;
  onRefresh: () => void;
  onLogout: () => void;
}) {
  const [panel, setPanel] = useState<Panel>('resumen');
  const [month, setMonth] = useState(monthNow);
  const [propertyId, setPropertyId] = useState<number | null>(null);
  const metrics = ownerMonthMetrics(data, month, propertyId);
  const periodData = {
    ...data,
    properties: metrics.properties,
    reservations: data.reservations.filter(
      (item) => propertyId === null || item.propertyId === propertyId,
    ),
  };
  const series = ownerRevenueSeries(periodData, month);
  const title = tabs.find((tab) => tab.id === panel)?.label || 'Resumen';
  function shiftMonth(step: number) {
    const next = new Date(`${month}-01T12:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + step);
    const value = next.toISOString().slice(0, 7);
    if (value >= '2000-01' && value <= '2100-12') setMonth(value);
  }
  return (
    <section
      aria-label="Panel de propietario"
      className="mx-auto max-w-[1440px] px-3 py-6 text-[#183b56] sm:px-5 lg:px-8 lg:py-9"
    >
      <div className="overflow-hidden rounded-3xl border border-[#dce7ef] bg-[#f2f7fb] shadow-sm lg:grid lg:grid-cols-[208px_minmax(0,1fr)]">
        <aside className="flex flex-col bg-[#0b2d49] p-4 text-white lg:p-5">
          <div className="hidden border-b border-white/15 pb-6 pt-2 lg:block">
            <p className="text-xl font-semibold">
              Rest<span className="text-[#91d5f5]">Blu</span>
            </p>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-[.2em] text-[#b2ccdf]">
              Propietarios
            </p>
          </div>
          <nav
            aria-label="Panel de propietario"
            className="flex gap-2 overflow-x-auto lg:mt-6 lg:flex-col"
          >
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                type="button"
                key={id}
                aria-current={panel === id ? 'page' : undefined}
                onClick={() => setPanel(id)}
                className={`flex min-h-11 shrink-0 items-center gap-3 whitespace-nowrap rounded-xl px-3 py-3 text-left text-sm font-medium transition ${panel === id ? 'bg-[#18547d] text-white' : 'text-[#c3d8e7] hover:bg-white/10'}`}
              >
                <Icon aria-hidden="true" className="size-4" />
                {label}
              </button>
            ))}
          </nav>
          <div className="mt-auto hidden pt-12 lg:block">
            <ShieldCheck aria-hidden="true" className="size-6 text-[#91d5f5]" />
            <p className="mt-3 text-xs leading-5 text-[#b2ccdf]">
              Tu espacio privado.
              <br />
              Solo tus propiedades.
            </p>
          </div>
        </aside>
        <div className="min-w-0">
          <header className="border-b border-[#dce7ef] bg-white p-5 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1 break-words">
                <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-[#54758f]">
                  TU PROPIEDAD, A TU RITMO
                </p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
                  {title}
                </h1>
                <p className="mt-2 text-sm text-[#54758f]">
                  Hola, {data.owner.name.split(' ')[0] || 'propietario'}. Así
                  van tus alojamientos.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button className={outline} type="button" onClick={onRefresh}>
                  <RefreshCw aria-hidden="true" className="size-4" />
                  <span className="hidden sm:inline">Actualizar</span>
                  <span className="sr-only sm:hidden">Actualizar panel</span>
                </button>
                <button type="button" className={outline} onClick={onLogout}>
                  <LogOut aria-hidden="true" className="size-4" />
                  <span className="hidden sm:inline">Salir</span>
                  <span className="sr-only sm:hidden">Cerrar sesión</span>
                </button>
              </div>
            </div>
            <p className="mt-4 break-all text-xs text-[#54758f]">
              {data.owner.email}
            </p>
          </header>
          <div className="p-4 sm:p-6">
            <div className="mb-6 flex flex-wrap items-end gap-3">
              <label className="min-w-0 flex-1 basis-52 text-xs font-semibold text-[#426580]">
                Alojamiento
                <select
                  className={field}
                  value={propertyId ?? ''}
                  onChange={(event) =>
                    setPropertyId(
                      event.target.value ? Number(event.target.value) : null,
                    )
                  }
                >
                  <option value="">Todos mis alojamientos</option>
                  {data.properties.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold text-[#426580]">
                Mes
                <input
                  type="month"
                  aria-label="Mes del panel"
                  min="2000-01"
                  max="2100-12"
                  className={`${field} max-w-48`}
                  value={month}
                  onChange={(event) => {
                    if (
                      /^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(
                        event.target.value,
                      )
                    )
                      setMonth(event.target.value);
                  }}
                />
              </label>
            </div>
            {data.properties.length === 0 && (
              <output className="mb-6 block rounded-2xl border border-[#cbdfee] bg-white p-5 text-sm leading-6">
                Tu cuenta está habilitada. La administración todavía no te ha
                asignado alojamientos.
              </output>
            )}
            {panel === 'resumen' && (
              <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Stat
                    label="Reservas pagadas"
                    value={money(metrics.grossRevenue)}
                    hint="Importe bruto · entradas del mes"
                    icon={<Wallet />}
                  />
                  <Stat
                    label="Ocupación"
                    value={`${metrics.occupancyPercent}%`}
                    hint="Noches pagadas · propiedades activas"
                    icon={<BarChart3 />}
                  />
                  <Stat
                    label="Reservas confirmadas"
                    value={String(metrics.confirmedReservations)}
                    hint="Con pago · entradas del mes"
                    icon={<CalendarDays />}
                  />
                  <Stat
                    label="Propiedades activas"
                    value={String(metrics.activeProperties)}
                    hint={`${metrics.properties.length} asignadas en esta selección`}
                    icon={<Home />}
                  />
                </div>
                <div className="mt-5 grid gap-5 xl:grid-cols-[1.2fr_1fr]">
                  <PanelCard
                    title="Reservas pagadas"
                    note="Importes brutos según mes de entrada"
                  >
                    <RevenueChart series={series} />
                  </PanelCard>
                  <PanelCard
                    title="Reservas del mes"
                    action={
                      <button
                        className="min-h-11 text-xs font-semibold text-[#11699b]"
                        onClick={() => setPanel('reservas')}
                      >
                        Ver todas
                      </button>
                    }
                  >
                    <ReservationList
                      reservations={metrics.reservations.slice(0, 4)}
                    />
                  </PanelCard>
                </div>
                <div className="mt-5">
                  <PanelCard
                    title="Tu calendario"
                    action={
                      <button
                        className="min-h-11 text-xs font-semibold text-[#11699b]"
                        onClick={() => setPanel('calendario')}
                      >
                        Ver calendario
                      </button>
                    }
                  >
                    <OwnerCalendar
                      month={month}
                      reservations={metrics.reservations}
                    />
                  </PanelCard>
                </div>
              </>
            )}
            {panel === 'calendario' && (
              <PanelCard
                title="Calendario de estadías"
                note="Se muestran reservas confirmadas con pago. La salida no ocupa noche."
                action={
                  <div className="flex gap-1">
                    <button
                      aria-label="Mes anterior"
                      className={outline}
                      onClick={() => shiftMonth(-1)}
                    >
                      <ChevronLeft aria-hidden="true" className="size-4" />
                    </button>
                    <button
                      aria-label="Mes siguiente"
                      className={outline}
                      onClick={() => shiftMonth(1)}
                    >
                      <ChevronRight aria-hidden="true" className="size-4" />
                    </button>
                  </div>
                }
              >
                <OwnerCalendar
                  month={month}
                  reservations={metrics.reservations}
                />
                <div className="mt-5 border-t border-[#e3ecf3] pt-5">
                  <ReservationList reservations={metrics.reservations} />
                </div>
              </PanelCard>
            )}
            {panel === 'reservas' && (
              <PanelCard
                title="Reservas del mes"
                note="Incluye estadías que se solapan con el mes seleccionado."
              >
                <ReservationList reservations={metrics.reservations} />
              </PanelCard>
            )}
            {panel === 'propiedades' && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  {metrics.properties.map((property) => (
                    <article
                      key={property.id}
                      className="overflow-hidden rounded-2xl border border-[#dce7ef] bg-white"
                    >
                      {property.image && (
                        <Image
                          unoptimized
                          src={property.image}
                          alt={property.name}
                          width={600}
                          height={300}
                          className="h-40 w-full object-cover"
                        />
                      )}
                      <div className="p-5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h2 className="font-semibold">{property.name}</h2>
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-medium ${property.active ? 'bg-[#e7f3fb] text-[#195d85]' : 'bg-slate-100 text-slate-600'}`}
                          >
                            {property.active ? 'Activa' : 'Inactiva'}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-[#54758f]">
                          {property.place}
                        </p>
                        <p className="mt-4 text-lg font-semibold">
                          {money(property.nightlyPrice)}{' '}
                          <span className="text-xs font-normal text-[#54758f]">
                            / noche
                          </span>
                        </p>
                        <p className="mt-2 text-xs text-[#54758f]">
                          Hasta {property.guests} huéspedes
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
                <p className="mt-5 text-sm leading-6 text-[#54758f]">
                  Para cambiar la ficha, la tarifa o la asignación de una
                  propiedad, contacta con la administración.
                </p>
              </>
            )}
            {panel === 'ingresos' && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Stat
                    label="Reservas pagadas"
                    value={money(metrics.grossRevenue)}
                    hint={`Entradas en ${monthLabel(month)}`}
                    icon={<Wallet />}
                  />
                  <Stat
                    label="Reservas confirmadas"
                    value={String(metrics.confirmedReservations)}
                    hint="Con pago registrado"
                    icon={<CalendarDays />}
                  />
                </div>
                <div className="mt-5">
                  <PanelCard
                    title="Evolución de importes pagados"
                    note="Últimos seis meses · según fecha de entrada"
                  >
                    <RevenueChart series={series} />
                  </PanelCard>
                </div>
                <p className="mt-5 rounded-2xl border border-[#cbdfee] bg-white p-5 text-sm leading-6 text-[#426580]">
                  Estos valores corresponden al importe bruto de las reservas
                  confirmadas con pago. Las comisiones, los gastos, los
                  reembolsos y las liquidaciones al propietario aún no se
                  calculan en este panel.
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: ReactNode;
}) {
  return (
    <motion.article
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
      className="min-w-0 rounded-2xl border border-[#dce7ef] bg-white p-5"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-[#54758f]">{label}</p>
        <span
          aria-hidden="true"
          className="shrink-0 text-[#1672aa] [&>svg]:size-5"
        >
          {icon}
        </span>
      </div>
      <p className="mt-4 break-words text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </p>
      <p className="mt-2 text-[11px] leading-5 text-[#54758f]">{hint}</p>
    </motion.article>
  );
}
function PanelCard({
  title,
  note,
  action,
  children,
}: {
  title: string;
  note?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-2xl border border-[#dce7ef] bg-white p-4 sm:p-5">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {note && (
            <p className="mt-1 text-xs leading-5 text-[#54758f]">{note}</p>
          )}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
function ReservationList({
  reservations,
}: {
  reservations: OwnerReservation[];
}) {
  if (!reservations.length)
    return (
      <p className="py-7 text-center text-sm leading-6 text-[#54758f]">
        No hay reservas para esta selección.
      </p>
    );
  return (
    <ul className="divide-y divide-[#e5edf4]">
      {reservations.map((item) => (
        <li
          key={item.id}
          className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0"
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold">{item.propertyName}</p>
            <p className="mt-1 text-xs text-[#54758f]">
              {date(item.checkIn)} – {date(item.checkOut)} · {item.guests}{' '}
              huéspedes
            </p>
            <p className="mt-1 text-xs text-[#54758f]">
              {item.guestName} · {item.id}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold tabular-nums">
              {money(item.total)}
            </p>
            <span
              className={`mt-1 inline-block rounded-full px-2 py-1 text-[11px] font-medium ${isConfirmedOwnerReservation(item) ? 'bg-[#e7f3fb] text-[#195d85]' : 'bg-slate-100 text-slate-600'}`}
            >
              {isConfirmedOwnerReservation(item)
                ? 'Confirmada · pagada'
                : item.status === 'expirada'
                  ? 'Expirada'
                  : item.status === 'cancelada'
                    ? 'Cancelada'
                    : 'Pendiente'}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
function RevenueChart({
  series,
}: {
  series: ReturnType<typeof ownerRevenueSeries>;
}) {
  const max = Math.max(1, ...series.map((item) => item.revenue));
  return (
    <div>
      <div
        aria-hidden="true"
        className="flex h-44 items-end gap-3 border-b border-[#dce7ef] px-1 pt-4 sm:gap-5"
      >
        {series.map((item, index) => (
          <div
            key={item.month}
            className="flex h-full min-w-0 flex-1 items-end justify-center"
          >
            <div
              title={money(item.revenue)}
              className={`w-full max-w-12 rounded-t-md ${index === series.length - 1 ? 'bg-[#166d9d]' : 'bg-[#91bbd9]'}`}
              style={{
                height: `${item.revenue ? Math.max(3, (item.revenue / max) * 100) : 0}%`,
              }}
            />
          </div>
        ))}
      </div>
      <dl className="mt-3 grid grid-cols-6 gap-2 text-center">
        {series.map((item) => (
          <div key={item.month}>
            <dt className="text-[10px] text-[#54758f]">{item.label}</dt>
            <dd className="mt-1 break-all text-[10px] font-semibold tabular-nums">
              {money(item.revenue)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
function OwnerCalendar({
  month,
  reservations,
}: {
  month: string;
  reservations: OwnerReservation[];
}) {
  const first = new Date(`${month}-01T12:00:00Z`);
  const offset = (first.getUTCDay() + 6) % 7;
  const end = new Date(first);
  end.setUTCMonth(first.getUTCMonth() + 1, 0);
  const days = end.getUTCDate();
  const paid = reservations.filter(isConfirmedOwnerReservation);
  return (
    <div>
      <p className="mb-4 text-sm font-medium capitalize">{monthLabel(month)}</p>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium text-[#54758f]">
        {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((day) => (
          <span key={day} className="py-2">
            {day}
          </span>
        ))}
      </div>
      <ol
        aria-label={`Estadías confirmadas en ${monthLabel(month)}`}
        className="grid grid-cols-7 gap-1"
      >
        {Array.from({ length: offset }, (_, index) => (
          <li aria-hidden="true" key={`blank-${index}`} />
        ))}
        {Array.from({ length: days }, (_, index) => {
          const day = `${month}-${String(index + 1).padStart(2, '0')}`;
          const stays = paid.filter(
            (item) => item.checkIn <= day && item.checkOut > day,
          );
          return (
            <li
              key={day}
              aria-label={`${index + 1}: ${stays.length ? stays.map((item) => item.propertyName).join(', ') : 'sin estadías confirmadas'}`}
              className={`min-h-14 min-w-0 rounded-lg border p-1.5 sm:min-h-20 sm:p-2 ${stays.length ? 'border-[#b9d9ed] bg-[#edf6fd]' : 'border-[#edf1f5]'}`}
            >
              <span className="text-xs font-medium">{index + 1}</span>
              {stays.length > 0 && (
                <>
                  <span className="mt-1 block rounded bg-[#1b6b98] px-1 py-0.5 text-center text-[9px] text-white sm:hidden">
                    {stays.length}
                  </span>
                  <span
                    aria-hidden="true"
                    className="mt-1 hidden truncate text-[9px] font-medium text-[#195d85] sm:block"
                  >
                    {stays[0].propertyName}
                  </span>
                  {stays.length > 1 && (
                    <span
                      aria-hidden="true"
                      className="hidden text-[9px] text-[#195d85] sm:block"
                    >
                      +{stays.length - 1}
                    </span>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ol>
      <p className="mt-4 flex items-center gap-2 text-xs text-[#54758f]">
        <span aria-hidden="true" className="size-2.5 rounded bg-[#1b6b98]" />{' '}
        Estadía confirmada con pago
      </p>
    </div>
  );
}
