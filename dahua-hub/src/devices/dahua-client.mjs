import { IAccessDeviceClient, validateAccessUser } from './access-device-client.mjs';

// Cliente del terminal Dahua real. Habla con el equipo por el canal que abrió
// con Auto Register (DeviceChannel: login con token y CGI normales), así que
// funciona aunque el terminal esté en otra red. Usa las mismas CGI que el
// gestor RestBlu en la red local (AccessUser, AccessCard, accessControl).

export class DahuaDeviceError extends Error {
  constructor(message, { code = 'DEVICE_ERROR', response = '' } = {}) {
    super(message);
    this.code = code;
    this.deviceResponse = response;
  }
}

export function parseKeyValue(text) {
  const result = {};
  for (const line of String(text).split(/\r?\n/)) {
    const index = line.indexOf('=');
    if (index > 0) result[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return result;
}

function isOk(text) {
  return /^\s*OK\s*$/i.test(text) || /(?:^|\n)result\s*=\s*(?:true|ok|1)(?:\r?\n|$)/i.test(text);
}

function deviceMessage(text) {
  const trimmed = String(text || '').trim();
  return trimmed.match(/(?:Error|error|message|detail)\s*[=:]\s*([^\r\n]+)/)?.[1]?.trim() || trimmed.slice(0, 300) || 'respuesta vacía';
}

// "2026-10-10T18:00:00Z" -> "2026-10-10 15:00:00" en la zona del terminal.
export function deviceDateTime(iso, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export class DahuaClient extends IAccessDeviceClient {
  constructor({ registrationId, session, timeZone = 'America/Santiago', door = 1 }) {
    super({ registrationId });
    this.session = session;
    this.timeZone = timeZone;
    this.door = door;
  }

  async #cgi(options) {
    const channel = this.session?.channel;
    if (!channel || this.session.socket.destroyed) {
      throw new DahuaDeviceError(`El terminal ${this.registrationId} no está conectado.`, { code: 'DISCONNECTED' });
    }
    const response = await channel.cgi(options);
    if (response.status !== 200) {
      throw new DahuaDeviceError(`El terminal respondió HTTP ${response.status} a ${options.path}.`, {
        code: 'DEVICE_HTTP_ERROR', response: response.text,
      });
    }
    return response.text;
  }

  async ping() {
    const started = Date.now();
    const time = parseKeyValue(await this.#cgi({ path: '/cgi-bin/global.cgi', params: { action: 'getCurrentTime' } }));
    return { ok: true, latencyMs: Date.now() - started, deviceTime: time.result || '' };
  }

  async getDeviceInfo() {
    const system = parseKeyValue(await this.#cgi({ path: '/cgi-bin/magicBox.cgi', params: { action: 'getSystemInfo' } }));
    const version = parseKeyValue(await this.#cgi({ path: '/cgi-bin/magicBox.cgi', params: { action: 'getSoftwareVersion' } }));
    return {
      model: system.deviceType || system.updateSerial || '',
      serialNumber: system.serialNumber || '',
      firmware: version.version || '',
      raw: { ...system, ...version },
    };
  }

  async #userExists(userId) {
    const text = await this.#cgi({ path: '/cgi-bin/AccessUser.cgi', params: { action: 'startFind', 'Condition.UserID': userId } });
    let payload;
    try { payload = JSON.parse(text); } catch { payload = parseKeyValue(text); }
    const token = payload.Token ?? payload.token;
    if (token !== undefined) {
      await this.#cgi({ path: '/cgi-bin/AccessUser.cgi', params: { action: 'stopFind', Token: token } }).catch(() => {});
    }
    return Number(payload.Total ?? payload.total ?? 0) > 0;
  }

  // Crea o actualiza la persona con su vigencia y PIN; si trae cardNo (el
  // contenido del QR de la reserva), también le asigna esa tarjeta.
  async upsertAccessUser(user) {
    validateAccessUser(user);
    const exists = await this.#userExists(user.userId);
    const item = {
      UserID: user.userId,
      UserName: String(user.name).slice(0, 31),
      UserType: 0,
      UserStatus: 0,
      Authority: 2,
      Doors: [this.door - 1],
      TimeSections: [255],
      ValidFrom: deviceDateTime(user.validFrom, this.timeZone),
      ValidTo: deviceDateTime(user.validTo, this.timeZone),
      ...(user.pin ? { Password: String(user.pin) } : {}),
    };
    const action = exists ? 'updateMulti' : 'insertMulti';
    const text = await this.#cgi({ method: 'POST', path: '/cgi-bin/AccessUser.cgi', params: { action }, json: { UserList: [item] } });
    if (!isOk(text)) {
      throw new DahuaDeviceError(`El terminal no aceptó al usuario ${user.userId}: ${deviceMessage(text)}`, { code: 'USER_UPSERT_FAILED', response: text });
    }
    if (user.cardNo) {
      const json = { CardList: [{ UserID: user.userId, CardNo: String(user.cardNo), CardType: 0, CardStatus: 0 }] };
      let card = await this.#cgi({ method: 'POST', path: '/cgi-bin/AccessCard.cgi', params: { action: 'insertMulti' }, json });
      // Si la tarjeta ya existía (reserva modificada), se actualiza.
      if (!isOk(card)) card = await this.#cgi({ method: 'POST', path: '/cgi-bin/AccessCard.cgi', params: { action: 'updateMulti' }, json });
      if (!isOk(card)) {
        throw new DahuaDeviceError(`El terminal no aceptó la tarjeta/QR de ${user.userId}: ${deviceMessage(card)}`, { code: 'CARD_UPSERT_FAILED', response: card });
      }
    }
    return { userId: user.userId, action: exists ? 'updated' : 'created', validFrom: item.ValidFrom, validTo: item.ValidTo };
  }

  // Quita a la persona (y con ella sus tarjetas y rostro).
  async removeAccessUser(userId) {
    if (!(await this.#userExists(userId))) return { removed: false };
    const text = await this.#cgi({ path: '/cgi-bin/AccessUser.cgi', params: { action: 'removeMulti', 'UserIDList[0]': userId } });
    if (!isOk(text)) {
      throw new DahuaDeviceError(`No fue posible eliminar a ${userId}: ${deviceMessage(text)}`, { code: 'USER_REMOVE_FAILED', response: text });
    }
    return { removed: true };
  }

  async openDoor({ channel = this.door } = {}) {
    const text = await this.#cgi({ path: '/cgi-bin/accessControl.cgi', params: { action: 'openDoor', channel, Type: 'Remote' } });
    if (!isOk(text)) {
      throw new DahuaDeviceError(`El terminal no abrió la puerta: ${deviceMessage(text)}`, { code: 'OPEN_DOOR_FAILED', response: text });
    }
    return { opened: true };
  }
}
