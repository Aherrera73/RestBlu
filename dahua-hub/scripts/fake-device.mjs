import net from 'node:net';
import { parseArgs } from 'node:util';

// Simula uno o varios Dahua con Auto Register: se conectan al hub, envían su
// registro, lo repiten como heartbeat (igual que el DHI-ASI6214S-PW) y, si la
// conexión se corta, reintentan como el equipo real.
//
//   node scripts/fake-device.mjs --id PROP-0001
//   node scripts/fake-device.mjs --id PROP-0001,PROP-0002
//   node scripts/fake-device.mjs --host 0.tcp.sa.ngrok.io --port 12345 --id PROP-0001

const { values } = parseArgs({
  options: {
    host: { type: 'string', default: '127.0.0.1' },
    port: { type: 'string', default: '9500' },
    id: { type: 'string', default: 'PROP-0001' },
    class: { type: 'string', default: 'AccessControl' },
    'retry-seconds': { type: 'string', default: '10' },
    'heartbeat-seconds': { type: 'string', default: '30' },
  },
});

const port = Number.parseInt(values.port, 10);
const retryMs = Number.parseInt(values['retry-seconds'], 10) * 1000;
const heartbeatMs = Number.parseInt(values['heartbeat-seconds'], 10) * 1000;
const time = () => new Date().toLocaleTimeString('es-CL', { hour12: false });

function connect(registrationId) {
  const log = (message) => console.log(`${time()} [${registrationId}] ${message}`);
  const body = JSON.stringify({ DevClass: values.class, DeviceID: registrationId, ServerIP: values.host });
  const registration = [
    'POST /cgi-bin/api/autoRegist/connect HTTP/1.1',
    `Host: ${values.host}:${port}`,
    'Content-Type: application/json',
    `Content-Length: ${Buffer.byteLength(body)}`,
    'Connection: keep-alive',
    '',
    body,
  ].join('\r\n');
  let heartbeat = null;
  const socket = net.connect({ host: values.host, port }, () => {
    socket.write(registration);
    log(`conectado a ${values.host}:${port}, registro enviado.`);
    if (heartbeatMs > 0) heartbeat = setInterval(() => socket.write(registration), heartbeatMs);
  });
  socket.setKeepAlive(true, 30_000);
  socket.on('data', (chunk) => {
    const firstLine = chunk.toString('latin1').split('\r\n')[0];
    log(`hub respondió: ${firstLine}`);
  });
  socket.on('error', (error) => log(`error: ${error.code || error.message}`));
  socket.on('close', () => {
    clearInterval(heartbeat);
    log(`conexión cerrada; reintento en ${retryMs / 1000} s.`);
    setTimeout(() => connect(registrationId), retryMs);
  });
}

for (const id of values.id.split(',').map((item) => item.trim()).filter(Boolean)) connect(id);
console.log('Ctrl+C para desconectar los terminales simulados.');
