export type Screen =
  | 'inicio'
  | 'catalogo'
  | 'destinos'
  | 'soporte'
  | 'experiencias'
  | 'propietarios'
  | 'consulta'
  | 'cuenta';

export type Property = {
  id: number;
  name: string;
  place: string;
  type: string;
  guests: number;
  beds: number;
  baths: number;
  price: string;
  rating: string;
  image: string;
  gallery: [{ src: string; alt: string }, { src: string; alt: string }];
  tags: string[];
  unavailableRanges?: { checkIn: string; checkOut: string }[];
};

export type SearchCriteria = {
  destination: string;
  checkIn: string;
  checkOut: string;
  guests: number;
};

export type Reservation = {
  id: string;
  property: Property;
  guestName: string;
  email: string;
  phone: string;
  documentId: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  nights: number;
  nightlyPrice: number;
  total: number;
  paymentStatus?: string;
  accessPin: string;
  dahuaUserId?: string;
  createdAt: string;
  verificationStatus: 'pending' | 'verified';
  emailVerified?: boolean;
  pdfUrl?: string;
  pdfBase64?: string;
  pdfFileName?: string;
  cloud?: boolean;
  synced?: boolean;
  verificationEmailSentAt?: string;
  verificationEmailError?: string;
  emailPending?: boolean;
  confirmationEmailSentAt?: string;
  confirmationEmailError?: string;
  statusError?: string;
  biometricStatus?: string;
  biometricEnrolledAt?: string | null;
  biometricExpiresAt?: string | null;
  dahuaStatus?: string;
  dahuaError?: string | null;
  // Código QR de acceso que el gestor registró en el Dahua y su imagen PNG.
  accessQr?: string;
  accessQrImage?: string;
  accessQrExpiresAt?: string;
  dahuaQrStatus?: string;
};

export type ReservationProcessingStatus = {
  id?: string;
  status?: string;
  verified?: boolean;
  emailVerified?: boolean;
  paymentStatus?: string;
  paymentReference?: string | null;
  expiresAt?: string | null;
  expiredAt?: string | null;
  pdfUrl?: string | null;
  verificationEmailSentAt?: string | null;
  verificationEmailError?: string | null;
  emailPending?: boolean;
  confirmationEmailSentAt?: string | null;
  confirmationEmailError?: string | null;
  error?: string | null;
  syncError?: string | null;
  syncStatus?: string;
  syncedAt?: string | null;
  localUpdatedAt?: string | null;
  pdfBase64?: string;
  pdfFileName?: string;
  biometricStatus?: string;
  biometricEnrolledAt?: string | null;
  biometricExpiresAt?: string | null;
  dahuaStatus?: string;
  dahuaError?: string | null;
  // Código QR de acceso que el gestor registró en el Dahua y su imagen PNG.
  accessQr?: string;
  accessQrImage?: string;
  accessQrExpiresAt?: string;
  dahuaQrStatus?: string;
  dahuaUserId?: string;
  booking?: {
    id: string;
    propertyId: number;
    propertyName: string;
    propertyPlace: string;
    guestName: string;
    email: string;
    phone: string;
    documentId: string;
    checkIn: string;
    checkOut: string;
    guests: number;
    nights: number;
    nightlyPrice: number;
    total: number;
    createdAt: string;
    accessPin?: string;
  };
};

export type FirebaseSession = {
  idToken: string;
  refreshToken: string;
  uid: string;
  expiresAt: number;
};

// Cuenta RestBlu (correo y contraseña de Firebase). Una sesión anónima no
// tiene correo y no puede reservar.
export type CustomerAccount = {
  uid: string;
  email: string;
  emailVerified: boolean;
};

export type CustomerProfile = {
  name: string;
  documentId: string;
  phone: string;
  birthDate?: string;
  nationality?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  favorites?: number[];
};

export type ReservationVerificationNotice = {
  reservationId: string;
  status: 'working' | 'success' | 'error';
  message: string;
  localFallbackUrl?: string;
};

export type FirestoreValue = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  nullValue?: null;
  arrayValue?: { values?: FirestoreValue[] };
  mapValue?: { fields?: Record<string, FirestoreValue> };
};
