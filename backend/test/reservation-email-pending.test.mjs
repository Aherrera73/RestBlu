import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createLocalDatabase } from '../src/database/local-database.mjs';
import { reservationLookupEmailGroups } from '../src/reservations/public-lookup.mjs';

const root = resolve(import.meta.dirname, '..');

async function unusedPort() {
  const probe = createServer();
  await new Promise((done) => probe.listen(0, '127.0.0.1', done));
  const { port } = probe.address();
  await new Promise((done) => probe.close(done));
  return port;
}

// Token de una cuenta del emulador de Firebase Auth (sin firma, como los
// emite el emulador). El gestor de prueba lo acepta sólo en modo emulador.
const EMULATOR_PROJECT = 'demo-restblu';
function accountToken(uid, email, emailVerified = true) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
    iss: `https://securetoken.google.com/${EMULATOR_PROJECT}`,
    aud: EMULATOR_PROJECT,
    auth_time: now - 10,
    iat: now - 10,
    exp: now + 3600,
    sub: uid,
    user_id: uid,
    email,
    email_verified: emailVerified,
    firebase: { identities: { email: [email] }, sign_in_provider: 'password' },
  })}.`;
}

test('reservar exige cuenta verificada; el gestor recalcula precio, valida datos y verifica el pago en Webpay', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'restblu-reservation-test-'));
  const databasePath = join(temp, 'reservations.sqlite');
  const configPath = join(temp, 'test.env');
  // Aislar la prueba de la configuración SMTP real del equipo.
  await writeFile(configPath, 'SMTP_HOST=127.0.0.1\nSMTP_PORT=1\nSMTP_USER=test\nSMTP_PASS=test\n', 'utf8');
  const database = createLocalDatabase({
    databasePath,
    legacyJsonPath: join(temp, 'legacy-not-present.json'),
    schemaPath: join(root, 'src', 'database', 'schema.sql'),
  });
  const initial = database.readDatabase();
  initial.properties.push({
    id: 1,
    name: 'Alojamiento de prueba',
    place: 'Chile',
    type: 'Casa',
    guests: 2,
    beds: 1,
    baths: 1,
    price: 10000,
    ownerName: 'Propietaria de prueba',
    ownerDocumentId: '11.111.111-1',
    ownerEmail: 'owner-private@example.invalid',
    ownerPhone: '+56922222222',
    active: true,
    gallery: [],
    tags: [],
  });
  database.saveDatabase(initial);
  database.close();

  // Emulador mínimo de Firebase Auth: el SDK confirma la cuenta con
  // accounts:lookup al verificar un token del emulador.
  const authEmulator = createHttpServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      const ids = JSON.parse(body || '{}').localId || [];
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ users: ids.map((localId) => ({ localId, disabled: false })) }));
    });
  });
  await new Promise((done) => authEmulator.listen(0, '127.0.0.1', done));

  // Transbank simulado: entrega el estado de una transacción según su token.
  const webpayTransactions = new Map();
  const transbank = createHttpServer((request, response) => {
    const token = decodeURIComponent(request.url.split('/').pop());
    const transaction = webpayTransactions.get(token);
    response.writeHead(transaction ? 200 : 422, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(transaction || { error_message: 'Invalid token' }));
  });
  await new Promise((done) => transbank.listen(0, '127.0.0.1', done));

  const port = await unusedPort();
  const server = spawn(process.execPath, ['server.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      RESTBLU_ADMIN_PORT: String(port),
      RESTBLU_MANAGER_PASSWORD: 'clave-de-prueba-gestor-0123456789abcdef',
      RESTBLU_DB_PATH: databasePath,
      // Las pruebas nunca deben usar la base SQL Server real del archivo privado.
      RESTBLU_DB_ENGINE: 'sqlite',
      RESTBLU_ENV_PATH: configPath,
      FIREBASE_SERVICE_ACCOUNT_PATH: join(temp, 'firebase-not-present.json'),
      FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${authEmulator.address().port}`,
      RESTBLU_FIREBASE_EMULATOR_PROJECT: EMULATOR_PROJECT,
      TRANSBANK_API_BASE: `http://127.0.0.1:${transbank.address().port}`,
      DAHUA_RESERVATION_SYNC: '0',
      SMTP_HOST: '',
      SMTP_USER: '',
      SMTP_PASS: '',
    },
    stdio: 'ignore',
  });

  const api = (path, { method = 'GET', token, body } = {}) => fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(!token ? { Authorization: `Basic ${Buffer.from('manager:clave-de-prueba-gestor-0123456789abcdef').toString('base64')}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const guestA = accountToken('account-a', 'test@example.invalid');
  const guestB = accountToken('account-b', 'second@example.invalid');

  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (server.exitCode !== null) break;
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`);
        ready = response.ok;
        if (ready) break;
      } catch {
        await delay(100);
      }
    }
    assert.ok(ready, 'el servidor aislado debe iniciar');

    const healthResponse = await api('/api/health');
    assert.equal(healthResponse.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(healthResponse.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(healthResponse.headers.get('x-frame-options'), 'DENY');
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/backup`)).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/admin/properties`)).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/properties`)).status, 200);
    assert.equal((await api('/api/backup')).status, 200);

    const preflight = await fetch(`http://127.0.0.1:${port}/api/reservations`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3000',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://localhost:3000');
    assert.match(preflight.headers.get('access-control-allow-headers'), /authorization/i);
    const untrustedPreflight = await fetch(`http://127.0.0.1:${port}/api/reservations`, {
      method: 'OPTIONS', headers: { Origin: 'https://otro-sitio.example' },
    });
    assert.equal(untrustedPreflight.headers.get('access-control-allow-origin'), null);

    const publicPropertiesText = await (await api('/api/properties')).text();
    assert.doesNotMatch(publicPropertiesText, /owner-private@example\.invalid/i);
    assert.doesNotMatch(publicPropertiesText, /11\.111\.111-1/);
    assert.match(await (await api('/api/admin/properties')).text(), /owner-private@example\.invalid/i);

    const id = 'RB-TEST-ACCOUNT-ONE';
    const base = {
      id,
      guestName: 'Persona de prueba',
      documentId: '12.345.678-5',
      email: 'test@example.invalid',
      phone: '+56912345678',
      propertyId: 1,
      propertyName: 'Nombre manipulado por cliente',
      propertyPlace: 'Ubicación manipulada',
      checkIn: '2099-01-10',
      checkOut: '2099-01-11',
      guests: 2,
      nights: 99,
      nightlyPrice: 1,
      total: 1,
      accessPin: '123456',
      schemaVersion: 3,
    };

    // La consulta por RUT nunca revela datos en la respuesta.
    const lookup = await api('/api/public/reservations/lookup', { method: 'POST', body: { documentId: '12.345.678-5' } });
    assert.equal(lookup.status, 200);
    const lookupBody = await lookup.text();
    assert.match(JSON.parse(lookupBody).message, /Si hay reservas asociadas/i);
    assert.doesNotMatch(lookupBody, /test@example\.invalid|Persona de prueba|123456|12\.345\.678-5|RB-TEST-ACCOUNT-ONE|Alojamiento de prueba/);
    assert.equal((await api('/api/public/reservations/lookup', { method: 'POST', body: { documentId: '12345678-0' } })).status, 400);

    // Sin cuenta, con una cuenta sin verificar o con otro correo: rechazado.
    assert.equal((await api('/api/reservations', { method: 'POST', body: base })).status, 401);
    assert.equal((await api('/api/reservations', {
      method: 'POST', body: base, token: accountToken('account-x', 'test@example.invalid', false),
    })).status, 401);
    assert.equal((await api('/api/reservations', { method: 'POST', body: base, token: guestB })).status, 403);
    assert.equal((await api('/api/my/reservations')).status, 401);

    const response = await api('/api/reservations', { method: 'POST', body: base, token: guestA });
    const payload = await response.json();
    assert.equal(response.status, 201, JSON.stringify(payload));
    assert.equal(payload.reservation.id, id);
    assert.equal(payload.reservation.ownerUid, 'account-a');
    assert.equal(payload.reservation.propertyName, 'Alojamiento de prueba');
    assert.equal(payload.reservation.propertyPlace, 'Chile');
    assert.equal(payload.reservation.nights, 1);
    assert.equal(payload.reservation.nightlyPrice, 10000);
    assert.equal(payload.reservation.total, 10000);
    assert.equal(payload.reservation.paymentStatus, 'pendiente-demo');
    // Con la cuenta verificada no se envía otro correo de verificación.
    assert.equal(payload.reservation.status, 'correo-verificado-pago-pendiente');
    assert.equal(payload.verification.emailVerified, true);
    assert.equal(payload.verification.emailPending, false);
    assert.equal(payload.verification.verified, false);
    assert.equal(payload.verification.pdfUrl, null);
    assert.equal('verificationTokenPending' in payload.reservation, false);
    assert.equal('verificationTokenHash' in payload.reservation, false);

    const repeated = await api('/api/reservations', { method: 'POST', body: base, token: guestA });
    assert.equal(repeated.status, 201);
    assert.equal((await repeated.json()).duplicated, true);

    const declined = await api('/api/reservations', {
      method: 'POST', token: guestA,
      body: { ...base, id: 'RB-TEST-NO-FUNDS', checkIn: '2099-05-10', checkOut: '2099-05-11', paymentDemoCard: 'insufficient' },
    });
    assert.equal(declined.status, 400);
    assert.match((await declined.json()).error, /se realiza en Webpay/i);

    const missingCard = await api('/api/reservations', {
      method: 'POST', token: guestA,
      body: { ...base, id: 'RB-TEST-NO-CARD', schemaVersion: 2, checkIn: '2099-06-10', checkOut: '2099-06-11' },
    });
    assert.equal(missingCard.status, 400);
    assert.match((await missingCard.json()).error, /versión de la reserva ya no es compatible/i);

    const missingProperty = await api('/api/reservations', {
      method: 'POST', token: guestA,
      body: { id: 'RB-TEST-NO-PROPERTY', email: 'test@example.invalid', propertyId: 999, checkIn: '2099-02-10', checkOut: '2099-02-11' },
    });
    assert.equal(missingProperty.status, 400);

    const overCapacity = await api('/api/reservations', {
      method: 'POST', token: guestA,
      body: { ...base, id: 'RB-TEST-OVER-CAPACITY', checkIn: '2099-02-10', checkOut: '2099-02-11', guests: 3 },
    });
    assert.equal(overCapacity.status, 400);

    const secondCustomer = await api('/api/reservations', {
      method: 'POST', token: guestB,
      body: {
        id: 'RB-TEST-SECOND-CUSTOMER', guestName: 'Segunda persona', documentId: '11.111.111-1',
        email: 'second@example.invalid', phone: '+56987654321', propertyId: 1,
        checkIn: '2099-03-10', checkOut: '2099-03-11', guests: 1, accessPin: '654321', schemaVersion: 3,
      },
    });
    assert.equal(secondCustomer.status, 201);

    const mixedIdentity = await api('/api/reservations', {
      method: 'POST', token: guestB,
      body: {
        id: 'RB-TEST-MIXED-IDENTITY', guestName: 'Identidad mezclada', documentId: '12.345.678-5',
        email: 'second@example.invalid', phone: '+56911111111', propertyId: 1,
        checkIn: '2099-04-10', checkOut: '2099-04-11', guests: 1, accessPin: '111111', schemaVersion: 3,
      },
    });
    assert.equal(mixedIdentity.status, 400);
    assert.match((await mixedIdentity.json()).error, /fichas de cliente distintas/i);

    // «Mis reservas» entrega sólo las reservas de la propia cuenta.
    const mine = await (await api('/api/my/reservations', { token: guestA })).json();
    assert.deepEqual(mine.reservations.map((item) => item.booking.id), [id]);
    const theirs = await (await api('/api/my/reservations', { token: guestB })).json();
    assert.deepEqual(theirs.reservations.map((item) => item.booking.id), ['RB-TEST-SECOND-CUSTOMER']);

    const fakeImage = await fetch(`http://127.0.0.1:${port}/api/uploads?name=falsa`, {
      method: 'POST', headers: {
        'Content-Type': 'image/png',
        Authorization: `Basic ${Buffer.from('manager:clave-de-prueba-gestor-0123456789abcdef').toString('base64')}`,
      }, body: 'esto no es una imagen',
    });
    assert.equal(fakeImage.status, 400);
    assert.match((await fakeImage.json()).error, /imagen válida/i);
    let limitedUpload;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      limitedUpload = await fetch(`http://127.0.0.1:${port}/api/uploads?name=falsa-${attempt}`, {
        method: 'POST', headers: {
          'Content-Type': 'image/png',
          Authorization: `Basic ${Buffer.from('manager:clave-de-prueba-gestor-0123456789abcdef').toString('base64')}`,
        }, body: 'esto tampoco es una imagen',
      });
    }
    assert.equal(limitedUpload.status, 429);
    assert.ok(Number(limitedUpload.headers.get('retry-after')) > 0);

    // Pago de prueba: una tarjeta sin fondos se rechaza; la aprobada habilita el PDF.
    const blockedPdf = await api(`/api/reservations/${id}/pdf`);
    assert.equal(blockedPdf.status, 409);
    const webpayResult = (status, responseCode, amount = 10000, buyOrder = id) => ({
      buy_order: buyOrder, amount, status, response_code: responseCode,
      authorization_code: '1213', card_detail: { card_number: '6623' }, payment_type_code: 'VN',
    });
    webpayTransactions.set('rechazado0000000000000000', webpayResult('FAILED', -1));
    webpayTransactions.set('montoalterado00000000000', webpayResult('AUTHORIZED', 0, 1));
    webpayTransactions.set('aprobado0000000000000000', webpayResult('AUTHORIZED', 0));
    const pay = (webpayToken) => api(`/api/reservations/${id}/webpay-payment`, { method: 'POST', body: { webpayToken } });
    const declinedPayment = await pay('rechazado0000000000000000');
    assert.equal(declinedPayment.status, 409);
    assert.match((await declinedPayment.json()).error, /rechazó/i);
    const alteredAmount = await pay('montoalterado00000000000');
    assert.equal(alteredAmount.status, 409);
    assert.match((await alteredAmount.json()).error, /monto/i);
    assert.equal((await pay('desconocido0000000000000')).status, 409);
    const approved = await pay('aprobado0000000000000000');
    assert.equal(approved.status, 200);
    const paidStatus = await approved.json();
    assert.equal(paidStatus.verified, true);
    assert.equal(paidStatus.paymentStatus, 'aprobado-demo');
    assert.ok(paidStatus.pdfUrl);
    const pdfResponse = await api(paidStatus.pdfUrl);
    assert.equal(pdfResponse.status, 200);
    assert.equal(pdfResponse.headers.get('content-type'), 'application/pdf');

    const saved = createLocalDatabase({
      databasePath,
      legacyJsonPath: join(temp, 'legacy-not-present.json'),
      schemaPath: join(root, 'src', 'database', 'schema.sql'),
    });
    try {
      const snapshot = saved.readDatabase();
      assert.equal(snapshot.customers.length, 2);
      assert.equal(snapshot.reservations.length, 2);
      assert.ok(snapshot.reservations.every((item) => item.id !== 'RB-TEST-NO-FUNDS'));
      assert.equal(snapshot.reservations.find((item) => item.id === 'RB-TEST-SECOND-CUSTOMER').paymentStatus, 'pendiente-demo');
      assert.equal(saved.hasVerifiedEmailSession('session-a', 'test@example.invalid', '12.345.678-5'), false);
      saved.rememberVerifiedEmailSession('session-a', 'test@example.invalid', '12.345.678-5');
      assert.equal(saved.hasVerifiedEmailSession('session-a', 'test@example.invalid', '12.345.678-5'), true);
      assert.equal(saved.hasVerifiedEmailSession('session-b', 'test@example.invalid', '12.345.678-5'), false);

      // Una confirmación heredada sin aprobación de pago no puede habilitar el PDF.
      const inherited = snapshot.reservations.find((item) => item.id === 'RB-TEST-SECOND-CUSTOMER');
      inherited.status = 'confirmada';
      inherited.confirmationEmailSentAt = new Date().toISOString();
      saved.saveDatabase(snapshot);
      const inheritedBody = await (await api('/api/reservations/RB-TEST-SECOND-CUSTOMER/verification')).json();
      assert.equal(inheritedBody.verified, false);
      assert.equal(inheritedBody.pdfUrl, null);
      assert.equal(inheritedBody.confirmationEmailSentAt, null);
      assert.equal((await api('/api/reservations/RB-TEST-SECOND-CUSTOMER/pdf')).status, 409);
    } finally {
      saved.close();
    }

    // La reserva enlaza a la ficha del cliente: un cambio de nombre se ve en ella.
    const customers = (await (await api('/api/customers')).json()).customers;
    const ownCustomer = customers.find((item) => item.documentId === '12.345.678-5');
    assert.equal(ownCustomer.ownerUid, 'account-a');
    const renamed = await api(`/api/customers/${ownCustomer.id}`, {
      method: 'PUT', body: { ...ownCustomer, name: 'Nombre Corregido' },
    });
    assert.equal(renamed.status, 200);
    const afterRename = await (await api('/api/my/reservations', { token: guestA })).json();
    assert.equal(afterRename.reservations[0].booking.guestName, 'Nombre Corregido');
    assert.equal(afterRename.reservations[0].booking.propertyName, 'Alojamiento de prueba');

    // Con una reserva confirmada el RUT queda bloqueado, y un RUT de otra
    // cuenta no puede usarse.
    const changedRut = await api('/api/reservations', {
      method: 'POST', token: guestA,
      body: { ...base, id: 'RB-TEST-CHANGED-RUT', documentId: '9.876.543-3', checkIn: '2099-09-10', checkOut: '2099-09-11' },
    });
    assert.equal(changedRut.status, 400);
    assert.match((await changedRut.json()).error, /ya no se puede cambiar/i);
    const foreignRut = await api('/api/reservations', {
      method: 'POST', token: accountToken('account-c', 'third@example.invalid'),
      body: { ...base, id: 'RB-TEST-FOREIGN-RUT', email: 'third@example.invalid', checkIn: '2099-09-12', checkOut: '2099-09-13' },
    });
    assert.equal(foreignRut.status, 400);
    assert.match((await foreignRut.json()).error, /otra cuenta/i);

    // Una reserva pendiente vencida libera sus fechas para otra reserva.
    const expiringId = 'RB-TEST-EXPIRING';
    assert.equal((await api('/api/reservations', {
      method: 'POST', token: guestA, body: { ...base, id: expiringId, checkIn: '2099-08-10', checkOut: '2099-08-11' },
    })).status, 201);
    const historical = createLocalDatabase({ databasePath, legacyJsonPath: join(temp, 'legacy-not-present.json'), schemaPath: join(root, 'src', 'database', 'schema.sql') });
    try {
      const snapshot = historical.readDatabase();
      snapshot.reservations.find((item) => item.id === expiringId).expiresAt = '2020-01-01T00:00:00.000Z';
      historical.saveDatabase(snapshot);
    } finally {
      historical.close();
    }
    const expiredStatus = await (await api(`/api/reservations/${expiringId}/verification`)).json();
    assert.equal(expiredStatus.status, 'expirada');
    const replacement = await api('/api/reservations', {
      method: 'POST', token: guestA, body: { ...base, id: 'RB-TEST-REPLACEMENT', checkIn: '2099-08-10', checkOut: '2099-08-11' },
    });
    assert.equal(replacement.status, 201, JSON.stringify(await replacement.json()));
  } finally {
    server.kill();
    authEmulator.close();
    transbank.close();
    await delay(100);
    await rm(temp, { recursive: true, force: true });
  }
});

