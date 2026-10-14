// RestBlu · pagos con Webpay Plus (Transbank) en un Cloudflare Worker.
//
// POST /webpay/create  → crea la transacción y devuelve { token, url }.
// GET|POST /webpay/return → Transbank devuelve aquí al cliente; el Worker
//   confirma el pago (commit) dentro del plazo de Transbank y redirige a la web
//   con ?pago=<reserva>&estado=<aprobado|rechazado|anulado|expirado>&token=<token>.
//
// El Worker no marca reservas como pagadas: el gestor RestBlu vuelve a consultar
// a Transbank el estado del token y sólo acepta el pago si fue autorizado por la
// orden y el monto de la reserva.

const API_PATH = '/rswebpaytransaction/api/webpay/v1.2/transactions';
// Credencial pública del ambiente de integración; en producción se configura
// el secreto TRANSBANK_API_KEY.
const INTEGRATION_API_KEY = '579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C';
const RESERVATION_ID = /^(LS|RB)-[A-Z0-9-]{10,23}$/;
// La app Android vuelve por este esquema propio (ver AndroidManifest).
const APP_RETURN = 'restblu://webpay';
const APP_PACKAGE = 'cl.lumastay.huesped';
const WEBPAY_TOKEN = /^[A-Za-z0-9]{20,100}$/;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

function html(body, status = 200) {
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RestBlu</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#f5f8f7;color:#102d3f}main{max-width:420px;padding:28px;text-align:center}a.button{display:inline-block;margin-top:18px;padding:14px 22px;border-radius:12px;background:#0b6871;color:#fff;font-weight:700;text-decoration:none}p{line-height:1.5;color:#4f6f78}</style></head><body><main>${body}</main></body></html>`, {
    status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function allowedOrigins(env) {
  return new Set(String(env.ALLOWED_RETURN_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean));
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  return allowedOrigins(env).has(origin)
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' }
    : {};
}

function json(request, env, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders(request, env) },
  });
}

// Sólo se vuelve a sitios de RestBlu: evita usar el Worker para redirigir a
// páginas ajenas.
function safeReturnUrl(value, env) {
  try {
    const url = new URL(value);
    if (allowedOrigins(env).has(url.origin)) return url;
  } catch {
    // Se usa la dirección por defecto.
  }
  return new URL(env.DEFAULT_RETURN || 'https://restblu.web.app/');
}

