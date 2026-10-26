'use client';

/* oxlint-disable next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowRight,
  Bath,
  BedDouble,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Download,
  FileText,
  Heart,
  Mail,
  MapPin,
  Maximize2,
  MessageSquareMore,
  Menu,
  Phone,
  QrCode,
  Search,
  ScanFace,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import type {
  CustomerAccount,
  CustomerProfile,
  Property,
  Reservation,
  ReservationProcessingStatus,
  ReservationVerificationNotice,
  Screen,
  SearchCriteria,
} from './domain/types';
import {
  initialSearch,
  LOCAL_DATA_API,
  PAYMENTS_API,
} from './config';
import {
  formatCurrency,
  formatDate,
  formatRut,
  getNightCount,
  hasDateConflict,
  hasInvalidAvailabilityRanges,
  isValidRut,
  makeAccessPin,
  makeReservationCode,
  normalizeText,
  priceToNumber,
  reservationQrUrl,
  todayForInput,
} from './domain/reservation';
import {
  createCloudReservation,
  getCloudReservationStatus,
  loadCloudProperties,
  submitReservationVerification,
  usesLocalManager,
} from './services/firebase';
import PublicAiAssistant, { type AssistantStay } from './components/PublicAiAssistant';
import BiometricEnrollment from './components/BiometricEnrollment';
import PropertyAvailabilityCalendar from './components/PropertyAvailabilityCalendar';
import ReservationLookup from './components/ReservationLookup';
import AccountScreen from './components/AccountScreen';
import OwnerPortal from './components/OwnerPortal';
import StayLanding from './components/StayLanding';
import { Destinations, SupportCenter } from './components/ExploreSections';
import { confirmWebpayPayment, startWebpayPayment } from './services/payments';
import { isRecoverableWebpayReturn, recoverWebpayReturn, type WebpayReturn } from './services/webpay-return';
import { ACCOUNT_CHANGED_EVENT, accountSession, currentAccount } from './services/account';
import {
  loadCustomerProfile, loadCustomerReservations, saveCustomerProfile, saveFavorites, type CustomerReservation,
} from './services/customer';

const initialProperties: Property[] = [
  {
    id: 1,
    name: 'Brisa del Pacífico',
    place: 'Algarrobo, Chile',
    type: 'Vista al mar',
    guests: 5,
    beds: 2,
    baths: 2,
    price: '$148.000',
    rating: '4.9',
    image:
      'https://images.unsplash.com/photo-1601918774946-25832a4be0d6?auto=format&fit=crop&w=1100&q=85',
    gallery: [
      {
        src: 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=900&q=85',
        alt: 'Sala luminosa de Brisa del Pacífico',
      },
      {
        src: 'https://images.unsplash.com/photo-1600573472550-8090b5e0745e?auto=format&fit=crop&w=900&q=85',
        alt: 'Terraza costera de Brisa del Pacífico',
      },
    ],
    tags: ['Mar', 'Familia'],
  },
  {
    id: 2,
    name: 'Casa Duna',
    place: 'Zapallar, Chile',
    type: 'Casa completa',
    guests: 8,
    beds: 4,
    baths: 3,
    price: '$265.000',
    rating: '4.8',
    image:
      'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1100&q=85',
    gallery: [
      {
        src: 'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=900&q=85',
        alt: 'Fachada contemporánea de Casa Duna',
      },
      {
        src: 'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=900&q=85',
        alt: 'Living y comedor de Casa Duna',
      },
    ],
    tags: ['Piscina', 'Mascotas'],
  },
  {
    id: 3,
    name: 'Mirador Laguna',
    place: 'Pucón, Chile',
    type: 'Departamento',
    guests: 4,
    beds: 2,
    baths: 2,
    price: '$112.000',
    rating: '4.9',
    image:
      'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=1100&q=85',
    gallery: [
      {
        src: 'https://images.unsplash.com/photo-1600607688969-a5bfcd646154?auto=format&fit=crop&w=900&q=85',
        alt: 'Exterior rodeado de árboles de Mirador Laguna',
      },
      {
        src: 'https://images.unsplash.com/photo-1600585152915-d208bec867a1?auto=format&fit=crop&w=900&q=85',
        alt: 'Living principal de Mirador Laguna',
      },
    ],
    tags: ['Naturaleza', 'Remoto'],
  },
  {
    id: 4,
    name: 'Refugio Nativo',
    place: 'Puerto Varas, Chile',
    type: 'Cabaña privada',
    guests: 6,
    beds: 3,
    baths: 2,
    price: '$172.000',
    rating: '4.7',
    image:
      'https://images.unsplash.com/photo-1520984032042-162d526883e0?auto=format&fit=crop&w=1100&q=85',
    gallery: [
      {
        src: 'https://images.unsplash.com/photo-1449844908441-8829872d2607?auto=format&fit=crop&w=900&q=85',
        alt: 'Cabaña de madera de Refugio Nativo entre árboles',
      },
      {
        src: 'https://images.unsplash.com/photo-1510798831971-661eb04b3739?auto=format&fit=crop&w=900&q=85',
        alt: 'Refugio Nativo junto al lago en invierno',
      },
    ],
    tags: ['Naturaleza', 'Jacuzzi'],
  },
  {
    id: 5,
    name: 'Luz de Viña',
    place: 'Viña del Mar, Chile',
    type: 'Loft urbano',
    guests: 2,
    beds: 1,
    baths: 1,
    price: '$94.000',
    rating: '4.8',
    image:
      'https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?auto=format&fit=crop&w=1100&q=85',
    gallery: [
      {
        src: 'https://images.unsplash.com/photo-1600210491892-03d54c0aaf87?auto=format&fit=crop&w=900&q=85',
        alt: 'Sala de estar del loft Luz de Viña',
      },
      {
        src: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=900&q=85',
        alt: 'Dormitorio del loft Luz de Viña',
      },
    ],
    tags: ['Ciudad', 'Parejas'],
  },
  {
    id: 6,
    name: 'Terraza Azul',
    place: 'La Serena, Chile',
    type: 'Vista al mar',
    guests: 4,
    beds: 2,
    baths: 2,
    price: '$118.000',
    rating: '4.9',
    image:
      'https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=1100&q=85',
    gallery: [
      {
        src: 'https://images.unsplash.com/photo-1600566753051-f0b89df2dd90?auto=format&fit=crop&w=900&q=85',
        alt: 'Dormitorio luminoso de Terraza Azul',
      },
      {
        src: 'https://images.unsplash.com/photo-1600573472592-401b489a3cdc?auto=format&fit=crop&w=900&q=85',
        alt: 'Terraza y piscina de Terraza Azul',
      },
    ],
    tags: ['Mar', 'Piscina'],
  },
];

type CreateReservationResponse = ReservationProcessingStatus & {
  verification?: ReservationProcessingStatus;
  reservationStatus?: ReservationProcessingStatus;
};

function statusText(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

function statusErrorMessage(status: ReservationProcessingStatus) {
  if (status.status === 'expirada') {
    return 'El plazo para verificar y pagar esta reserva venció. Las fechas ya están disponibles nuevamente.';
  }
  const message = statusText(status.error) || statusText(status.syncError);
  if (message) return message;
  return status.status === 'error' || status.syncStatus === 'error'
    ? 'No fue posible sincronizar esta reserva con el gestor.'
    : '';
}

function reservationStatusFromResponse(response: CreateReservationResponse) {
  return response.verification || response.reservationStatus || response;
}

function restoreReservationFromStatus(
  status: ReservationProcessingStatus,
  attempt: { id: string; cloud: boolean },
  properties: Property[],
): Reservation | null {
  const booking = status.booking;
  if (!booking || booking.id !== attempt.id ||
      !Number.isInteger(booking.propertyId) || !booking.propertyName ||
      !booking.checkIn || !booking.checkOut || !booking.email ||
      !Number.isFinite(booking.total)) return null;
  const catalogProperty = properties.find((item) => item.id === booking.propertyId);
  const property: Property = {
    ...(catalogProperty || initialProperties[0]),
    id: booking.propertyId,
    name: booking.propertyName,
    place: booking.propertyPlace,
    price: formatCurrency(booking.nightlyPrice),
  };
  return {
    id: booking.id,
    property,
    guestName: booking.guestName,
    email: booking.email,
    phone: booking.phone,
    documentId: booking.documentId,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    guests: booking.guests,
    nights: booking.nights,
    nightlyPrice: booking.nightlyPrice,
    total: booking.total,
    paymentStatus: status.paymentStatus || 'pendiente-demo',
    accessPin: status.verified && status.paymentStatus === 'aprobado-demo' ? booking.accessPin || '' : '',
    dahuaUserId: status.verified ? status.dahuaUserId : '',
    accessQr: status.accessQr,
    accessQrImage: status.accessQrImage,
    accessQrExpiresAt: status.accessQrExpiresAt,
    dahuaQrStatus: status.dahuaQrStatus,
    createdAt: new Intl.DateTimeFormat('es-CL', { dateStyle: 'long', timeStyle: 'short' })
      .format(new Date(booking.createdAt)),
    verificationStatus: status.verified && status.paymentStatus === 'aprobado-demo' ? 'verified' : 'pending',
    emailVerified: status.emailVerified ?? Boolean(status.verificationEmailSentAt && status.confirmationEmailSentAt),
    pdfUrl: status.pdfUrl || undefined,
    pdfBase64: status.pdfBase64,
    pdfFileName: status.pdfFileName,
    cloud: attempt.cloud,
    synced: true,
    verificationEmailSentAt: status.verificationEmailSentAt || undefined,
    verificationEmailError: status.verificationEmailError || undefined,
    emailPending: status.emailPending,
    confirmationEmailSentAt: status.confirmationEmailSentAt || undefined,
    confirmationEmailError: status.confirmationEmailError || undefined,
  };
}

const WEBPAY_VERIFICATION_KEY = 'restblu:webpay-verifying-reservation';
const WEBPAY_RETURN_KEY = 'restblu:webpay-approved-return';

export default function RestBluApp({ initialScreen = 'inicio' }: { initialScreen?: Screen }) {
  const reduceMotion = useReducedMotion();
  const paymentAttemptStorageKey = 'restblu:last-demo-payment-attempt-v2';
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [filter, setFilter] = useState('Todos');
  const [selected, setSelected] = useState<Property | null>(null);
  const [saved, setSaved] = useState<number[]>([]);
  const [properties, setProperties] =
    useState<Property[]>(initialProperties);
  const [search, setSearch] = useState<SearchCriteria>(initialSearch);
  const [appliedSearch, setAppliedSearch] =
    useState<SearchCriteria>(initialSearch);
  const [bookingProperty, setBookingProperty] = useState<Property | null>(null);
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [paymentReservation, setPaymentReservation] = useState<Reservation | null>(null);
  const [pendingReservation, setPendingReservation] = useState<Reservation | null>(null);
  const [toast, setToast] = useState('');
  const [verificationNotice, setVerificationNotice] =
    useState<ReservationVerificationNotice | null>(null);
  const [lastPaymentAttempt, setLastPaymentAttempt] = useState<{
    id: string; propertyName: string; total: number; cloud: boolean;
  } | null>(null);
  const [lastPaymentResult, setLastPaymentResult] = useState('');
  const [returnReservationId, setReturnReservationId] = useState('');
  const [paymentVerificationId, setPaymentVerificationId] = useState('');
  const handleAccountPaymentConfirmed = useCallback(() => {
    localStorage.removeItem(WEBPAY_VERIFICATION_KEY);
    sessionStorage.removeItem(WEBPAY_RETURN_KEY);
    setPaymentVerificationId('');
    setLastPaymentResult('Pago confirmado en Webpay. Tu reserva ya está en Mi cuenta.');
  }, []);
  // Cuenta del cliente: reservar exige una cuenta con el correo verificado.
  const [account, setAccount] = useState<CustomerAccount | null>(null);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [accountReason, setAccountReason] = useState('');
  const [propertyAwaitingAccount, setPropertyAwaitingAccount] = useState<Property | null>(null);
  useEffect(() => {
    const sync = () => setAccount(currentAccount());
    sync();
    window.addEventListener(ACCOUNT_CHANGED_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(ACCOUNT_CHANGED_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  useEffect(() => {
    if (!account?.emailVerified) {
      setProfile(null);
      setProfileLoaded(false);
      return;
    }
    let active = true;
    setProfileLoaded(false);
    void loadCustomerProfile()
      .then((loaded) => {
        if (!active) return;
        setProfile(loaded);
        if (loaded?.favorites) setSaved(loaded.favorites);
      })
      .catch(() => {})
      .finally(() => { if (active) setProfileLoaded(true); });
    return () => { active = false; };
  }, [account?.uid, account?.emailVerified]);
  // Si el cliente venía de pulsar «Reservar», se retoma esa reserva cuando ya
  // tiene la cuenta verificada y el RUT registrado.
  useEffect(() => {
    if (!propertyAwaitingAccount || !account?.emailVerified || !profile?.documentId) return;
    setBookingProperty(propertyAwaitingAccount);
    setPropertyAwaitingAccount(null);
    setAccountReason('');
  }, [propertyAwaitingAccount, account?.emailVerified, profile?.documentId]);
  // El QR del PDF abre ?pase=<reserva>: se muestra el pase con el QR de acceso
  // vigente, pidiendo antes iniciar sesión con la cuenta dueña de la reserva.
  const [passToOpen, setPassToOpen] = useState('');
  useEffect(() => {
    const url = new URL(window.location.href);
    const pass = url.searchParams.get('pase') || '';
    if (!/^(LS|RB)-[A-Z0-9-]{10,50}$/.test(pass)) return;
    url.searchParams.delete('pase');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    setPassToOpen(pass);
  }, []);
  useEffect(() => {
    if (!passToOpen) return;
    if (!account?.emailVerified) {
      setAccountReason('Inicia sesión con la cuenta de la reserva para ver tu QR de acceso.');
      setScreen('cuenta');
      return;
    }
    const id = passToOpen;
    setPassToOpen('');
    void loadCustomerReservations()
      .then((items) => {
        const item = items.find((entry) => entry.booking.id === id);
        if (item) {
          setAccountReason('');
          return openCustomerReservation(item);
        }
        notice('Esa reserva no pertenece a la cuenta con la que iniciaste sesión.');
      })
      .catch((error) => notice(error instanceof Error ? error.message : 'No fue posible abrir el pase.'));
  }, [passToOpen, account?.uid, account?.emailVerified]);
  // Vuelta desde Webpay (?pago=<reserva>&estado=...&token=...): se entrega el
  // token al gestor para que verifique el pago y luego se abre el pase.
  const [webpayReturn, setWebpayReturn] = useState<WebpayReturn | null>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    const id = url.searchParams.get('pago') || '';
    const estado = url.searchParams.get('estado') || '';
    const token = url.searchParams.get('token') || '';
    if (!id && !estado) {
      try {
        const pending: unknown = JSON.parse(sessionStorage.getItem(WEBPAY_RETURN_KEY) || 'null');
        if (isRecoverableWebpayReturn(pending)) {
          setScreen('cuenta');
          setReturnReservationId(pending.id);
          setWebpayReturn(pending);
          return;
        }
      } catch {
        sessionStorage.removeItem(WEBPAY_RETURN_KEY);
      }
      const saved = localStorage.getItem(WEBPAY_VERIFICATION_KEY) || '';
      if (/^(LS|RB)-[A-Z0-9-]{10,50}$/.test(saved)) {
        setPaymentVerificationId(saved);
        setReturnReservationId(saved);
        setScreen('cuenta');
      }
      return;
    }
    for (const key of ['pago', 'estado', 'token']) url.searchParams.delete(key);
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    setScreen('cuenta');
    setReturnReservationId(id);
    if (isRecoverableWebpayReturn({ id, estado, token })) {
      sessionStorage.setItem(WEBPAY_RETURN_KEY, JSON.stringify({ id, estado, token }));
    }
    setWebpayReturn({ id, estado, token });
  }, []);
  useEffect(() => {
    if (!webpayReturn || !account?.emailVerified) return;
    const { id, estado } = webpayReturn;
    setWebpayReturn(null);
    let cloud = !usesLocalManager();
    try {
      const pending = JSON.parse(sessionStorage.getItem('restblu:webpay-pending') || 'null') as { id?: string; cloud?: boolean } | null;
      if (pending?.id === id) cloud = Boolean(pending.cloud);
      sessionStorage.removeItem('restblu:webpay-pending');
    } catch {
      // Sin datos guardados se usa el modo del sitio.
    }
    if (!isRecoverableWebpayReturn(webpayReturn)) {
      sessionStorage.removeItem(WEBPAY_RETURN_KEY);
      notice(estado === 'anulado'
        ? 'Cancelaste el pago en Webpay. Tu reserva sigue pendiente.'
        : estado === 'expirado'
          ? 'El tiempo para pagar en Webpay se agotó. Puedes intentarlo de nuevo.'
          : estado === 'rechazado'
            ? 'Webpay rechazó el pago. Puedes intentarlo con otra tarjeta.'
            : 'No fue posible identificar el resultado del pago. Consulta Mi cuenta antes de volver a pagar.');
      return;
    }
    localStorage.setItem(WEBPAY_VERIFICATION_KEY, id);
    setPaymentVerificationId(id);
    notice(estado === 'pendiente'
      ? 'Estamos verificando el resultado del pago con Webpay. No vuelvas a pagar; consulta Mi cuenta.'
      : 'Pago aprobado en Webpay. Verás la reserva en Mi cuenta mientras se confirma; no vuelvas a pagar.');
    void recoverWebpayReturn(webpayReturn, PAYMENTS_API, (reservationId, webpayToken) => confirmWebpayPayment(reservationId, webpayToken, cloud))
      .then((result) => {
        if (result === 'pending') {
          notice('Webpay todavía no confirma el resultado. Conservamos tu intento; recarga esta página para reconsultarlo. No vuelvas a pagar.');
          return;
        }
        sessionStorage.removeItem(WEBPAY_RETURN_KEY);
        if (result === 'rejected') {
          if (localStorage.getItem(WEBPAY_VERIFICATION_KEY) === id) localStorage.removeItem(WEBPAY_VERIFICATION_KEY);
          setPaymentVerificationId((current) => current === id ? '' : current);
          notice('Webpay rechazó el pago. Puedes intentarlo con otra tarjeta.');
        }
      })
      .catch((error) => {
        notice(`${error instanceof Error ? error.message : 'La confirmación sigue pendiente.'} Consulta Mi cuenta y no vuelvas a pagar.`);
      });
  }, [webpayReturn, account?.uid, account?.emailVerified]);
  async function openCustomerReservation(item: CustomerReservation) {
    try {
      const cloud = !usesLocalManager();
      const status = cloud ? await getCloudReservationStatus(item.booking.id) : item;
      const restored = status && restoreReservationFromStatus(status, { id: item.booking.id, cloud }, properties);
      if (!restored) {
        notice('Esta reserva todavía se está sincronizando con el gestor. Inténtalo en unos momentos.');
        return;
      }
      if (restored.verificationStatus === 'verified') {
        setReservation(restored);
      } else {
        setPendingReservation(restored);
        setPaymentReservation(restored);
      }
    } catch (error) {
      notice(error instanceof Error ? error.message : 'No fue posible abrir la reserva.');
    }
  }
  useEffect(() => {
    try {
      localStorage.removeItem('restblu:last-demo-payment-attempt');
      const saved = JSON.parse(localStorage.getItem(paymentAttemptStorageKey) || 'null');
      if (typeof saved?.id === 'string' && /^(LS|RB)-[A-Z0-9-]{10,50}$/.test(saved.id)) {
        setLastPaymentAttempt(saved);
      }
    } catch {
      localStorage.removeItem(paymentAttemptStorageKey);
    }
  }, []);
  async function checkLastPaymentAttempt(openReservation = false) {
    if (!lastPaymentAttempt) return;
    try {
      let status: ReservationProcessingStatus | null;
      if (lastPaymentAttempt.cloud) {
        status = await getCloudReservationStatus(lastPaymentAttempt.id);
      } else {
        const response = await fetch(
          `${LOCAL_DATA_API}/reservations/${encodeURIComponent(lastPaymentAttempt.id)}/verification`,
          { cache: 'no-store' },
        );
        if (response.status === 404) {
          localStorage.removeItem(paymentAttemptStorageKey);
          setLastPaymentAttempt(null);
          setLastPaymentResult('');
          notice('La reserva anterior no llegó al gestor. Puedes intentarlo nuevamente.');
          return;
        }
        status = response.ok ? await response.json() as ReservationProcessingStatus : null;
      }
      const problem = statusErrorMessage(status || {});
      setLastPaymentResult(status?.verified && status.paymentStatus === 'aprobado-demo'
        ? 'Pago confirmado en Webpay. Puedes abrir tu comprobante y tu QR de acceso.'
        : problem
          ? problem
          : status?.emailVerified
            ? 'Correo verificado. Continúa al pago con Webpay.'
            : status
              ? 'Reserva recibida. Verifica el correo para continuar al pago.'
              : 'Todavía no hay estado para este código. Si eliminaste las reservas, pulsa Ocultar para comenzar de nuevo; si acabas de reservar, espera unos minutos.');
      if (!openReservation || !status || problem) return;
      const restored = pendingReservation?.id === lastPaymentAttempt.id
        ? pendingReservation
        : restoreReservationFromStatus(status, lastPaymentAttempt, properties);
      if (!restored) {
        setLastPaymentResult('La reserva está en el gestor, pero aún no se puede recuperar en esta sesión. Actualiza e inténtalo otra vez.');
        return;
      }
      if (status.verified && status.paymentStatus === 'aprobado-demo') {
        setReservation({ ...restored, verificationStatus: 'verified',
          paymentStatus: status.paymentStatus, accessPin: status.booking?.accessPin || restored.accessPin,
          dahuaUserId: status.dahuaUserId || restored.dahuaUserId,
          accessQrImage: status.accessQrImage, accessQrExpiresAt: status.accessQrExpiresAt,
          dahuaQrStatus: status.dahuaQrStatus,
          pdfBase64: status.pdfBase64, pdfFileName: status.pdfFileName });
      } else {
        setPendingReservation(restored);
        setPaymentReservation(restored);
      }
    } catch (error) {
      setLastPaymentResult(error instanceof Error
        ? `No fue posible consultar esta reserva: ${error.message}`
        : 'No fue posible consultar el estado. Reinténtalo cuando vuelva la conexión; no se cobra dinero real.');
    }
  }
  useEffect(() => {
    if (lastPaymentAttempt) void checkLastPaymentAttempt();
  }, [lastPaymentAttempt?.id]);
  useEffect(() => {
    if (verificationNotice?.status !== 'success' ||
        verificationNotice.reservationId !== lastPaymentAttempt?.id) return;
    setVerificationNotice(null);
    void checkLastPaymentAttempt(true);
  }, [verificationNotice?.status, verificationNotice?.reservationId, lastPaymentAttempt?.id]);
  useEffect(() => {
    const currentUrl = new URL(window.location.href);
    const reservationId = currentUrl.searchParams.get('verifyReservation') || '';
    const token = currentUrl.searchParams.get('token') || '';
    if (!reservationId || !token) return;
    setVerificationNotice({
      reservationId,
      status: 'working',
      message: 'Estamos validando el enlace único de esta reserva.',
    });
    void submitReservationVerification(reservationId, token)
      .then(() => {
        currentUrl.searchParams.delete('verifyReservation');
        currentUrl.searchParams.delete('token');
        window.history.replaceState(
          {},
          '',
          `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`,
        );
        setVerificationNotice({
          reservationId,
          status: 'success',
          message: 'Correo verificado. Ya puedes pagar con Webpay; el PDF y el QR aparecerán cuando se apruebe.',
        });
      })
      .catch((error) => {
        setVerificationNotice({
          reservationId,
          status: 'error',
          message: error instanceof Error
            ? error.message
            : 'No fue posible verificar esta reserva.',
          localFallbackUrl: usesLocalManager()
            ? undefined
            : `http://127.0.0.1:3100/api/reservations/${encodeURIComponent(reservationId)}/verify?token=${encodeURIComponent(token)}`,
        });
      });
  }, []);
  useEffect(() => {
    let mounted = true;
    let lastCloudRefreshAt = 0;
    async function loadProperties() {
      const localManager = usesLocalManager();
      if (!localManager) {
        const now = Date.now();
        if (now - lastCloudRefreshAt < 120_000) return;
        lastCloudRefreshAt = now;
      }
      try {
        if (localManager) {
          const response = await fetch(`${LOCAL_DATA_API}/properties`, {
            cache: 'no-store',
          });
          if (!response.ok) return;
          const data = (await response.json()) as { properties?: Property[] };
          if (mounted && Array.isArray(data.properties)) {
            setProperties(data.properties);
          }
          return;
        }
        const cloudProperties = await loadCloudProperties();
        if (mounted && cloudProperties.length) {
          setProperties(cloudProperties);
        }
      } catch {
        // El catálogo integrado queda disponible si la nube está temporalmente fuera de línea.
      }
    }
    void loadProperties();
    const timer = window.setInterval(loadProperties, usesLocalManager() ? 5_000 : 120_000);
    window.addEventListener('focus', loadProperties);
    return () => {
      mounted = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', loadProperties);
    };
  }, []);
  const filtered = useMemo(() => {
    const destination = normalizeText(appliedSearch.destination);
    return properties.filter((property) => {
      const matchesCategory =
        filter === 'Todos' || property.tags.includes(filter);
      const searchable = normalizeText(
        `${property.name} ${property.place} ${property.type} ${property.tags.join(' ')}`,
      );
      const matchesDestination =
        destination.length === 0 || searchable.includes(destination);
      const matchesCapacity = property.guests >= appliedSearch.guests;
      const matchesAvailability = !hasDateConflict(
        appliedSearch.checkIn,
        appliedSearch.checkOut,
        property.unavailableRanges,
      );
      return matchesCategory && matchesDestination && matchesCapacity && matchesAvailability;
    });
  }, [appliedSearch, filter, properties]);
  function notice(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(''), 2800);
  }
  function go(next: Screen) {
    setSelected(null);
    setScreen(next);
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  }
  // Favoritos: con sesión se guardan en el perfil y se ven en todos los dispositivos.
  function toggleSaved(id: number) {
    const next = saved.includes(id) ? saved.filter((item) => item !== id) : [...saved, id];
    setSaved(next);
    if (account?.emailVerified && profile?.documentId) {
      setProfile({ ...profile, favorites: next });
      void saveFavorites(next).catch(() => notice('No fue posible guardar el favorito. Inténtalo nuevamente.'));
    } else if (!account) {
      notice('Inicia sesión para guardar tus favoritos en tu cuenta.');
    }
  }
  function validateDates(criteria: SearchCriteria, requireDates = false) {
    if (requireDates && (!criteria.checkIn || !criteria.checkOut)) {
      notice('Selecciona las fechas de entrada y salida para reservar.');
      return false;
    }
    if (
      (criteria.checkIn && !criteria.checkOut) ||
      (!criteria.checkIn && criteria.checkOut)
    ) {
      notice('Completa ambas fechas para realizar la búsqueda.');
      return false;
    }
    if (
      criteria.checkIn &&
      criteria.checkOut &&
      getNightCount(criteria.checkIn, criteria.checkOut) < 1
    ) {
      notice('La fecha de salida debe ser posterior al check-in.');
      return false;
    }
    return true;
  }
  function runSearch(criteria: SearchCriteria = search) {
    if (!validateDates(criteria)) return;
    setAppliedSearch({ ...criteria });
    setFilter('Todos');
    setSelected(null);
    setScreen('catalogo');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function clearSearch() {
    setSearch(initialSearch);
    setAppliedSearch(initialSearch);
    setFilter('Todos');
  }
  function exploreDestination(destination: string) {
    // Explorar sigue disponible si el formulario conserva fechas incompletas.
    const hasValidStay = search.checkIn && search.checkOut && getNightCount(search.checkIn, search.checkOut) >= 1;
    const next = {
      ...search,
      destination,
      checkIn: hasValidStay ? search.checkIn : '',
      checkOut: hasValidStay ? search.checkOut : '',
    };
    setSearch(next);
    runSearch(next);
  }
  // criteria permite reservar con fechas recién elegidas (p. ej. desde Blu),
  // antes de que el estado search se actualice.
  function startReservation(property: Property, criteria: SearchCriteria = search) {
    if (!validateDates(criteria, true)) return;
    if (hasInvalidAvailabilityRanges(property.unavailableRanges)) {
      notice('No se pudo validar la disponibilidad. Reinicia el gestor y vuelve a intentarlo.');
      return;
    }
    if (hasDateConflict(criteria.checkIn, criteria.checkOut, property.unavailableRanges)) {
      notice('Este alojamiento ya está ocupado durante una parte de las fechas seleccionadas.');
      return;
    }
    if (criteria.guests > property.guests) {
      notice(`Este alojamiento admite hasta ${property.guests} huéspedes.`);
      return;
    }
    if (!account?.emailVerified || (profileLoaded && !profile?.documentId)) {
      setPropertyAwaitingAccount(property);
      setAccountReason(!account
        ? `Inicia sesión o crea tu cuenta para reservar ${property.name}.`
        : !account.emailVerified
          ? `Verifica tu correo para reservar ${property.name}.`
          : `Registra tu RUT para reservar ${property.name}.`);
      go('cuenta');
      return;
    }
    setBookingProperty(property);
  }
  // Acciones de Blu: abrir la ficha, o aplicar las fechas sugeridas y seguir
  // el flujo normal de reserva (validaciones, cuenta y diálogo).
  function openPropertyFromAssistant(property: Property) {
    setSelected(property);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function reserveFromAssistant(property: Property, stay: AssistantStay) {
    const criteria: SearchCriteria = {
      ...search,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      guests: stay.guests > 0 ? stay.guests : search.guests,
    };
    setSearch(criteria);
    openPropertyFromAssistant(property);
    startReservation(property, criteria);
  }
  async function confirmReservation(details: {
    id: string;
    guestName: string;
    email: string;
    phone: string;
    documentId: string;
  }) {
    if (!bookingProperty) return;
    const property = bookingProperty;
    if (hasInvalidAvailabilityRanges(property.unavailableRanges)) {
      notice('No se pudo validar la disponibilidad. Reinicia el gestor y vuelve a intentarlo.');
      setBookingProperty(null);
      return;
    }
    if (hasDateConflict(search.checkIn, search.checkOut, property.unavailableRanges)) {
      notice('Estas fechas acaban de ser ocupadas. Selecciona otros días.');
      setBookingProperty(null);
      return;
    }
    const nights = getNightCount(search.checkIn, search.checkOut);
    // La reserva queda ligada a la cuenta: su uid y su correo verificado.
    const { session: accountToken, account: activeAccount } = await accountSession();
    if (!activeAccount.emailVerified) {
      throw new Error('Verifica el correo de tu cuenta antes de reservar.');
    }
    const nightlyPrice = priceToNumber(property.price);
    const confirmed: Reservation = {
      id: details.id,
      property,
      guestName: details.guestName,
      email: activeAccount.email,
      phone: details.phone,
      documentId: details.documentId,
      checkIn: search.checkIn,
      checkOut: search.checkOut,
      guests: search.guests,
      nights,
      nightlyPrice,
      total: nightlyPrice * nights,
      paymentStatus: 'pendiente-demo',
      accessPin: makeAccessPin(),
      verificationStatus: 'pending',
      createdAt: new Intl.DateTimeFormat('es-CL', {
        dateStyle: 'long',
        timeStyle: 'short',
      }).format(new Date()),
    };
    const payload = {
      id: confirmed.id,
      guestName: confirmed.guestName,
      documentId: confirmed.documentId,
      email: confirmed.email,
      phone: confirmed.phone,
      propertyId: confirmed.property.id,
      propertyName: confirmed.property.name,
      propertyPlace: confirmed.property.place,
      checkIn: confirmed.checkIn,
      checkOut: confirmed.checkOut,
      guests: confirmed.guests,
      nights: confirmed.nights,
      nightlyPrice: confirmed.nightlyPrice,
      total: confirmed.total,
      schemaVersion: 3,
      ownerUid: accountToken.uid,
      accessPin: confirmed.accessPin,
    };
    const paymentAttempt = {
      id: confirmed.id,
      propertyName: confirmed.property.name,
      total: confirmed.total,
      cloud: !usesLocalManager(),
    };
    if (usesLocalManager()) {
      let response: Response;
      try {
        response = await fetch(`${LOCAL_DATA_API}/reservations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accountToken.idToken}`,
          },
          body: JSON.stringify(payload),
        });
      } catch {
        throw new Error('No se pudo conectar con el gestor local. Abre RestBlu completo y vuelve a intentarlo; no se inició ningún pago.');
      }
      const data = (await response.json()) as CreateReservationResponse;
      if (!response.ok) {
        throw new Error(data.error || 'No fue posible iniciar la verificación del correo.');
      }
      const status = reservationStatusFromResponse(data);
      confirmed.verificationStatus = status.verified ? 'verified' : 'pending';
      confirmed.emailVerified = status.emailVerified;
      confirmed.paymentStatus = status.paymentStatus || 'pendiente-demo';
      confirmed.pdfUrl = status.pdfUrl || undefined;
      confirmed.synced = true;
      confirmed.verificationEmailSentAt = statusText(status.verificationEmailSentAt) || undefined;
      confirmed.verificationEmailError = statusText(status.verificationEmailError) || undefined;
      confirmed.emailPending = status.emailPending ?? (
        !confirmed.verificationEmailSentAt && !status.verified
      );
      confirmed.confirmationEmailSentAt = statusText(status.confirmationEmailSentAt) || undefined;
      confirmed.confirmationEmailError = statusText(status.confirmationEmailError) || undefined;
      confirmed.statusError = statusErrorMessage(status) || undefined;
    } else {
      await createCloudReservation(payload);
      confirmed.cloud = true;
      confirmed.synced = false;
      confirmed.emailPending = true;
      confirmed.verificationStatus = 'pending';
    }
    try {
      localStorage.setItem(paymentAttemptStorageKey, JSON.stringify(paymentAttempt));
    } catch {
      // La reserva sigue protegida por el identificador y el estado del gestor.
    }
    setLastPaymentAttempt(paymentAttempt);
    setLastPaymentResult('Reserva guardada. Todavía no hay un pago aprobado.');
    const nextProfile = { ...profile, name: details.guestName.trim(), documentId: details.documentId, phone: details.phone.trim() };
    if (!profile || profile.name !== nextProfile.name || profile.documentId !== nextProfile.documentId ||
        profile.phone !== nextProfile.phone) {
      void saveCustomerProfile(nextProfile, profile?.documentId || "").then(() => setProfile(nextProfile)).catch(() => {});
    }
    const verificationEmailSent = Boolean(confirmed.verificationEmailSentAt);
    setBookingProperty(null);
    setPendingReservation(confirmed);
    setPaymentReservation(confirmed);
    notice(
      confirmed.emailVerified
          ? 'Reserva guardada con tu cuenta verificada. Continúa al pago con Webpay.'
          : verificationEmailSent
          ? 'Revisa tu correo para habilitar el pago.'
          : confirmed.cloud
          ? 'Reserva guardada en línea. El gestor la sincronizará en unos segundos.'
          : 'Reserva guardada. El correo de verificación todavía está pendiente.',
    );
  }
  return (
    <MotionConfig reducedMotion="user">
    <main className="restblu-site min-h-screen">
      <Header screen={screen} go={go} account={account} />
      {lastPaymentAttempt && (
        <aside role="status" className="mx-auto mt-4 flex max-w-7xl flex-wrap items-center gap-3 rounded-xl border border-[#b9d9d7] bg-[#effaf7] px-4 py-3 text-sm">
          <span className="flex-1"><strong>Reserva en proceso {lastPaymentAttempt.id}</strong> · {lastPaymentAttempt.propertyName}. {lastPaymentResult || 'Consulta el estado si la página se interrumpió.'}</span>
          {pendingReservation && <button type="button" onClick={() => setPaymentReservation(pendingReservation)} className="font-bold text-[#0b6871]">Ir al pago</button>}
          <button type="button" onClick={() => void checkLastPaymentAttempt(true)} className="font-bold text-[#0b6871]">Consultar estado</button>
          <button type="button" onClick={() => { localStorage.removeItem(paymentAttemptStorageKey); setLastPaymentAttempt(null); setLastPaymentResult(''); }} className="font-bold text-[#54727b]">Ocultar</button>
        </aside>
      )}
      <AnimatePresence initial={false} mode="wait">
      <motion.div key={selected ? `property-${selected.id}` : screen} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
      {selected ? (
        <PropertyDetail
          property={selected}
          saved={saved.includes(selected.id)}
          search={search}
          setSearch={setSearch}
          onBack={() => setSelected(null)}
          onSave={() => toggleSaved(selected.id)}
          onReserve={() => startReservation(selected)}
          onNotice={notice}
        />
      ) : screen === 'inicio' ? (
        <Landing
          go={go}
          properties={properties}
          onSelect={setSelected}
          saved={saved}
          onSave={toggleSaved}
          search={search}
          setSearch={setSearch}
          onSearch={runSearch}
        />
      ) : screen === 'destinos' ? (
        <Destinations properties={properties} onChoose={exploreDestination} />
      ) : screen === 'soporte' ? (
        <SupportCenter onChat={() => setAssistantOpen(true)} onAccount={() => go('cuenta')} onLookup={() => go('consulta')} />
      ) : screen === 'catalogo' ? (
        <Catalog
          filter={filter}
          setFilter={setFilter}
          properties={filtered}
          allProperties={properties}
          onSelect={setSelected}
          saved={saved}
          onSave={toggleSaved}
          criteria={appliedSearch}
          search={search}
          setSearch={setSearch}
          onSearch={runSearch}
          onReset={clearSearch}
        />
      ) : screen === 'experiencias' ? (
        <Experiences onExplore={exploreDestination} />
      ) : screen === 'propietarios' ? (
        <OwnerPortal account={account} onGuestAccount={() => go('cuenta')} />
      ) : screen === 'cuenta' ? (
        <AccountScreen
          account={account}
          profile={profile}
          profileLoaded={profileLoaded}
          reason={accountReason}
          properties={properties}
          favorites={saved}
          onToggleFavorite={toggleSaved}
          onSelectProperty={(property) => { setSelected(property); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
          onProfileSaved={setProfile}
          onOpenReservation={(item) => void openCustomerReservation(item)}
          focusReservationId={returnReservationId}
          verifyingReservationId={paymentVerificationId}
          onPaymentConfirmed={handleAccountPaymentConfirmed}
        />
      ) : (
        <ReservationLookup />
      )}
      </motion.div>
      </AnimatePresence>
      <Footer go={go} />
      {bookingProperty && (
        <BookingDialog
          property={bookingProperty}
          search={search}
          accountEmail={account?.email || ''}
          profile={profile}
          onClose={() => setBookingProperty(null)}
          onConfirm={confirmReservation}
        />
      )}
      {reservation && (
        <ReservationReceipt
          reservation={reservation}
          onClose={() => setReservation(null)}
        />
      )}
      {paymentReservation && (
        <PaymentDialog
          reservation={paymentReservation}
          paymentVerifying={paymentReservation.id === paymentVerificationId}
          onClose={() => setPaymentReservation(null)}
          onConfirmed={(confirmed) => {
            localStorage.removeItem(WEBPAY_VERIFICATION_KEY);
            sessionStorage.removeItem(WEBPAY_RETURN_KEY);
            setPaymentVerificationId('');
            setPaymentReservation(null);
            setPendingReservation(null);
            setReservation(confirmed);
            setLastPaymentResult('Pago confirmado en Webpay. Tu QR de acceso ya está disponible.');
          }}
        />
      )}
      {verificationNotice && (
        <ReservationVerificationDialog
          notice={verificationNotice}
          onClose={() => setVerificationNotice(null)}
        />
      )}
      <PublicAiAssistant
        open={assistantOpen}
        onOpenChange={setAssistantOpen}
        properties={properties}
        search={search}
        selectedProperty={selected}
        onOpenProperty={openPropertyFromAssistant}
        onReserveProperty={reserveFromAssistant}
      />
      {toast && (
        <output className="fixed bottom-5 left-5 z-[80] max-w-[calc(100vw-2.5rem)] rounded-xl bg-[#103d50] px-4 py-3 text-sm font-semibold text-white shadow-xl">
          {/ocupad|reservad|disponib/i.test(toast)
            ? <CircleAlert className="mr-2 inline size-4 text-[#ffbd9c]" />
            : <Check className="mr-2 inline size-4 text-[#54dfc7]" />}
          {toast}
        </output>
      )}
    </main>
    </MotionConfig>
  );
}

function ReservationVerificationDialog({
  notice,
  onClose,
}: {
  notice: ReservationVerificationNotice;
  onClose: () => void;
}) {
  const success = notice.status === 'success';
  const failed = notice.status === 'error';
  return (
    <dialog
      open
      aria-labelledby="reservation-verification-title"
      className="fixed inset-0 z-[70] m-0 flex h-full max-h-none w-full max-w-none items-center justify-center bg-[#082b38]/75 p-4 backdrop-blur-sm"
    >
      <section className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="bg-[#103d50] px-7 py-6 text-white">
          <p className="text-xs font-extrabold tracking-[0.18em] text-[#72e4d7]">
            VERIFICACIÓN POR RESERVA
          </p>
          <h2 id="reservation-verification-title" className="mt-2 text-2xl font-extrabold">
            {success ? 'Reserva verificada' : failed ? 'No pudimos verificarla' : 'Validando enlace'}
          </h2>
        </div>
        <div className="px-7 py-7 text-center">
          <span className={`mx-auto flex size-16 items-center justify-center rounded-full ${success ? 'bg-emerald-100 text-emerald-700' : failed ? 'bg-red-100 text-red-700' : 'bg-[#e5f6f3] text-[#087f83]'}`}>
            {success ? <CheckCircle2 className="size-8" /> : failed ? <CircleAlert className="size-8" /> : <Mail className="size-8" />}
          </span>
          <p className="mt-5 text-sm font-extrabold tracking-wide text-[#0b6871]">
            {notice.reservationId}
          </p>
          <p className="mt-3 text-base leading-7 text-[#496b74]">{notice.message}</p>
          {failed && notice.localFallbackUrl && (
            <>
              <a
                href={notice.localFallbackUrl}
                className="mt-6 block w-full rounded-xl bg-[#0b6871] px-5 py-3 text-sm font-bold text-white hover:bg-[#07565d]"
              >
                Verificar con gestor local
              </a>
              <p className="mt-2 text-xs leading-5 text-[#6b858d]">
                Requiere abrir el gestor RestBlu en este mismo PC.
              </p>
            </>
          )}
          {notice.status !== 'working' && (
            <button
              type="button"
              onClick={onClose}
              className={`${failed && notice.localFallbackUrl ? 'mt-3' : 'mt-6'} w-full rounded-xl border border-[#cfe0de] px-5 py-3 text-sm font-bold text-[#0b6871] hover:bg-[#eef7f5]`}
            >
              Volver a RestBlu
            </button>
          )}
        </div>
      </section>
    </dialog>
  );
}

function Header({ screen, go, account }: {
  screen: Screen;
  go: (screen: Screen) => void;
  account: CustomerAccount | null;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const publicNav: { label: string; screen: Screen }[] = [
    { label: 'Inicio', screen: 'inicio' },
    { label: 'Alojamientos', screen: 'catalogo' },
    { label: 'Destinos', screen: 'destinos' },
    { label: 'Experiencias', screen: 'experiencias' },
    { label: 'Para propietarios', screen: 'propietarios' },
    { label: 'Ayuda', screen: 'soporte' },
  ];
  function navigate(next: Screen) {
    setMenuOpen(false);
    go(next);
  }
  return (
    <header className="restblu-header sticky top-0 z-30 bg-[#f7fafc]">
      <div className="mx-auto flex min-h-20 max-w-7xl items-center justify-between gap-3 px-5 lg:px-8">
        <button type="button" onClick={() => navigate('inicio')} aria-label="RestBlu, ir al inicio" className="flex min-h-11 shrink-0 items-center gap-2.5 text-left">
          <span aria-hidden="true" className="grid size-10 place-items-center rounded-[50%_50%_12px_50%] bg-[#103d50] text-xs font-bold tracking-[-.06em] text-[#c2edf1]">RB</span>
          <span className="block text-2xl font-semibold tracking-[-.04em] text-[#102d3f]">Rest<span className="text-[#0b8996]">Blu</span></span>
        </button>
        <nav aria-label="Navegación principal" className="hidden items-center gap-1 xl:flex">
          {publicNav.map((item) => (
            <button type="button" key={item.screen} onClick={() => navigate(item.screen)} aria-current={screen === item.screen ? 'page' : undefined} className={`min-h-11 rounded-full px-4 text-[13px] font-medium transition-colors ${screen === item.screen ? 'bg-[#e6f2f8] text-[#144e67]' : 'text-[#5b7787] hover:bg-[#eaf4fa] hover:text-[#17465e]'}`}>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-1.5 sm:gap-3">
          <button type="button" onClick={() => navigate('cuenta')} className={`flex min-h-11 items-center gap-2 rounded-full px-3 text-xs font-medium sm:text-sm ${screen === 'cuenta' ? 'bg-[#e6f2f8] text-[#144e67]' : 'text-[#436679]'}`}><UserRound aria-hidden="true" className="size-4" /><span className="hidden sm:inline">{account ? 'Mi cuenta' : 'Ingresar'}</span><span className="sr-only sm:hidden">{account ? 'Mi cuenta' : 'Ingresar'}</span></button>
          <button type="button" onClick={() => navigate('catalogo')} className="hidden min-h-11 items-center gap-2 rounded-full bg-[#103d50] px-5 text-xs font-semibold text-white transition-colors hover:bg-[#102d3f] sm:inline-flex">Reservar <ArrowRight aria-hidden="true" size={14} /></button>
          <button type="button" aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'} aria-expanded={menuOpen} aria-controls="restblu-mobile-nav" onClick={() => setMenuOpen(!menuOpen)} className="grid size-11 place-items-center rounded-full border border-[#d6e5ee] text-[#103d50] xl:hidden">{menuOpen ? <X aria-hidden="true" size={20} /> : <Menu aria-hidden="true" size={20} />}</button>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {menuOpen && <motion.nav id="restblu-mobile-nav" aria-label="Navegación móvil" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="grid gap-1 border-t border-[#dce8ef] bg-[#f7fafc] px-5 py-3 xl:hidden">
          {publicNav.map((item) => <button type="button" key={item.screen} aria-current={screen === item.screen ? 'page' : undefined} onClick={() => navigate(item.screen)} className={`min-h-11 rounded-xl px-4 text-left text-sm ${screen === item.screen ? 'bg-[#e6f2f8] font-semibold text-[#144e67]' : 'text-[#436679]'}`}>{item.label}</button>)}
        </motion.nav>}
      </AnimatePresence>
    </header>
  );
}

function Landing({ go, properties, onSelect, saved, onSave, search, setSearch, onSearch }: {
  go: (screen: Screen) => void;
  properties: Property[];
  onSelect: (property: Property) => void;
  saved: number[];
  onSave: (id: number) => void;
  search: SearchCriteria;
  setSearch: (search: SearchCriteria) => void;
  onSearch: () => void;
}) {
  return (
    <StayLanding
      onExplore={() => go('catalogo')}
      onLookup={() => go('consulta')}
      highlight={properties[0]}
      onSelectHighlight={() => { if (properties[0]) onSelect(properties[0]); }}
      searchBox={<SearchBox properties={properties} search={search} setSearch={setSearch} onSearch={onSearch} />}
      featured={properties.slice(0, 3).map((property) => (
        <PropertyCard key={property.id} property={property} saved={saved.includes(property.id)} onSave={() => onSave(property.id)} onSelect={() => onSelect(property)} />
      ))}
    />
  );
}

function SearchBox({
  properties,
  search,
  setSearch,
  onSearch,
  compact = false,
}: {
  properties: Property[];
  search: SearchCriteria;
  setSearch: (search: SearchCriteria) => void;
  onSearch: () => void;
  compact?: boolean;
}) {
  const minimumDate = todayForInput();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSearch();
      }}
      className={`restblu-search ${compact ? 'is-compact' : ''}`}
    >
      <SearchField
        id={compact ? 'catalog-destination' : 'home-destination'}
        icon={<MapPin />}
        label="Destino"
      >
        <input
          id={compact ? 'catalog-destination' : 'home-destination'}
          list="restblu-destinations"
          value={search.destination}
          onChange={(event) =>
            setSearch({ ...search, destination: event.target.value })
          }
          placeholder="Ciudad o alojamiento"
          className="w-full min-w-0 bg-transparent text-sm font-semibold text-[#173f4b] outline-none placeholder:text-[#78919a]"
        />
        <datalist id="restblu-destinations">
          {[...new Set(properties.map((property) => property.place))].map(
            (place) => (
              <option value={place} key={place}>
                {place}
              </option>
            ),
          )}
        </datalist>
      </SearchField>
      <SearchField
        id={compact ? 'catalog-checkin' : 'home-checkin'}
        icon={<CalendarDays />}
        label="Llegada"
      >
        <input
          id={compact ? 'catalog-checkin' : 'home-checkin'}
          type="date"
          min={minimumDate}
          value={search.checkIn}
          onChange={(event) =>
            setSearch({ ...search, checkIn: event.target.value })
          }
          className="w-full min-w-0 bg-transparent text-sm font-semibold text-[#173f4b] outline-none"
        />
      </SearchField>
      <SearchField
        id={compact ? 'catalog-checkout' : 'home-checkout'}
        icon={<CalendarDays />}
        label="Salida"
      >
        <input
          id={compact ? 'catalog-checkout' : 'home-checkout'}
          type="date"
          min={search.checkIn || minimumDate}
          value={search.checkOut}
          onChange={(event) =>
            setSearch({ ...search, checkOut: event.target.value })
          }
          className="w-full min-w-0 bg-transparent text-sm font-semibold text-[#173f4b] outline-none"
        />
      </SearchField>
      <SearchField
        id={compact ? 'catalog-guests' : 'home-guests'}
        icon={<Users />}
        label="Huéspedes"
      >
        <select
          id={compact ? 'catalog-guests' : 'home-guests'}
          value={search.guests}
          onChange={(event) =>
            setSearch({ ...search, guests: Number(event.target.value) })
          }
          className="w-full bg-transparent text-sm font-semibold text-[#173f4b] outline-none"
        >
          {Array.from({ length: 8 }, (_, index) => index + 1).map((count) => (
            <option value={count} key={count}>
              {count} {count === 1 ? 'huésped' : 'huéspedes'}
            </option>
          ))}
        </select>
      </SearchField>
      <button
        type="submit"
        className="restblu-primary-button"
      >
        <Search aria-hidden="true" size={18} /> Buscar
      </button>
    </form>
  );
}

function SearchField({
  id,
  icon,
  label,
  children,
}: {
  id: string;
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={id}
      className="restblu-search-field"
    >
      <span aria-hidden="true" className="shrink-0 text-[#0b788b]">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="restblu-field-label">
          {label}
        </span>
        {children}
      </span>
    </label>
  );
}

function Catalog({
  filter,
  setFilter,
  properties,
  allProperties,
  onSelect,
  saved,
  onSave,
  criteria,
  search,
  setSearch,
  onSearch,
  onReset,
}: {
  filter: string;
  setFilter: (value: string) => void;
  properties: Property[];
  allProperties: Property[];
  onSelect: (property: Property) => void;
  saved: number[];
  onSave: (id: number) => void;
  criteria: SearchCriteria;
  search: SearchCriteria;
  setSearch: (search: SearchCriteria) => void;
  onSearch: () => void;
  onReset: () => void;
}) {
  const filters = ['Todos', 'Mar', 'Piscina', 'Naturaleza', 'Mascotas'];
  return (
    <section className="restblu-catalog restblu-container">
      <div className="max-w-2xl">
        <h1 className="restblu-display text-4xl leading-[1.12] tracking-[-.035em] sm:text-5xl">
          Encuentra tu lugar.
        </h1>
        <p className="mt-4 leading-7 text-[#55727a]">
          Elige dónde y cuándo. Nosotros te mostramos los alojamientos.
        </p>
      </div>
      <SearchBox
        properties={allProperties}
        search={search}
        setSearch={setSearch}
        onSearch={onSearch}
        compact
      />
      <div className="restblu-catalog-filters mt-8 flex flex-wrap items-center justify-between gap-4 py-4">
        <div className="flex flex-wrap gap-2">
          {filters.map((item) => (
            <button
              key={item}
              aria-pressed={filter === item}
              onClick={() => setFilter(item)}
              className={`min-h-11 rounded-full px-5 py-2 text-sm font-medium transition-colors ${filter === item ? 'bg-[#0b6871] text-white' : 'bg-white text-[#56727a] ring-1 ring-[#d4e5e2] hover:bg-[#e9f5f3]'}`}
            >
              {item}
            </button>
          ))}
        </div>
        <button
          onClick={onReset}
          className="flex items-center gap-2 text-sm font-bold text-[#486b74]"
        >
          <SlidersHorizontal size={17} /> Limpiar búsqueda
        </button>
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 text-sm text-[#55727a]">
        <output aria-live="polite" aria-atomic="true">
          <strong className="text-[#173f4b]">{properties.length}</strong>{' '}
          {properties.length === 1 ? 'alojamiento encontrado' : 'alojamientos encontrados'}
        </output>
        {(criteria.destination || criteria.checkIn) && (
          <p>
            {criteria.destination || 'Todos los destinos'}
            {criteria.checkIn &&
              ` · ${formatDate(criteria.checkIn)} al ${formatDate(criteria.checkOut)}`}
            {` · ${criteria.guests} ${criteria.guests === 1 ? 'huésped' : 'huéspedes'}`}
          </p>
        )}
      </div>
      {properties.length > 0 ? (
        <div className="restblu-property-grid mt-6">
          {properties.map((property) => (
            <PropertyCard
              key={property.id}
              property={property}
              saved={saved.includes(property.id)}
              onSave={() => onSave(property.id)}
              onSelect={() => onSelect(property)}
            />
          ))}
        </div>
      ) : (
        <div className="mt-5 rounded-3xl border border-dashed border-[#b9d5d1] bg-white px-6 py-14 text-center">
          <Search className="mx-auto size-10 text-[#0b8e92]" />
          <h2 className="mt-4 text-xl font-bold">
            No encontramos alojamientos
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#66818a]">
            Prueba con otra ciudad, reduce la cantidad de huéspedes o limpia la
            búsqueda para volver a ver todas las propiedades.
          </p>
          <button
            onClick={onReset}
            className="mt-5 rounded-xl bg-[#0b6871] px-4 py-2.5 text-sm font-bold text-white"
          >
            Ver todos los alojamientos
          </button>
        </div>
      )}
    </section>
  );
}

function PropertyCard({ property, saved, onSave, onSelect }: {
  property: Property;
  saved: boolean;
  onSave: () => void;
  onSelect: () => void;
}) {
  return (
    <article className="restblu-property-card group">
      <div className="relative overflow-hidden bg-[#eaf2f7]">
        <button type="button" onClick={onSelect} aria-label={`Ver alojamiento ${property.name}`} className="restblu-card-photo block w-full overflow-hidden text-left">
          <img src={property.image} alt={property.name} loading="lazy" width={800} height={550} className="restblu-property-image h-full w-full object-cover" />
        </button>
        <button type="button" aria-label={saved ? `Quitar ${property.name} de favoritos` : `Guardar ${property.name} en favoritos`} aria-pressed={saved} onClick={onSave} className={`restblu-save-button absolute right-3 top-3 grid size-11 place-items-center rounded-full transition-colors ${saved ? 'bg-[#103d50] text-white' : 'bg-white text-[#2f6279] hover:bg-[#edf5fa]'}`}>
          <Heart aria-hidden="true" size={18} fill={saved ? 'currentColor' : 'none'} />
        </button>
      </div>
      <div className="restblu-card-copy">
        <div className="flex items-center justify-between gap-3 text-sm">
          <p className="flex items-center gap-1.5 text-[#58788b]"><MapPin aria-hidden="true" size={13} />{property.place}</p>
          <span className="flex shrink-0 items-center gap-1 font-semibold text-[#245570]"><Star aria-hidden="true" size={13} fill="#b68e42" className="text-[#b68e42]" /><span className="sr-only">Valoración </span>{property.rating}</span>
        </div>
        <h3 className="mt-1 text-xl font-semibold tracking-[-.025em] text-[#153d56]"><button type="button" onClick={onSelect} className="min-h-11 text-left hover:text-[#087b8c]">{property.name}</button></h3>
        <p className="text-sm text-[#55727a]">{property.type}</p>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[13px] text-[#5a788b]">
          <span className="flex items-center gap-1.5"><Users aria-hidden="true" size={14} />{property.guests} huéspedes</span>
          <span className="flex items-center gap-1.5"><BedDouble aria-hidden="true" size={14} />{property.beds} camas</span>
          <span className="flex items-center gap-1.5"><Bath aria-hidden="true" size={14} />{property.baths} baños</span>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="text-lg font-semibold tracking-[-.03em] text-[#17465e]">{property.price}<span className="text-xs font-normal tracking-normal text-[#5a788b]"> / noche</span></p>
          <button type="button" onClick={onSelect} className="inline-flex min-h-11 items-center gap-2 text-xs font-semibold text-[#0b6871]">Ver detalle <ArrowRight aria-hidden="true" size={15} /></button>
        </div>
      </div>
    </article>
  );
}

function PropertyDetail({
  property,
  saved,
  search,
  setSearch,
  onBack,
  onSave,
  onReserve,
  onNotice,
}: {
  property: Property;
  saved: boolean;
  search: SearchCriteria;
  setSearch: (search: SearchCriteria) => void;
  onBack: () => void;
  onSave: () => void;
  onReserve: () => void;
  onNotice: (message: string) => void;
}) {
  const nights = getNightCount(search.checkIn, search.checkOut);
  const estimatedTotal = nights * priceToNumber(property.price);
  const galleryImages = [
    { src: property.image, alt: `${property.name}, imagen principal` },
    ...property.gallery,
  ].filter(
    (image, index, images) =>
      Boolean(image.src) && images.findIndex((item) => item.src === image.src) === index,
  );
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  function previousImage() {
    setViewerIndex((current) =>
      current === null ? 0 : (current - 1 + galleryImages.length) % galleryImages.length,
    );
  }

  function nextImage() {
    setViewerIndex((current) =>
      current === null ? 0 : (current + 1) % galleryImages.length,
    );
  }

  useEffect(() => {
    if (viewerIndex === null) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function handleKeyboard(event: KeyboardEvent) {
      if (event.key === 'Escape') setViewerIndex(null);
      if (event.key === 'ArrowLeft') {
        setViewerIndex((current) =>
          current === null
            ? 0
            : (current - 1 + galleryImages.length) % galleryImages.length,
        );
      }
      if (event.key === 'ArrowRight') {
        setViewerIndex((current) =>
          current === null ? 0 : (current + 1) % galleryImages.length,
        );
      }
    }
    window.addEventListener('keydown', handleKeyboard);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyboard);
    };
  }, [viewerIndex, galleryImages.length]);

  return (
    <section className="restblu-property-detail restblu-container py-8">
      <button
        onClick={onBack}
        className="mb-5 flex items-center gap-2 text-sm font-bold text-[#4b6d75]"
      >
        <ChevronLeft size={18} />
        Volver al catálogo
      </button>
      <div className="grid gap-7 lg:grid-cols-[1.35fr_.65fr]">
        <div>
          <div className="relative grid h-[400px] gap-1 overflow-hidden rounded-3xl bg-[#dbe7e5] sm:grid-cols-[1.4fr_.6fr] sm:grid-rows-2">
            <button
              type="button"
              onClick={() => setViewerIndex(0)}
              aria-label={`Abrir imagen principal de ${property.name}`}
              className="group h-full w-full overflow-hidden sm:row-span-2"
            >
              <img
                src={property.image}
                alt={property.name}
                className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
              />
            </button>
            {property.gallery.map((image, index) => (
              <button
                type="button"
                key={`${image.src}-${index}`}
                onClick={() => {
                  const imageIndex = galleryImages.findIndex((item) => item.src === image.src);
                  setViewerIndex(imageIndex >= 0 ? imageIndex : 0);
                }}
                aria-label={`Abrir imagen ${index + 2} de ${property.name}`}
                className="group hidden h-full w-full overflow-hidden sm:block"
              >
                <img
                  src={image.src}
                  alt={image.alt}
                  onError={(event) => {
                    event.currentTarget.src = property.image;
                  }}
                  className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                />
              </button>
            ))}
            <button
              type="button"
              onClick={() => setViewerIndex(0)}
              className="absolute bottom-4 right-4 flex items-center gap-2 rounded-full bg-white/95 px-4 py-2.5 text-sm font-bold text-[#173f4b] shadow-lg backdrop-blur hover:bg-white"
            >
              <Maximize2 size={16} /> Ver {galleryImages.length} fotos
            </button>
          </div>
          <div className="mt-7 flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-[#07888d]">
                {property.type}
              </p>
              <h1 className="mt-1 text-4xl font-bold tracking-tight">
                {property.name}
              </h1>
              <p className="mt-2 flex items-center gap-1 text-[#66828b]">
                <MapPin size={17} />
                {property.place}
              </p>
            </div>
            <button
              onClick={onSave}
              className={`rounded-xl px-3 py-2 text-sm font-bold ${saved ? 'bg-[#e0f3f1] text-[#08757b]' : 'border border-[#d3e3e0] text-[#496b74]'}`}
            >
              <Heart
                className="mr-1 inline size-4"
                fill={saved ? 'currentColor' : 'none'}
              />
              {saved ? 'Guardado' : 'Guardar'}
            </button>
          </div>
          <div className="mt-7 grid grid-cols-3 gap-3 border-y border-[#deebe9] py-5">
            <Info
              icon={<Users />}
              label="Huéspedes"
              value={`${property.guests} personas`}
            />
            <Info
              icon={<BedDouble />}
              label="Dormitorios"
              value={`${property.beds} habitaciones`}
            />
            <Info
              icon={<Bath />}
              label="Baños"
              value={`${property.baths} baños`}
            />
          </div>
          <h2 className="mt-7 text-xl font-bold">
            Una estadía diseñada para desconectarte
          </h2>
          <p className="mt-3 max-w-2xl leading-7 text-[#55727a]">
            Espacios cómodos, equipamiento completo y una ubicación ideal para
            disfrutar con calma. Al confirmar la reserva recibirás un pase
            digital con instrucciones de llegada y acceso seguro.
          </p>
        </div>
        <aside className="restblu-booking-panel h-fit lg:sticky lg:top-28" aria-label="Fechas y precio de tu estadía">
          <h2 className="text-lg font-semibold tracking-tight">Tu estadía empieza aquí.</h2>
          <p className="mt-5 text-sm text-[#55727a]">Tarifa por noche</p>
          <p className="mt-1 text-3xl font-bold">
            {property.price}
            <span className="text-sm font-medium text-[#779199]"> / noche</span>
          </p>
          <div className="mt-5 space-y-3 text-sm">
            <PropertyAvailabilityCalendar
              property={property}
              search={search}
              setSearch={setSearch}
              onNotice={onNotice}
            />
            <label className="block border-t border-[#e1ecea] pt-3">
              <span className="text-sm font-medium text-[#55727a]">
                Huéspedes
              </span>
              <select
                value={Math.min(search.guests, property.guests)}
                onChange={(event) =>
                  setSearch({ ...search, guests: Number(event.target.value) })
                }
                className="mt-2 min-h-12 w-full rounded-lg bg-[#f2f8f7] px-3 py-2 text-base font-medium outline-none focus:ring-2 focus:ring-[#54d9ce]"
              >
                {Array.from(
                  { length: property.guests },
                  (_, index) => index + 1,
                ).map((count) => (
                  <option value={count} key={count}>
                    {count} {count === 1 ? 'huésped' : 'huéspedes'}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {nights > 0 && (
            <div className="mt-4 flex items-center justify-between rounded-xl bg-[#eaf6f4] px-3 py-3 text-sm">
              <span className="text-[#55727a]">
                Total por {nights} {nights === 1 ? 'noche' : 'noches'}
              </span>
              <strong>{formatCurrency(estimatedTotal)}</strong>
            </div>
          )}
          <button
            onClick={onReserve}
            className="restblu-primary-button mt-5 w-full"
          >
            Continuar con mi reserva <ArrowRight aria-hidden="true" size={17} />
          </button>
          <p className="mt-3 text-center text-[13px] leading-5 text-[#55727a]">
            Primero revisas tus datos. Luego continúas al pago con Webpay.
          </p>
          <div className="mt-5 space-y-3 border-t border-[#e5efed] pt-5 text-sm text-[#55727a]">
            <p className="flex gap-2">
              <ShieldCheck className="size-4 text-[#0b8e92]" />
              Fechas y disponibilidad del alojamiento
            </p>
            <p className="flex gap-2">
              <QrCode className="size-4 text-[#0b8e92]" />
              Pase digital con el pago confirmado
            </p>
            <p className="flex gap-2">
              <MessageSquareMore className="size-4 text-[#0b8e92]" />
              Consulta tus dudas con Blu
            </p>
          </div>
        </aside>
      </div>
      {viewerIndex !== null && (
        <dialog
          open
          aria-modal="true"
          aria-label={`Galería de ${property.name}`}
          className="fixed inset-0 z-50 m-0 h-full max-h-none w-full max-w-none overflow-hidden bg-[#061722]/95 p-0 text-white backdrop-blur-md"
        >
          <div className="flex h-full flex-col">
            <header className="flex items-center justify-between gap-4 px-5 py-4 sm:px-8">
              <div className="min-w-0">
                <p className="truncate text-base font-bold">{property.name}</p>
                <p className="mt-0.5 text-sm text-white/60">
                  {viewerIndex + 1} de {galleryImages.length}
                </p>
              </div>
              <button
                type="button"
                autoFocus
                onClick={() => setViewerIndex(null)}
                aria-label="Cerrar galería"
                className="grid size-11 shrink-0 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
              >
                <X size={22} />
              </button>
            </header>

            <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 sm:px-20">
              {galleryImages.length > 1 && (
                <button
                  type="button"
                  onClick={previousImage}
                  aria-label="Imagen anterior"
                  className="absolute left-3 z-10 grid size-11 place-items-center rounded-full bg-white/10 text-white backdrop-blur hover:bg-white/20 sm:left-7 sm:size-13"
                >
                  <ChevronLeft size={26} />
                </button>
              )}
              <figure className="flex h-full w-full items-center justify-center">
                <img
                  src={galleryImages[viewerIndex].src}
                  alt={galleryImages[viewerIndex].alt}
                  className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
                />
              </figure>
              {galleryImages.length > 1 && (
                <button
                  type="button"
                  onClick={nextImage}
                  aria-label="Imagen siguiente"
                  className="absolute right-3 z-10 grid size-11 place-items-center rounded-full bg-white/10 text-white backdrop-blur hover:bg-white/20 sm:right-7 sm:size-13"
                >
                  <ChevronRight size={26} />
                </button>
              )}
            </div>

            <div className="flex justify-center gap-2 overflow-x-auto px-5 py-4 sm:px-8">
              {galleryImages.map((image, index) => (
                <button
                  type="button"
                  key={`${image.src}-thumbnail`}
                  onClick={() => setViewerIndex(index)}
                  aria-label={`Ver imagen ${index + 1}`}
                  aria-current={viewerIndex === index ? 'true' : undefined}
                  className={`h-14 w-20 shrink-0 overflow-hidden rounded-lg border-2 transition ${viewerIndex === index ? 'border-[#dff568] opacity-100' : 'border-transparent opacity-55 hover:opacity-90'}`}
                >
                  <img src={image.src} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        </dialog>
      )}
    </section>
  );
}

function Experiences({ onExplore }: { onExplore: (place: string) => void }) {
  const items = [
    [
      'Navegación al atardecer',
      'Algarrobo',
      'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=1000&q=85',
    ],
    [
      'Ruta de viñedos',
      'Casablanca',
      'https://images.unsplash.com/photo-1473973266408-ed4e27abdd47?auto=format&fit=crop&w=1000&q=85',
    ],
    [
      'Sendero entre bosques',
      'Pucón',
      'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1000&q=85',
    ],
  ];
  return (
    <section className="mx-auto max-w-7xl px-5 py-11 lg:px-8">
      <div className="max-w-2xl">
        <p className="text-xs font-bold uppercase tracking-[.16em] text-[#07888d]">
          EXPERIENCIAS
        </p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight">
          Una reserva es solo el comienzo.
        </h1>
        <p className="mt-3 leading-6 text-[#648088]">
          Recomendaciones locales seleccionadas para complementar tu estadía.
        </p>
      </div>
      <div className="mt-8 grid gap-5 md:grid-cols-3">
        {items.map(([name, place, image]) => (
          <article
            key={name}
            className="overflow-hidden rounded-2xl bg-white shadow-sm"
          >
            <img src={image} alt={name} className="h-60 w-full object-cover" />
            <div className="p-5">
              <p className="text-sm font-bold text-[#07888d]">{place}</p>
              <h2 className="mt-1 text-xl font-bold">{name}</h2>
              <button
                onClick={() => onExplore(place)}
                className="mt-4 text-sm font-bold text-[#0b6871]"
              >
                Buscar alojamiento cercano{' '}
                <ArrowRight className="ml-1 inline size-4" />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function BookingDialog({
  property,
  search,
  accountEmail,
  profile,
  onClose,
  onConfirm,
}: {
  property: Property;
  search: SearchCriteria;
  accountEmail: string;
  profile: CustomerProfile | null;
  onClose: () => void;
  onConfirm: (details: {
    id: string;
    guestName: string;
    email: string;
    phone: string;
    documentId: string;
  }) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [guestName, setGuestName] = useState(profile?.name || '');
  const email = accountEmail;
  const [phone, setPhone] = useState(profile?.phone || '');
  const [documentId, setDocumentId] = useState(profile?.documentId || '');
  const [attemptId] = useState(() => makeReservationCode());
  const [rutTouched, setRutTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const rutValid = isValidRut(documentId);
  const nights = getNightCount(search.checkIn, search.checkOut);
  const total = nights * priceToNumber(property.price);
  const inputClass =
    'mt-2 min-h-12 w-full rounded-lg border border-[#c9dbdf] bg-white px-3 py-3 text-base font-normal outline-none transition-colors focus:border-[#0b8e92] focus:ring-2 focus:ring-[#b9ebe5]';

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby="booking-title"
      onCancel={(event) => { event.preventDefault(); if (!submitting) onClose(); }}
      className="restblu-booking-overlay fixed inset-0 z-50 m-0 h-full max-h-none w-full max-w-none overflow-y-auto bg-[#082b38]/65 p-4 sm:p-8"
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setRutTouched(true);
          setSubmitError('');
          if (!rutValid) return;
          setSubmitting(true);
          try {
            await onConfirm({ id: attemptId, guestName, email, phone, documentId });
          } catch (error) {
            setSubmitError(
              error instanceof Error
                ? error.message
                : 'No fue posible iniciar la reserva.',
            );
            setSubmitting(false);
          }
        }}
        className="restblu-booking-sheet mx-auto w-full max-w-2xl overflow-hidden bg-white"
      >
        <div className="flex items-start justify-between gap-4 px-6 pb-0 pt-6 sm:px-8 sm:pt-8">
          <div>
            <h2 id="booking-title" className="restblu-display text-3xl tracking-tight">
              Revisa tu reserva.
            </h2>
            <p className="mt-2 text-sm leading-6 text-[#55727a]">Un último vistazo antes de continuar al pago.</p>
          </div>
          <button
            type="button"
            aria-label="Cerrar formulario de reserva"
            onClick={onClose}
            disabled={submitting}
            className="restblu-icon-button shrink-0 disabled:opacity-40"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 sm:px-8 sm:pb-8">
          <ol className="restblu-booking-progress" aria-label="Proceso de reserva"><li>Tu estadía</li><li aria-current="step">Tus datos</li><li>Pago</li></ol>
          <div className="restblu-booking-summary grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <p className="text-lg font-semibold">{property.name}</p>
              <p className="mt-1 text-sm text-[#55727a]">{property.place}</p>
              <p className="mt-2 text-sm font-medium leading-6 text-[#0b6871]">
                {formatDate(search.checkIn)} → {formatDate(search.checkOut)} ·{' '}
                {search.guests} {search.guests === 1 ? 'huésped' : 'huéspedes'}
              </p>
            </div>
            <div className="text-left sm:text-right">
              <p className="text-[13px] text-[#55727a]">Total referencial</p>
              <p className="text-2xl font-semibold tabular-nums">{formatCurrency(total)}</p>
              <p className="text-[13px] text-[#55727a]">
                {nights} {nights === 1 ? 'noche' : 'noches'}
              </p>
            </div>
          </div>

          <fieldset className="mt-6 grid gap-5 sm:grid-cols-2">
            <legend className="mb-4 text-base font-semibold">Datos del huésped</legend>
            <label className="text-sm font-bold text-[#274b56]">
              Nombre completo
              <span className="relative block">
                <UserRound className="absolute left-3 top-4 size-4 text-[#0b8e92]" />
                <input
                  required
                  autoFocus
                  autoComplete="name"
                  value={guestName}
                  onChange={(event) => setGuestName(event.target.value)}
                  placeholder="Ej.: Camila Fernández"
                  className={`${inputClass} pl-10`}
                />
              </span>
            </label>
            <label className="text-sm font-bold text-[#274b56]">
              RUT chileno
              <input
                required
                readOnly={Boolean(profile?.documentId)}
                title={profile?.documentId ? 'El RUT se cambia desde Mi cuenta' : undefined}
                value={documentId}
                onChange={(event) => {
                  setDocumentId(formatRut(event.target.value));
                  setRutTouched(true);
                }}
                onBlur={() => setRutTouched(true)}
                placeholder="Ej.: 12.345.678-9"
                maxLength={12}
                autoComplete="off"
                aria-invalid={rutTouched && !rutValid}
                aria-describedby="rut-help"
                className={`${inputClass} ${rutTouched && !rutValid ? 'border-red-400 focus:border-red-500 focus:ring-red-100' : ''}`}
              />
              <span
                id="rut-help"
                className={`mt-1 block text-xs font-medium ${rutTouched && !rutValid ? 'text-red-600' : 'text-[#55727a]'}`}
              >
                {rutTouched && !rutValid
                  ? 'Ingresa un RUT chileno válido.'
                  : profile?.documentId
                    ? 'Es el RUT de tu cuenta.'
                    : 'Se agregan puntos y guion automáticamente.'}
              </span>
            </label>
            <label className="text-sm font-bold text-[#274b56]">
              Correo electrónico
              <span className="relative block">
                <Mail className="absolute left-3 top-4 size-4 text-[#0b8e92]" />
                <input
                  required
                  type="email"
                  readOnly
                  value={email}
                  title="Es el correo de tu cuenta RestBlu"
                  className={`${inputClass} cursor-not-allowed bg-[#f1f6f5] pl-10 text-[#5d7a83]`}
                />
              </span>
            </label>
            <label className="text-sm font-bold text-[#274b56]">
              Teléfono
              <span className="relative block">
                <Phone className="absolute left-3 top-4 size-4 text-[#0b8e92]" />
                <input
                  required
                  type="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="Ej.: +56 9 1234 5678"
                  className={`${inputClass} pl-10`}
                />
              </span>
            </label>
          </fieldset>

          <div className="mt-5 flex gap-3 rounded-lg bg-[#edf5fa] p-4 text-sm leading-6 text-[#3f6870]">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-[#07888d]" />
            <p>
              Guardaremos la reserva en tu cuenta. El comprobante y el pase digital
              estarán disponibles cuando Webpay confirme el pago.
            </p>
          </div>

          {submitError && (
            <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              {submitError}
            </div>
          )}

          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="min-h-12 rounded-lg px-5 py-3 text-sm font-semibold text-[#496b74] hover:bg-[#edf5fa] disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="restblu-primary-button disabled:cursor-wait disabled:opacity-60"
            >
              {submitting ? 'Preparando pago…' : `Continuar al pago · ${formatCurrency(total)}`}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}

function PaymentDialog({
  reservation,
  paymentVerifying,
  onClose,
  onConfirmed,
}: {
  reservation: Reservation;
  paymentVerifying: boolean;
  onClose: () => void;
  onConfirmed: (reservation: Reservation) => void;
}) {
  const [status, setStatus] = useState<ReservationProcessingStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');

  async function loadStatus(showError = false) {
    try {
      const result = reservation.cloud
        ? await getCloudReservationStatus(reservation.id)
        : await (async () => {
          const response = await fetch(`${LOCAL_DATA_API}/reservations/${encodeURIComponent(reservation.id)}/verification`, { cache: 'no-store' });
          const data = await response.json() as ReservationProcessingStatus;
          if (!response.ok) throw new Error(data.error || 'No se pudo consultar la reserva.');
          return data;
        })();
      if (!result) return null;
      setStatus(result);
      const problem = statusErrorMessage(result);
      if (problem) setError(problem);
      if (result.verified && result.paymentStatus === 'aprobado-demo') {
        onConfirmed({
          ...reservation,
          verificationStatus: 'verified',
          paymentStatus: result.paymentStatus,
          pdfUrl: result.pdfUrl || undefined,
          pdfBase64: result.pdfBase64,
          pdfFileName: result.pdfFileName,
          accessPin: result.booking?.accessPin || reservation.accessPin,
          dahuaUserId: result.dahuaUserId || reservation.dahuaUserId,
          accessQrImage: result.accessQrImage,
          accessQrExpiresAt: result.accessQrExpiresAt,
          dahuaQrStatus: result.dahuaQrStatus,
          confirmationEmailSentAt: result.confirmationEmailSentAt || undefined,
          confirmationEmailError: result.confirmationEmailError || undefined,
        });
      }
      return result;
    } catch (failure) {
      if (showError) setError(failure instanceof Error ? failure.message : 'No se pudo consultar la reserva.');
      return null;
    }
  }

  useEffect(() => {
    void loadStatus();
    const timer = window.setInterval(() => { void loadStatus(); }, reservation.cloud ? 10_000 : 5_000);
    return () => window.clearInterval(timer);
  }, [reservation.id, reservation.cloud]);

  // Lleva al formulario de Webpay. Al volver, la web entrega el token al gestor,
  // que verifica el pago con Transbank y habilita el QR.
  async function pay() {
    if (paymentVerifying || localStorage.getItem(WEBPAY_VERIFICATION_KEY) === reservation.id) {
      setError('Hay un pago en verificación para esta reserva. Consulta su estado en Mi cuenta; no vuelvas a pagar.');
      return;
    }
    setError('');
    setPaying(true);
    try {
      const latest = await loadStatus(true);
      if (!latest?.emailVerified) throw new Error('Primero verifica el enlace enviado a tu correo.');
      if (latest.verified || latest.paymentStatus === 'aprobado-demo' || latest.paymentStatus === 'reembolso-pendiente') {
        throw new Error('Esta reserva ya registra un pago. Consulta su estado en Mi cuenta.');
      }
      if (latest.status === 'expirada') throw new Error('El plazo para pagar esta reserva venció. Haz una nueva reserva.');
      try {
        sessionStorage.setItem('restblu:webpay-pending', JSON.stringify({ id: reservation.id, cloud: Boolean(reservation.cloud) }));
      } catch {
        // Si no se puede guardar, la vuelta igual identifica la reserva.
      }
      await startWebpayPayment(reservation.id, latest.booking?.total ?? reservation.total);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo iniciar el pago.');
      setPaying(false);
    }
  }

  return (
    <dialog open aria-labelledby="payment-title" className="fixed inset-0 z-50 m-0 grid h-full max-h-none w-full max-w-none place-items-center overflow-y-auto bg-[#082b38]/70 p-4 backdrop-blur-sm">
      <section className="w-full max-w-xl overflow-hidden rounded-3xl bg-white shadow-2xl">
        <header className="flex items-start justify-between bg-[#103d50] p-6 text-white">
          <div><p className="text-xs font-bold uppercase tracking-[.16em] text-[#70e1d5]">PAGO CON WEBPAY</p><h2 id="payment-title" className="mt-1 text-2xl font-bold">Paga tu reserva</h2></div>
          <button type="button" onClick={onClose} aria-label="Cerrar pago" className="rounded-xl bg-white/10 p-2"><X size={20} /></button>
        </header>
        <div className="space-y-5 p-6">
          <div className="rounded-2xl border border-[#d8e8e5] p-4">
            <p className="font-bold">{reservation.property.name} · {formatCurrency(reservation.total)}</p>
            <p className="mt-1 text-xs text-[#66818a]">Reserva {reservation.id} · {formatDate(reservation.checkIn)} → {formatDate(reservation.checkOut)}</p>
          </div>
          <div className={`rounded-2xl p-4 text-sm ${status?.emailVerified ? 'bg-[#eaf8f2] text-[#146b52]' : 'bg-amber-50 text-amber-900'}`}>
            <p className="font-bold">{status?.emailVerified ? '✓ Correo verificado' : '1. Verifica tu correo'}</p>
            <p className="mt-1">{status?.emailVerified
              ? 'Ya puedes pagar con Webpay.'
              : status?.verificationEmailSentAt
                ? `Abre el enlace de verificación enviado a ${reservation.email}. Esta pantalla se actualizará automáticamente.`
                : status?.verificationEmailError
                  ? `El correo sigue pendiente: ${status.verificationEmailError}`
                  : 'La reserva se está sincronizando; el gestor enviará el enlace de verificación.'}</p>
          </div>
          <button type="button" disabled={checking} onClick={async () => { setChecking(true); await loadStatus(true); setChecking(false); }} className="text-sm font-bold text-[#0b6871]">
            {checking ? 'Consultando…' : 'Ya verifiqué mi correo · actualizar'}
          </button>
          {status?.emailVerified && status.status !== 'expirada' && (
            <div className="rounded-2xl border border-[#d8e8e5] p-4 text-sm text-[#3f6870]">
              <p className="font-bold text-[#274b56]">2. Paga en Webpay</p>
              <p className="mt-1">Serás llevado al formulario seguro de Transbank para pagar con tarjeta de crédito, débito o prepago. Al terminar volverás a RestBlu.</p>
            </div>
          )}
          {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
          <div className="flex flex-wrap justify-end gap-3">
            <button type="button" onClick={onClose} className="rounded-xl border border-[#ccdfdc] px-5 py-3 text-sm font-bold text-[#496b74]">Cerrar</button>
            {status?.emailVerified && status.status !== 'expirada' && !paymentVerifying && <button type="button" disabled={paying} onClick={() => void pay()} className="rounded-xl bg-[#0b6871] px-5 py-3 text-sm font-bold text-white disabled:opacity-60">{paying ? 'Abriendo Webpay…' : `Pagar ${formatCurrency(status?.booking?.total ?? reservation.total)} con Webpay`}</button>}
          </div>
          {paymentVerifying && <p className="text-center text-sm font-semibold text-[#0b6871]">Pago en verificación. Sigue su estado en Mi cuenta; no realices otro pago.</p>}
          <p className="text-center text-xs text-[#718b93]">Tu QR de acceso y el comprobante se habilitan apenas se aprueba el pago.</p>
        </div>
      </section>
    </dialog>
  );
}

function ReservationReceipt({
  reservation,
  onClose,
}: {
  reservation: Reservation;
  onClose: () => void;
}) {
  const [qrError, setQrError] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState(reservation.verificationStatus);
  const [pdfUrl, setPdfUrl] = useState(reservation.pdfUrl || '');
  const [pdfBase64, setPdfBase64] = useState(reservation.pdfBase64 || '');
  const [pdfFileName, setPdfFileName] = useState(reservation.pdfFileName || `RestBlu-${reservation.id}.pdf`);
  const [synced, setSynced] = useState(reservation.synced ?? !reservation.cloud);
  const [verificationEmailSentAt, setVerificationEmailSentAt] = useState(
    reservation.verificationEmailSentAt || '',
  );
  const [verificationEmailError, setVerificationEmailError] = useState(
    reservation.verificationEmailError || '',
  );
  const [emailPending, setEmailPending] = useState(
    reservation.emailPending ?? (
      !reservation.verificationEmailSentAt && reservation.verificationStatus !== 'verified'
    ),
  );
  const [confirmationEmailSentAt, setConfirmationEmailSentAt] = useState(
    reservation.confirmationEmailSentAt || '',
  );
  const [confirmationEmailError, setConfirmationEmailError] = useState(
    reservation.confirmationEmailError || '',
  );
  const [statusError, setStatusError] = useState(reservation.statusError || '');
  const [paymentStatus, setPaymentStatus] = useState(reservation.paymentStatus || 'pendiente-demo');
  const [checking, setChecking] = useState(false);
  const [verificationError, setVerificationError] = useState('');
  const [statusNotice, setStatusNotice] = useState('');
  const [biometricOpen, setBiometricOpen] = useState(false);
  const [biometricStatus, setBiometricStatus] = useState(
    reservation.biometricStatus || 'sin-registrar',
  );
  const [dahuaStatus, setDahuaStatus] = useState(reservation.dahuaStatus || 'sin-registrar');
  const [accessQrImage, setAccessQrImage] = useState(reservation.accessQrImage || '');
  const [accessQrExpiresAt, setAccessQrExpiresAt] = useState(reservation.accessQrExpiresAt || '');
  const [dahuaQrStatus, setDahuaQrStatus] = useState(reservation.dahuaQrStatus || '');
  const [biometricNotice, setBiometricNotice] = useState('');
  const verified = verificationStatus === 'verified';
  const verificationEmailSent = Boolean(verificationEmailSentAt);
  const verificationEmailPending = !verified && (emailPending || !verificationEmailSent);
  const confirmationEmailSent = Boolean(confirmationEmailSentAt);
  // El QR de acceso lo genera el gestor y el lector Dahua sólo lo acepta
  // durante unos minutos; se pide uno nuevo periódicamente. Sin QR vigente se
  // muestra el QR informativo, que no contiene credenciales.
  const accessQrFresh = Boolean(accessQrImage) && Date.parse(accessQrExpiresAt) > Date.now();
  const qrUrl = accessQrFresh ? accessQrImage : reservationQrUrl(reservation);
  const downloadUrl = pdfUrl
    ? `${LOCAL_DATA_API.replace(/\/api$/, '')}${pdfUrl}`
    : `${LOCAL_DATA_API}/reservations/${encodeURIComponent(reservation.id)}/pdf`;
  const receiptTitle = verified
    ? paymentStatus === 'aprobado-demo' ? 'Pago confirmado' : 'Reserva confirmada'
    : statusError
      ? 'Revisa esta reserva'
      : verificationEmailSent
        ? 'Verifica tu correo'
        : synced
          ? 'Correo pendiente'
          : 'Reserva guardada';
  const statusBadge = verified
    ? paymentStatus === 'aprobado-demo' ? '● PAGO CONFIRMADO · WEBPAY' : '● CONFIRMADA'
    : statusError
      ? '● ERROR DE SINCRONIZACIÓN'
      : verificationEmailSent
        ? '● CORREO ENVIADO · SIN VERIFICAR'
        : synced
          ? '● SINCRONIZADA · CORREO PENDIENTE'
          : '● GUARDADA · SINCRONIZACIÓN PENDIENTE';
  const summaryLabel = verified
    ? 'Código de reserva'
    : statusError
      ? 'No fue posible sincronizar'
      : verificationEmailSent
        ? 'Enlace enviado a'
        : synced
          ? 'Reserva sincronizada · correo pendiente'
          : 'Reserva guardada en la nube';
  const summaryDetail = verified
    ? ''
    : statusError
      ? statusError
      : verificationEmailSent
        ? 'Abre ese correo y pulsa “Verificar esta reserva”.'
        : synced
          ? verificationEmailError
            ? `El último intento de envío falló: ${verificationEmailError}. El correo sigue pendiente y puede reintentarse.`
            : 'El gestor ya recibió la reserva, pero aún no hay registro de que el correo se haya enviado.'
          : 'El gestor local debe incorporarla antes de poder enviar el correo.';

  function downloadPdf() {
    if (!pdfBase64) {
      window.location.assign(downloadUrl);
      return;
    }
    const binary = window.atob(pdfBase64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = pdfFileName;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  async function checkVerification(showProgress = false) {
    if (showProgress) setChecking(true);
    try {
      let status: ReservationProcessingStatus;
      if (reservation.cloud) {
        const cloudStatus = await getCloudReservationStatus(reservation.id);
        if (!cloudStatus) {
          setSynced(false);
          if (showProgress) {
            setStatusNotice('La reserva está guardada y todavía espera sincronización con el gestor local.');
            setVerificationError('');
          }
          return;
        }
        status = cloudStatus;
      } else {
        const response = await fetch(
          `${LOCAL_DATA_API}/reservations/${encodeURIComponent(reservation.id)}/verification`,
          { cache: 'no-store' },
        );
        const localStatus = (await response.json()) as ReservationProcessingStatus;
        if (!response.ok) {
          throw new Error(localStatus.error || 'No se pudo consultar la verificación.');
        }
        status = localStatus;
      }

      const processingError = statusErrorMessage(status);
      if (processingError) {
        setStatusError(processingError);
        if (reservation.cloud) setSynced(false);
        setVerificationError(processingError);
        setStatusNotice('');
        return;
      }

      setSynced(true);
      if (status.paymentStatus) setPaymentStatus(status.paymentStatus);
      setStatusError('');
      setVerificationError('');
      setStatusNotice('');

      if ('verificationEmailSentAt' in status) {
        setVerificationEmailSentAt(statusText(status.verificationEmailSentAt));
      }
      if ('verificationEmailError' in status) {
        setVerificationEmailError(statusText(status.verificationEmailError));
      }
      if (typeof status.emailPending === 'boolean') {
        setEmailPending(status.emailPending);
      } else if (statusText(status.verificationEmailSentAt)) {
        setEmailPending(false);
      }
      if ('confirmationEmailSentAt' in status) {
        setConfirmationEmailSentAt(statusText(status.confirmationEmailSentAt));
      }
      if ('confirmationEmailError' in status) {
        setConfirmationEmailError(statusText(status.confirmationEmailError));
      }
      if (status.biometricStatus) {
        setBiometricStatus(status.biometricStatus);
      }
      if (status.dahuaStatus) {
        setDahuaStatus(status.dahuaStatus);
      }
      if (status.accessQrImage && status.accessQrImage !== accessQrImage) {
        setAccessQrImage(status.accessQrImage);
        setAccessQrExpiresAt(status.accessQrExpiresAt || '');
        setQrError(false);
      }
      if (status.dahuaQrStatus) setDahuaQrStatus(status.dahuaQrStatus);

      if (status.verified) {
        setVerificationStatus('verified');
        setEmailPending(false);
        setPdfUrl(status.pdfUrl || '');
        setPdfBase64(status.pdfBase64 || '');
        setPdfFileName(status.pdfFileName || `RestBlu-${reservation.id}.pdf`);
      } else if (showProgress) {
        const sentAt = statusText(status.verificationEmailSentAt) || verificationEmailSentAt;
        const sendError = statusText(status.verificationEmailError) || verificationEmailError;
        setStatusNotice(
          sentAt
            ? `La reserva ${reservation.id} todavía está pendiente. Abre el correo de esta reserva y pulsa su enlace de verificación.`
            : sendError
              ? 'La reserva está sincronizada, pero el correo continúa pendiente. El gestor puede reintentar el envío.'
              : 'La reserva está sincronizada, pero el correo de verificación todavía no se ha enviado.',
        );
      }
    } catch (error) {
      if (showProgress || reservation.cloud) {
        setVerificationError(
          error instanceof Error ? error.message : 'No se pudo consultar la verificación.',
        );
        setStatusNotice('');
      }
    } finally {
      if (showProgress) setChecking(false);
    }
  }

  useEffect(() => {
    if (verified) return;
    const timer = window.setInterval(() => {
      void checkVerification(false);
    }, reservation.cloud ? 30_000 : 5_000);
    return () => window.clearInterval(timer);
  }, [reservation.cloud, reservation.id, verified]);

  // Con la reserva confirmada, pedir un QR de acceso nuevo antes de que venza
  // (el lector lo acepta 10 minutos; el gestor lo renueva cada 4 en la nube).
  useEffect(() => {
    if (!verified) return;
    void checkVerification(false);
    const timer = window.setInterval(() => {
      void checkVerification(false);
    }, reservation.cloud ? 60_000 : 120_000);
    return () => window.clearInterval(timer);
  }, [reservation.cloud, reservation.id, verified]);

  return (
    <dialog
      open
      aria-labelledby="receipt-title"
      className="reservation-overlay fixed inset-0 z-50 m-0 h-full max-h-none w-full max-w-none overflow-y-auto bg-[#082b38]/70 p-4 backdrop-blur-sm sm:p-8"
    >
      <article
        id="reservation-receipt"
        className="reservation-document mx-auto w-full max-w-4xl overflow-hidden rounded-3xl bg-white text-[#173f4b] shadow-2xl"
      >
        <header className="relative overflow-hidden bg-[#103d50] px-6 py-6 text-white sm:px-9">
          <div className="absolute -right-14 -top-20 size-56 rounded-full bg-[#0b8e92]/35" />
          <div className="relative flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="grid size-11 place-items-center rounded-2xl bg-[#55d8cb] text-2xl font-bold text-[#073b45]">
                ⌁
              </div>
              <div>
                <p className="text-2xl font-bold tracking-tight">
                  Rest<span className="text-[#55d8cb]">Blu</span>
                </p>
                <p className="text-[10px] font-bold tracking-[.18em] text-[#b8d9dc]">
                  ESTADÍAS INTELIGENTES
                </p>
              </div>
            </div>
            <button
              type="button"
              aria-label="Cerrar comprobante"
              onClick={onClose}
              className="no-print rounded-xl bg-white/10 p-2 hover:bg-white/20"
            >
              <X size={20} />
            </button>
          </div>
          <div className="relative mt-7 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[.16em] text-[#70e1d5]">
                COMPROBANTE Y PASE DIGITAL
              </p>
              <h2 id="receipt-title" className="mt-1 text-3xl font-bold">
                {receiptTitle}
              </h2>
            </div>
            <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${verified ? 'bg-[#dcf7ee] text-[#087759]' : statusError ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>
              {statusBadge}
            </span>
          </div>
        </header>

        <div className="grid gap-7 p-6 sm:p-9 lg:grid-cols-[1fr_280px]">
          <div>
            <div className={`flex items-center gap-3 rounded-2xl p-4 ${verified ? 'bg-[#eaf6f4]' : statusError ? 'bg-red-50' : 'bg-amber-50'}`}>
              {verified ? (
                <CheckCircle2 className="size-8 shrink-0 text-[#0a8f68]" />
              ) : statusError ? (
                <CircleAlert className="size-8 shrink-0 text-red-700" />
              ) : (
                <Mail className="size-8 shrink-0 text-amber-700" />
              )}
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[#66818a]">
                  {summaryLabel}
                </p>
                <p className={`mt-1 font-bold ${verified ? 'font-mono text-xl text-[#0b6871]' : statusError ? 'text-base text-red-900' : 'text-base text-amber-900'}`}>
                  {verificationEmailSent && !verified ? reservation.email : reservation.id}
                </p>
                {summaryDetail && (
                  <p className="mt-1 text-xs text-[#66818a]">
                    {summaryDetail}
                  </p>
                )}
              </div>
            </div>

            {!verified && <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <ReservationProgressStep
                label="Reserva guardada"
                detail={reservation.cloud ? 'Guardada en línea' : 'Guardada en el gestor'}
                state="done"
              />
              <ReservationProgressStep
                label="Sincronización"
                detail={statusError ? 'No pudo completarse' : synced ? 'Gestor actualizado' : 'Esperando al gestor'}
                state={statusError ? 'error' : synced ? 'done' : 'pending'}
              />
              <ReservationProgressStep
                label="Correo de verificación"
                detail={verificationEmailSent
                  ? 'Envío confirmado'
                  : verificationEmailError
                    ? 'Pendiente · reintentable'
                    : verified
                      ? 'Envío no registrado'
                      : verificationEmailPending
                        ? 'Pendiente de envío'
                        : 'Sin registro de envío'}
                state={verificationEmailSent ? 'done' : verificationEmailError ? 'retry' : 'pending'}
              />
            </div>}

            <ReceiptSection title="Alojamiento">
              <ReceiptRow label="Propiedad" value={reservation.property.name} />
              <ReceiptRow
                label="Ubicación"
                value={reservation.property.place}
              />
              <ReceiptRow
                label="Check-in"
                value={`${formatDate(reservation.checkIn)} · desde las 15:00`}
              />
              <ReceiptRow
                label="Check-out"
                value={`${formatDate(reservation.checkOut)} · hasta las 11:00`}
              />
              <ReceiptRow
                label="Estadía"
                value={`${reservation.nights} ${reservation.nights === 1 ? 'noche' : 'noches'} · ${reservation.guests} ${reservation.guests === 1 ? 'huésped' : 'huéspedes'}`}
              />
            </ReceiptSection>

            <ReceiptSection title="Huésped principal">
              <ReceiptRow label="Nombre" value={reservation.guestName} />
              <ReceiptRow label="Documento" value={reservation.documentId} />
              <ReceiptRow label="Correo" value={reservation.email} />
              <ReceiptRow label="Teléfono" value={reservation.phone} />
            </ReceiptSection>

            <ReceiptSection title="Resumen del valor">
              <ReceiptRow
                label="Tarifa por noche"
                value={formatCurrency(reservation.nightlyPrice)}
              />
              <ReceiptRow
                label="Total referencial"
                value={formatCurrency(reservation.total)}
                strong
              />
              <ReceiptRow label="Pago" value={paymentStatus === 'aprobado-demo'
                ? 'Aprobado en Webpay'
                : statusError ? 'No aprobado' : 'Pendiente de pago en Webpay'} />
            </ReceiptSection>
          </div>

          <aside className="h-fit rounded-3xl border border-[#cfe2df] bg-[#f6faf9] p-5 text-center">
            <p className="text-xs font-bold uppercase tracking-[.14em] text-[#07888d]">
              PASE DE ACCESO
            </p>
            {verified ? (
              <>
                {!qrError ? (
                  <img
                    src={qrUrl}
                    alt={`Código QR de la reserva ${reservation.id}`}
                    onError={() => setQrError(true)}
                    className="mx-auto mt-3 aspect-square w-full max-w-[230px] rounded-xl bg-white p-2"
                  />
                ) : (
                  <div className="mx-auto mt-4 grid aspect-square max-w-[230px] place-items-center rounded-xl border border-dashed border-[#bdcfcc] bg-white p-5 text-sm text-[#6b848c]">
                    No fue posible cargar el QR en pantalla. El PDF igualmente lo incluye.
                  </div>
                )}
                <p className="mt-3 text-xs leading-5 text-[#66818a]">
                  {accessQrFresh
                    ? 'Muestra este QR en el lector de acceso. Se renueva solo cada pocos minutos y funciona durante tu estadía.'
                    : dahuaQrStatus === 'activo'
                      ? 'Actualizando el QR de acceso… Este código muestra solo los datos de la reserva.'
                      : 'Tu acceso se está habilitando en el terminal. Este código muestra solo los datos de la reserva.'}
                </p>
                <div className="mt-4 rounded-2xl bg-[#103d50] px-4 py-4 text-white">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#9edbd5]">
                    PIN TEMPORAL
                  </p>
                  <p className="mt-1 font-mono text-3xl font-bold tracking-[.2em]">
                    {reservation.accessPin}
                  </p>
                  {reservation.dahuaUserId && (
                    <p className="mt-3 break-all text-[11px] text-[#c3e7e3]">ID Dahua: <span className="font-mono font-bold">{reservation.dahuaUserId}</span></p>
                  )}
                </div>
                <p className="mt-3 text-xs leading-5 text-[#66818a]">
                  En el terminal, elige acceso por contraseña e introduce el ID Dahua y el PIN cuando tu acceso esté activado.
                  Para usar la huella directamente en Dahua, regístrala presencialmente con su lector. La apertura con biometría del teléfono está disponible sólo en la app Android.
                </p>
                <p className="mt-4 text-[11px] leading-5 text-[#789098]">
                  Emitido el {reservation.createdAt}. Válido durante tu estadía.
                </p>
              </>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-amber-300 bg-amber-50 px-5 py-10">
                <Mail className="mx-auto size-12 text-amber-700" />
                <p className="mt-4 font-bold text-amber-900">Pase bloqueado</p>
                <p className="mt-2 text-xs leading-5 text-amber-800">
                  El QR, el PIN y el PDF se habilitan al verificar esta reserva.
                </p>
              </div>
            )}
          </aside>
        </div>

        <footer className="border-t border-[#dce9e7] bg-[#f3f8f7] px-6 py-5 sm:px-9">
          <div className="no-print flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-xs text-[#66818a]">
              <FileText className="size-4 text-[#0b8e92]" />
              {verified
                ? confirmationEmailSent
                  ? 'El comprobante PDF también fue enviado al correo verificado.'
                  : confirmationEmailError
                    ? 'El PDF está listo; el correo de confirmación quedó pendiente y puede reintentarse.'
                    : 'El PDF está listo; el envío del correo de confirmación aún no está confirmado.'
                : statusError
                  ? 'La reserva sigue guardada, pero requiere corregir el error de sincronización.'
                  : verificationEmailSent
                    ? 'Cada reserva requiere abrir su propio enlace de verificación.'
                    : synced
                      ? 'La reserva está sincronizada; el correo de verificación sigue pendiente.'
                      : 'La reserva permanecerá segura en la nube hasta que el gestor sincronice.'}
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-[#cbdedb] px-4 py-2.5 text-sm font-bold text-[#496b74]"
              >
                Cerrar
              </button>
              {verified ? (
                <>
                  <button
                    type="button"
                    disabled={biometricStatus === 'activa' &&
                      !['sin-registrar', 'pendiente-configuracion'].includes(dahuaStatus)}
                    onClick={() => setBiometricOpen(true)}
                    className="flex items-center justify-center gap-2 rounded-xl border border-[#8fc8c1] px-4 py-2.5 text-sm font-bold text-[#0b6871] disabled:cursor-default disabled:bg-[#dff7ed] disabled:text-[#08735f]"
                  >
                    <ScanFace size={17} /> {biometricStatus === 'activa'
                      ? dahuaStatus === 'verificado' ? 'Acceso facial verificado'
                        : ['sin-registrar', 'pendiente-configuracion'].includes(dahuaStatus)
                          ? 'Completar acceso Dahua' : 'Biometría registrada'
                      : 'Registrar rostro en Dahua'}
                  </button>
                  <button
                    type="button"
                    onClick={downloadPdf}
                    className="flex items-center justify-center gap-2 rounded-xl bg-[#0b6871] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#07565d]"
                  >
                    <Download size={17} /> Descargar PDF
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={checking}
                  onClick={() => void checkVerification(true)}
                  className="flex items-center justify-center gap-2 rounded-xl bg-[#0b6871] px-4 py-2.5 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60"
                >
                  <Mail size={17} /> {checking ? 'Actualizando…' : 'Actualizar estado'}
                </button>
              )}
            </div>
          </div>
          {statusNotice && (
            <p className="no-print mt-3 text-right text-xs font-semibold text-amber-700">
              {statusNotice}
            </p>
          )}
          {verificationError && (
            <p role="alert" className="no-print mt-3 text-right text-xs font-semibold text-red-600">
              {verificationError}
            </p>
          )}
          {biometricNotice && (
            <p className="no-print mt-3 text-right text-xs font-semibold text-[#087759]">
              {biometricNotice}
            </p>
          )}
          <p className="print-only hidden text-center text-[10px] text-[#718b93]">
            RestBlu · Comprobante de reserva · El QR de acceso es personal y
            válido solo durante la estadía.
          </p>
        </footer>
      </article>
      {biometricOpen && (
        <BiometricEnrollment
          reservation={reservation}
          onClose={() => setBiometricOpen(false)}
          onEnrolled={(result) => {
            setBiometricStatus(result.status || 'activa');
            setDahuaStatus(result.dahuaStatus || 'sin-registrar');
            setBiometricNotice(
              result.dahuaStatus === 'verificado'
                ? 'El Dahua confirmó el rostro; el acceso sólo estará vigente durante la reserva.'
                : result.dahuaStatus === 'registrado-sin-verificar'
                  ? 'El Dahua aceptó el rostro, pero aún no pudo confirmarse su lectura.'
                  : result.dahuaStatus === 'error'
                    ? 'Falló el alta en Dahua. Aún no hay acceso; revisa el gestor.'
                  : 'El registro en Dahua está pendiente; aún no hay acceso confirmado.',
            );
            setBiometricOpen(false);
          }}
        />
      )}
    </dialog>
  );
}

function ReservationProgressStep({
  label,
  detail,
  state,
}: {
  label: string;
  detail: string;
  state: 'done' | 'pending' | 'retry' | 'error';
}) {
  const colors = {
    done: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    pending: 'border-amber-200 bg-amber-50 text-amber-900',
    retry: 'border-orange-200 bg-orange-50 text-orange-900',
    error: 'border-red-200 bg-red-50 text-red-900',
  };
  const indicators = {
    done: '✓',
    pending: '…',
    retry: '↻',
    error: '!',
  };

  return (
    <div className={`rounded-xl border p-3 text-sm ${colors[state]}`}>
      <div className="flex items-center gap-2 font-bold">
        <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center rounded-full bg-white/80 text-xs">
          {indicators[state]}
        </span>
        <span>{label}</span>
      </div>
      <p className="mt-1 text-xs leading-5 opacity-80">{detail}</p>
    </div>
  );
}

function ReceiptSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6">
      <h3 className="border-b border-[#dce9e7] pb-2 text-sm font-bold uppercase tracking-[.12em] text-[#0b7d82]">
        {title}
      </h3>
      <dl className="mt-2 divide-y divide-[#e7efee]">{children}</dl>
    </section>
  );
}

function ReceiptRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-4 py-2.5 text-sm">
      <dt className="text-[#718b93]">{label}</dt>
      <dd
        className={`text-right ${strong ? 'font-bold text-[#0b6871]' : 'font-semibold'}`}
      >
        {value}
      </dd>
    </div>
  );
}

function Info({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div>
      <div className="text-[#0b8e92]">{icon}</div>
      <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-[#78919a]">
        {label}
      </p>
      <p className="mt-1 text-sm font-bold">{value}</p>
    </div>
  );
}
function Footer({ go }: { go: (screen: Screen) => void }) {
  return (
    <footer className="mt-10 bg-[#092f3e] text-white">
      <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 sm:grid-cols-2 lg:grid-cols-4 lg:px-8">
        <div>
          <p className="text-xl font-bold">
            Rest<span className="text-[#54d9ce]">Blu</span>
          </p>
          <p className="mt-3 max-w-xs text-sm leading-6 text-[#a9c4c9]">
            Estadías que se disfrutan desde la reserva hasta el último acceso.
          </p>
        </div>
        <FooterLinks
          title="Explorar"
          items={[
            ['Alojamientos', 'catalogo'],
            ['Destinos', 'destinos'],
            ['Experiencias', 'experiencias'],
            ['Mis reservas', 'consulta'],
          ]}
          go={go}
        />
        <FooterLinks
          title="Propietarios"
          items={[
            ['Cómo funciona', 'propietarios'],
            ['Administración local', 'propietarios'],
            ['Centro de ayuda', 'soporte'],
          ]}
          go={go}
        />
        <div>
          <p className="text-sm font-bold">Soporte RestBlu</p>
          <p className="mt-3 text-sm leading-6 text-[#a9c4c9]">
            Encuentra respuestas en Ayuda o conversa con Blu sobre el catálogo y tu reserva.
          </p>
          <button type="button" onClick={() => go('soporte')} className="mt-3 min-h-11 text-sm font-semibold text-[#a9d9e9] hover:text-white">Ir al centro de ayuda <ArrowRight aria-hidden="true" className="ml-1 inline size-4" /></button>
        </div>
      </div>
      <div className="border-t border-white/10 py-4 text-center text-xs text-[#8eabb1]">
        © 2026 RestBlu · Plataforma de arriendos y accesos inteligentes
      </div>
    </footer>
  );
}
function FooterLinks({
  title,
  items,
  go,
}: {
  title: string;
  items: [string, Screen][];
  go: (screen: Screen) => void;
}) {
  return (
    <div>
      <p className="text-sm font-bold">{title}</p>
      <div className="mt-3 space-y-2">
        {items.map(([label, screen]) => (
          <button
            key={label}
            onClick={() => go(screen)}
            className="block text-sm text-[#a9c4c9] hover:text-white"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
