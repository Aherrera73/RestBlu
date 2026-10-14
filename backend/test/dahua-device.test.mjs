import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { test } from 'node:test';

import { DahuaClient } from '../src/dahua/device-client.mjs';
import { makeDigestAuthorization, parseAuthChallenge } from '../src/dahua/digest-auth.mjs';
import {
  dahuaDynamicQrContent, dahuaQrInput, enrollReservationFace, enrollReservationQr, generateDahuaQrCode,
  revokeReservationFace,
} from '../src/dahua/reservation-access.mjs';

const USERNAME = 'admin';
const PASSWORD = 'correct-horse';
const REALM = 'Mock Dahua';
const NONCE = 'a1b2c3d4';

function md5(value) {
  return crypto.createHash('md5').update(value).digest('hex');
}

function parseDigest(header = '') {
  const values = {};
  for (const match of header.matchAll(/([\w-]+)=(?:"([^"]*)"|([^,\s]+))/g)) values[match[1]] = match[2] ?? match[3];
  return values;
}

function authorized(request) {
  const header = request.headers.authorization;
  if (!header?.startsWith('Digest ')) return false;
  const auth = parseDigest(header);
  const ha1 = md5(`${USERNAME}:${REALM}:${PASSWORD}`);
  const ha2 = md5(`${request.method}:${auth.uri}`);
  const expected = md5(`${ha1}:${NONCE}:${auth.nc}:${auth.cnonce}:${auth.qop}:${ha2}`);
  return auth.username === USERNAME && auth.response === expected;
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function mockDevice(context) {
  const calls = [];
  const bodies = [];
  const server = http.createServer(async (request, response) => {
    if (!authorized(request)) {
      await readBody(request);
      response.writeHead(401, {
        'WWW-Authenticate': `Digest realm="${REALM}", nonce="${NONCE}", qop="auth", algorithm=MD5`,
      });
      return response.end('Unauthorized');
    }
    const url = new URL(request.url, 'http://mock');
    calls.push(`${url.pathname.split('/').pop()}:${url.searchParams.get('action')}`);
    if (request.method === 'POST') bodies.push(JSON.parse(await readBody(request)));
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    if (url.pathname.endsWith('magicBox.cgi')) return response.end('deviceType=ASI6214S-PW\nserialNumber=TEST01\n');
    if (url.pathname.endsWith('global.cgi')) return response.end('time=2026-09-28 10:00:00\n');
    if (url.pathname.endsWith('AccessFace.cgi') && url.searchParams.get('action') === 'list') {
      return response.end(`FaceDataList[0].UserID=${url.searchParams.get('UserIDList[0]')}\n`);
    }
    return response.end('OK');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, calls, bodies };
}

test('crea una cabecera Digest con qop=auth', () => {
  const header = makeDigestAuthorization({
    challenge: parseAuthChallenge('Digest realm="device", qop="auth", nonce="nonce-1", algorithm=MD5'),
    username: 'admin',
    password: 'secret',
    method: 'GET',
    uri: '/cgi-bin/magicBox.cgi?action=getSystemInfo',
  });
  assert.match(header, /^Digest username="admin"/);
  assert.match(header, /qop=auth/);
  assert.match(header, /nc=00000001/);
});

test('el cliente acepta HTTP en la LAN, sin CA, y rechaza IP públicas', () => {
  assert.doesNotThrow(() => new DahuaClient({
    baseUrl: 'http://172.26.10.160', username: 'admin', password: 'x',
  }));
  assert.throws(() => new DahuaClient({
    baseUrl: 'http://8.8.8.8', username: 'admin', password: 'x',
  }), /IP privada/);
  assert.throws(() => new DahuaClient({
    baseUrl: 'http://172.26.10.160/cgi-bin', username: 'admin', password: 'x',
  }), /dirección base/);
});

test('alta de reserva contra un terminal simulado: persona V2, rostro, verificación y revocación', async (context) => {
  const device = await mockDevice(context);
  const client = new DahuaClient({ baseUrl: device.baseUrl, username: USERNAME, password: PASSWORD });

  const info = await client.getDeviceInfo();
  assert.equal(info.deviceType, 'ASI6214S-PW');

  const input = {
    userId: 'RB0123456789abcdef0123',
    name: 'Huésped de prueba',
    photoBase64: '/9j/4AAQ',
    validFrom: '20260928 150000',
    validTo: '20260930 110000',
    door: 1,
  };
  const result = await enrollReservationFace(client, input);
  assert.equal(result.verified, true);
  assert.deepEqual(device.bodies[0].UserList[0].Doors, [0]);
  assert.equal(device.bodies[0].UserList[0].ValidFrom, '2026-09-28 15:00:00');
  assert.equal(device.bodies[0].UserList[0].ValidTo, '2026-09-30 11:00:00');
  assert.equal(device.bodies[1].FaceList[0].UserID, input.userId);
  assert.deepEqual(device.bodies[1].FaceList[0].PhotoData, [input.photoBase64]);

  await revokeReservationFace(client, { userId: input.userId, recNo: '' });
  assert.ok(device.calls.includes('AccessFace.cgi:removeMulti'));
  assert.ok(device.calls.includes('AccessUser.cgi:removeMulti'));
});

test('credenciales incorrectas se informan sin reintentar en bucle', async (context) => {
  const device = await mockDevice(context);
  const client = new DahuaClient({ baseUrl: device.baseUrl, username: USERNAME, password: 'mala' });
  await assert.rejects(client.getDeviceInfo(), /Usuario o contraseña incorrectos/);
});

test('al confirmar se crea la persona con su QR; luego el rostro se agrega a la misma persona', async (context) => {
  const device = await mockDevice(context);
  const client = new DahuaClient({ baseUrl: device.baseUrl, username: USERNAME, password: PASSWORD });
  const reservation = {
    id: 'RB-QR0001-ABCDEF123456',
    status: 'confirmada',
    paymentStatus: 'aprobado-demo',
    checkIn: '2099-01-10',
    checkInTime: '15:00',
    checkOut: '2099-01-12',
    checkOutTime: '11:00',
    dahuaQrCode: generateDahuaQrCode(),
    accessPin: '482631',
  };
  assert.match(reservation.dahuaQrCode, /^[0-9A-F]{10}$/);
  const input = dahuaQrInput({ reservation, customer: { name: 'Huésped QR' } });
  await enrollReservationQr(client, input);
  assert.equal(device.bodies[0].UserList[0].UserID, input.userId);
  assert.equal(device.bodies[0].UserList[0].Password, reservation.accessPin);
  assert.deepEqual(device.bodies[1].CardList[0], {
    UserID: input.userId, CardNo: reservation.dahuaQrCode, CardType: 0, CardStatus: 0,
  });

  device.calls.length = 0;
  device.bodies.length = 0;
  await enrollReservationQr(client, input, { personExists: true });
  assert.ok(device.calls.includes('AccessUser.cgi:updateMulti'));
  assert.equal(device.bodies[0].UserList[0].Password, reservation.accessPin);

  device.calls.length = 0;
  await enrollReservationFace(client, { ...input, photoBase64: '/9j/4AAQ' }, () => {}, { personExists: true });
  assert.ok(!device.calls.includes('AccessUser.cgi:insertMulti'), 'no debe recrear la persona');
  assert.ok(device.calls.includes('AccessFace.cgi:insertMulti'));

  device.calls.length = 0;
  await revokeReservationFace(client, { userId: input.userId, recNo: '', cardNo: reservation.dahuaQrCode });
  assert.ok(device.calls.includes('AccessCard.cgi:removeMulti'));
  assert.ok(device.calls.includes('AccessUser.cgi:removeMulti'));
});

test('no se emite QR para reservas sin confirmar o ya terminadas', () => {
  const base = {
    id: 'RB-QR0002-ABCDEF123456', status: 'confirmada', paymentStatus: 'aprobado-demo',
    checkIn: '2099-01-10', checkOut: '2099-01-12', dahuaQrCode: '5A5A112233', accessPin: '482631',
  };
  assert.throws(() => dahuaQrInput({ reservation: { ...base, paymentStatus: 'pendiente-demo' }, customer: { name: 'A' } }), /no está confirmada/);
  assert.throws(() => dahuaQrInput({ reservation: { ...base, checkIn: '2020-01-01', checkOut: '2020-01-02' }, customer: { name: 'A' } }), /ya terminó/);
  assert.throws(() => dahuaQrInput({ reservation: { ...base, dahuaQrCode: '12' }, customer: { name: 'A' } }), /código QR/);
});

test('el QR dinámico se descifra como lo hace el lector: hora de emisión + tarjeta', () => {
  const key = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8');
  const issuedAt = 1_790_000_000;
  const content = dahuaDynamicQrContent(key, '5A5A112233', issuedAt);
  const decipher = crypto.createDecipheriv('aes-256-cfb', key, Buffer.alloc(16));
  const plain = Buffer.concat([decipher.update(Buffer.from(content, 'base64')), decipher.final()]);
  assert.equal(plain.readUInt32BE(0), issuedAt);
  assert.equal(plain.subarray(4).toString('hex').toUpperCase(), '5A5A112233');
  assert.throws(() => dahuaDynamicQrContent(key, '12345'), /tarjeta/);
});

test('el acceso vale desde que se registra (confirmación) hasta el check-out', () => {
  const reservation = {
    id: 'RB-QR0003-ABCDEF123456', status: 'confirmada', paymentStatus: 'aprobado-demo',
    checkIn: '2099-01-10', checkInTime: '15:00', checkOut: '2099-01-12', checkOutTime: '11:00',
    dahuaQrCode: '5A5A112233', accessPin: '482631',
  };
  const input = dahuaQrInput({ reservation, customer: { name: 'A' } });
  const today = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  assert.ok(input.validFrom.startsWith(`${today.getFullYear()}${pad(today.getMonth() + 1)}${pad(today.getDate())} `));
  assert.equal(input.validTo, '20990112 110000');
});
