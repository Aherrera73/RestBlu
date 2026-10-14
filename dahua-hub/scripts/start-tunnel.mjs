import { execFile, spawn } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPrivateConfig } from '../src/config.mjs';

// Abre el túnel TCP de ngrok hacia el hub (puerto 9500) en su propia ventana y
// muestra la dirección pública. Si cambió desde la última vez, intenta apuntar
// el Dahua de la red local a la nueva dirección; si no está en esa red, indica
// cómo hacerlo. Lo usa Abrir_Tunel_Dahua.bat.

const PROJECT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const NGROK_API = 'http://127.0.0.1:4040/api/tunnels';
loadPrivateConfig();
const HUB_PORT = Number(process.env.DAHUA_HUB_TCP_PORT || 9500);
const RESTBLU_DIR = join(process.env.LOCALAPPDATA || '.', 'RestBlu');
const LAST_ADDRESS_FILE = join(RESTBLU_DIR, 'ngrok-ultima-direccion.txt');
const reservedAddress = String(process.env.NGROK_TCP_ADDRESS || '').trim().replace(/^tcp:\/\//i, '');
if (reservedAddress) {
  const match = /^([a-z0-9.-]+):(\d{1,5})$/i.exec(reservedAddress);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535) {
    throw new Error('NGROK_TCP_ADDRESS debe tener formato host:puerto de una dirección TCP reservada.');
  }
}

function tunnelPort(item) {
  const address = String(item.config?.addr || '');
  return Number(address.match(/(?:^|:)(\d+)$/)?.[1] || 0);
}

