'use client';

import { useState } from 'react';
import { CalendarDays, KeyRound, Mail, MailCheck, Phone, ShieldCheck, UserRound } from 'lucide-react';
import type { CustomerAccount, CustomerProfile, Property } from '../domain/types';
import AccountDashboard from './AccountDashboard';
import { formatRut, isValidRut } from '../domain/reservation';
import {
  loginAccount, logoutAccount, refreshAccount, registerAccount, requestVerificationCode, sendPasswordReset, verifyAccountCode,
} from '../services/account';
import { saveCustomerProfile, type CustomerReservation } from '../services/customer';
import GoogleSignInButton from './GoogleSignInButton';

const inputClass =
  'mt-1.5 w-full rounded-xl border border-[#d5e5e3] bg-white px-3 py-2.5 text-sm outline-none transition focus:border-[#0b8e92] focus:ring-2 focus:ring-[#b9ebe5]';

export function reservationLabel(item: CustomerReservation) {
  if (item.status === 'expirada') return { text: 'Vencida', tone: 'bg-[#fff0dd] text-[#8a552a]' };
  if (item.verified && item.paymentStatus === 'aprobado-demo') {
    return { text: 'Confirmada', tone: 'bg-[#dff7ed] text-[#08735f]' };
  }
  if (item.emailVerified) return { text: 'Pago pendiente', tone: 'bg-[#fff3cf] text-[#8a5a08]' };
  return { text: 'En proceso', tone: 'bg-[#fff3cf] text-[#8a5a08]' };
}

