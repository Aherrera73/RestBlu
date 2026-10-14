import { createPublicKey, verify } from 'node:crypto';

export function phoneAccessPayload({ ownerUid, reservationId, requestId, signedAt }) {
  return `RESTBLU_PHONE_ACCESS_V1\n${ownerUid}\n${reservationId}\n${requestId}\n${signedAt}`;
}

export function verifyPhoneAccessSignature({ ownerUid, reservationId, requestId, signedAt, publicKey, signature }) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(ownerUid) ||
      !/^(LS|RB)-[A-Z0-9-]{10,50}$/.test(reservationId) ||
      !/^[a-f0-9-]{36}$/.test(requestId) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(signedAt) ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(publicKey) || publicKey.length > 1000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(signature) || signature.length > 500) return false;
  try {
    const key = createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') return false;
    return verify('sha256', Buffer.from(phoneAccessPayload({ ownerUid, reservationId, requestId, signedAt })),
      key, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}

export function phoneAccessWithinStay(reservation, now = new Date()) {
  const start = Date.parse(`${reservation.checkIn}T${reservation.checkInTime || '15:00'}:00`);
  const end = Date.parse(`${reservation.checkOut}T${reservation.checkOutTime || '11:00'}:00`);
  return Number.isFinite(start) && Number.isFinite(end) && start < end &&
    now.getTime() >= start && now.getTime() < end;
}
