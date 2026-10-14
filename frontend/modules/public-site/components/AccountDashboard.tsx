'use client';
/* oxlint-disable next/no-img-element -- el sitio es estático (output: export) y las imágenes vienen del catálogo. */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  CalendarDays, ChevronRight, Heart, HelpCircle, KeyRound, LogOut, MapPin, Moon, RefreshCw,
  ShieldCheck, Sparkles, Trash2, UserRound,
} from 'lucide-react';
import type { CustomerAccount, CustomerProfile, Property } from '../domain/types';
import { formatCurrency, formatDate, getNightCount } from '../domain/reservation';
import {
  accountProviders, changePassword, deleteAccount, logoutAccount, sendPasswordReset,
} from '../services/account';
import { deleteCustomerData, loadCustomerReservations, type CustomerReservation } from '../services/customer';
import { ProfileForm, reservationLabel } from './AccountScreen';

type Tab = 'resumen' | 'reservas' | 'favoritos' | 'datos' | 'seguridad';

const SUPPORT_EMAIL = 'aherrera.bitfot@gmail.com';

function initials(name: string, email: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length) return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
  return email.slice(0, 2).toUpperCase();
}

function isConfirmed(item: CustomerReservation) {
  return Boolean(item.verified) && item.paymentStatus === 'aprobado-demo';
}