export default function AccountScreen({
  account,
  profile,
  profileLoaded,
  reason,
  properties,
  favorites,
  onToggleFavorite,
  onSelectProperty,
  onProfileSaved,
  onOpenReservation,
  focusReservationId,
  verifyingReservationId,
  onPaymentConfirmed,
}: {
  account: CustomerAccount | null;
  profile: CustomerProfile | null;
  profileLoaded: boolean;
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
  if (!account) return <AccountAccess reason={reason} onProfileSaved={onProfileSaved} />;
  if (!account.emailVerified) return <VerifyEmail account={account} />;
  if (!profileLoaded) {
    return <p className="mx-auto max-w-xl px-5 py-16 text-center text-sm text-[#5d7a83]">Cargando tu cuenta…</p>;
  }
  // Quien entra con Google (o una cuenta antigua) debe registrar su RUT antes
  // de reservar.
  if (!profile?.documentId) {
    return (
      <section className="mx-auto max-w-md px-5 py-12">
        <p className="text-xs font-bold uppercase tracking-[.16em] text-[#07888d]">COMPLETA TU REGISTRO</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Un último paso</h1>
        <p className="mt-2 text-sm leading-6 text-[#5d7a83]">
          Para reservar necesitamos tu nombre, RUT y teléfono. Se usan en tus comprobantes y en el acceso al alojamiento.
        </p>
        {reason && <p className="mt-4 rounded-xl bg-[#e8f6f3] px-3 py-2 text-sm font-semibold text-[#3f6870]">{reason}</p>}
        <div className="mt-6">
          <ProfileForm profile={profile} rutLocked={false} onSaved={onProfileSaved} submitLabel="Completar registro" />
        </div>
        <button type="button" onClick={logoutAccount} className="mt-4 w-full text-sm font-semibold text-[#54727b]">
          Usar otra cuenta
        </button>
      </section>
    );
  }
  return (
    <AccountDashboard
      account={account}
      profile={profile}
      reason={reason}
      properties={properties}
      favorites={favorites}
      onToggleFavorite={onToggleFavorite}
      onSelectProperty={onSelectProperty}
      onProfileSaved={onProfileSaved}
      onOpenReservation={onOpenReservation}
      focusReservationId={focusReservationId}
      verifyingReservationId={verifyingReservationId}
      onPaymentConfirmed={onPaymentConfirmed}
    />
  );
}

function AccountAccess({ reason, onProfileSaved }: {
  reason?: string;
  onProfileSaved: (profile: CustomerProfile) => void;
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  async function submit(event: { preventDefault: () => void }) {
    event.preventDefault();
    setError('');
    setInfo('');
    if (mode === 'register' && !isValidRut(documentId)) {
      setError('Ingresa un RUT chileno válido.');
      return;
    }
    if (mode === 'register' && password !== confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'register') {
        const profile = { name: name.trim(), documentId: formatRut(documentId), phone: phone.trim() };
        await registerAccount(email, password, () => saveCustomerProfile(profile));
        onProfileSaved(profile);
      } else {
        await loginAccount(email, password);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No fue posible continuar.');
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    setError('');
    setInfo('');
    if (!email.trim()) {
      setError('Escribe tu correo para enviarte el enlace de recuperación.');
      return;
    }
    try {
      await sendPasswordReset(email);
      setInfo('Si existe una cuenta con ese correo, te enviamos un enlace para crear una nueva contraseña.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No fue posible enviar el enlace.');
    }
  }

  return (
    <section className="mx-auto grid max-w-5xl gap-8 px-5 py-12 lg:grid-cols-2 lg:px-8">
      <div>
        <p className="text-xs font-bold uppercase tracking-[.16em] text-[#07888d]">CUENTA RESTBLU</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          {mode === 'login' ? 'Inicia sesión para reservar' : 'Crea tu cuenta'}
        </h1>
        <p className="mt-3 leading-7 text-[#5d7a83]">
          Con tu cuenta reservas sin volver a escribir tus datos, ves todas tus reservas desde cualquier
          dispositivo y tienes siempre a mano tu QR de acceso.
        </p>
        <ul className="mt-6 grid gap-3 text-sm text-[#3f6870]">
          <li className="flex gap-2"><MailCheck className="size-5 shrink-0 text-[#07888d]" /> Verificas tu correo con un código al registrarte.</li>
          <li className="flex gap-2"><CalendarDays className="size-5 shrink-0 text-[#07888d]" /> Tus reservas quedan en “Mis reservas”.</li>
          <li className="flex gap-2"><ShieldCheck className="size-5 shrink-0 text-[#07888d]" /> El QR de acceso queda ligado a tu cuenta.</li>
        </ul>
      </div>
      <form onSubmit={submit} className="rounded-3xl border border-[#d8e8e5] bg-white p-6 shadow-sm">
        {reason && <p className="mb-4 rounded-xl bg-[#e8f6f3] px-3 py-2 text-sm font-semibold text-[#3f6870]">{reason}</p>}
        <div className="mb-5 grid grid-cols-2 rounded-xl bg-[#eef5f4] p-1 text-sm font-bold">
          {(['login', 'register'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => { setMode(item); setError(''); setInfo(''); }}
              className={`rounded-lg px-3 py-2 ${mode === item ? 'bg-white text-[#103d50] shadow-sm' : 'text-[#5d7a83]'}`}
            >
              {item === 'login' ? 'Ingresar' : 'Crear cuenta'}
            </button>
          ))}
        </div>
        <GoogleSignInButton onError={setError} />
        <p className="my-4 flex items-center gap-3 text-xs font-semibold text-[#8aa0a7] before:h-px before:flex-1 before:bg-[#e0ecea] after:h-px after:flex-1 after:bg-[#e0ecea]">
          o con tu correo
        </p>
        {mode === 'register' && (
          <>
            <label className="block text-sm font-bold text-[#274b56]">
              Nombre completo
              <span className="relative block">
                <UserRound className="absolute left-3 top-4 size-4 text-[#0b8e92]" />
                <input required minLength={2} maxLength={120} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} className={`${inputClass} pl-10`} />
              </span>
            </label>
            <label className="mt-4 block text-sm font-bold text-[#274b56]">
              RUT chileno
              <input required maxLength={12} value={documentId} onChange={(event) => setDocumentId(formatRut(event.target.value))} placeholder="Ej.: 12.345.678-9" className={`${inputClass} ${documentId && !isValidRut(documentId) ? 'border-red-400' : ''}`} />
            </label>
            <label className="mt-4 block text-sm font-bold text-[#274b56]">
              Teléfono
              <span className="relative block">
                <Phone className="absolute left-3 top-4 size-4 text-[#0b8e92]" />
                <input required type="tel" maxLength={30} autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Ej.: +56 9 1234 5678" className={`${inputClass} pl-10`} />
              </span>
            </label>
          </>
        )}
        <label className={`${mode === 'register' ? 'mt-4 ' : ''}block text-sm font-bold text-[#274b56]`}>
          Correo electrónico
          <span className="relative block">
            <Mail className="absolute left-3 top-4 size-4 text-[#0b8e92]" />
            <input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nombre@correo.cl" className={`${inputClass} pl-10`} />
          </span>
        </label>
        <label className="mt-4 block text-sm font-bold text-[#274b56]">
          Contraseña
          <span className="relative block">
            <KeyRound className="absolute left-3 top-4 size-4 text-[#0b8e92]" />
            <input required type="password" minLength={6} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} className={`${inputClass} pl-10`} />
          </span>
        </label>
        {mode === 'register' && (
          <label className="mt-4 block text-sm font-bold text-[#274b56]">
            Repite la contraseña
            <input required type="password" minLength={6} autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} className={inputClass} />
          </label>
        )}
        {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}
        {info && <output className="block mt-4 rounded-xl bg-[#e8f6f3] px-3 py-2 text-sm font-semibold text-[#3f6870]">{info}</output>}
        <button type="submit" disabled={busy} className="mt-5 w-full rounded-xl bg-[#0b6871] px-5 py-3 text-sm font-bold text-white disabled:opacity-60">
          {busy ? 'Un momento…' : mode === 'login' ? 'Ingresar' : 'Crear cuenta'}
        </button>
        {mode === 'login' && (
          <button type="button" onClick={() => void resetPassword()} className="mt-3 w-full text-sm font-semibold text-[#0b6871]">
            Olvidé mi contraseña
          </button>
        )}
      </form>
    </section>
  );
}

