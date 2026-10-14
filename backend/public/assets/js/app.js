import { api, uploadImage } from './services/api.js';
import { escapeHtml, money, shortDate } from './shared/formatters.js';
import { PassiveFaceObservation } from './biometric-motion.js';

const state = { properties: [], customers: [], reservations: [], database: null };
const manualDoorState = new Map();
let biometricStream = null;
let biometricReservation = null;
let biometricScanId = 0;
let biometricScanTimer = null;
let faceLandmarkerPromise = null;
const titles = {
  summary: 'Pulso general',
  properties: 'Espacios publicados',
  customers: 'Viajeros registrados',
  reservations: 'Registro de estadías',
  ai: 'Asistente RestBlu IA',
  biometrics: 'Verificación biométrica',
  access: 'Accesos y validaciones',
  security: 'Seguridad de viviendas',
  terminals: 'Terminales Dahua',
  accounts: 'Cuentas de clientes',
};

// Métodos de apertura según el registro del Dahua.
const ACCESS_METHODS = { 0: 'Contraseña', 1: 'QR / tarjeta', 4: 'Remoto', 5: 'Botón', 15: 'Rostro' };
const ACCESS_ERRORS = { 16: 'No autorizado' };

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const imageSlots = [
  { file: '#property-image-file', value: '#property-image', preview: '#property-image-preview', objectUrl: '' },
  { file: '#property-gallery-1-file', value: '#property-gallery-1', preview: '#property-gallery-1-preview', objectUrl: '' },
  { file: '#property-gallery-2-file', value: '#property-gallery-2', preview: '#property-gallery-2-preview', objectUrl: '' },
];

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 2800);
}

function showImagePreview(slot, source) {
  const image = $(slot.preview);
  const frame = image.closest('.upload-frame');
  if (source) {
    image.src = source;
    frame.classList.add('has-image');
  } else {
    image.removeAttribute('src');
    frame.classList.remove('has-image');
  }
}

function setStoredImage(slot, source = '') {
  if (slot.objectUrl) URL.revokeObjectURL(slot.objectUrl);
  slot.objectUrl = '';
  $(slot.file).value = '';
  $(slot.value).value = source;
  showImagePreview(slot, source);
}

function previewSelectedImage(slot) {
  if (slot.objectUrl) URL.revokeObjectURL(slot.objectUrl);
  slot.objectUrl = '';
  const file = $(slot.file).files[0];
  if (file) {
    slot.objectUrl = URL.createObjectURL(file);
    showImagePreview(slot, slot.objectUrl);
  } else {
    showImagePreview(slot, $(slot.value).value);
  }
}

async function resolveImage(slot) {
  const file = $(slot.file).files[0];
  return file ? uploadImage(file) : $(slot.value).value;
}

async function refresh() {
  const [properties, customers, reservations, database] = await Promise.all([
    api('/api/admin/properties'),
    api('/api/customers'),
    api('/api/reservations'),
    api('/api/database/info'),
  ]);
  state.properties = properties.properties;
  state.customers = customers.customers;
  state.reservations = reservations.reservations;
  state.database = database;
  renderAll();
}

function setView(view) {
  $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  $$('.view').forEach((section) => section.classList.toggle('active', section.id === `${view}-view`));
  $('#view-title').textContent = titles[view];
  if (view === 'ai') { void refreshAiStatus(); void refreshAiFeedback(); }
  if (view === 'summary') void refreshToday();
  if (view === 'biometrics') void refreshBiometricStatus();
  if (view === 'security') { void refreshSecurity(); void refreshToday(); }
  if (view === 'accounts') void refreshAccounts();
  clearInterval(state.terminalsTimer);
  if (view === 'terminals') {
    void refreshTerminals();
    // Mientras la sección está abierta se actualiza sola.
    state.terminalsTimer = setInterval(() => void refreshTerminals(), 15_000);
  }
}

function durationText(seconds) {
  if (seconds == null) return '';
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  const hours = Math.floor(seconds / 3600);
  return hours < 48 ? `${hours} h ${Math.floor((seconds % 3600) / 60)} min` : `${Math.floor(hours / 24)} días`;
}

async function refreshTerminals() {
  const updated = $('#terminals-updated');
  try {
    const result = await api('/api/dahua/terminals');
    state.terminals = result;
    renderTerminals();
    updated.className = 'ai-status connected';
    updated.innerHTML = `<i></i> Actualizado ${new Date().toLocaleTimeString('es-CL', { hour12: false })}`;
  } catch (error) {
    updated.className = 'ai-status offline';
    updated.innerHTML = `<i></i> ${escapeHtml(error.message)}`;
  }
}

function renderTerminals() {
  const result = state.terminals;
  if (!result) return;
  const { hub, tunnel, terminals } = result;
  $('#terminals-hub').textContent = !hub.configured ? 'Sin configurar' : hub.connected ? 'Conectado' : 'Sin respuesta';
  $('#terminals-hub-detail').textContent = !hub.configured
    ? 'Falta DAHUA_HUB_URL en el archivo privado del gestor.'
    : hub.connected ? `${hub.url}${result.defaultDevice ? ` · por omisión ${result.defaultDevice}` : ''}`
      : hub.error || 'Abre Abrir_Dahua_Hub.bat.';
  $('#terminals-tunnel').textContent = tunnel.active ? `${tunnel.host}:${tunnel.port}` : 'Sin túnel';
  $('#terminals-tunnel-detail').textContent = tunnel.active
    ? `Hacia ${tunnel.forwardsTo || 'localhost:9500'}`
    : `${tunnel.error || 'ngrok no responde.'} Abre Abrir_Tunel_Dahua.bat.`;
  const online = terminals.filter((terminal) => terminal.online).length;
  $('#terminals-online').textContent = online;
  $('#terminals-online-detail').textContent = `de ${terminals.length} registrado${terminals.length === 1 ? '' : 's'} en el hub`;

  $('#terminals-table').innerHTML = terminals.length ? terminals.map((terminal) => {
    const since = terminal.online
      ? `Conectado hace ${durationText(terminal.connectedSeconds)}`
      : terminal.lastDisconnectedAt ? `Última vez: ${shortDate(terminal.lastDisconnectedAt)}`
        : terminal.lastConnectedAt ? `Última vez: ${shortDate(terminal.lastConnectedAt)}` : 'Nunca se ha conectado';
    const homes = [
      ...terminal.properties.map((property) => escapeHtml(property.name)),
      ...(terminal.isDefault && terminal.defaultFor ? [`Por omisión: ${terminal.defaultFor} vivienda${terminal.defaultFor === 1 ? '' : 's'} sin terminal propio`] : []),
    ];
    return `
    <tr>
      <td><strong>${escapeHtml(terminal.registrationId)}</strong><br /><small>${escapeHtml(terminal.deviceClass || terminal.name || '')}</small></td>
      <td><span class="badge ${terminal.online ? 'active' : 'inactive'}">${terminal.online ? 'En línea' : 'Desconectado'}</span></td>
      <td>${terminal.online ? (terminal.tls ? '🔒 HTTPS' : 'HTTP sin cifrar') : '—'}</td>
      <td>${since}</td>
      <td>${homes.length ? homes.join('<br />') : '<small>Sin vivienda asignada</small>'}</td>
      <td><button type="button" class="small-button" data-test-terminal="${escapeHtml(terminal.registrationId)}" ${terminal.online ? '' : 'disabled'}>Probar</button></td>
    </tr>`;
  }).join('') : `<tr><td colspan="6" class="empty">${hub.connected ? 'El hub aún no tiene terminales. Configura el Registro Automático CGI en un Dahua.' : 'No se pudo consultar el hub.'}</td></tr>`;
}

async function refreshAccounts() {
  try {
    state.accounts = (await api('/api/admin/accounts')).accounts;
  } catch (error) {
    state.accounts = null;
    $('#accounts-table').innerHTML = `<tr><td colspan="7" class="empty">${escapeHtml(error.message)}</td></tr>`;
    return;
  }
  renderAccounts();
}

function accountProvider(account) {
  if (account.anonymous) return 'Anónima';
  return account.providers.map((provider) => (provider === 'google.com' ? 'Google' : provider === 'password' ? 'Correo' : provider)).join(' + ');
}

