import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

// Genera la autoridad certificadora propia de RestBlu y el certificado TLS del
// hub, para que los Dahua se conecten por HTTPS (Registro Automático CGI con
// "HTTPs" activado). Quedan en %LOCALAPPDATA%\RestBlu\certs, fuera del proyecto.
//
//   node scripts/generate-certificates.mjs
//   node scripts/generate-certificates.mjs --host mi.dominio.cl --ip 203.0.113.10
//
// La autoridad (restblu-ca) se crea una sola vez y se reutiliza; el
// certificado del hub se vuelve a emitir en cada ejecución.

const { values } = parseArgs({
  options: {
    host: { type: 'string', multiple: true, default: [] },
    ip: { type: 'string', multiple: true, default: [] },
    'new-ca': { type: 'boolean', default: false },
  },
});

const directory = join(process.env.LOCALAPPDATA || '.', 'RestBlu', 'certs');
mkdirSync(directory, { recursive: true });
const file = (name) => join(directory, name);

function findOpenssl() {
  const candidates = ['openssl', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe', 'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe'];
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['version'], { stdio: 'ignore' });
      return candidate;
    } catch { /* siguiente */ }
  }
  throw new Error('No se encontró openssl. Instala Git para Windows (incluye openssl) y vuelve a ejecutar.');
}
const openssl = findOpenssl();
const run = (...args) => execFileSync(openssl, args, { stdio: ['ignore', 'pipe', 'pipe'] });

// Dominios de los túneles TCP de ngrok (Sudamérica) y el equipo local.
const hosts = [...new Set(['localhost', '0.tcp.sa.ngrok.io', '*.tcp.sa.ngrok.io', ...values.host])];
const ips = [...new Set(['127.0.0.1', '54.232.216.110', '15.229.167.172', ...values.ip])];

if (values['new-ca'] || !existsSync(file('restblu-ca.key')) || !existsSync(file('restblu-ca.crt'))) {
  run('genrsa', '-out', file('restblu-ca.key'), '3072');
  run('req', '-x509', '-new', '-key', file('restblu-ca.key'), '-sha256', '-days', '3650',
    '-subj', '/C=CL/O=RestBlu/CN=RestBlu Dahua CA', '-out', file('restblu-ca.crt'),
    '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign');
  console.log('Autoridad certificadora creada: restblu-ca.crt');
} else {
  console.log('Se reutiliza la autoridad certificadora existente: restblu-ca.crt');
}

// RSA 2048: el más compatible con los firmwares Dahua.
const extensions = file('dahua-hub.ext');
writeFileSync(extensions, [
  'basicConstraints=CA:FALSE',
  'keyUsage=critical,digitalSignature,keyEncipherment',
  'extendedKeyUsage=serverAuth',
  `subjectAltName=${[...hosts.map((host) => `DNS:${host}`), ...ips.map((ip) => `IP:${ip}`)].join(',')}`,
].join('\n'));
run('genrsa', '-out', file('dahua-hub.key'), '2048');
run('req', '-new', '-key', file('dahua-hub.key'), '-subj', '/C=CL/O=RestBlu/CN=RestBlu Dahua Hub', '-out', file('dahua-hub.csr'));
run('x509', '-req', '-in', file('dahua-hub.csr'), '-CA', file('restblu-ca.crt'), '-CAkey', file('restblu-ca.key'),
  '-CAcreateserial', '-days', '825', '-sha256', '-extfile', extensions, '-out', file('dahua-hub.crt'));
rmSync(file('dahua-hub.csr'), { force: true });
rmSync(extensions, { force: true });

console.log(`Certificado del hub emitido para: ${[...hosts, ...ips].join(', ')}`);
console.log(`Carpeta: ${directory}`);
console.log('Agrega a %LOCALAPPDATA%\\RestBlu\\dahua-hub.env.local:');
console.log(`  DAHUA_HUB_TLS_CERT=${file('dahua-hub.crt')}`);
console.log(`  DAHUA_HUB_TLS_KEY=${file('dahua-hub.key')}`);
console.log('Si el Dahua pide confiar en el certificado, instala en él restblu-ca.crt (nunca la .key).');
