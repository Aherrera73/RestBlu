'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Camera, CheckCircle2, ScanFace, ShieldCheck } from 'lucide-react';
import { LOCAL_DATA_API } from '../config';
import { enrollCloudBiometrics } from '../services/cloudBridge';
import { usesLocalManager } from '../services/firebase';
import type { Reservation } from '../domain/types';
import { formatRut, isValidRut } from '../domain/reservation';

type EnrollmentResult = {
  status?: string;
  enrolledAt?: string;
  expiresAt?: string;
  dahuaStatus?: string;
  dahuaError?: string | null;
  error?: string;
};

export default function BiometricEnrollment({
  reservation,
  onClose,
  onEnrolled,
}: {
  reservation: Reservation;
  onClose: () => void;
  onEnrolled: (result: EnrollmentResult) => void;
}) {
  const screenRef = useRef<HTMLDialogElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [documentId, setDocumentId] = useState(reservation.documentId);
  const [consent, setConsent] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [capture, setCapture] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousBodyOverflow = document.body.style.overflow;
    const previousPageOverflow = document.documentElement.style.overflow;
    const receipt = document.getElementById('reservation-receipt')?.closest('dialog');
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    screenRef.current?.scrollTo({ top: 0 });
    screenRef.current?.focus({ preventScroll: true });
    if (receipt) receipt.inert = true;
    return () => {
      if (receipt) receipt.inert = false;
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousPageOverflow;
      previousFocus?.focus({ preventScroll: true });
    };
  }, []);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  useEffect(() => {
    let cancelled = false;
    async function startCamera() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Este navegador no permite usar la cámara en este contexto.');
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setCameraReady(true);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'No fue posible abrir la cámara.');
      }
    }
    void startCamera();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, []);

  function captureFace() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
      setError('La cámara todavía no está lista.');
      return;
    }
    // El Dahua probado recibe un JPEG cuadrado de 500 px y menos de 100 KB.
    const crop = Math.min(video.videoWidth, video.videoHeight);
    canvas.width = 500;
    canvas.height = 500;
    canvas.getContext('2d', { alpha: false })?.drawImage(
      video,
      (video.videoWidth - crop) / 2,
      (video.videoHeight - crop) / 2,
      crop,
      crop,
      0, 0, 500, 500,
    );
    let quality = 0.9;
    let jpeg = canvas.toDataURL('image/jpeg', quality);
    while (Math.floor((jpeg.length - 'data:image/jpeg;base64,'.length) * 0.75) > 98_000 && quality > 0.5) {
      quality -= 0.08;
      jpeg = canvas.toDataURL('image/jpeg', quality);
    }
    if (Math.floor((jpeg.length - 'data:image/jpeg;base64,'.length) * 0.75) > 200_000) {
      setError('La captura sigue siendo muy pesada para el terminal. Repite la foto.');
      return;
    }
    setCapture(jpeg);
    setError('');
  }

  async function submitEnrollment(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedDocument = formatRut(documentId);
    if (!isValidRut(normalizedDocument)) {
      setError('Ingresa un RUT chileno válido.');
      return;
    }
    if (!capture) {
      setError('Captura tu rostro antes de continuar.');
      return;
    }
    if (!consent) {
      setError('Debes autorizar el uso de la plantilla facial para esta estadía.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      let result: EnrollmentResult;
      if (usesLocalManager()) {
        const response = await fetch(`${LOCAL_DATA_API}/biometrics/enroll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reservationId: reservation.id,
            documentId: normalizedDocument,
            consent: true,
            dahuaConsent: true,
            image: capture,
          }),
        });
        result = (await response.json()) as EnrollmentResult;
        if (!response.ok) throw new Error(result.error || 'No fue posible registrar la biometría.');
      } else {
        result = await enrollCloudBiometrics({
          reservationId: reservation.id,
          documentId: normalizedDocument,
          image: capture,
        });
      }
      setCapture('');
      stopCamera();
      onEnrolled(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible registrar la biometría.');
    } finally {
      setSubmitting(false);
    }
  }

  if (typeof document === 'undefined') return null;
  return createPortal(
    <dialog ref={screenRef} open tabIndex={-1} aria-modal="true" aria-labelledby="biometric-enrollment-title" className="fixed inset-0 z-[100] m-0 h-full max-h-none w-full max-w-none overflow-y-auto border-0 bg-[#f5f8f7] p-0 outline-none">
      <form onSubmit={submitEnrollment} className="mx-auto flex min-h-full w-full max-w-2xl flex-col bg-white text-[#173f4b] shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 bg-[#103d50] px-6 py-5 text-white">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.16em] text-[#70e1d5]">ACCESO BIOMÉTRICO</p>
            <h2 id="biometric-enrollment-title" className="mt-1 text-2xl font-bold">Registrar mi rostro</h2>
          </div>
          <button type="button" aria-label="Volver a la reserva" onClick={onClose} className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/20"><ArrowLeft size={20} /> Volver</button>
        </header>

        <div className="flex-1 p-6">
          <div className="flex gap-3 rounded-2xl bg-[#eaf6f4] p-4 text-sm leading-6 text-[#315d66]">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-[#07888d]" />
            <p>RestBlu cifra la captura en este dispositivo. Si usas el sitio publicado, Firebase la conserva temporalmente hasta que el gestor encendido la procese y la elimine. El gestor envía la foto al Dahua, que registra el rostro para el acceso durante la reserva. RestBlu no crea una plantilla facial paralela para esta alta.</p>
          </div>

          <div className="relative mx-auto mt-5 aspect-[4/3] w-full max-w-lg overflow-hidden rounded-2xl bg-[#0b2e3d]">
            <video ref={videoRef} autoPlay playsInline muted className={`size-full object-cover [transform:scaleX(-1)] ${capture ? 'invisible' : ''}`} />
            <canvas ref={canvasRef} aria-label="Captura facial pendiente de confirmación" className={capture ? 'absolute inset-0 size-full object-cover [transform:scaleX(-1)]' : 'hidden'} />
            <div aria-hidden="true" className="pointer-events-none absolute inset-y-[11%] left-[29%] right-[29%] rounded-[48%] border-[3px] border-[#55d8cb] shadow-[0_0_0_999px_rgba(7,31,43,.22)]" />
          </div>

          <div className="mt-4 flex justify-center">
            <button type="button" disabled={!cameraReady || submitting} onClick={() => capture ? setCapture('') : captureFace()} className="flex items-center gap-2 rounded-xl border border-[#bdd7d3] px-5 py-3 text-sm font-bold text-[#0b6871] disabled:opacity-50">
              {capture ? <Camera size={18} /> : <ScanFace size={18} />}
              {capture ? 'Repetir captura' : 'Capturar rostro'}
            </button>
          </div>

          <label className="mt-5 grid gap-2 text-sm font-bold text-[#365869]">
            RUT del huésped principal
            <input value={documentId} onChange={(event) => setDocumentId(formatRut(event.target.value))} inputMode="text" maxLength={12} className="rounded-xl border border-[#c9dcda] px-4 py-3 font-normal outline-none focus:border-[#0b8e92]" />
          </label>

          <label className="mt-4 flex items-start gap-3 rounded-2xl border border-[#d5e5e2] p-4 text-sm leading-6 text-[#496b74]">
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-1 size-4 accent-[#0b8e92]" />
            <span>Autorizo enviar mi fotografía facial al terminal Dahua para registrar y verificar mi acceso durante esta estadía. RestBlu eliminará la captura temporal y solicitará la revocación al terminar la reserva. Entiendo que el registro no incluye prueba de vida.</span>
          </label>

          {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}
        </div>

        <footer className="sticky bottom-0 z-10 flex flex-col-reverse gap-3 border-t border-[#dce9e7] bg-[#f3f8f7] px-6 py-4 shadow-[0_-8px_24px_rgba(7,31,43,.08)] sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="rounded-xl border border-[#cbdedb] px-5 py-3 text-sm font-bold text-[#496b74]">Volver a la reserva</button>
          <button type="submit" disabled={submitting || !capture || !consent} className="flex items-center justify-center gap-2 rounded-xl bg-[#0b6871] px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
            {submitting ? 'Enviando foto cifrada…' : <><CheckCircle2 size={18} /> Registrar rostro en Dahua</>}
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}