function findNgrok() {
  const home = process.env.USERPROFILE || '';
  const candidates = [
    process.env.NGROK_PATH,
    join(home, 'Desktop', 'ngrok.exe'),
    join(home, 'OneDrive', 'Escritorio', 'ngrok.exe'),
    join(home, 'Escritorio', 'ngrok.exe'),
    join(home, 'Downloads', 'ngrok.exe'),
    join(home, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links', 'ngrok.exe'),
  ].filter(Boolean);
  const found = candidates.find((path) => existsSync(path));
  if (found) return found;
  return 'ngrok'; // en el PATH
}

async function currentTunnel() {
  try {
    const response = await fetch(NGROK_API, { signal: AbortSignal.timeout(2_000) });
    const { tunnels = [] } = await response.json();
    const tunnel = tunnels.find((item) =>
      String(item.public_url || '').startsWith('tcp://') && tunnelPort(item) === HUB_PORT);
    if (!tunnel && tunnels.some((item) => String(item.public_url || '').startsWith('tcp://'))) {
      throw new Error(`ngrok tiene un túnel TCP abierto, pero no hacia el hub en el puerto ${HUB_PORT}.`);
    }
    return tunnel ? new URL(tunnel.public_url) : null;
  } catch (error) {
    if (error?.message?.includes('pero no hacia el hub')) throw error;
    return null;
  }
}

// Terminales que el hub ve conectados ahora (si están conectados, la
// dirección que tienen configurada es la correcta).
async function hubOnline() {
  try {
    const response = await fetch(`http://127.0.0.1:${process.env.DAHUA_HUB_API_PORT || 3200}/api/devices/online`, {
      headers: process.env.DAHUA_HUB_API_KEY ? { 'x-api-key': process.env.DAHUA_HUB_API_KEY } : {},
      signal: AbortSignal.timeout(3_000),
    });
    return (await response.json()).devices.map((device) => device.registrationId.toUpperCase());
  } catch {
    // El gestor ya tiene acceso al hub aunque este lanzador no tenga su clave.
    try {
      const response = await fetch('http://127.0.0.1:3100/api/dahua/hub', {
        signal: AbortSignal.timeout(3_000),
      });
      const status = await response.json();
      return status.connected ? status.online.map((id) => id.toUpperCase()) : [];
    } catch {
      return [];
    }
  }
}

async function hubListening() {
  try {
    const response = await fetch(`http://127.0.0.1:${process.env.DAHUA_HUB_API_PORT || 3200}/api/health`, {
      headers: process.env.DAHUA_HUB_API_KEY ? { 'x-api-key': process.env.DAHUA_HUB_API_KEY } : {},
      signal: AbortSignal.timeout(2_000),
    });
    if (response.ok) return true;
  } catch { /* usar el diagnóstico del gestor */ }
  try {
    const response = await fetch('http://127.0.0.1:3100/api/dahua/hub', {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok && Boolean((await response.json()).connected);
  } catch {
    return false;
  }
}

function configureDahua(registrationId) {
  return new Promise((done) => {
    execFile(process.execPath, [join(PROJECT, 'backend', 'scripts', 'configure-dahua-autoregister.mjs'), '--id', registrationId],
      { cwd: join(PROJECT, 'backend'), timeout: 40_000 }, (error, stdout, stderr) => {
        done({ ok: !error, output: `${stdout}${stderr}`.split(/\r?\n/).filter((line) => line && !/ExperimentalWarning|trace-warnings/.test(line)).join('\n') });
      });
  });
}

async function printManualConfiguration(tunnel) {
  const ip = await lookup(tunnel.hostname, { family: 4 }).then((result) => result.address).catch(() => 'consultar DNS');
  console.log('En la red del Dahua, abre su web y edita Network → Registro Automático CGI:');
  console.log(`  Address / Dirección IP: ${ip}`);
  console.log(`  Domain / Nombre de dominio: ${tunnel.hostname}`);
  console.log(`  Port / Puerto: ${tunnel.port}`);
  console.log('Conserva el ajuste HTTPS del terminal. La IP puede cambiar aunque el dominio y el puerto sigan iguales.');
}

// Sin process.exit(): en Windows, salir de golpe justo después de usar fetch
// hace fallar a Node. Se devuelve el código y el proceso termina solo.
async function main() {
  if (!(await hubListening())) {
    console.log('Aviso: el hub Dahua no responde. Abre también Abrir_Dahua_Hub.bat.\n');
  }

  let tunnel;
  try {
    tunnel = await currentTunnel();
  } catch (error) {
    console.error(`${error.message} Cierra ese túnel y ejecuta Abrir_Tunel_Dahua.bat otra vez.`);
    return 1;
  }
  if (tunnel) {
    if (reservedAddress && `${tunnel.hostname}:${tunnel.port}`.toLowerCase() !== reservedAddress.toLowerCase()) {
      console.error(`El túnel activo usa ${tunnel.hostname}:${tunnel.port}, pero NGROK_TCP_ADDRESS indica ${reservedAddress}. Cierra el túnel actual y vuelve a abrirlo.`);
      return 1;
    }
    console.log('El túnel ngrok ya estaba abierto.');
  } else {
    const ngrok = findNgrok();
    console.log(`Abriendo ngrok (${ngrok}) en una ventana aparte…`);
    // Ventana propia: cerrarla corta el túnel.
    spawn('cmd.exe', ['/c', 'start', '"Tunel ngrok Dahua"', ngrok, 'tcp',
      ...(reservedAddress ? [`--url=${reservedAddress}`] : []), String(HUB_PORT)], {
      detached: true, stdio: 'ignore', windowsVerbatimArguments: true,
    }).unref();
    for (let attempt = 0; attempt < 30 && !tunnel; attempt += 1) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
      try {
        tunnel = await currentTunnel();
      } catch (error) {
        console.error(error.message);
        return 1;
      }
    }
    if (!tunnel) {
      console.log('\nngrok no entregó una dirección. Revisa la ventana de ngrok:');
      console.log('  - ERR_NGROK_8013: la cuenta debe tener una tarjeta verificada (dashboard.ngrok.com).');
      console.log('  - ERR_NGROK_108: ya hay otro ngrok abierto con esta cuenta; ciérralo.');
      console.log('  - "ngrok no se reconoce": define NGROK_PATH o deja ngrok.exe en el Escritorio.');
      return 1;
    }
    if (reservedAddress && `${tunnel.hostname}:${tunnel.port}`.toLowerCase() !== reservedAddress.toLowerCase()) {
      console.error(`ngrok no abrió la dirección TCP reservada ${reservedAddress}. Revisa la reserva de la cuenta y la ventana de ngrok.`);
      return 1;
    }
  }

  const address = `${tunnel.hostname}:${tunnel.port}`;
  console.log(`\nDirección pública del hub: ${address}`);
  const previous = existsSync(LAST_ADDRESS_FILE) ? readFileSync(LAST_ADDRESS_FILE, 'utf8').trim() : '';
  const registrationId = process.env.DAHUA_HUB_DEFAULT_DEVICE || 'PROP-0001';
  if ((await hubOnline()).includes(registrationId.toUpperCase())) {
    if (previous !== address) writeFileSync(LAST_ADDRESS_FILE, address);
    console.log(`${registrationId} ya está conectado al hub con esta dirección.`);
    return 0;
  }

  console.log(previous === address
    ? `\nLa dirección no cambió, pero ${registrationId} está desconectado. Se revisará su configuración.`
    : previous
      ? `\nLa dirección CAMBIÓ (antes: ${previous}). Hay que actualizarla en los Dahua.`
      : '\nPrimera vez que se registra esta dirección.');
  console.log(`Intentando actualizar el Dahua de la red local (${registrationId})…`);
  if (!process.env.DAHUA_BASE_URL || !process.env.DAHUA_USERNAME ||
      !(process.env.DAHUA_PASSWORD_BASE64 || process.env.DAHUA_PASSWORD)) {
    console.log(`La cuenta CGI del Dahua no está guardada en ${process.env.RESTBLU_ENV_PATH || '%LOCALAPPDATA%\\RestBlu\\.env.local'}.`);
    console.log('Ejecuta Configurar_Dahua_Reservas.bat desde la red del terminal para completar la configuración.');
    await printManualConfiguration(tunnel);
    return 2;
  }
  const result = await configureDahua(registrationId);
  if (result.ok) {
    writeFileSync(LAST_ADDRESS_FILE, address);
    console.log(result.output);
    console.log(`\nListo: el Dahua quedó apuntando a ${address}. Se reconectará en 1 o 2 minutos.`);
  } else {
    console.log(`No se pudo actualizar automáticamente:\n${result.output}`);
    console.log('\nNo fue posible llegar al Dahua desde este PC.');
    await printManualConfiguration(tunnel);
    console.log('O ejecuta este .bat de nuevo estando en esa red.');
    return 2;
  }
  return 0;
}

process.exitCode = await main();