async function transbank(env, method, path, body) {
  const response = await fetch(`${env.TRANSBANK_API_BASE}${API_PATH}${path}`, {
    method,
    headers: {
      'Tbk-Api-Key-Id': env.TRANSBANK_COMMERCE_CODE,
      'Tbk-Api-Key-Secret': env.TRANSBANK_API_KEY || INTEGRATION_API_KEY,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

async function createTransaction(request, env) {
  const input = await request.json().catch(() => ({}));
  const reservationId = String(input.reservationId || '');
  const amount = Number(input.amount);
  if (!RESERVATION_ID.test(reservationId)) return json(request, env, 400, { error: 'Código de reserva inválido.' });
  if (!Number.isInteger(amount) || amount < 50 || amount > 99_999_999) {
    return json(request, env, 400, { error: 'Monto inválido para Webpay.' });
  }
  const forApp = String(input.returnTo || '') === APP_RETURN;
  const returnUrl = new URL('/webpay/return', request.url);
  returnUrl.searchParams.set('r', reservationId);
  if (forApp) {
    returnUrl.searchParams.set('app', '1');
  } else {
    const returnTo = safeReturnUrl(String(input.returnTo || ''), env);
    returnUrl.searchParams.set('to', `${returnTo.origin}${returnTo.pathname}`);
  }
  const result = await transbank(env, 'POST', '', {
    buy_order: reservationId,
    session_id: crypto.randomUUID().replace(/-/g, '').slice(0, 26),
    amount,
    return_url: returnUrl.toString(),
  });
  if (!result.ok || !result.data.token || !result.data.url) {
    return json(request, env, 502, { error: result.data.error_message || 'Transbank no pudo iniciar el pago. Inténtalo nuevamente.' });
  }
  // payUrl abre el formulario de Webpay desde un enlace normal (la app Android
  // no puede enviar el POST que exige Transbank).
  const payUrl = new URL('/webpay/go', request.url);
  payUrl.searchParams.set('token', result.data.token);
  payUrl.searchParams.set('url', result.data.url);
  return json(request, env, 200, { token: result.data.token, url: result.data.url, payUrl: payUrl.toString() });
}

// La app conserva el token del intento. Si el navegador no logra volver a la
// app, puede consultar el resultado real sin iniciar una segunda transacción.
async function paymentStatus(request, env) {
  const input = await request.json().catch(() => ({}));
  const token = String(input.token || '');
  const reservationId = String(input.reservationId || '');
  if (!WEBPAY_TOKEN.test(token) || !RESERVATION_ID.test(reservationId)) {
    return json(request, env, 400, { error: 'Identificador de pago inválido.' });
  }
  const result = await transbank(env, 'GET', `/${encodeURIComponent(token)}`);
  if (!result.ok) return json(request, env, 502, { error: 'No fue posible consultar el pago en Transbank. Inténtalo más tarde.' });
  if (String(result.data.buy_order || '') !== reservationId) {
    return json(request, env, 409, { error: 'El pago corresponde a otra reserva.' });
  }
  const status = String(result.data.status || '');
  const state = status === 'AUTHORIZED' && Number(result.data.response_code) === 0
    ? 'approved'
    : ['FAILED', 'REVERSED', 'NULLIFIED', 'PARTIALLY_NULLIFIED'].includes(status) ? 'rejected' : 'pending';
  return json(request, env, 200, { state, reservationId });
}

function goToWebpay(request) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || '';
  let target;
  try {
    target = new URL(url.searchParams.get('url') || '');
  } catch {
    target = null;
  }
  if (!WEBPAY_TOKEN.test(token) || !target || target.protocol !== 'https:' ||
      !(target.hostname === 'transbank.cl' || target.hostname.endsWith('.transbank.cl'))) {
    return html('<h1>Enlace de pago inválido</h1><p>Vuelve a RestBlu e inicia el pago nuevamente.</p>', 400);
  }
  return html(`<h1>Abriendo Webpay…</h1><form id="pay" method="post" action="${escapeHtml(target)}"><input type="hidden" name="token_ws" value="${escapeHtml(token)}"><button class="button" style="border:0;padding:14px 22px;border-radius:12px;background:#0b6871;color:#fff;font-weight:700">Continuar al pago</button></form><script>document.getElementById('pay').submit()</script>`);
}

async function handleReturn(request, env) {
  const url = new URL(request.url);
  const params = new URLSearchParams(url.search);
  if (request.method === 'POST') {
    const form = await request.formData().catch(() => null);
    for (const [key, value] of form || []) params.set(key, String(value));
  }
  const reservationId = RESERVATION_ID.test(params.get('r') || '') ? params.get('r') : (params.get('TBK_ORDEN_COMPRA') || '');
  const destination = safeReturnUrl(params.get('to') || '', env);
  const token = params.get('token_ws') || '';
  let estado;
  if (params.get('TBK_TOKEN')) {
    estado = 'anulado';
  } else if (!token) {
    estado = 'expirado';
  } else {
    // Confirmar el pago. Si ya estaba confirmado, se consulta su estado.
    let result;
    try {
      result = await transbank(env, 'PUT', `/${encodeURIComponent(token)}`);
      if (!result.ok) result = await transbank(env, 'GET', `/${encodeURIComponent(token)}`);
    } catch { /* el resultado se podrá consultar desde la app */ }
    estado = result?.ok && result.data.status === 'AUTHORIZED' && Number(result.data.response_code) === 0
      ? 'aprobado'
      : result?.ok && ['FAILED', 'REVERSED', 'NULLIFIED', 'PARTIALLY_NULLIFIED'].includes(result.data.status)
        ? 'rechazado' : 'pendiente';
  }
  const result = new URLSearchParams({ pago: RESERVATION_ID.test(reservationId) ? reservationId : '', estado });
  if (token && (estado === 'aprobado' || estado === 'pendiente')) result.set('token', token);
  if (params.get('app') === '1') {
    // Un enlace de esquema propio se abre también en navegadores Android que
    // no admiten intent:// (por ejemplo, al volver manualmente desde Webpay).
    const appUrl = `${APP_RETURN}?${result}`;
    const intentUrl = `intent://webpay?${result}#Intent;scheme=restblu;package=${APP_PACKAGE};end`;
    const title = estado === 'aprobado' ? 'Pago aprobado' : estado === 'anulado' ? 'Pago cancelado' : estado === 'expirado' ? 'Tiempo agotado' : estado === 'pendiente' ? 'Pago en verificación' : 'Pago rechazado';
    return html(`<h1>${title}</h1><p>Vuelve a la app RestBlu para ${estado === 'aprobado' ? 'ver tu reserva' : 'consultar el resultado del pago'}.</p><a class="button" href="${escapeHtml(appUrl)}">Volver a RestBlu</a><p>Si no se abre, pulsa este botón desde tu navegador.</p><script>setTimeout(function(){location.href=${JSON.stringify(intentUrl)}},400)</script>`);
  }
  for (const [key, value] of result) destination.searchParams.set(key, value);
  return Response.redirect(destination.toString(), 303);
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    try {
      if (pathname === '/webpay/create' && request.method === 'POST') return await createTransaction(request, env);
      if (pathname === '/webpay/status' && request.method === 'POST') return await paymentStatus(request, env);
      if (pathname === '/webpay/return' && (request.method === 'GET' || request.method === 'POST')) return await handleReturn(request, env);
      if (pathname === '/webpay/go' && request.method === 'GET') return goToWebpay(request);
      if (pathname === '/') return json(request, env, 200, { service: 'restblu-pagos', ok: true });
      return json(request, env, 404, { error: 'Ruta no encontrada.' });
    } catch {
      return json(request, env, 500, { error: 'Error interno del servicio de pagos.' });
    }
  },
};
