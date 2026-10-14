import { readFile } from "node:fs/promises";
import net from "node:net";
import { digestRequest } from "./digest-auth.mjs";

export class DahuaError extends Error {
  constructor(message, { code = "DAHUA_ERROR", status = 502, deviceResponse = "" } = {}) {
    super(message);
    this.name = "DahuaError";
    this.code = code;
    this.status = status;
    this.deviceResponse = deviceResponse;
  }
}

export function parseKeyValue(text) {
  const result = {};
  for (const line of String(text).split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index < 1) continue;
    result[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return result;
}

export function parseIndexedRecords(text) {
  const records = new Map();
  const meta = {};
  for (const [key, value] of Object.entries(parseKeyValue(text))) {
    const match = key.match(/^(?:records|items)\[(\d+)\]\.(.+)$/i);
    if (!match) {
      meta[key] = value;
      continue;
    }
    const index = Number(match[1]);
    if (!records.has(index)) records.set(index, {});
    records.get(index)[match[2]] = value;
  }
  return { meta, records: [...records.entries()].sort((a, b) => a[0] - b[0]).map(([, value]) => value) };
}

function isOk(body) {
  return /^\s*OK\s*$/i.test(body) || /(?:^|\n)result\s*=\s*(?:true|ok|1)(?:\r?\n|$)/i.test(body);
}

function deviceMessage(body) {
  const trimmed = String(body || "").trim();
  const known = trimmed.match(/(?:Error|error|message|detail)\s*[=:]\s*([^\r\n]+)/);
  return known?.[1]?.trim() || trimmed.slice(0, 300) || "Respuesta vacía";
}

function isDeviceError(body) {
  return /^\s*(?:ERROR|Error|Invalid|Forbidden|NotSupported)/i.test(String(body || ""));
}

function v2Date(value) {
  const match = String(value).match(/^(\d{4})(\d{2})(\d{2}) (\d{2})(\d{2})(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}` : value;
}

export class DahuaClient {
  // transport: alternativa a la conexión HTTP directa por la red local. Recibe
  // { path, params, method, json, timeoutMs } y devuelve { status, text }; el
  // hub Dahua lo usa para llegar al terminal por su conexión de Auto Register.
  constructor({ baseUrl, username, password, caCertPath = "", allowSelfSigned = false, transport = null }) {
    this.transport = transport;
    if (transport) return;
    this.baseUrl = new URL(baseUrl);
    if (!["http:", "https:"].includes(this.baseUrl.protocol) || this.baseUrl.username ||
        this.baseUrl.password || this.baseUrl.pathname !== "/" ||
        this.baseUrl.search || this.baseUrl.hash) {
      throw new Error("DAHUA_BASE_URL debe ser sólo la dirección base del terminal (http:// o https://).");
    }
    if (!isPrivateDeviceHost(this.baseUrl.hostname)) {
      throw new Error("Por seguridad, el terminal Dahua debe usar una IP privada de la red local o un nombre .local/.lan.");
    }
    if (!username || !password) {
      throw new Error("Configura el usuario y la contraseña CGI de Dahua.");
    }
    this.username = username;
    this.password = password;
    this.caCertPath = caCertPath;
    this.allowSelfSigned = Boolean(allowSelfSigned);
    this.caCertificate = null;
  }

  async certificateAuthority() {
    if (this.baseUrl.protocol !== "https:" || !this.caCertPath) return undefined;
    this.caCertificate ||= await readFile(this.caCertPath);
    return this.caCertificate;
  }

  buildUrl(path, params = {}) {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.append(key, String(value));
    }
    return url;
  }

  async request(path, { params, method = "GET", json, timeoutMs = 15000 } = {}) {
    if (this.transport) return this.requestThroughTransport(path, { params, method, json, timeoutMs });
    const url = this.buildUrl(path, params);
    const body = json === undefined ? null : JSON.stringify(json);
    let response;
    try {
      response = await digestRequest(url, {
        method,
        username: this.username,
        password: this.password,
        ca: await this.certificateAuthority(),
        allowSelfSigned: this.allowSelfSigned,
        timeoutMs,
        body,
        headers: json === undefined ? {} : { "Content-Type": "application/json" },
      });
    } catch (error) {
      const message = error.code === "ECONNREFUSED"
        ? "El terminal rechazó la conexión. Revisa IP, puerto y protocolo."
        : error.code === "EACCES"
          ? "El servidor local no tiene permiso para acceder a la red LAN. Reinicia la aplicación autorizando el acceso de red."
        : error.code === "EHOSTUNREACH"
          ? "No hay ruta de red hacia el terminal Dahua."
          : error.message;
      throw new DahuaError(message, { code: "DEVICE_UNREACHABLE", status: 502 });
    }

    const text = response.body.toString("utf8");
    if (response.status === 401 || response.status === 403) {
      throw new DahuaError("Usuario o contraseña incorrectos, o la cuenta no tiene permisos de administración.", {
        code: "DEVICE_AUTH_FAILED",
        status: 401,
      });
    }
    if (response.status < 200 || response.status >= 300) {
      throw new DahuaError(`El terminal respondió HTTP ${response.status}.`, {
        code: "DEVICE_HTTP_ERROR",
        status: 502,
        deviceResponse: deviceMessage(text),
      });
    }
    return { text, headers: response.headers, status: response.status };
  }

  async requestThroughTransport(path, { params, method, json, timeoutMs }) {
    let response;
    try {
      response = await this.transport({ path, params: params || {}, method, json, timeoutMs });
    } catch (error) {
      throw new DahuaError(error.message, { code: "DEVICE_UNREACHABLE", status: 502 });
    }
    const text = String(response.text ?? "");
    if (response.status === 401 || response.status === 403) {
      throw new DahuaError("El terminal rechazó la cuenta CGI configurada en el hub.", { code: "DEVICE_AUTH_FAILED", status: 401 });
    }
    if (response.status < 200 || response.status >= 300) {
      throw new DahuaError(`El terminal respondió HTTP ${response.status}.`, {
        code: "DEVICE_HTTP_ERROR", status: 502, deviceResponse: deviceMessage(text),
      });
    }
    return { text, headers: {}, status: response.status };
  }

  async getDeviceInfo() {
    const [system, version, time] = await Promise.allSettled([
      this.request("/cgi-bin/magicBox.cgi", { params: { action: "getSystemInfo" } }),
      this.request("/cgi-bin/magicBox.cgi", { params: { action: "getSoftwareVersion" } }),
      this.request("/cgi-bin/global.cgi", { params: { action: "getCurrentTime" } }),
    ]);
    if (system.status === "rejected" && version.status === "rejected") throw system.reason;
    const data = {};
    if (system.status === "fulfilled") Object.assign(data, parseKeyValue(system.value.text));
    if (version.status === "fulfilled") Object.assign(data, parseKeyValue(version.value.text));
    if (time.status === "fulfilled") Object.assign(data, parseKeyValue(time.value.text));
    return data;
  }

  async insertPerson({ userId, name, validFrom, validTo, door = 1, cardNo = "", pin = "" }) {
    try {
      const v2 = await this.request("/cgi-bin/AccessUser.cgi", {
        params: { action: "insertMulti" },
        method: "POST",
        json: {
          UserList: [{
            UserID: userId,
            UserName: name,
            UserType: 0,
            UserStatus: 0,
            Authority: 2,
            Doors: [door - 1],
            TimeSections: [255],
            ValidFrom: v2Date(validFrom),
            ValidTo: v2Date(validTo),
            ...(pin ? { Password: String(pin) } : {}),
          }],
        },
      });
      if (isOk(v2.text)) return { recNo: null, apiVersion: 2, raw: v2.text };
    } catch (error) {
      if (error.code === "DEVICE_AUTH_FAILED" || error.code === "DEVICE_UNREACHABLE") throw error;
    }

    const response = await this.request("/cgi-bin/recordUpdater.cgi", {
      params: {
        action: "insert",
        name: "AccessControlCard",
        CardName: name,
        UserID: userId,
        // En CGI V1 la persona es el propio registro de tarjeta: el QR del
        // huésped se lee como este número.
        CardNo: cardNo || undefined,
        CardStatus: 0,
        CardType: 0,
        "Doors[0]": door,
        "TimeSections[0]": 255,
        ValidDateStart: validFrom,
        ValidDateEnd: validTo,
        IsValid: "true",
      },
    });
    const parsed = parseKeyValue(response.text);
    const recNo = parsed.RecNo || parsed.recno || parsed.recNo;
    if (!recNo && !isOk(response.text)) {
      throw new DahuaError(`No fue posible crear a la persona: ${deviceMessage(response.text)}`, {
        code: "PERSON_INSERT_FAILED",
        status: 409,
        deviceResponse: deviceMessage(response.text),
      });
    }
    return { recNo: recNo || null, apiVersion: 1, raw: response.text };
  }

  // Clave con la que el lector descifra los QR (QRCodeDecode). Sólo se usa en
  // el gestor para generar los QR dinámicos; nunca se entrega a la web o la app.
  // Ajusta cuántos minutos acepta el lector un QR desde su emisión.
  async ensureQrValidTime(minutes) {
    const current = parseKeyValue((await this.request("/cgi-bin/configManager.cgi", {
      params: { action: "getConfig", name: "QRCode" },
    })).text)["table.QRCode.ValidTime"];
    if (String(current) === String(minutes)) return;
    const response = await this.request("/cgi-bin/configManager.cgi", {
      params: { action: "setConfig", "QRCode.ValidTime": minutes },
    });
    if (!isOk(response.text)) {
      throw new DahuaError(`El terminal no aceptó la vigencia del QR: ${deviceMessage(response.text)}`, {
        code: "QR_VALID_TIME_FAILED",
      });
    }
  }

  async getQrDecodeKey() {
    const response = await this.request("/cgi-bin/configManager.cgi", {
      params: { action: "getConfig", name: "QRCodeDecode" },
    });
    const config = parseKeyValue(response.text);
    const cipher = config["table.QRCodeDecode.cipher"];
    const key = config["table.QRCodeDecode.key"] || "";
    if (cipher !== "0" || key.length !== 32) {
      throw new DahuaError("El Dahua no tiene configurado el descifrado QR AES-256 esperado.", {
        code: "QR_KEY_UNAVAILABLE",
      });
    }
    return Buffer.from(key, "utf8");
  }

  async findPerson(userId) {
    const started = await this.request("/cgi-bin/AccessUser.cgi", {
      params: { action: "startFind", "Condition.UserID": userId },
    });
    let payload;
    try {
      payload = JSON.parse(started.text);
    } catch {
      payload = parseKeyValue(started.text);
    }
    const token = payload.Token ?? payload.token;
    if (token !== undefined) {
      await this.request("/cgi-bin/AccessUser.cgi", {
        params: { action: "stopFind", Token: token },
      }).catch(() => {});
    }
    return Number(payload.Total ?? payload.total ?? 0) > 0;
  }

  // Registro de aperturas y rechazos del terminal (AccessControlCardRec).
  // startTime/endTime son segundos Unix; CreateTime de cada registro también.
  async listAccessRecords({ startTime, endTime, count = 1000 }) {
    const response = await this.request("/cgi-bin/recordFinder.cgi", {
      params: { action: "find", name: "AccessControlCardRec", StartTime: startTime, EndTime: endTime, count },
      timeoutMs: 30000,
    });
    if (isDeviceError(response.text)) {
      throw new DahuaError(`El firmware no permitió leer el registro de accesos: ${deviceMessage(response.text)}`, {
        code: "ACCESS_RECORDS_FAILED",
        deviceResponse: deviceMessage(response.text),
      });
    }
    return parseIndexedRecords(response.text).records.map((record) => ({
      recNo: Number(record.RecNo),
      createTime: Number(record.CreateTime),
      type: record.Type || "",
      method: record.Method === undefined ? null : Number(record.Method),
      authorized: record.Status === "1",
      errorCode: record.ErrorCode === undefined ? null : Number(record.ErrorCode),
      userId: record.UserID || "",
      cardName: record.CardName || "",
    })).filter((record) => Number.isFinite(record.recNo) && Number.isFinite(record.createTime));
  }

  // Cambia la vigencia de una persona existente sin tocar su rostro ni su QR.
  async updatePersonValidity({ userId, name, validFrom, validTo, door = 1, pin = "" }) {
    const response = await this.request("/cgi-bin/AccessUser.cgi", {
      params: { action: "updateMulti" },
      method: "POST",
      json: {
        UserList: [{
          UserID: userId,
          UserName: name,
          UserType: 0,
          UserStatus: 0,
          Authority: 2,
          Doors: [door - 1],
          TimeSections: [255],
          ValidFrom: v2Date(validFrom),
          ValidTo: v2Date(validTo),
          ...(pin ? { Password: String(pin) } : {}),
        }],
      },
    });
    if (!isOk(response.text)) {
      throw new DahuaError(`No fue posible actualizar la vigencia: ${deviceMessage(response.text)}`, {
        code: "PERSON_UPDATE_FAILED",
        deviceResponse: deviceMessage(response.text),
      });
    }
  }

  async openDoor({ channel = 1 } = {}) {
    if (!Number.isInteger(channel) || channel < 1 || channel > 4) {
      throw new DahuaError('Canal de puerta inválido.', { code: 'OPEN_DOOR_INVALID_CHANNEL', status: 400 });
    }
    const response = await this.request('/cgi-bin/accessControl.cgi', {
      params: { action: 'openDoor', channel, Type: 'Remote' },
      timeoutMs: 10_000,
    });
    if (!isOk(response.text)) {
      throw new DahuaError(`El terminal no confirmó la apertura: ${deviceMessage(response.text)}`, {
        code: 'OPEN_DOOR_FAILED', deviceResponse: deviceMessage(response.text),
      });
    }
    return { opened: true };
  }

  // El lector trata el contenido de un código QR como número de tarjeta.
  async addCard({ userId, cardNo }) {
    const response = await this.request("/cgi-bin/AccessCard.cgi", {
      params: { action: "insertMulti" },
      method: "POST",
      json: { CardList: [{ UserID: userId, CardNo: cardNo, CardType: 0, CardStatus: 0 }] },
    });
    if (!isOk(response.text)) {
      throw new DahuaError(`El terminal rechazó el código QR: ${deviceMessage(response.text)}`, {
        code: "CARD_INSERT_FAILED",
        status: 422,
        deviceResponse: deviceMessage(response.text),
      });
    }
  }

  async removeCard(cardNo) {
    const response = await this.request("/cgi-bin/AccessCard.cgi", {
      params: { action: "removeMulti", "CardNoList[0]": cardNo },
    });
    if (!isOk(response.text)) {
      throw new DahuaError(`No fue posible eliminar el código QR: ${deviceMessage(response.text)}`, {
        code: "CARD_REMOVE_FAILED",
        deviceResponse: deviceMessage(response.text),
      });
    }
  }

  async addFace({ userId, name, photoBase64, update = false }) {
    try {
      const v2 = await this.request("/cgi-bin/AccessFace.cgi", {
        params: { action: update ? "updateMulti" : "insertMulti" },
        method: "POST",
        json: { FaceList: [{ UserID: userId, PhotoData: [photoBase64] }] },
        timeoutMs: 30000,
      });
      if (isOk(v2.text)) return;
    } catch (error) {
      if (error.code === "DEVICE_AUTH_FAILED" || error.code === "DEVICE_UNREACHABLE") throw error;
    }

    const response = await this.request("/cgi-bin/FaceInfoManager.cgi", {
      params: { action: update ? "update" : "add" },
      method: "POST",
      json: {
        UserID: userId,
        Info: { UserName: name, PhotoData: [photoBase64] },
      },
      timeoutMs: 30000,
    });
    if (!isOk(response.text)) {
      throw new DahuaError(`El terminal rechazó la imagen facial: ${deviceMessage(response.text)}`, {
        code: "FACE_INSERT_FAILED",
        status: 422,
        deviceResponse: deviceMessage(response.text),
      });
    }
  }

  async findFace(userId) {
    try {
      const v2 = await this.request("/cgi-bin/AccessFace.cgi", {
        params: { action: "list", "UserIDList[0]": userId },
      });
      if (!isDeviceError(v2.text)) {
        const foundUser = new RegExp(`(?:^|\\n)FaceDataList\\[\\d+\\]\\.UserID=${escapeRegExp(userId)}(?:\\r?\\n|$)`).test(v2.text)
          || new RegExp(`(?:^|\\n)FaceList\\[\\d+\\]\\.UserID=${escapeRegExp(userId)}(?:\\r?\\n|$)`).test(v2.text);
        if (foundUser) return true;
        if (/^(?:found|count|totalCount)=0\s*$/im.test(v2.text) || /^\s*OK\s*$/i.test(v2.text)) return false;
      }
    } catch (error) {
      if (error.code === "DEVICE_AUTH_FAILED" || error.code === "DEVICE_UNREACHABLE") throw error;
    }

    const started = await this.request("/cgi-bin/FaceInfoManager.cgi", {
      params: { action: "startFind", "Condition.UserID": userId },
    });
    let payload;
    try {
      payload = JSON.parse(started.text);
    } catch {
      payload = parseKeyValue(started.text);
    }
    const token = payload.Token ?? payload.token;
    const total = Number(payload.Total ?? payload.total ?? payload.totalCount ?? 0);
    if (token !== undefined) {
      try {
        if (total > 0) {
          await this.request("/cgi-bin/FaceInfoManager.cgi", {
            params: { action: "doFind", Token: token, Offset: 0, Count: 1 },
          });
        }
      } finally {
        await this.request("/cgi-bin/FaceInfoManager.cgi", {
          params: { action: "stopFind", Token: token },
        }).catch(() => {});
      }
    }
    return total > 0;
  }

  async listPeople() {
    let response = await this.request("/cgi-bin/recordFinder.cgi", {
      params: { action: "doSeekFind", name: "AccessControlCard", count: 2000 },
      timeoutMs: 20000,
    });
    if (isDeviceError(response.text)) {
      response = await this.request("/cgi-bin/recordFinder.cgi", {
        params: { action: "find", name: "AccessControlCard", "condition.count": 2000 },
        timeoutMs: 20000,
      });
    }
    if (isDeviceError(response.text)) {
      throw new DahuaError(`El firmware no permitió leer las personas: ${deviceMessage(response.text)}`, {
        code: "PEOPLE_LIST_FAILED",
        deviceResponse: deviceMessage(response.text),
      });
    }
    let records;
    try {
      const json = JSON.parse(response.text);
      records = json.UserList || json.Records || json.records || [];
    } catch {
      records = parseIndexedRecords(response.text).records;
    }
    return records.map((record) => ({
      recNo: record.RecNo || record.recno || "",
      userId: record.UserID || "",
      name: record.CardName || record.UserName || "Sin nombre",
      isValid: !["false", "0"].includes(String(record.IsValid).toLowerCase()),
      validFrom: record.ValidDateStart || "",
      validTo: record.ValidDateEnd || "",
    }));
  }

  async removeFace(userId) {
    try {
      const v2 = await this.request("/cgi-bin/AccessFace.cgi", {
        params: { action: "removeMulti", "UserIDList[0]": userId },
      });
      if (isOk(v2.text)) return;
    } catch (error) {
      if (error.code === "DEVICE_AUTH_FAILED" || error.code === "DEVICE_UNREACHABLE") throw error;
    }
    const response = await this.request("/cgi-bin/FaceInfoManager.cgi", {
      params: { action: "remove", UserID: userId },
    });
    if (!isOk(response.text)) {
      throw new DahuaError(`No fue posible eliminar el rostro: ${deviceMessage(response.text)}`, {
        code: "FACE_REMOVE_FAILED",
        deviceResponse: deviceMessage(response.text),
      });
    }
  }

  async removePerson(recNo, userId = "") {
    if (userId) {
      try {
        const v2 = await this.request("/cgi-bin/AccessUser.cgi", {
          params: { action: "removeMulti", "UserIDList[0]": userId },
        });
        if (isOk(v2.text)) return;
      } catch (error) {
        if (error.code === "DEVICE_AUTH_FAILED" || error.code === "DEVICE_UNREACHABLE") throw error;
      }
    }
    if (!recNo) {
      throw new DahuaError("El firmware no entregó un identificador interno para eliminar el registro V1.", {
        code: "PERSON_REMOVE_FAILED",
      });
    }
    const response = await this.request("/cgi-bin/recordUpdater.cgi", {
      params: { action: "remove", name: "AccessControlCard", recno: recNo },
    });
    if (!isOk(response.text)) {
      throw new DahuaError(`No fue posible eliminar a la persona: ${deviceMessage(response.text)}`, {
        code: "PERSON_REMOVE_FAILED",
        deviceResponse: deviceMessage(response.text),
      });
    }
  }

}

export function isPrivateDeviceHost(hostname) {
  const host = String(hostname || "").replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".lan")) return true;
  const family = net.isIP(host);
  if (family === 4) {
    const parts = host.split(".").map(Number);
    return parts[0] === 10
      || parts[0] === 127
      || (parts[0] === 192 && parts[1] === 168)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 169 && parts[1] === 254);
  }
  if (family === 6) return host === "::1" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host);
  return false;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