test('la consulta agrupa sólo reservas con correo verificado y respeta el correo congelado', () => {
  const database = {
    customers: [{ id: 1, documentId: '12.345.678-5', email: 'perfil@example.invalid' }],
    reservations: [
      { id: 'RB-UNO', customerId: 1, guestDocumentId: '12.345.678-5', guestEmail: 'uno@example.invalid', emailVerifiedAt: '2026-01-01', propertyName: 'Casa Uno', checkIn: '2026-11-01', checkOut: '2026-11-02', status: 'confirmada' },
      { id: 'RB-DOS', customerId: 1, guestDocumentId: '12.345.678-5', guestEmail: 'dos@example.invalid', emailVerifiedAt: '2026-01-02', propertyName: 'Casa Dos', checkIn: '2026-12-01', checkOut: '2026-12-02', status: 'confirmada' },
      { id: 'RB-PENDIENTE', customerId: 1, guestDocumentId: '12.345.678-5', guestEmail: 'sinverificar@example.invalid', propertyName: 'No enviar' },
    ],
  };
  const groups = reservationLookupEmailGroups(database, '12.345.678-5');
  assert.deepEqual([...groups.keys()].sort(), ['dos@example.invalid', 'uno@example.invalid']);
  assert.deepEqual(groups.get('uno@example.invalid').map((item) => item.reference), ['RB-UNO']);
  assert.deepEqual(groups.get('dos@example.invalid').map((item) => item.reference), ['RB-DOS']);
});
