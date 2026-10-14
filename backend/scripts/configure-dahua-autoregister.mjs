import { lookup } from 'node:dns/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';
import { DahuaClient } from '../src/dahua/device-client.mjs';

// Configura el Auto Register CGI (VSP_CGI.AutoRegister) del Dahua para que se
// conecte al hub central. Sin --host/--port toma la dirección del túnel TCP
// que ngrok tenga abierto en este PC. Necesita llegar al Dahua por la red
// local, con la cuenta CGI del gestor.
//
//   node scripts/configure-dahua-autoregister.mjs --id PROP-0001
//   node scripts/configure-dahua-autoregister.mjs --host 0.tcp.sa.ngrok.io --port 12345 --id PROP-0001
//   node scripts/configure-dahua-autoregister.mjs --id PROP-0001 --https   (o --no-https)
//   node scripts/configure-dahua-autoregister.mjs --disable

const { values } = parseArgs({
  allowNegative: true,
  options: {
    host: { type: 'string' },
    port: { type: 'string' },
    id: { type: 'string', default: 'PROP-0001' },
    disable: { type: 'boolean', default: false },
    // Sin --https ni --no-https se conserva lo que el Dahua ya tenía.
    https: { type: 'boolean' },
  },
});

dotenv.config({
  path: process.env.RESTBLU_ENV_PATH || join(process.env.LOCALAPPDATA || '', 'RestBlu', '.env.local'),
  quiet: true,
});
if (!process.env.DAHUA_BASE_URL || !process.env.DAHUA_USERNAME ||
    !(process.env.DAHUA_PASSWORD_BASE64 || process.env.DAHUA_PASSWORD)) {
  console.error('Falta la cuenta CGI del terminal. Ejecuta Configurar_Dahua_Reservas.bat desde su red.');
  process.exit(1);
}
const client = new DahuaClient({
  baseUrl: process.env.DAHUA_BASE_URL,
  username: process.env.DAHUA_USERNAME,
  password: Buffer.from(process.env.DAHUA_PASSWORD_BASE64 || '', 'base64').toString('utf8') || process.env.DAHUA_PASSWORD,
  allowSelfSigned: true,
});

async function ngrokAddress() {
  let tunnels;
  try {
    tunnels = (await (await fetch('http://127.0.0.1:4040/api/tunnels')).json()).tunnels;
  } catch {
    throw new Error('No hay un ngrok abierto en este PC. Ejecuta "ngrok tcp 9500" o indica --host y --port.');
  }
  const tunnel = tunnels.find((item) => item.public_url?.startsWith('tcp://'));
  if (!tunnel) throw new Error('ngrok está abierto pero sin túnel TCP. Ejecuta "ngrok tcp 9500".');
  const url = new URL(tunnel.public_url);
  return { host: url.hostname, port: url.port };
}

const prefix = 'VSP_CGI.AutoRegister';
const params = { action: 'setConfig', [`${prefix}.Enable`]: values.disable ? 'false' : 'true' };
if (!values.disable) {
  const target = values.host && values.port ? { host: values.host, port: values.port } : await ngrokAddress();
  // Se envían el dominio y su IP actual: algunos firmware sólo usan Address.
  const address = /^\d+\.\d+\.\d+\.\d+$/.test(target.host) ? target.host : (await lookup(target.host, { family: 4 })).address;
  Object.assign(params, {
    [`${prefix}.DeviceID`]: values.id,
    [`${prefix}.Servers[0].Address`]: address,
    [`${prefix}.Servers[0].Domain`]: target.host === address ? '' : target.host,
    [`${prefix}.Servers[0].Port`]: target.port,
    ...(values.https === undefined ? {} : { [`${prefix}.Servers[0].HttpsEnable`]: String(values.https) }),
  });
  console.log(`Dahua → ${target.host}:${target.port} (${address}) como ${values.id}`);
}
try {
  const result = await client.request('/cgi-bin/configManager.cgi', { params });
  console.log(`Dahua respondió: ${result.text.trim()}`);
  const { text } = await client.request('/cgi-bin/configManager.cgi', { params: { action: 'getConfig', name: 'VSP_CGI' } });
  console.log(text.split(/\r?\n/).filter((line) => line.includes('AutoRegister')).join('\n'));
} catch (error) {
  console.error(`No se pudo configurar el Dahua en ${process.env.DAHUA_BASE_URL}: ${error.message}`);
  console.error('Este paso necesita estar en la misma red que el Dahua.');
  process.exitCode = 1;
}
