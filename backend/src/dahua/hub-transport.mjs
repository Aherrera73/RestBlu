// Comunicación del gestor con el hub Dahua (D:\RB\dahua-hub). El hub mantiene
// la conexión de Auto Register de cada terminal y ejecuta en él las CGI que el
// gestor le envía, aunque el terminal esté en otra red.

const REGISTRATION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function validRegistrationId(value) {
  return REGISTRATION_ID.test(String(value || ''));
}

async function hubFetch(hubUrl, apiKey, path, { method = 'GET', body, timeoutMs = 20_000 } = {}) {
  let response;
  try {
    response = await fetch(new URL(path, hubUrl), {
      method,
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { 'x-api-key': apiKey } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const reason = error?.name === 'TimeoutError' ? 'no respondió a tiempo' : 'no está disponible';
    throw new Error(`El hub Dahua (${hubUrl}) ${reason}.`);
  }
  let payload = {};
  try { payload = await response.json(); } catch { /* sin JSON */ }
  if (!response.ok) {
    throw Object.assign(new Error(payload.error || `El hub Dahua respondió HTTP ${response.status}.`), { status: response.status });
  }
  return payload;
}

// Transporte para DahuaClient: cada CGI viaja al terminal por el hub.
export function createHubTransport({ hubUrl, apiKey = '', registrationId }) {
  return async ({ path, params, method, json, timeoutMs }) => hubFetch(hubUrl, apiKey,
    `/api/devices/${encodeURIComponent(registrationId)}/cgi`, {
      method: 'POST',
      body: { path, params, method, json, timeoutMs },
      // El hub espera al terminal; se le da un margen adicional.
      timeoutMs: (timeoutMs || 15_000) + 10_000,
    });
}

// Informa al hub qué terminales atienden cada alojamiento.
export async function pushPropertyTerminals({ hubUrl, apiKey = '', properties }) {
  for (const property of properties) {
    await hubFetch(hubUrl, apiKey, `/api/restblu-properties/${property.id}`, {
      method: 'PUT',
      body: { name: property.name, registrationIds: property.dahuaRegistrationId ? [property.dahuaRegistrationId] : [] },
    });
  }
}

// Todos los terminales que conoce el hub, con su sesión si están conectados.
export async function hubDevices({ hubUrl, apiKey = '' }) {
  return (await hubFetch(hubUrl, apiKey, '/api/devices', { timeoutMs: 5_000 })).devices;
}

// Túnel TCP de ngrok abierto en este PC (API local del agente de ngrok).
export async function ngrokTunnel(apiUrl = 'http://127.0.0.1:4040', hubPort = 9500) {
  let tunnels;
  try {
    const response = await fetch(new URL('/api/tunnels', apiUrl), { signal: AbortSignal.timeout(3_000) });
    tunnels = (await response.json()).tunnels || [];
  } catch {
    return { active: false, error: 'ngrok no está abierto en este PC.' };
  }
  const tcpTunnels = tunnels.filter((item) => String(item.public_url || '').startsWith('tcp://'));
  const tunnel = tcpTunnels.find((item) =>
    Number(String(item.config?.addr || '').match(/(?:^|:)(\d+)$/)?.[1] || 0) === hubPort);
  if (!tunnel) return { active: false, error: tcpTunnels.length
    ? `ngrok no tiene un túnel TCP hacia el puerto ${hubPort}.`
    : 'ngrok está abierto, pero sin túnel TCP.' };
  const url = new URL(tunnel.public_url);
  return { active: true, publicUrl: tunnel.public_url, host: url.hostname, port: Number(url.port), forwardsTo: tunnel.config?.addr || '' };
}

export async function hubStatus({ hubUrl, apiKey = '' }) {
  const [health, online] = await Promise.all([
    hubFetch(hubUrl, apiKey, '/api/health', { timeoutMs: 5_000 }),
    hubFetch(hubUrl, apiKey, '/api/devices/online', { timeoutMs: 5_000 }),
  ]);
  return { ...health, online: online.devices.map((device) => device.registrationId) };
}