export default function AccountDashboard({
  account, profile, reason, properties, favorites, onToggleFavorite, onSelectProperty, onProfileSaved, onOpenReservation,
  focusReservationId, verifyingReservationId, onPaymentConfirmed,
}: {
  account: CustomerAccount;
  profile: CustomerProfile | null;
  reason?: string;
  properties: Property[];
  favorites: number[];
  onToggleFavorite: (id: number) => void;
  onSelectProperty: (property: Property) => void;
  onProfileSaved: (profile: CustomerProfile) => void;
  onOpenReservation: (item: CustomerReservation) => void;
  focusReservationId: string;
  verifyingReservationId: string;
  onPaymentConfirmed: () => void;
}) {
  const [tab, setTab] = useState<Tab>('resumen');
  const [items, setItems] = useState<CustomerReservation[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setItems(await loadCustomerReservations());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No fue posible cargar tus reservas.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    loadCustomerReservations()
      .then((loaded) => { if (active) setItems(loaded); })
      .catch((failure) => { if (active) setError(failure instanceof Error ? failure.message : 'No fue posible cargar tus reservas.'); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (focusReservationId) setTab('reservas');
  }, [focusReservationId]);
  useEffect(() => {
    if (!verifyingReservationId) return;
    let active = true;
    const refresh = async () => {
      try {
        const loaded = await loadCustomerReservations();
        if (!active) return;
        setItems(loaded);
        if (loaded.some((item) => item.booking.id === verifyingReservationId && isConfirmed(item))) {
          onPaymentConfirmed();
        }
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : 'No fue posible actualizar tus reservas.');
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [verifyingReservationId, onPaymentConfirmed]);

  const today = new Date().toISOString().slice(0, 10);
  const confirmed = useMemo(() => (items || []).filter(isConfirmed), [items]);
  const upcoming = useMemo(
    () => confirmed.filter((item) => item.booking.checkOut >= today).sort((a, b) => a.booking.checkIn.localeCompare(b.booking.checkIn)),
    [confirmed, today],
  );
  const past = confirmed.filter((item) => item.booking.checkOut < today);
  const nights = confirmed.reduce((total, item) => total + (item.booking.nights || getNightCount(item.booking.checkIn, item.booking.checkOut)), 0);
  const favoriteProperties = properties.filter((property) => favorites.includes(property.id));
  const rutLocked = confirmed.length > 0;
  const firstName = profile?.name?.split(' ')[0] || '';

  const tabs: { id: Tab; label: string; icon: ReactNode }[] = [
    { id: 'resumen', label: 'Resumen', icon: <Sparkles className="size-4" /> },
    { id: 'reservas', label: 'Mis reservas', icon: <CalendarDays className="size-4" /> },
    { id: 'favoritos', label: 'Favoritos', icon: <Heart className="size-4" /> },
    { id: 'datos', label: 'Mis datos', icon: <UserRound className="size-4" /> },
    { id: 'seguridad', label: 'Seguridad y ayuda', icon: <ShieldCheck className="size-4" /> },
  ];

  return (
    <section className="mx-auto max-w-6xl px-5 py-8 lg:px-8">
      <header className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#0b2435] via-[#103d50] to-[#0b6871] p-6 text-white shadow-xl sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-16 size-64 rounded-full bg-[#53d9c6]/20 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-5">
          <div className="grid size-20 place-items-center rounded-[50%_50%_18px_50%] bg-[#53d9c6] text-2xl font-black text-[#092b3a] shadow-[inset_-8px_-8px_0_#0b8982]">
            {initials(profile?.name || '', account.email)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[#9edbd5]">MI CUENTA RESTBLU</p>
            <h1 className="mt-1 truncate text-3xl font-bold tracking-tight">Hola{firstName ? `, ${firstName}` : ''}</h1>
            <p className="mt-1 truncate text-sm text-[#bfd0d5]">{account.email} · RUT {profile?.documentId}</p>
          </div>
          <button type="button" onClick={logoutAccount} className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-bold hover:bg-white/20">
            <LogOut className="size-4" /> Cerrar sesión
          </button>
        </div>
        <div className="relative mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Reservas" value={String(confirmed.length)} />
          <Stat label="Noches" value={String(nights)} />
          <Stat label="Favoritos" value={String(favorites.length)} />
          <Stat label="Próxima estadía" value={upcoming[0] ? formatDate(upcoming[0].booking.checkIn) : '—'} small />
        </div>
      </header>

      {reason && <p className="mt-5 rounded-2xl bg-[#e8f6f3] px-4 py-3 text-sm font-semibold text-[#3f6870]">{reason}</p>}

      <nav className="mt-6 flex gap-2 overflow-x-auto pb-1" aria-label="Secciones de la cuenta">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition ${tab === item.id ? 'bg-[#103d50] text-white shadow' : 'bg-white text-[#3e5e6c] ring-1 ring-[#d8e8e5] hover:bg-[#eef5f4]'}`}
          >
            {item.icon}{item.label}
          </button>
        ))}
      </nav>

      <div className="mt-6">
        {tab === 'resumen' && (
          <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
            <Card title="Próxima estadía">
              {upcoming[0] ? (
                <ReservationRow item={upcoming[0]} properties={properties} onOpen={onOpenReservation} highlight />
              ) : (
                <Empty text="No tienes estadías próximas. ¿Buscamos tu siguiente refugio?" />
              )}
            </Card>
            <Card title="Tus favoritos">
              {favoriteProperties.length ? (
                <ul className="grid gap-3">
                  {favoriteProperties.slice(0, 3).map((property) => (
                    <li key={property.id}>
                      <button type="button" onClick={() => onSelectProperty(property)} className="flex w-full items-center gap-3 rounded-2xl p-2 text-left hover:bg-[#f2f8f7]">
                        <img src={property.image} alt="" className="size-14 rounded-xl object-cover" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-bold">{property.name}</span>
                          <span className="block truncate text-xs text-[#66818a]">{property.place}</span>
                        </span>
                        <ChevronRight className="size-4 text-[#9ab]" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty text="Marca alojamientos con el corazón para verlos aquí." />
              )}
            </Card>
          </div>
        )}

        {tab === 'reservas' && (
          <Card
            title="Mis reservas"
            action={
              <button type="button" onClick={() => void load()} aria-label="Actualizar reservas" className="rounded-full p-2 text-[#3e5e6c] ring-1 ring-[#d8e8e5]">
                <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            }
          >
            {error && <p role="alert" className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}
            {items && !items.length && <Empty text="Todavía no tienes reservas. Elige un alojamiento y reserva con tu cuenta." />}
            {items === null && !error && <p className="text-sm text-[#66818a]">Cargando…</p>}
            {upcoming.length > 0 && <SectionLabel text="Próximas" />}
            <ul className="grid gap-3">{upcoming.map((item) => <li key={item.booking.id}><ReservationRow item={item} properties={properties} onOpen={onOpenReservation} verifying={item.booking.id === verifyingReservationId} /></li>)}</ul>
            {(items || []).some((item) => !isConfirmed(item)) && <SectionLabel text="Pendientes" />}
            <ul className="grid gap-3">{(items || []).filter((item) => !isConfirmed(item)).map((item) => <li key={item.booking.id}><ReservationRow item={item} properties={properties} onOpen={onOpenReservation} verifying={item.booking.id === verifyingReservationId} /></li>)}</ul>
            {past.length > 0 && <SectionLabel text="Estadías anteriores" />}
            <ul className="grid gap-3">{past.map((item) => <li key={item.booking.id}><ReservationRow item={item} properties={properties} onOpen={onOpenReservation} /></li>)}</ul>
          </Card>
        )}

        {tab === 'favoritos' && (
          <Card title="Favoritos">
            {favoriteProperties.length ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {favoriteProperties.map((property) => (
                  <article key={property.id} className="overflow-hidden rounded-3xl border border-[#e0ecea] bg-white shadow-sm">
                    <div className="relative">
                      <img src={property.image} alt="" className="h-44 w-full object-cover" />
                      <button type="button" onClick={() => onToggleFavorite(property.id)} aria-label="Quitar de favoritos" className="absolute right-3 top-3 grid size-9 place-items-center rounded-full bg-white/95 shadow">
                        <Heart className="size-5 fill-[#e5485d] text-[#e5485d]" />
                      </button>
                    </div>
                    <div className="p-4">
                      <p className="font-bold">{property.name}</p>
                      <p className="flex items-center gap-1 text-sm text-[#66818a]"><MapPin className="size-3.5" />{property.place}</p>
                      <div className="mt-3 flex items-center justify-between">
                        <span className="text-sm font-bold">{property.price} <span className="font-normal text-[#66818a]">/ noche</span></span>
                        <button type="button" onClick={() => onSelectProperty(property)} className="rounded-full bg-[#0b6871] px-4 py-1.5 text-sm font-bold text-white">Ver</button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <Empty text="Aún no tienes favoritos. Toca el corazón en un alojamiento para guardarlo." />
            )}
          </Card>
        )}

        {tab === 'datos' && (
          <ProfileForm
            key={JSON.stringify(profile)}
            profile={profile}
            rutLocked={rutLocked}
            onSaved={onProfileSaved}
            full
          />
        )}

        {tab === 'seguridad' && (
          <SecurityPanel email={account.email} profile={profile} hasUpcoming={upcoming.length > 0} />
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, small = false }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-2xl bg-white/10 px-4 py-3 backdrop-blur">
      <p className="text-[11px] font-bold uppercase tracking-wider text-[#9edbd5]">{label}</p>
      <p className={`mt-1 font-bold ${small ? 'text-base' : 'text-2xl'}`}>{value}</p>
    </div>
  );
}

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-3xl border border-[#d8e8e5] bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold tracking-tight">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function SectionLabel({ text }: { text: string }) {
  return <p className="mb-2 mt-5 text-xs font-bold uppercase tracking-[.16em] text-[#07888d] first:mt-0">{text}</p>;
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-2xl border border-dashed border-[#cfe2df] px-4 py-8 text-center text-sm text-[#5d7a83]">{text}</p>;
}

function ReservationRow({ item, properties, onOpen, highlight = false, verifying = false }: {
  item: CustomerReservation;
  properties: Property[];
  onOpen: (item: CustomerReservation) => void;
  highlight?: boolean;
  verifying?: boolean;
}) {
  const label = reservationLabel(item);
  const image = properties.find((property) => property.id === item.booking.propertyId)?.image;
  const confirmed = isConfirmed(item);
  return (
    <div className={`flex flex-wrap items-center gap-4 rounded-2xl border p-3 ${highlight ? 'border-[#9fd8d1] bg-[#f2fbf9]' : 'border-[#e0ecea]'}`}>
      {image && <img src={image} alt="" className="size-20 rounded-xl object-cover" />}
      <div className="min-w-0 flex-1">
        <p className="truncate font-bold">{item.booking.propertyName}</p>
        <p className="text-sm text-[#5d7a83]">{formatDate(item.booking.checkIn)} → {formatDate(item.booking.checkOut)}</p>
        <p className="mt-0.5 flex items-center gap-2 text-xs text-[#789098]"><Moon className="size-3" />{item.booking.nights} noches · {formatCurrency(item.booking.total)}</p>
      </div>
      <div className="flex items-center gap-3">
        <span className={`rounded-lg px-2.5 py-1 text-xs font-bold ${label.tone}`}>{verifying && !confirmed ? 'Verificando pago' : label.text}</span>
        {item.status !== 'expirada' && (
          <button type="button" disabled={verifying && !confirmed} onClick={() => onOpen(item)} className="rounded-full bg-[#0b6871] px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">
            {confirmed ? 'Ver acceso' : verifying ? 'Esperando confirmación' : 'Pagar'}
          </button>
        )}
      </div>
    </div>
  );
}

function SecurityPanel({ email, profile, hasUpcoming }: { email: string; profile: CustomerProfile | null; hasUpcoming: boolean }) {
  const [providers, setProviders] = useState<string[] | null>(null);
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [legal, setLegal] = useState<'terminos' | 'privacidad' | null>(null);

  useEffect(() => {
    let active = true;
    accountProviders().then((list) => { if (active) setProviders(list); }).catch(() => { if (active) setProviders([]); });
    return () => { active = false; };
  }, []);
  const usesPassword = providers?.includes('password') ?? false;

  async function run(action: () => Promise<void>, done: string) {
    setBusy(true);
    setMessage('');
    try {
      await action();
      setMessage(done);
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : 'No fue posible completar la operación.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Contraseña">
        {providers === null ? (
          <p className="text-sm text-[#66818a]">Cargando…</p>
        ) : usesPassword ? (
          <form onSubmit={(event) => { event.preventDefault(); void run(async () => { await changePassword(password); setPassword(''); }, 'Contraseña actualizada.'); }}>
            <label className="block text-sm font-bold text-[#274b56]">
              Nueva contraseña
              <span className="relative block">
                <KeyRound className="absolute left-3 top-4 size-4 text-[#0b8e92]" />
                <input type="password" required minLength={6} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border border-[#d5e5e3] px-3 py-2.5 pl-10 text-sm outline-none focus:border-[#0b8e92]" />
              </span>
            </label>
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="submit" disabled={busy} className="rounded-xl bg-[#0b6871] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">Cambiar contraseña</button>
              <button type="button" disabled={busy} onClick={() => void run(() => sendPasswordReset(email), 'Te enviamos un enlace para crear una nueva contraseña.')} className="rounded-xl px-4 py-2.5 text-sm font-bold text-[#0b6871] ring-1 ring-[#cfe2df]">Enviarme un enlace</button>
            </div>
          </form>
        ) : (
          <p className="text-sm leading-6 text-[#5d7a83]">Ingresas con tu cuenta de Google, así que tu contraseña se administra en Google.</p>
        )}
      </Card>

      <Card title="Ayuda">
        <ul className="grid gap-2 text-sm">
          <li><a href={`mailto:${SUPPORT_EMAIL}?subject=Ayuda%20RestBlu`} className="flex items-center gap-3 rounded-2xl p-3 font-semibold hover:bg-[#f2f8f7]"><HelpCircle className="size-5 text-[#07888d]" />Escríbenos a {SUPPORT_EMAIL}</a></li>
          <li><button type="button" onClick={() => setLegal('terminos')} className="flex w-full items-center gap-3 rounded-2xl p-3 text-left font-semibold hover:bg-[#f2f8f7]"><ShieldCheck className="size-5 text-[#07888d]" />Términos y condiciones</button></li>
          <li><button type="button" onClick={() => setLegal('privacidad')} className="flex w-full items-center gap-3 rounded-2xl p-3 text-left font-semibold hover:bg-[#f2f8f7]"><UserRound className="size-5 text-[#07888d]" />Política de privacidad</button></li>
        </ul>
        {legal && (
          <div className="mt-3 rounded-2xl bg-[#f2f8f7] p-4 text-sm leading-6 text-[#3f6870]">
            {legal === 'terminos'
              ? 'Al reservar aceptas las condiciones del alojamiento, los horarios de check-in y check-out y el uso personal del QR de acceso, que solo es válido durante tu estadía. Los pagos se procesan con Webpay (Transbank).'
              : 'Usamos tu nombre, RUT, correo y teléfono para gestionar tus reservas y habilitar tu acceso. La fotografía facial, si la registras, se envía cifrada al terminal de acceso y no se conserva en nuestros servidores.'}
            <button type="button" onClick={() => setLegal(null)} className="mt-2 block font-bold text-[#0b6871]">Cerrar</button>
          </div>
        )}
      </Card>

      <Card title="Eliminar cuenta">
        {hasUpcoming ? (
          <p className="text-sm leading-6 text-[#5d7a83]">Tienes estadías próximas. Podrás eliminar tu cuenta cuando terminen.</p>
        ) : (
          <form onSubmit={(event) => {
            event.preventDefault();
            if (confirmText !== 'ELIMINAR') return;
            void run(async () => { await deleteCustomerData(profile?.documentId || ''); await deleteAccount(); }, 'Cuenta eliminada.');
          }}>
            <p className="text-sm leading-6 text-[#5d7a83]">Se borrarán tu perfil y tu acceso. El historial de reservas pagadas se conserva por razones contables. Escribe <strong>ELIMINAR</strong> para confirmar.</p>
            <input value={confirmText} onChange={(event) => setConfirmText(event.target.value)} className="mt-3 w-full rounded-xl border border-[#d5e5e3] px-3 py-2.5 text-sm outline-none focus:border-red-400" />
            <button type="submit" disabled={busy || confirmText !== 'ELIMINAR'} className="mt-3 flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">
              <Trash2 className="size-4" /> Eliminar mi cuenta
            </button>
          </form>
        )}
      </Card>

      {message && <output className="block rounded-2xl bg-[#e8f6f3] px-4 py-3 text-sm font-semibold text-[#3f6870] lg:col-span-2">{message}</output>}
    </div>
  );
}