function VerifyEmail({ account }: { account: CustomerAccount }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function verify(event: { preventDefault: () => void }) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const refreshed = await verifyAccountCode(code);
      if (!refreshed?.emailVerified) setError('No pudimos confirmar la verificación. Inténtalo nuevamente.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No fue posible verificar el código.');
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await requestVerificationCode();
      setMessage(result.verified ? 'Tu correo ya estaba verificado.' : 'Te enviamos un código nuevo. Revisa también Spam o Promociones.');
      if (result.verified) await refreshAccount();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No fue posible enviar el código.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-md px-5 py-14 text-center">
      <MailCheck className="mx-auto size-14 text-[#07888d]" />
      <h1 className="mt-4 text-3xl font-bold tracking-tight">Verifica tu correo</h1>
      <p className="mt-3 leading-7 text-[#5d7a83]">
        Enviamos un código de 6 dígitos a <strong>{account.email}</strong>. Escríbelo aquí para activar tu cuenta.
      </p>
      <form onSubmit={verify} className="mt-6">
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="••••••"
          aria-label="Código de verificación"
          className="w-full rounded-2xl border border-[#cfe2df] bg-white px-4 py-4 text-center font-mono text-3xl font-bold tracking-[.6em] outline-none focus:border-[#0b8e92] focus:ring-2 focus:ring-[#b9ebe5]"
        />
        {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}
        {message && <output className="mt-4 block rounded-xl bg-[#e8f6f3] px-3 py-2 text-sm font-semibold text-[#3f6870]">{message}</output>}
        <button type="submit" disabled={busy || code.length !== 6} className="mt-5 w-full rounded-xl bg-[#0b6871] px-5 py-3 text-sm font-bold text-white disabled:opacity-60">
          {busy ? 'Un momento…' : 'Verificar'}
        </button>
      </form>
      <div className="mt-4 flex flex-wrap justify-center gap-3">
        <button type="button" disabled={busy} onClick={() => void resend()} className="rounded-xl px-4 py-2 text-sm font-bold text-[#0b6871] ring-1 ring-[#cfe2df] disabled:opacity-60">
          Enviar otro código
        </button>
        <button type="button" onClick={logoutAccount} className="rounded-xl px-4 py-2 text-sm font-bold text-[#54727b]">
          Usar otra cuenta
        </button>
      </div>
    </section>
  );
}

