import type { SearchCriteria } from './domain/types';

export const initialSearch: SearchCriteria = {
  destination: '',
  checkIn: '',
  checkOut: '',
  guests: 2,
};

export const LOCAL_DATA_API =
  process.env.NEXT_PUBLIC_RESTBLU_DATA_API?.trim() ||
  'http://127.0.0.1:3100/api';
export const FIREBASE_PROJECT_ID = 'lumastay-bab6a';
export const FIREBASE_API_KEY = 'AIzaSyADKsieNglFr6XRdWOOCJUwQURz5uc8gKI';
export const FIRESTORE_DOCUMENTS =
  `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
export const FIREBASE_SESSION_KEY = 'lumastay_firebase_session_v1';
// Servicio de pagos Webpay (Cloudflare Worker).
export const PAYMENTS_API =
  process.env.NEXT_PUBLIC_RESTBLU_PAYMENTS_API?.trim() ||
  'https://restblu-pagos.restblu.workers.dev';