function renderAccounts() {
  const accounts = state.accounts;
  if (!accounts) return;
  const people = accounts.filter((account) => !account.anonymous);
  $('#accounts-total').textContent = people.length;
  $('#accounts-incomplete').textContent = people.filter((account) => !account.profileComplete).length;
  $('#accounts-anonymous').textContent = accounts.length - people.length;
  const query = $('#accounts-search').value.trim().toLowerCase();
  const rows = ($('#accounts-show-anonymous').checked ? accounts : people).filter((account) => !query ||
    `${account.name} ${account.email} ${account.documentId} ${account.uid}`.toLowerCase().includes(query));
  $('#accounts-table').innerHTML = rows.length ? rows.map((account) => `
    <tr>
      <td><strong>${escapeHtml(account.name || (account.anonymous ? 'Identidad anónima' : 'Sin nombre'))}</strong><br /><small>${escapeHtml(account.uid)}</small></td>
      <td>${escapeHtml(account.email || '—')}${account.email ? `<br /><small>${account.emailVerified ? 'Correo verificado' : 'Correo sin verificar'}</small>` : ''}</td>
      <td>${account.documentId ? escapeHtml(account.documentId) : account.anonymous ? '—' : '<span class="badge inactive">Registro incompleto</span>'}</td>
      <td>${escapeHtml(accountProvider(account))}</td>
      <td>${account.createdAt ? shortDate(account.createdAt) : '—'}<br /><small>${account.lastSignInAt ? `Último ingreso: ${shortDate(account.lastSignInAt)}` : 'Sin ingresos'}</small></td>
      <td>${account.reservations}${account.activeReservations.length ? `<br /><small>${account.activeReservations.length} vigente(s)</small>` : ''}</td>
      <td><button type="button" class="small-button danger" data-delete-account="${escapeHtml(account.uid)}" ${account.activeReservations.length ? 'disabled title="Tiene una estadía confirmada vigente"' : ''}>Eliminar</button></td>
    </tr>`).join('') : `<tr><td colspan="7" class="empty">${query ? 'Ninguna cuenta coincide con la búsqueda.' : 'No hay cuentas.'}</td></tr>`;
}

$('#accounts-search').addEventListener('input', renderAccounts);
$('#accounts-show-anonymous').addEventListener('change', renderAccounts);
$('#accounts-refresh').addEventListener('click', () => void refreshAccounts());
$('#accounts-table').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-delete-account]');
  if (!button) return;
  const account = (state.accounts || []).find((item) => item.uid === button.dataset.deleteAccount);
  if (!account) return;
  const label = account.email || account.name || account.uid;
  const confirmed = window.confirm(`¿Eliminar la cuenta de ${label}?\n\nSe borran su acceso, su perfil y su RUT registrado. Podrá crear una cuenta nueva. Sus reservas quedan en el gestor como historial.\n\nEsta acción no se puede deshacer.`);
  if (!confirmed) return;
  button.disabled = true;
  button.textContent = 'Eliminando…';
  try {
    await api(`/api/admin/accounts/${encodeURIComponent(account.uid)}`, { method: 'DELETE' });
    showToast(`Cuenta de ${label} eliminada.`);
    await refreshAccounts();
  } catch (error) {
    showToast(error.message);
    button.disabled = false;
    button.textContent = 'Eliminar';
  }
});