export function ProfileForm({ profile, rutLocked, onSaved, submitLabel = 'Guardar datos', full = false }: {
  profile: CustomerProfile | null;
  rutLocked: boolean;
  onSaved: (profile: CustomerProfile) => void;
  submitLabel?: string;
  full?: boolean;
}) {
  const [name, setName] = useState(profile?.name || '');
  const [documentId, setDocumentId] = useState(profile?.documentId || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [birthDate, setBirthDate] = useState(profile?.birthDate || '');
  const [nationality, setNationality] = useState(profile?.nationality || 'Chile');
  const [emergencyContactName, setEmergencyContactName] = useState(profile?.emergencyContactName || '');
  const [emergencyContactPhone, setEmergencyContactPhone] = useState(profile?.emergencyContactPhone || '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const rutValid = isValidRut(documentId);

  async function submit(event: { preventDefault: () => void }) {
    event.preventDefault();
    setMessage('');
    if (!rutValid) {
      setMessage('Ingresa un RUT chileno válido.');
      return;
    }
    setBusy(true);
    try {
      const next: CustomerProfile = {
        ...profile,
        name: name.trim(),
        documentId: formatRut(documentId),
        phone: phone.trim(),
        birthDate,
        nationality: nationality.trim(),
        emergencyContactName: emergencyContactName.trim(),
        emergencyContactPhone: emergencyContactPhone.trim(),
      };
      await saveCustomerProfile(next, profile?.documentId || "");
      onSaved(next);
      setMessage('Perfil guardado.');
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : 'No fue posible guardar el perfil.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={`h-fit rounded-3xl border border-[#d8e8e5] bg-white p-6 shadow-sm ${full ? 'sm:grid sm:grid-cols-2 sm:gap-x-5' : ''}`}>
      <div className="sm:col-span-2">
        <p className="text-xs font-bold uppercase tracking-[.16em] text-[#07888d]">MIS DATOS</p>
        <p className="mt-1 text-sm text-[#5d7a83]">Se usan en todas tus reservas: si corriges tu nombre o teléfono, se actualizan también en ellas.</p>
      </div>
      <label className="mt-4 block text-sm font-bold text-[#274b56]">
        Nombre completo
        <span className="relative block">
          <UserRound className="absolute left-3 top-4 size-4 text-[#0b8e92]" />
          <input required minLength={2} maxLength={120} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} className={`${inputClass} pl-10`} />
        </span>
      </label>
      <label className="mt-4 block text-sm font-bold text-[#274b56]">
        RUT chileno
        <input required maxLength={12} readOnly={rutLocked && Boolean(profile?.documentId)} value={documentId} onChange={(event) => setDocumentId(formatRut(event.target.value))} placeholder="Ej.: 12.345.678-9" className={`${inputClass} ${documentId && !rutValid ? 'border-red-400' : ''} ${rutLocked && profile?.documentId ? 'cursor-not-allowed bg-[#f1f6f5] text-[#5d7a83]' : ''}`} />
        {rutLocked && profile?.documentId && (
          <span className="mt-1 block text-xs font-medium text-[#718b93]">Tienes reservas confirmadas: para corregir el RUT, escríbenos.</span>
        )}
      </label>
      <label className="mt-4 block text-sm font-bold text-[#274b56]">
        Teléfono
        <span className="relative block">
          <Phone className="absolute left-3 top-4 size-4 text-[#0b8e92]" />
          <input required type="tel" maxLength={30} autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Ej.: +56 9 1234 5678" className={`${inputClass} pl-10`} />
        </span>
      </label>
      {full && (
        <>
          <label className="mt-4 block text-sm font-bold text-[#274b56]">
            Fecha de nacimiento
            <input type="date" value={birthDate} max={new Date().toISOString().slice(0, 10)} onChange={(event) => setBirthDate(event.target.value)} className={inputClass} />
          </label>
          <label className="mt-4 block text-sm font-bold text-[#274b56]">
            Nacionalidad
            <input maxLength={60} value={nationality} onChange={(event) => setNationality(event.target.value)} className={inputClass} />
          </label>
          <p className="mt-6 text-xs font-bold uppercase tracking-[.16em] text-[#07888d] sm:col-span-2">CONTACTO DE EMERGENCIA</p>
          <label className="mt-2 block text-sm font-bold text-[#274b56]">
            Nombre
            <input maxLength={120} value={emergencyContactName} onChange={(event) => setEmergencyContactName(event.target.value)} className={inputClass} />
          </label>
          <label className="mt-2 block text-sm font-bold text-[#274b56]">
            Teléfono
            <input type="tel" maxLength={30} value={emergencyContactPhone} onChange={(event) => setEmergencyContactPhone(event.target.value)} className={inputClass} />
          </label>
        </>
      )}
      {message && <output className="block mt-4 text-sm font-semibold text-[#3f6870] sm:col-span-2">{message}</output>}
      <button type="submit" disabled={busy} className="mt-5 w-full rounded-xl bg-[#0b6871] px-5 py-3 text-sm font-bold text-white disabled:opacity-60 sm:col-span-2">
        {busy ? 'Guardando…' : submitLabel}
      </button>
    </form>
  );
}
