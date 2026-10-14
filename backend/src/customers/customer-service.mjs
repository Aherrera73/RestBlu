import { text } from '../shared/normalizers.mjs';

export function customerFromInput(input, existing = {}) {
  const name = text(input.name || input.guestName, 120);
  const documentId = text(input.documentId, 60);
  const email = text(input.email, 160).toLowerCase();
  const phone = text(input.phone, 60);
  if (!name || (!documentId && !email)) {
    throw new Error('El cliente necesita nombre y al menos documento o correo.');
  }
  return {
    ...existing,
    name,
    documentId,
    email,
    phone,
    emailVerified: input.emailVerified ?? existing.emailVerified ?? false,
    nationality: text(input.nationality ?? existing.nationality, 80) || 'Chile',
    birthDate: text(input.birthDate ?? existing.birthDate, 20),
    emergencyContactName: text(input.emergencyContactName ?? existing.emergencyContactName, 120),
    emergencyContactPhone: text(input.emergencyContactPhone ?? existing.emergencyContactPhone, 60),
    notes: text(input.notes ?? existing.notes, 1000),
    status: input.status === 'inactivo' ? 'inactivo' : 'activo',
    updatedAt: new Date().toISOString(),
  };
}