$('#terminals-refresh').addEventListener('click', () => void refreshTerminals());
$('#today-refresh').addEventListener('click', () => void refreshToday());
$('#ai-feedback-filter').addEventListener('change', renderAiFeedback);
$('#ai-rating').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-ai-rate]');
  if (!button || !state.lastAiExchange) return;
  $$('#ai-rating button').forEach((item) => { item.disabled = true; });
  try {
    await api('/api/ai/feedback', { method: 'POST', body: JSON.stringify({ ...state.lastAiExchange, rating: button.dataset.aiRate }) });
    button.classList.add('selected');
    $('#ai-rating-note').textContent = '¡Gracias! Quedó registrada.';
    void refreshAiFeedback();
  } catch (error) {
    $$('#ai-rating button').forEach((item) => { item.disabled = false; });
    $('#ai-rating-note').textContent = error.message;
  }
});
void refreshToday();
$('#terminals-table').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-test-terminal]');
  if (!button) return;
  const registrationId = button.dataset.testTerminal;
  button.disabled = true;
  button.textContent = 'Probando…';
  try {
    const result = await api(`/api/dahua/terminals/${encodeURIComponent(registrationId)}/test`, { method: 'POST' });
    showToast(`${registrationId} respondió en ${result.latencyMs} ms · ${result.model} · serie ${result.serialNumber}${result.deviceTime ? ` · hora del equipo ${result.deviceTime}` : ''}`);
  } catch (error) {
    showToast(`${registrationId}: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = 'Probar';
  }
});

async function refreshSecurity() {
  const sync = $('#security-sync');
  try {
    const [result, hub] = await Promise.all([
      api(`/api/admin/access-events?days=${encodeURIComponent($('#security-days').value)}`),
      api('/api/dahua/hub').catch(() => null),
    ]);
    state.accessEvents = result.events;
    state.dahuaHub = hub;
    const failing = (result.terminals || []).filter((item) => item.error);
    if (!result.dahuaConfigured) {
      sync.className = 'ai-status warning';
      sync.innerHTML = '<i></i> Dahua sin configurar';
    } else if (failing.length && failing.length === (result.terminals || []).length) {
      sync.className = 'ai-status offline';
      sync.innerHTML = '<i></i> Terminal sin respuesta';
      sync.title = result.lastSyncError;
    } else if (failing.length) {
      sync.className = 'ai-status warning';
      sync.innerHTML = `<i></i> ${failing.length} terminal${failing.length === 1 ? '' : 'es'} sin respuesta · Sincronizado ${result.lastSyncAt ? shortDate(result.lastSyncAt) : 'pendiente'}`;
      sync.title = result.lastSyncError;
    } else {
      sync.className = 'ai-status connected';
      sync.innerHTML = `<i></i> Sincronizado ${result.lastSyncAt ? shortDate(result.lastSyncAt) : 'pendiente'}`;
      sync.title = '';
    }
  } catch (error) {
    sync.className = 'ai-status offline';
    sync.innerHTML = '<i></i> No disponible';
    sync.title = error.message;
  }
  renderSecurity();
}

function accessMovement(event) {
  if (event.type === 'Exit') return 'Salida';
  if (event.type === 'Entry') return 'Entrada';
  return event.type || '—';
}

function accessPerson(event) {
  if (event.person) return event.person;
  return event.userId ? `Usuario ${event.userId}` : 'Sin identificar';
}

// Terminal que atiende una vivienda y si está conectado al hub.
function propertyTerminal(property) {
  const hub = state.dahuaHub;
  const assigned = property.dahuaRegistrationId || '';
  // El gestor informa el terminal efectivo: el asignado, el de por omisión o 'lan'.
  const effective = hub?.assignments?.find((item) => item.propertyId === property.id)?.terminal;
  const terminal = effective ?? (assigned || (hub?.configured ? hub.defaultDevice : '') || 'lan');
  if (terminal === 'lan') return { label: 'Dahua de la red local', state: 'neutral', assigned };
  if (!terminal) return { label: 'Sin terminal', status: 'las reservas no se registran', state: 'warning', assigned };
  const online = Boolean(hub?.connected && (hub.online || []).some((id) => id.toUpperCase() === terminal.toUpperCase()));
  return {
    label: `${terminal}${assigned ? '' : ' · por omisión'}`,
    state: !hub?.connected ? 'warning' : online ? 'online' : 'offline',
    status: !hub?.connected ? 'hub sin respuesta' : online ? 'en línea' : 'desconectado',
    assigned,
  };
}

function doorButton(property) {
  const terminal = String(property.dahuaRegistrationId || '').trim();
  const shared = terminal && state.properties.some((item) => item.id !== property.id &&
    String(item.dahuaRegistrationId || '').toUpperCase() === terminal.toUpperCase());
  const attempt = manualDoorState.get(property.id);
  const waiting = attempt?.busy || attempt?.until > Date.now();
  const reason = !terminal ? 'Asigna un terminal propio a este alojamiento.'
    : shared ? 'Este terminal también está asignado a otro alojamiento.'
      : waiting ? 'Espera 10 segundos antes de repetir la apertura.'
        : `Abrir ahora la puerta del terminal ${terminal}.`;
  const hint = !terminal || shared ? `<small class="door-hint">${escapeHtml(reason)}</small>` : '';
  return `<span class="door-control"><button type="button" class="small-button open-door" data-open-property-door="${property.id}"
    title="${escapeHtml(reason)}" ${!terminal || shared || waiting ? 'disabled' : ''}>${attempt?.busy ? 'Abriendo…' : 'Abrir puerta'}</button>${hint}</span>`;
}

async function openPropertyDoor(propertyId) {
  const property = state.properties.find((item) => item.id === Number(propertyId));
  if (!property || manualDoorState.get(property.id)?.busy) return;
  manualDoorState.set(property.id, { busy: true, until: 0 });
  renderProperties();
  renderSecurity();
  try {
    await api(`/api/admin/properties/${property.id}/open-door`, {
      method: 'POST',
      headers: { 'X-RestBlu-Manager-Action': 'open-door' },
    });
    showToast(`Puerta de ${property.name} abierta.`);
  } catch (error) {
    showToast(error.message);
  } finally {
    manualDoorState.set(property.id, { busy: false, until: Date.now() + 10_000 });
    renderProperties();
    renderSecurity();
    window.setTimeout(() => { renderProperties(); renderSecurity(); }, 10_100);
  }
}

function terminalLabel(terminal) {
  if (!terminal || terminal === 'lan') return 'Red local';
  return terminal;
}

function renderSecurity() {
  const events = state.accessEvents || [];
  const today = new Date().toDateString();
  const propertyName = (id) => state.properties.find((property) => property.id === id)?.name || 'Vivienda eliminada';
  const unassigned = events.filter((event) => event.propertyId == null);
  const query = ($('#security-search')?.value || '').trim().toLowerCase();
  const visible = state.properties.filter((property) => !query || [
    property.name, property.place, property.type, propertyTerminal(property).label,
  ].join(' ').toLowerCase().includes(query));
  const showUnassigned = !query || 'sin vivienda asociada'.includes(query);
  const cards = visible.map((property) => {
    const key = String(property.id);
    const own = events.filter((event) => event.propertyId === property.id);
    const todayEvents = own.filter((event) => event.authorized && new Date(event.occurredAt).toDateString() === today);
    const entries = todayEvents.filter((event) => event.type !== 'Exit').length;
    const exits = todayEvents.filter((event) => event.type === 'Exit').length;
    const last = own[0]
      ? `Último movimiento: ${shortDate(own[0].occurredAt)} · ${escapeHtml(accessPerson(own[0]))}`
      : 'Sin movimientos en el periodo';
    const terminal = propertyTerminal(property);
    return `
    <div class="security-item ${state.securityProperty === key ? 'selected' : ''}">
      <button type="button" class="security-card" data-security-property="${key}">
        <div class="property-cell"><img src="${escapeHtml(property.image)}" alt="" /><div><strong>${escapeHtml(property.name)}</strong><small>${escapeHtml(property.place)}</small></div></div>
        <div class="security-counts"><span>${entries} entradas hoy</span><span>${exits} salidas</span></div>
        <small>${last}</small>
      </button>
      <div class="security-terminal">
        <span class="terminal-state ${terminal.state}" title="${escapeHtml(terminal.status || '')}"><i></i>${escapeHtml(terminal.label)}${terminal.status ? ` · ${escapeHtml(terminal.status)}` : ''}</span>
        <button type="button" class="small-button" data-assign-terminal="${key}">${terminal.assigned ? 'Cambiar' : 'Asignar terminal'}</button>
        ${doorButton(property)}
      </div>
    </div>`;
  }).join('');
  const unassignedCard = showUnassigned ? `
    <div class="security-item ${state.securityProperty === 'none' ? 'selected' : ''}">
      <button type="button" class="security-card" data-security-property="none">
        <strong>Sin vivienda asociada</strong>
        <div class="security-counts"><span>${unassigned.length} movimientos</span><span>${unassigned.filter((event) => !event.authorized).length} rechazados</span></div>
        <small>Rechazos, botón de salida y personas registradas a mano en el terminal.</small>
      </button>
    </div>` : '';
  $('#security-properties').innerHTML = cards || unassignedCard
    ? `${cards}${unassignedCard}`
    : `<p class="security-empty">Ninguna vivienda coincide con «${escapeHtml(query)}».</p>`;

  const selected = state.securityProperty || '';
  const rows = selected === 'none' ? unassigned
    : selected ? events.filter((event) => String(event.propertyId) === selected) : events;
  $('#security-title').textContent = selected === 'none' ? 'Sin vivienda asociada'
    : selected ? propertyName(Number(selected)) : 'Todas las viviendas';
  $('#security-table').innerHTML = rows.length ? rows.map((event) => {
    const method = ACCESS_METHODS[event.method] || (event.method == null ? '—' : `Método ${event.method}`);
    const result = event.authorized ? 'Autorizado'
      : ACCESS_ERRORS[event.errorCode] || `Rechazado${event.errorCode ? ` (${event.errorCode})` : ''}`;
    const reservation = event.reservationId
      ? `<button class="small-button" data-view-reservation="${escapeHtml(event.reservationId)}">${escapeHtml(event.reservationId)}</button>`
      : '—';
    return `
    <tr>
      <td>${shortDate(event.occurredAt)}</td>
      <td>${escapeHtml(accessPerson(event))}</td>
      <td>${event.propertyId == null ? '—' : escapeHtml(propertyName(event.propertyId))}</td>
      <td>${reservation}</td>
      <td>${escapeHtml(terminalLabel(event.terminal))}</td>
      <td>${accessMovement(event)}</td>
      <td>${escapeHtml(method)}</td>
      <td><span class="badge ${event.authorized ? 'active' : 'inactive'}">${escapeHtml(result)}</span></td>
    </tr>`;
  }).join('') : '<tr><td colspan="8" class="empty">No hay movimientos en este periodo.</td></tr>';
}

async function refreshBiometricStatus() {
  const status = $('#biometric-server-status');
  status.className = 'ai-status checking';
  status.innerHTML = '<i></i> Comprobando servidor…';
  try {
    const result = await api('/api/biometrics/status');
    if (result.directDahuaConfigured) {
      status.className = 'ai-status connected';
      status.innerHTML = '<i></i> Dahua configurado para registro directo';
      status.title = 'La conectividad y el rostro se comprueban durante el alta. El comparador externo no es necesario.';
    } else if (result.connected) {
      status.className = 'ai-status connected';
      status.innerHTML = '<i></i> Servidor biométrico conectado';
    } else if (result.configured) {
      status.className = 'ai-status offline';
      status.innerHTML = '<i></i> Servidor sin respuesta';
      status.title = result.error || '';
    } else {
      status.className = 'ai-status warning';
      status.innerHTML = '<i></i> Configuración pendiente';
    }
  } catch (error) {
    status.className = 'ai-status offline';
    status.innerHTML = '<i></i> No disponible';
    status.title = error.message;
  }
}

async function refreshAiStatus() {
  const status = $('#ai-status');
  status.className = 'ai-status checking';
  status.innerHTML = '<i></i> Comprobando servidor…';
  try {
    const result = await api('/api/ai/status');
    $('#ai-model').textContent = result.model || 'ia-local:latest';
    if (result.connected && result.modelAvailable !== false) {
      status.className = 'ai-status connected';
      status.innerHTML = '<i></i> IA conectada';
    } else if (result.connected) {
      status.className = 'ai-status warning';
      status.innerHTML = '<i></i> Modelo no disponible';
    } else {
      status.className = 'ai-status offline';
      status.innerHTML = '<i></i> Sin conexión';
      $('#ai-meta').textContent = result.error || 'Revisa la configuración privada de la IA.';
    }
  } catch (error) {
    status.className = 'ai-status offline';
    status.innerHTML = '<i></i> Sin conexión';
    $('#ai-meta').textContent = error.message;
  }
}

function formatAiAnswer(value) {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\n)\s*\*\s+/g, '$1• ')
    .replace(/\n/g, '<br />');
}

// Resumen del día (Pulso) y alertas de seguridad (Pulso y Seguridad).
function alertItems(alerts) {
  return alerts.map((alert) => `<div class="today-alert ${alert.nivel === 'alto' ? 'high' : ''}"><strong>${alert.nivel === 'alto' ? '⚠' : '•'}</strong> ${escapeHtml(alert.texto)}${alert.desde ? ` <small>${shortDate(alert.desde)}</small>` : alert.fecha ? ` <small>${shortDate(alert.fecha)}</small>` : ''}</div>`).join('');
}

async function refreshToday() {
  try {
    state.today = await api('/api/admin/daily-summary');
  } catch (error) {
    $('#today-grid').innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
    return;
  }
  const today = state.today;
  const list = (items, empty) => items.length
    ? `<ul>${items.map((item) => `<li><strong>${escapeHtml(item.huesped || item.codigo)}</strong> · ${escapeHtml(item.alojamiento)}<br /><small>${escapeHtml(item.codigo)}</small></li>`).join('')}</ul>`
    : `<p class="empty">${empty}</p>`;
  $('#today-title').textContent = `Resumen del día · ${today.fecha}`;
  $('#today-grid').innerHTML = `
    <article><span>Llegadas</span><strong>${today.llegadas.length}</strong>${list(today.llegadas, 'Sin llegadas hoy')}</article>
    <article><span>Salidas</span><strong>${today.salidas.length}</strong>${list(today.salidas, 'Sin salidas hoy')}</article>
    <article><span>Pagos por vencer (1 h)</span><strong>${today.pagosPorVencer.length}</strong>${list(today.pagosPorVencer, 'Ninguno')}</article>
    <article><span>Accesos hoy</span><strong>${today.accesosHoy.autorizados}</strong><p class="empty">${today.accesosHoy.rechazados} rechazado(s) · ${today.alojados.length} estadía(s) en curso</p></article>`;
  const alerts = alertItems(today.alertas);
  $('#today-alerts').innerHTML = alerts || '<div class="today-alert ok">✓ Sin alertas de seguridad ni terminales desconectados.</div>';
  $('#security-alerts').innerHTML = alerts;
}

async function refreshAiFeedback() {
  try {
    state.aiFeedback = (await api('/api/admin/ai-feedback')).feedback;
  } catch (error) {
    $('#ai-feedback-table').innerHTML = `<tr><td colspan="5" class="empty">${escapeHtml(error.message)}</td></tr>`;
    return;
  }
  renderAiFeedback();
}

function renderAiFeedback() {
  const onlyDown = $('#ai-feedback-filter').value === 'down';
  const rows = (state.aiFeedback || []).filter((item) => !onlyDown || item.rating === 'down');
  $('#ai-feedback-table').innerHTML = rows.length ? rows.map((item) => `
    <tr>
      <td>${shortDate(item.createdAt)}</td>
      <td>${item.channel === 'gestor' ? 'Gestor' : 'Blu (web / app)'}</td>
      <td>${escapeHtml(item.question)}</td>
      <td><small>${escapeHtml(item.answer.length > 280 ? `${item.answer.slice(0, 279)}…` : item.answer)}</small></td>
      <td>${item.rating === 'up' ? '👍' : '👎'}</td>
    </tr>`).join('') : `<tr><td colspan="5" class="empty">${onlyDown ? 'No hay respuestas marcadas como no útiles.' : 'Aún no hay valoraciones.'}</td></tr>`;
}

async function askAi(question) {
  const submit = $('#ai-submit');
  const answer = $('#ai-answer p');
  const meta = $('#ai-meta');
  submit.disabled = true;
  submit.textContent = 'Pensando…';
  answer.textContent = 'Consultando el servidor remoto…';
  meta.textContent = '';
  try {
    const result = await api('/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ question }),
    });
    answer.innerHTML = formatAiAnswer(result.answer);
    meta.textContent = `${result.model} · ${(result.elapsedMs / 1000).toFixed(1)} s`;
    state.lastAiExchange = { question, answer: result.answer };
    $('#ai-rating').hidden = false;
    $$('#ai-rating button').forEach((button) => { button.disabled = false; button.classList.remove('selected'); });
    $('#ai-rating-note').textContent = '¿Te sirvió?';
    await refreshAiStatus();
  } catch (error) {
    answer.textContent = error.message;
    meta.textContent = 'No se enviaron cambios a la base de datos.';
  } finally {
    submit.disabled = false;
    submit.textContent = 'Preguntar a la IA';
  }
}

function customerName(customerId) {
  return state.customers.find((customer) => customer.id === customerId)?.name || 'Cliente sin identificar';
}

function reservationStatus(reservation) {
  if (reservation.status === 'expirada') {
    return { label: 'Vencida · fechas liberadas', className: 'inactive' };
  }
  if (reservation.status === 'pendiente-verificacion') {
    return { label: 'Correo pendiente', className: 'pending' };
  }
  if (reservation.status === 'correo-verificado-pago-pendiente') {
    return { label: 'Correo verificado · pago pendiente', className: 'pending' };
  }
  if (reservation.status === 'confirmada') {
    return {
      label: reservation.confirmationEmailSentAt ? 'Confirmada · PDF enviado' : 'Confirmada · PDF pendiente',
      className: 'confirmed',
    };
  }
  return { label: 'Confirmada', className: 'confirmed' };
}

function renderSummary() {
  $('#stat-properties').textContent = state.properties.filter((property) => property.active !== false).length;
  $('#stat-customers').textContent = state.customers.length;
  $('#stat-reservations').textContent = state.reservations.length;
  if (state.database) {
    $('#database-path').textContent = state.database.path;
    $('#database-summary').textContent = `${state.database.tables.properties} alojamientos · ${state.database.tables.customers} clientes · ${state.database.tables.reservations} estadías`;
    $('#database-engine').textContent = `${state.database.engine || 'Base'} conectado`;
    $('#database-engine-title').textContent = `${state.database.engine || 'Base de datos'} para DBeaver`;
  }
  const container = $('#recent-reservations');
  if (!state.reservations.length) {
    container.innerHTML = '<div class="empty">Todavía no existen reservas. Confirma una reserva en RestBlu para verla aquí.</div>';
    return;
  }
  container.innerHTML = state.reservations.slice(0, 5).map((reservation) => `
    <article class="activity-row">
      <strong>${escapeHtml(reservation.id)}</strong>
      <div><strong>${escapeHtml(reservation.guestName || customerName(reservation.customerId))}</strong><span>${escapeHtml(reservation.propertyName)} · ${escapeHtml(reservation.checkIn)} al ${escapeHtml(reservation.checkOut)}</span></div>
      <span class="badge ${reservationStatus(reservation).className}">${reservationStatus(reservation).label}</span>
    </article>`).join('');
}

function renderProperties() {
  const query = $('#property-search').value.trim().toLowerCase();
  const items = state.properties.filter((property) => `${property.name} ${property.place} ${property.type} ${property.ownerName || ''} ${property.ownerEmail || ''}`.toLowerCase().includes(query));
  $('#properties-table').innerHTML = items.length ? items.map((property) => `
    <tr>
      <td><div class="property-cell"><img src="${escapeHtml(property.image)}" alt="" /><div><strong>${escapeHtml(property.name)}</strong><small>${escapeHtml(property.type)}</small></div></div></td>
      <td>${escapeHtml(property.place)}</td>
      <td>${property.ownerName ? `<strong>${escapeHtml(property.ownerName)}</strong><br /><small>${escapeHtml(property.ownerEmail || '')}<br />${escapeHtml(property.ownerPhone || '')}</small>` : '<span class="badge inactive">Pendiente</span>'}</td>
      <td>${property.guests} huéspedes · ${property.beds} dorm.</td>
      <td>${money(property.price)}</td>
      <td><span class="badge ${property.active === false ? 'inactive' : 'active'}">${property.active === false ? 'Oculto' : 'Publicado'}</span></td>
      <td><div class="row-actions">${doorButton(property)}<button class="small-button" data-assign-terminal="${property.id}">${property.dahuaRegistrationId ? 'Terminal' : 'Asignar terminal'}</button><button class="small-button" data-edit-property="${property.id}">Editar</button><button class="small-button" data-toggle-property="${property.id}">${property.active === false ? 'Publicar' : 'Ocultar'}</button><button class="small-button danger" data-delete-property="${property.id}">Eliminar</button></div></td>
    </tr>`).join('') : '<tr><td colspan="7" class="empty">No hay alojamientos que coincidan con la búsqueda.</td></tr>';
}

function renderCustomers() {
  const query = $('#customer-search').value.trim().toLowerCase();
  const items = state.customers.filter((customer) => `${customer.name} ${customer.documentId} ${customer.email}`.toLowerCase().includes(query));
  $('#customers-table').innerHTML = items.length ? items.map((customer) => `
    <tr>
      <td><strong>${escapeHtml(customer.name)}</strong></td>
      <td>${escapeHtml(customer.documentId || 'Sin documento')}</td>
      <td>${escapeHtml(customer.email || 'Sin correo')}<br /><small>${escapeHtml(customer.phone || '')}</small><br /><span class="mini-status ${customer.emailVerified ? 'verified' : 'unverified'}">${customer.emailVerified ? 'Validado en una reserva anterior' : 'Sin verificaciones completadas'}</span></td>
      <td>${shortDate(customer.lastReservationAt)}</td>
      <td><span class="badge ${customer.status === 'inactivo' ? 'inactive' : 'active'}">${customer.status === 'inactivo' ? 'Inactivo' : 'Activo'}</span></td>
      <td><button class="small-button" data-edit-customer="${customer.id}">Editar</button></td>
    </tr>`).join('') : '<tr><td colspan="6" class="empty">Todavía no hay clientes registrados.</td></tr>';
}

function renderReservations() {
  const query = $('#reservation-search').value.trim().toLowerCase();
  const items = state.reservations.filter((reservation) => `${reservation.id} ${reservation.guestName || customerName(reservation.customerId)} ${reservation.propertyName}`.toLowerCase().includes(query));
  $('#reservations-table').innerHTML = items.length ? items.map((reservation) => `
    <tr>
      <td><strong>${escapeHtml(reservation.id)}</strong><br /><small>${shortDate(reservation.createdAt)}</small></td>
      <td>${escapeHtml(reservation.guestName || customerName(reservation.customerId))}</td>
      <td>${escapeHtml(reservation.propertyName)}<br /><small>${escapeHtml(reservation.propertyPlace)}</small></td>
      <td>${escapeHtml(reservation.checkIn)} al ${escapeHtml(reservation.checkOut)}<br /><small>${reservation.guests} huéspedes · ${reservation.nights} noches</small></td>
      <td>${money(reservation.total)}</td>
      <td><span class="badge ${reservationStatus(reservation).className}">${reservationStatus(reservation).label}</span></td>
      <td><button class="small-button" data-view-reservation="${escapeHtml(reservation.id)}">Ver detalle</button></td>
    </tr>`).join('') : '<tr><td colspan="7" class="empty">Todavía no hay reservas registradas.</td></tr>';
}

function biometricStatus(reservation) {
  if (reservation.status !== 'confirmada') return { label: 'Reserva pendiente', className: 'pending' };
  if (reservation.biometricStatus === 'activa') return { label: 'Rostro registrado', className: 'active' };
  if (reservation.biometricStatus === 'expirada') return { label: 'Expirada', className: 'inactive' };
  if (reservation.biometricStatus === 'error') return { label: 'Registro con error', className: 'inactive' };
  return { label: 'Sin registrar', className: 'pending' };
}

function dahuaAccessStatus(reservation) {
  const labels = {
    verificado: ['Rostro confirmado', 'active'],
    'registrado-sin-verificar': ['Registrado · revisar', 'pending'],
    'pendiente-configuracion': ['Sin configurar', 'pending'],
    error: ['Error de alta', 'inactive'],
    'revocacion-pendiente': ['Revocación pendiente', 'inactive'],
    revocado: ['Revocado', 'inactive'],
  };
  const [label, className] = labels[reservation.dahuaStatus] || ['Sin registrar', 'pending'];
  return { label, className };
}

function dahuaQrStatus(reservation) {
  const labels = {
    activo: ['QR habilitado', 'active'],
    'pendiente-configuracion': ['QR sin configurar', 'pending'],
    error: ['QR con error', 'inactive'],
    revocado: ['QR revocado', 'inactive'],
  };
  const [label, className] = labels[reservation.dahuaQrStatus] ||
    [reservation.status === 'confirmada' ? 'QR pendiente' : 'QR sin emitir', 'pending'];
  return { label, className };
}

function renderBiometrics() {
  const query = $('#biometric-search').value.trim().toLowerCase();
  const items = state.reservations.filter((reservation) =>
    `${reservation.id} ${customerName(reservation.customerId)} ${reservation.propertyName}`
      .toLowerCase()
      .includes(query),
  );
  $('#biometrics-table').innerHTML = items.length ? items.map((reservation) => {
    const status = biometricStatus(reservation);
    const dahua = dahuaAccessStatus(reservation);
    const canVerify = reservation.status === 'confirmada' && reservation.biometricStatus === 'activa' &&
      reservation.biometricVerificationAvailable;
    return `
      <tr>
        <td><strong>${escapeHtml(reservation.id)}</strong><br /><small>${escapeHtml(reservation.checkIn)} al ${escapeHtml(reservation.checkOut)}</small></td>
        <td>${escapeHtml(customerName(reservation.customerId))}</td>
        <td>${escapeHtml(reservation.propertyName)}</td>
        <td><span class="badge ${status.className}">${status.label}</span>${reservation.biometricLastError ? `<br /><small>${escapeHtml(reservation.biometricLastError)}</small>` : ''}</td>
        <td><span class="badge ${dahua.className}">${dahua.label}</span>${reservation.dahuaError ? `<br /><small>${escapeHtml(reservation.dahuaError)}</small>` : ''}</td>
        <td>${reservation.biometricLastVerifiedAt ? shortDate(reservation.biometricLastVerifiedAt) : 'Sin verificaciones'}${reservation.biometricLastScore == null ? '' : `<br /><small>Puntaje: ${Number(reservation.biometricLastScore).toFixed(3)}</small>`}</td>
        <td><button class="small-button" data-verify-biometric="${escapeHtml(reservation.id)}" ${canVerify ? '' : 'disabled'}>${canVerify ? 'Verificar rostro' : reservation.dahuaStatus === 'verificado' ? 'Se valida en el Dahua' : 'No disponible'}</button></td>
      </tr>`;
  }).join('') : '<tr><td colspan="7" class="empty">No hay reservas que coincidan con la búsqueda.</td></tr>';
}

function renderAccess() {
  const now = new Date();
  const today = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString().slice(0, 10);
  const confirmed = state.reservations.filter((reservation) => reservation.status === 'confirmada');
  $('#access-confirmed').textContent = String(confirmed.length);
  $('#access-current').textContent = String(confirmed.filter((reservation) =>
    reservation.dahuaQrStatus === 'activo' && reservation.checkOut >= today).length);
  $('#access-biometric').textContent = String(confirmed.filter((reservation) =>
    ['verificado', 'registrado-sin-verificar'].includes(reservation.dahuaStatus)).length);

  const query = $('#access-search').value.trim().toLowerCase();
  const items = state.reservations.filter((reservation) =>
    `${reservation.id} ${reservation.guestName || customerName(reservation.customerId)} ${reservation.propertyName}`
      .toLowerCase().includes(query));
  $('#access-table').innerHTML = items.length ? items.map((reservation) => {
    const state = reservationStatus(reservation);
    const biometric = biometricStatus(reservation);
    const dahua = dahuaAccessStatus(reservation);
    const qr = dahuaQrStatus(reservation);
    return `<tr>
      <td><strong>${escapeHtml(reservation.id)}</strong></td>
      <td>${escapeHtml(reservation.guestName || customerName(reservation.customerId))}</td>
      <td>${escapeHtml(reservation.propertyName)}<br /><small>${escapeHtml(reservation.checkIn)} al ${escapeHtml(reservation.checkOut)}</small></td>
      <td><span class="badge ${state.className}">${state.label}</span></td>
      <td><span class="badge ${biometric.className}">${biometric.label}</span></td>
      <td><span class="badge ${qr.className}">${qr.label}</span><br /><span class="badge ${dahua.className}">${dahua.label}</span>${reservation.dahuaQrError ? `<br /><small>${escapeHtml(reservation.dahuaQrError)}</small>` : ''}</td>
      <td><button class="small-button" data-view-reservation="${escapeHtml(reservation.id)}">Ver estadía</button></td>
    </tr>`;
  }).join('') : '<tr><td colspan="7" class="empty">No hay reservas que coincidan con la búsqueda.</td></tr>';
}

function renderAll() {
  renderSummary();
  renderProperties();
  renderCustomers();
  renderReservations();
  renderBiometrics();
  renderAccess();
}

function openProperty(property = null) {
  $('#property-dialog-title').textContent = property ? 'Editar alojamiento' : 'Nuevo alojamiento';
  $('#property-id').value = property?.id || '';
  $('#property-name').value = property?.name || '';
  $('#property-place').value = property?.place || '';
  $('#property-address').value = property?.address || '';
  $('#property-commune').value = property?.commune || '';
  $('#property-region').value = property?.region || '';
  $('#property-description').value = property?.description || '';
  $('#property-owner-name').value = property?.ownerName || '';
  $('#property-owner-document').value = property?.ownerDocumentId || '';
  $('#property-owner-email').value = property?.ownerEmail || '';
  $('#property-owner-phone').value = property?.ownerPhone || '';
  $('#property-dahua-terminal').value = property?.dahuaRegistrationId || '';
  $('#property-guide-public').value = property?.guidePublic || '';
  $('#property-guide-private').value = property?.guidePrivate || '';
  $('#property-type').value = property?.type || '';
  $('#property-price').value = property?.price || 100000;
  $('#property-guests').value = property?.guests || 2;
  $('#property-beds').value = property?.beds || 1;
  $('#property-bed-count').value = property?.bedCount || property?.beds || 1;
  $('#property-baths').value = property?.baths || 1;
  $('#property-rating').value = property?.rating || 4.8;
  $('#property-check-in-time').value = property?.checkInTime || '15:00';
  $('#property-check-out-time').value = property?.checkOutTime || '11:00';
  $('#property-latitude').value = property?.latitude ?? '';
  $('#property-longitude').value = property?.longitude ?? '';
  $('#property-tags').value = property?.tags?.join(', ') || '';
  setStoredImage(imageSlots[0], property?.image || '');
  setStoredImage(imageSlots[1], property?.gallery?.[0]?.src || '');
  setStoredImage(imageSlots[2], property?.gallery?.[1]?.src || '');
  $('#property-active').checked = property?.active !== false;
  $('#property-dialog').showModal();
}

function openCustomer(customer) {
  $('#customer-id').value = customer.id;
  $('#customer-name').value = customer.name || '';
  $('#customer-document').value = customer.documentId || '';
  $('#customer-email').value = customer.email || '';
  $('#customer-phone').value = customer.phone || '';
  $('#customer-nationality').value = customer.nationality || 'Chile';
  $('#customer-birth-date').value = customer.birthDate || '';
  $('#customer-emergency-name').value = customer.emergencyContactName || '';
  $('#customer-emergency-phone').value = customer.emergencyContactPhone || '';
  $('#customer-email-verified').checked = customer.emailVerified === true;
  $('#customer-notes').value = customer.notes || '';
  $('#customer-status').value = customer.status || 'activo';
  $('#customer-dialog').showModal();
}

function detailRow(label, value, strong = false) {
  return `<div><dt>${escapeHtml(label)}</dt><dd class="${strong ? 'strong' : ''}">${escapeHtml(value ?? 'Sin registro')}</dd></div>`;
}

function openReservation(reservation) {
  const customer = state.customers.find((item) => item.id === reservation.customerId);
  const property = state.properties.find((item) => item.id === reservation.propertyId);
  $('#reservation-dialog-title').textContent = reservation.id;
  $('#reservation-detail').innerHTML = `
    <section><p class="eyebrow">RESUMEN</p><dl class="record-grid">
      ${detailRow('Estado', reservationStatus(reservation).label, true)}
      ${detailRow('Cliente', reservation.guestName || customer?.name || 'Cliente sin identificar')}
      ${detailRow('RUT', reservation.guestDocumentId || customer?.documentId || 'Sin documento')}
      ${detailRow('Correo', reservation.guestEmail || customer?.email || 'Sin correo')}
      ${detailRow('Alojamiento', reservation.propertyName)}
      ${detailRow('Ubicación', reservation.propertyPlace)}
    </dl></section>
    <section><p class="eyebrow">PROPIETARIO · PRIVADO</p><dl class="record-grid">
      ${detailRow('Nombre', property?.ownerName || 'Pendiente de completar')}
      ${detailRow('RUT', property?.ownerDocumentId || 'Sin registro')}
      ${detailRow('Correo', property?.ownerEmail || 'Sin registro')}
      ${detailRow('Teléfono', property?.ownerPhone || 'Sin registro')}
    </dl></section>
    <section><p class="eyebrow">CONTROL DE ACCESO</p><dl class="record-grid">
      ${detailRow('Terminal Dahua', reservation.dahuaTerminal === 'lan' ? 'Red local' : reservation.dahuaTerminal || property?.dahuaRegistrationId || 'Por omisión')}
      ${detailRow('QR en el terminal', reservation.dahuaQrStatus || 'sin-registrar')}
    </dl></section>
    <section><p class="eyebrow">FECHAS Y HUÉSPEDES</p><dl class="record-grid">
      ${detailRow('Check-in', `${reservation.checkIn} · ${reservation.checkInTime || '15:00'}`)}
      ${detailRow('Check-out', `${reservation.checkOut} · ${reservation.checkOutTime || '11:00'}`)}
      ${detailRow('Noches', reservation.nights)}
      ${detailRow('Huéspedes', reservation.guests)}
      ${detailRow('Adultos', reservation.adults ?? reservation.guests)}
      ${detailRow('Niños', reservation.children ?? 0)}
    </dl></section>
    <section><p class="eyebrow">VALORES</p><dl class="record-grid">
      ${detailRow('Tarifa por noche', money(reservation.nightlyPrice))}
      ${detailRow('Subtotal', money(reservation.subtotal))}
      ${detailRow('Limpieza', money(reservation.cleaningFee))}
      ${detailRow('Servicio', money(reservation.serviceFee))}
      ${detailRow('Impuestos', money(reservation.taxes))}
      ${detailRow('Total', money(reservation.total), true)}
      ${detailRow('Pago', reservation.paymentStatus === 'aprobado-demo' ? 'Aprobado en Webpay' : reservation.paymentStatus === 'reembolso-pendiente' ? 'Aprobado · reembolso pendiente' : 'Pendiente')}
      ${detailRow('Autorización Webpay', reservation.paymentReference || '—')}
      ${reservation.paymentDetail ? detailRow('Medio de pago', reservation.paymentDetail) : ''}
    </dl></section>
    <section><p class="eyebrow">VERIFICACIÓN Y ACCESO</p><dl class="record-grid">
      ${detailRow('PIN temporal', reservation.accessPin || 'Pendiente')}
      ${detailRow('Acceso con PIN', reservation.dahuaUserId
        ? 'En el terminal, elegir acceso por contraseña e introducir el ID Dahua y el PIN.'
        : 'Pendiente de alta de la persona en Dahua.')}
      ${detailRow('QR Dahua', dahuaQrStatus(reservation).label)}
      ${detailRow('Alta QR', shortDate(reservation.dahuaQrEnrolledAt))}
      ${reservation.dahuaQrError ? detailRow('Último error QR', reservation.dahuaQrError) : ''}
      ${detailRow('Rostro Dahua', dahuaAccessStatus(reservation).label)}
      ${detailRow('ID en Dahua', reservation.dahuaUserId || 'Sin registrar')}
      ${detailRow('Huella digital', reservation.dahuaUserId
        ? 'Captura presencial en Gestión de personal del Dahua: busca este ID, edita la persona y registra FP con su lector.'
        : 'Primero confirma el pago y espera el alta de la persona en Dahua.')}
      ${detailRow('Biometría del teléfono', 'App Android 2.1.0: el huésped autoriza la apertura con la biometría del móvil. No se registra la huella en Dahua.')}
      ${detailRow('Alta Dahua', shortDate(reservation.dahuaEnrolledAt))}
      ${detailRow('Verificación Dahua', shortDate(reservation.dahuaVerifiedAt))}
      ${detailRow('Revocación Dahua', shortDate(reservation.dahuaRevokedAt))}
      ${reservation.dahuaError ? detailRow('Último error Dahua', reservation.dahuaError) : ''}
      ${detailRow('Correo de verificación', shortDate(reservation.verificationEmailSentAt))}
      ${detailRow('Correo verificado', shortDate(reservation.emailVerifiedAt))}
      ${detailRow('PDF enviado', shortDate(reservation.confirmationEmailSentAt))}
      ${detailRow('Creada', shortDate(reservation.createdAt))}
      ${detailRow('Solicitudes', reservation.specialRequests || 'Sin solicitudes especiales')}
    </dl></section>`;
  $('#reservation-dialog').showModal();
}

function stopBiometricCamera() {
  biometricScanId += 1;
  if (biometricScanTimer) clearTimeout(biometricScanTimer);
  biometricScanTimer = null;
  if (biometricStream) biometricStream.getTracks().forEach((track) => track.stop());
  biometricStream = null;
  const video = $('#biometric-video');
  if (video) video.srcObject = null;
}

function closeBiometricDialog() {
  stopBiometricCamera();
  biometricReservation = null;
  if ($('#biometric-dialog').open) $('#biometric-dialog').close();
}

async function openBiometricVerification(reservation) {
  stopBiometricCamera();
  const sessionId = biometricScanId;
  biometricReservation = reservation;
  $('#biometric-dialog-title').textContent = `Verificar ${reservation.id}`;
  $('#biometric-reservation-summary').textContent = `${customerName(reservation.customerId)} · ${reservation.propertyName} · ${reservation.checkIn} al ${reservation.checkOut}`;
  const result = $('#biometric-result');
  result.className = 'biometric-result neutral';
  result.textContent = 'Solicitando acceso a la cámara…';
  $('#biometric-dialog').showModal();
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Este navegador no permite usar la cámara en este contexto.');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } },
      audio: false,
    });
    if (sessionId !== biometricScanId || !$('#biometric-dialog').open) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    biometricStream = stream;
    const video = $('#biometric-video');
    video.srcObject = biometricStream;
    await video.play();
    result.textContent = 'Preparando la observación pasiva del rostro…';
    const landmarker = await loadFaceLandmarker();
    if (sessionId !== biometricScanId || !biometricReservation) return;
    startBiometricScan(landmarker, sessionId);
  } catch (error) {
    if (sessionId !== biometricScanId) return;
    stopBiometricCamera();
    result.className = 'biometric-result failure';
    result.textContent = `No fue posible iniciar la cámara o el análisis facial. ${error.message}`;
  }
}

function loadFaceLandmarker() {
  if (!faceLandmarkerPromise) {
    faceLandmarkerPromise = (async () => {
      const packageUrl = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35';
      const { FaceLandmarker, FilesetResolver } = await import(`${packageUrl}/vision_bundle.mjs`);
      const vision = await FilesetResolver.forVisionTasks(`${packageUrl}/wasm`);
      return FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
        },
        runningMode: 'VIDEO',
        numFaces: 2,
        outputFaceBlendshapes: true,
      });
    })().catch((error) => {
      faceLandmarkerPromise = null;
      throw error;
    });
  }
  return faceLandmarkerPromise;
}

function biometricSample(detection) {
  const faces = detection.faceLandmarks?.length || 0;
  if (faces !== 1) return { faces };
  const landmarks = detection.faceLandmarks[0];
  let minX = 1; let maxX = 0; let minY = 1; let maxY = 0;
  for (const point of landmarks) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  if (maxX - minX < 0.18 || maxY - minY < 0.22 ||
      minX < 0.02 || maxX > 0.98 || minY < 0.02 || maxY > 0.98) {
    return { faces: 0 };
  }
  const categories = detection.faceBlendshapes?.[0]?.categories || [];
  const score = (name) => categories.find((category) => category.categoryName === name)?.score ?? 0;
  return {
    faces: 1,
    blinkLeft: score('eyeBlinkLeft'),
    blinkRight: score('eyeBlinkRight'),
    box: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, width: maxX - minX, height: maxY - minY },
  };
}

function startBiometricScan(landmarker, scanId) {
  const video = $('#biometric-video');
  const result = $('#biometric-result');
  const observation = new PassiveFaceObservation();
  let lastVideoTime = -1;
  let attempts = 0;
  let cooldownUntil = 0;
  const scan = async () => {
    if (scanId !== biometricScanId || !biometricStream || !biometricReservation) return;
    try {
      const now = performance.now();
      if (now >= cooldownUntil && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const detection = landmarker.detectForVideo(video, now);
        const progress = observation.update(biometricSample(detection), now);
        result.className = 'biometric-result neutral';
        result.textContent = progress.message;
        if (progress.ready) {
          attempts += 1;
          const match = await verifyBiometricIdentity(scanId);
          if (scanId !== biometricScanId || match === null) return;
          if (match) {
            stopBiometricCamera();
            return;
          }
          if (attempts >= 3) {
            result.textContent += ' Límite de 3 intentos en esta sesión; solicita revisión manual.';
            stopBiometricCamera();
            return;
          }
          observation.reset();
          cooldownUntil = performance.now() + 3_000;
        }
      }
    } catch (error) {
      result.className = 'biometric-result failure';
      result.textContent = `Se detuvo la verificación automática: ${error.message}`;
      stopBiometricCamera();
      return;
    }
    biometricScanTimer = setTimeout(scan, 90);
  };
  biometricScanTimer = setTimeout(scan, 90);
}

function captureBiometricFrame() {
  const video = $('#biometric-video');
  if (!video.videoWidth || !video.videoHeight) throw new Error('La cámara todavía no está lista.');
  const canvas = $('#biometric-canvas');
  const scale = Math.min(1, 720 / video.videoWidth);
  canvas.width = Math.max(160, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(160, Math.round(video.videoHeight * scale));
  const context = canvas.getContext('2d', { alpha: false });
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.88);
}

async function verifyBiometricIdentity(scanId) {
  if (!biometricReservation) return null;
  const result = $('#biometric-result');
  result.className = 'biometric-result neutral';
  result.textContent = 'Señal facial natural detectada. Comparando con la plantilla cifrada…';
  try {
    const response = await api('/api/admin/biometrics/verify', {
      method: 'POST',
      body: JSON.stringify({
        reservationId: biometricReservation.id,
        image: captureBiometricFrame(),
      }),
    });
    if (scanId !== biometricScanId) return null;
    result.className = `biometric-result ${response.match ? 'success' : 'failure'}`;
    const score = response.score == null ? '' : ` Puntaje: ${Number(response.score).toFixed(3)}.`;
    result.textContent = response.match
      ? `Coincidencia facial positiva tras la observación pasiva.${score} No es prueba de vida certificada; requiere supervisión humana.`
      : `El rostro no coincide con la plantilla registrada.${score} Se intentará de nuevo tras una pausa.`;
    await refresh();
    return Boolean(response.match);
  } catch (error) {
    if (scanId !== biometricScanId) return null;
    result.className = 'biometric-result failure';
    result.textContent = error.message;
    stopBiometricCamera();
    return null;
  }
}

$$('.nav-item').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
$$('[data-go]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.go)));
$('#property-search').addEventListener('input', renderProperties);
$('#customer-search').addEventListener('input', renderCustomers);
$('#reservation-search').addEventListener('input', renderReservations);
$('#biometric-search').addEventListener('input', renderBiometrics);
$('#access-search').addEventListener('input', renderAccess);
$('#security-days').addEventListener('change', () => void refreshSecurity());
$('#security-search').addEventListener('input', renderSecurity);
$('#security-all').addEventListener('click', () => { state.securityProperty = ''; renderSecurity(); });
function openTerminalDialog(propertyId) {
  const property = state.properties.find((item) => String(item.id) === String(propertyId));
  if (!property) return;
  const hub = state.dahuaHub;
  $('#terminal-property-id').value = property.id;
  $('#terminal-dialog-title').textContent = `Terminal de ${property.name}`;
  $('#terminal-registration-id').value = property.dahuaRegistrationId || '';
  const online = hub?.connected ? hub.online || [] : [];
  $('#terminal-online-list').innerHTML = online.map((id) => `<option value="${escapeHtml(id)}"></option>`).join('');
  $('#terminal-online-hint').textContent = !hub?.configured
    ? 'El hub Dahua no está configurado en este gestor: las reservas usan el Dahua de la red local.'
    : !hub.connected ? `El hub no responde (${hub.error || 'sin conexión'}). Puedes guardar igual; se aplicará cuando vuelva.`
      : online.length ? `Terminales en línea ahora: ${online.join(', ')}.${hub.defaultDevice ? ` Por omisión: ${hub.defaultDevice}.` : ''}`
        : 'No hay terminales en línea en este momento.';
  $('#terminal-dialog').showModal();
}

$('#terminal-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const property = state.properties.find((item) => String(item.id) === $('#terminal-property-id').value);
  if (!property) return;
  const registrationId = $('#terminal-registration-id').value.trim();
  try {
    await api(`/api/properties/${property.id}`, {
      method: 'PUT', body: JSON.stringify({ ...property, dahuaRegistrationId: registrationId }),
    });
    $('#terminal-dialog').close();
    await refresh();
    await refreshSecurity();
    showToast(registrationId ? `${property.name} quedó con el terminal ${registrationId}.` : `${property.name} usará el terminal por omisión.`);
  } catch (error) { showToast(error.message); }
});
$$('.close-terminal').forEach((button) => button.addEventListener('click', () => $('#terminal-dialog').close()));

$('#security-properties').addEventListener('click', (event) => {
  const open = event.target.closest('[data-open-property-door]');
  if (open) {
    void openPropertyDoor(open.dataset.openPropertyDoor);
    return;
  }
  const assign = event.target.closest('[data-assign-terminal]');
  if (assign) {
    openTerminalDialog(assign.dataset.assignTerminal);
    return;
  }
  const card = event.target.closest('[data-security-property]');
  if (!card) return;
  const key = card.dataset.securityProperty;
  state.securityProperty = state.securityProperty === key ? '' : key;
  renderSecurity();
});
$('#new-property').addEventListener('click', () => openProperty());
$('#ai-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const question = $('#ai-question').value.trim();
  if (question) await askAi(question);
});
$$('[data-ai-question]').forEach((button) => button.addEventListener('click', async () => {
  const question = button.dataset.aiQuestion;
  $('#ai-question').value = question;
  await askAi(question);
}));
imageSlots.forEach((slot) => $(slot.file).addEventListener('change', () => previewSelectedImage(slot)));
$$('.close-dialog').forEach((button) => button.addEventListener('click', () => $('#property-dialog').close()));
$$('.close-customer').forEach((button) => button.addEventListener('click', () => $('#customer-dialog').close()));
$$('.close-reservation').forEach((button) => button.addEventListener('click', () => $('#reservation-dialog').close()));
$$('.close-biometric').forEach((button) => button.addEventListener('click', closeBiometricDialog));
$('#biometric-dialog').addEventListener('close', stopBiometricCamera);

$('#properties-table').addEventListener('click', async (event) => {
  const open = event.target.closest('[data-open-property-door]');
  if (open) {
    await openPropertyDoor(open.dataset.openPropertyDoor);
    return;
  }
  const assign = event.target.closest('[data-assign-terminal]');
  if (assign) {
    openTerminalDialog(assign.dataset.assignTerminal);
    return;
  }
  const edit = event.target.closest('[data-edit-property]');
  const toggle = event.target.closest('[data-toggle-property]');
  const remove = event.target.closest('[data-delete-property]');
  if (edit) openProperty(state.properties.find((property) => property.id === Number(edit.dataset.editProperty)));
  if (toggle) {
    try {
      await api(`/api/properties/${toggle.dataset.toggleProperty}/toggle`, { method: 'POST', body: '{}' });
      await refresh();
      showToast('Estado del alojamiento actualizado.');
    } catch (error) { showToast(error.message); }
  }
  if (remove) {
    const property = state.properties.find((item) => item.id === Number(remove.dataset.deleteProperty));
    if (!property) return;
    const confirmed = window.confirm(
      `¿Eliminar definitivamente "${property.name}"?\n\nEsta acción no se puede deshacer.`,
    );
    if (!confirmed) return;
    remove.disabled = true;
    try {
      await api(`/api/properties/${property.id}`, { method: 'DELETE' });
      await refresh();
      showToast('Alojamiento eliminado de RestBlu.');
    } catch (error) {
      showToast(error.message);
      remove.disabled = false;
    }
  }
});

$('#customers-table').addEventListener('click', (event) => {
  const edit = event.target.closest('[data-edit-customer]');
  if (edit) openCustomer(state.customers.find((customer) => customer.id === Number(edit.dataset.editCustomer)));
});

$('#reservations-table').addEventListener('click', (event) => {
  const detail = event.target.closest('[data-view-reservation]');
  if (detail) openReservation(state.reservations.find((reservation) => reservation.id === detail.dataset.viewReservation));
});

$('#access-table').addEventListener('click', (event) => {
  const detail = event.target.closest('[data-view-reservation]');
  if (detail) openReservation(state.reservations.find((reservation) => reservation.id === detail.dataset.viewReservation));
});

$('#security-table').addEventListener('click', (event) => {
  const detail = event.target.closest('[data-view-reservation]');
  const reservation = detail && state.reservations.find((item) => item.id === detail.dataset.viewReservation);
  if (reservation) openReservation(reservation);
  else if (detail) showToast('La reserva ya no existe en el gestor.');
});

$('#biometrics-table').addEventListener('click', (event) => {
  const verify = event.target.closest('[data-verify-biometric]');
  if (!verify) return;
  const reservation = state.reservations.find(
    (item) => item.id === verify.dataset.verifyBiometric,
  );
  if (reservation) void openBiometricVerification(reservation);
});

$('#property-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = $('#property-id').value;
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  const originalButtonText = submitButton.textContent;
  submitButton.disabled = true;
  submitButton.textContent = 'Guardando imágenes…';
  try {
    const [mainImage, galleryImage1, galleryImage2] = await Promise.all(imageSlots.map(resolveImage));
    if (!mainImage) throw new Error('Selecciona una imagen principal.');
    const payload = {
      name: $('#property-name').value,
      place: $('#property-place').value,
      address: $('#property-address').value,
      commune: $('#property-commune').value,
      region: $('#property-region').value,
      description: $('#property-description').value,
      ownerName: $('#property-owner-name').value,
      ownerDocumentId: $('#property-owner-document').value,
      ownerEmail: $('#property-owner-email').value,
      ownerPhone: $('#property-owner-phone').value,
      dahuaRegistrationId: $('#property-dahua-terminal').value.trim(),
      guidePublic: $('#property-guide-public').value,
      guidePrivate: $('#property-guide-private').value,
      type: $('#property-type').value,
      price: Number($('#property-price').value),
      guests: Number($('#property-guests').value),
      beds: Number($('#property-beds').value),
      bedCount: Number($('#property-bed-count').value),
      baths: Number($('#property-baths').value),
      rating: Number($('#property-rating').value),
      checkInTime: $('#property-check-in-time').value,
      checkOutTime: $('#property-check-out-time').value,
      latitude: $('#property-latitude').value,
      longitude: $('#property-longitude').value,
      tags: $('#property-tags').value,
      image: mainImage,
      gallery: [
        { src: galleryImage1, alt: `${$('#property-name').value} fotografía secundaria 1` },
        { src: galleryImage2, alt: `${$('#property-name').value} fotografía secundaria 2` },
      ],
      active: $('#property-active').checked,
    };
    await api(id ? `/api/properties/${id}` : '/api/properties', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    $('#property-dialog').close();
    await refresh();
    showToast(id ? 'Alojamiento actualizado.' : 'Alojamiento creado y disponible en RestBlu.');
  } catch (error) { showToast(error.message); }
  finally {
    submitButton.disabled = false;
    submitButton.textContent = originalButtonText;
  }
});

$('#customer-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = $('#customer-id').value;
  const payload = {
    name: $('#customer-name').value,
    documentId: $('#customer-document').value,
    email: $('#customer-email').value,
    phone: $('#customer-phone').value,
    nationality: $('#customer-nationality').value,
    birthDate: $('#customer-birth-date').value,
    emergencyContactName: $('#customer-emergency-name').value,
    emergencyContactPhone: $('#customer-emergency-phone').value,
    notes: $('#customer-notes').value,
    status: $('#customer-status').value,
  };
  try {
    await api(`/api/customers/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    $('#customer-dialog').close();
    await refresh();
    showToast('Datos del cliente actualizados.');
  } catch (error) { showToast(error.message); }
});

refresh().catch((error) => showToast(error.message));
window.setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  if ($('#ai-view').classList.contains('active')) void refreshAiStatus();
  if ($('#biometrics-view').classList.contains('active')) void refreshBiometricStatus();
  if ($('#security-view').classList.contains('active')) void refreshSecurity();
}, 30_000);
