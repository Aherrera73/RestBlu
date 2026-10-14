import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function md5(value) {
  return crypto.createHash("md5").update(value).digest("hex");
}

export function parseAuthChallenge(header = "") {
  const schemeMatch = header.match(/^\s*(Digest|Basic)\s+/i);
  if (!schemeMatch) return null;
  const scheme = schemeMatch[1].toLowerCase();
  const values = {};
  const parameters = header.slice(schemeMatch[0].length);
  const pattern = /([\w-]+)\s*=\s*(?:"([^"]*)"|([^,\s]+))/g;
  let match;
  while ((match = pattern.exec(parameters))) {
    values[match[1].toLowerCase()] = match[2] ?? match[3];
  }
  return { scheme, ...values };
}

export function makeDigestAuthorization({ challenge, username, password, method, uri, nonceCount = 1 }) {
  if (!challenge?.realm || !challenge?.nonce) {
    throw new Error("El terminal no entregó un desafío Digest válido.");
  }

  const algorithm = (challenge.algorithm || "MD5").toUpperCase();
  if (algorithm !== "MD5" && algorithm !== "MD5-SESS") {
    throw new Error(`Algoritmo Digest no soportado por esta aplicación: ${algorithm}`);
  }

  const qops = (challenge.qop || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const qop = qops.includes("auth") ? "auth" : "";
  if (qops.length && !qop) {
    throw new Error("El terminal exige un modo Digest que no es compatible (se requiere qop=auth).");
  }

  const cnonce = crypto.randomBytes(12).toString("hex");
  const nc = nonceCount.toString(16).padStart(8, "0");
  let ha1 = md5(`${username}:${challenge.realm}:${password}`);
  if (algorithm === "MD5-SESS") ha1 = md5(`${ha1}:${challenge.nonce}:${cnonce}`);
  const ha2 = md5(`${method}:${uri}`);
  const response = qop
    ? md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${challenge.nonce}:${ha2}`);

  const parts = [
    `username="${String(username).replaceAll('"', '\\"')}"`,
    `realm="${challenge.realm.replaceAll('"', '\\"')}"`,
    `nonce="${challenge.nonce.replaceAll('"', '\\"')}"`,
    `uri="${uri.replaceAll('"', '\\"')}"`,
    `response="${response}"`,
    `algorithm=${algorithm}`,
  ];
  if (challenge.opaque) parts.push(`opaque="${challenge.opaque.replaceAll('"', '\\"')}"`);
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  return `Digest ${parts.join(", ")}`;
}

function rawRequest(url, { method, headers, body, timeoutMs, ca, allowSelfSigned }) {
  const isHttps = url.protocol === "https:";
  const transport = isHttps ? https : http;
  const tlsOptions = isHttps ? { ca: ca || undefined, rejectUnauthorized: !allowSelfSigned } : {};
  return new Promise((resolve, reject) => {
    const request = transport.request(
      url,
      {
        method,
        headers,
        timeout: timeoutMs,
        ...tlsOptions,
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            request.destroy(new Error("La respuesta del terminal excedió el límite permitido."));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode || 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("El terminal no respondió a tiempo.")));
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

export async function digestRequest(target, options = {}) {
  const url = target instanceof URL ? target : new URL(target);
  if (!["http:", "https:"].includes(url.protocol) || !options.username || !options.password) {
    throw new Error("Dahua requiere una dirección HTTP/HTTPS y una cuenta CGI.");
  }
  const method = (options.method || "GET").toUpperCase();
  const body = options.body == null
    ? null
    : Buffer.isBuffer(options.body)
      ? options.body
      : Buffer.from(String(options.body));
  const headers = {
    Accept: "application/json, text/plain, */*",
    "User-Agent": "Dahua-Enrolamiento-Facial/1.0",
    Connection: "close",
    ...(options.headers || {}),
  };
  if (body && headers["Content-Length"] == null) headers["Content-Length"] = body.length;

  const requestOptions = {
    method,
    headers,
    body,
    timeoutMs: options.timeoutMs || 10000,
    ca: options.ca,
    allowSelfSigned: Boolean(options.allowSelfSigned),
  };
  // Mismo flujo que la herramienta "Acceso Claro" probada con el terminal:
  // la primera petición sin credenciales recibe 401 (el equipo no la procesa)
  // y se repite con la cabecera Digest calculada sobre ese desafío.
  let response = await rawRequest(url, requestOptions);
  if (response.status !== 401) return response;

  const rawChallenge = Array.isArray(response.headers["www-authenticate"])
    ? response.headers["www-authenticate"].find((value) => /^Digest/i.test(value)) || response.headers["www-authenticate"][0]
    : response.headers["www-authenticate"];
  const challenge = parseAuthChallenge(rawChallenge);
  // No se envía la contraseña con Basic: sólo Digest.
  if (!challenge || challenge.scheme !== "digest") return response;
  headers.Authorization = makeDigestAuthorization({
    challenge,
    username: options.username,
    password: options.password,
    method,
    uri: `${url.pathname}${url.search}`,
  });
  return rawRequest(url, requestOptions);
}
