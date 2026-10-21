import assert from 'node:assert/strict';
import test from 'node:test';
import { isRecoverableWebpayReturn, recoverWebpayReturn } from '../modules/public-site/services/webpay-return.ts';

const payment = { id: 'RB-TEST12-ABCDEF012345', estado: 'pendiente', token: 'A'.repeat(64) };
const paymentsApi = 'https://payments.example';

function simulateStatus(t, states) {
  const requests = [];
  t.mock.method(globalThis, 'setTimeout', (callback) => { callback(); });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, ...JSON.parse(options.body) });
    const state = states[Math.min(requests.length - 1, states.length - 1)];
    return Response.json({ state, reservationId: payment.id });
  });
  return requests;
}

test('un retorno pendiente conserva su token para recuperar el resultado al recargar', () => {
  const saved = JSON.parse(JSON.stringify(payment));
  assert.equal(isRecoverableWebpayReturn(saved), true);
});

test('los retornos aprobados se recuperan y los cancelados o incompletos no', () => {
  assert.equal(isRecoverableWebpayReturn({ ...payment, estado: 'aprobado' }), true);
  for (const invalid of [null, {}, { ...payment, estado: 'anulado' }, { ...payment, estado: 'rechazado' },
    { ...payment, estado: 'expirado' }, { ...payment, id: 'otra-reserva' }, { ...payment, token: '' }]) {
    assert.equal(isRecoverableWebpayReturn(invalid), false);
  }
});

test('un pago pendiente sólo se entrega al gestor después de que Webpay lo aprueba', async (t) => {
  const requests = simulateStatus(t, ['pending', 'approved']);
  const confirmations = [];
  const result = await recoverWebpayReturn(payment, paymentsApi, async (id, token) => {
    assert.equal(requests.length, 2);
    confirmations.push({ id, token });
  });
  assert.equal(result, 'confirmed');
  assert.deepEqual(confirmations, [{ id: payment.id, token: payment.token }]);
  assert.deepEqual(requests, Array(2).fill({
    url: `${paymentsApi}/webpay/status`, reservationId: payment.id, token: payment.token,
  }));
});

test('si Webpay sigue pendiente se conserva el intento sin confirmar ni rechazar el pago', async (t) => {
  const requests = simulateStatus(t, ['pending']);
  const result = await recoverWebpayReturn(payment, paymentsApi, async () => assert.fail('no hay aprobación'));
  assert.equal(result, 'pending');
  assert.equal(requests.length, 6, 'la consulta termina y puede retomarse al recargar');
});

test('un rechazo definitivo permite finalizar la recuperación sin confirmar la reserva', async (t) => {
  simulateStatus(t, ['rejected']);
  const result = await recoverWebpayReturn(payment, paymentsApi, async () => assert.fail('pago rechazado'));
  assert.equal(result, 'rejected');
});

test('una pérdida de conexión no se convierte en un rechazo y permite reconsultar el mismo token', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('red caída'); });
  await assert.rejects(recoverWebpayReturn(payment, paymentsApi, async () => assert.fail('sin verificar')), /intento se conserva/);
  t.mock.restoreAll();
  simulateStatus(t, ['approved']);
  let confirmed = false;
  assert.equal(await recoverWebpayReturn(payment, paymentsApi, async () => { confirmed = true; }), 'confirmed');
  assert.equal(confirmed, true);
});

test('los límites del servicio y sus errores no se interpretan como pagos rechazados', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Límite alcanzado' }, { status: 429 }));
  await assert.rejects(recoverWebpayReturn(payment, paymentsApi, async () => assert.fail('sin verificar')), /intento se conserva/);
});

test('la respuesta debe pertenecer a esta reserva y contener un resultado conocido', async (t) => {
  const responses = [
    { state: 'approved', reservationId: 'RB-OTHER1-ABCDEF012345' },
    { state: 'unknown', reservationId: payment.id },
    null,
  ];
  t.mock.method(globalThis, 'fetch', async () => Response.json(responses.shift()));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await assert.rejects(recoverWebpayReturn(payment, paymentsApi, async () => assert.fail('respuesta inválida')), /resultado válido/);
  }
});

test('una respuesta ilegible conserva el intento y muestra un mensaje comprensible', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>Servicio no disponible</html>'));
  await assert.rejects(recoverWebpayReturn(payment, paymentsApi, async () => assert.fail('sin verificar')), /pago sigue en verificación/);
});

test('un retorno aprobado conserva la verificación del gestor sin repetir el inicio del pago', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('no se inicia otra transacción'));
  let confirmed = false;
  const result = await recoverWebpayReturn({ ...payment, estado: 'aprobado' }, paymentsApi, async (id, token) => {
    assert.equal(id, payment.id);
    assert.equal(token, payment.token);
    confirmed = true;
  });
  assert.equal(result, 'confirmed');
  assert.equal(confirmed, true);
});

test('un fallo del gestor permite reintentar la confirmación sin marcar el pago como confirmado', async () => {
  await assert.rejects(recoverWebpayReturn({ ...payment, estado: 'aprobado' }, paymentsApi, async () => {
    throw new Error('gestor sin conexión');
  }), /gestor sin conexión/);
});
