// Contrato IAccessDeviceClient: lo que el hub necesita de un terminal de
// acceso, sin importar la marca ni cómo se conecta. JavaScript no tiene
// interfaces; esta clase base documenta los métodos y falla si una
// implementación olvida alguno.
//
//   ping()                       -> { ok: true, latencyMs }
//   getDeviceInfo()              -> { model, serialNumber, firmware }
//   upsertAccessUser(user)       -> { userId }
//       user = { userId, name, pin, cardNo, validFrom, validTo }  (fechas ISO 8601;
//       cardNo es el número de tarjeta / contenido del QR, opcional)
//   removeAccessUser(userId)     -> { removed: boolean }
//   openDoor({ channel })        -> { opened: true }

export const ACCESS_DEVICE_METHODS = ['ping', 'getDeviceInfo', 'upsertAccessUser', 'removeAccessUser', 'openDoor'];

export class NotImplementedError extends Error {
  constructor(message) {
    super(message);
    this.code = 'NOT_IMPLEMENTED';
  }
}

export class IAccessDeviceClient {
  constructor({ registrationId }) {
    if (new.target === IAccessDeviceClient) throw new TypeError('IAccessDeviceClient es abstracta.');
    this.registrationId = registrationId;
  }

  async ping() { throw new NotImplementedError(`${this.constructor.name}.ping no está implementado.`); }
  async getDeviceInfo() { throw new NotImplementedError(`${this.constructor.name}.getDeviceInfo no está implementado.`); }
  async upsertAccessUser() { throw new NotImplementedError(`${this.constructor.name}.upsertAccessUser no está implementado.`); }
  async removeAccessUser() { throw new NotImplementedError(`${this.constructor.name}.removeAccessUser no está implementado.`); }
  async openDoor() { throw new NotImplementedError(`${this.constructor.name}.openDoor no está implementado.`); }
}

// Valida los datos de un usuario de acceso antes de mandarlo a cualquier terminal.
export function validateAccessUser(user) {
  if (!user || typeof user !== 'object') throw new Error('Faltan los datos del usuario de acceso.');
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(String(user.userId || ''))) throw new Error('userId inválido (1 a 32 letras, números, _ o -).');
  if (!String(user.name || '').trim()) throw new Error('Falta el nombre del usuario de acceso.');
  if (user.pin !== undefined && user.pin !== null && !/^\d{4,8}$/.test(String(user.pin))) throw new Error('El PIN debe tener entre 4 y 8 dígitos.');
  if (user.cardNo !== undefined && user.cardNo !== null && !/^[A-Za-z0-9]{1,32}$/.test(String(user.cardNo))) throw new Error('cardNo inválido (1 a 32 letras o números).');
  const from = Date.parse(user.validFrom);
  const to = Date.parse(user.validTo);
  if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error('validFrom y validTo deben ser fechas ISO 8601.');
  if (to <= from) throw new Error('validTo debe ser posterior a validFrom.');
}
