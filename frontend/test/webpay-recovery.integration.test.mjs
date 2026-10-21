import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../../payments-worker/src/index.js';
import { isRecoverableWebpayReturn, recoverWebpayReturn } from '../modules/public-site/services/webpay-return.ts';

test('la web recupera el retorno pendiente real del Worker sin crear otro cobro', async (t) => {
  const paymentsApi = 'https://payments.example';
  const reservationId = 'RB-TEST12-ABCDEF012345';
  const token = 'A'.repeat(64);
  const env = {
    TRANSBANK_API_BASE: 'https://transbank.example',
    TRANSBANK_COMMERCE_CODE: 'test',
    TRANSBANK_API_KEY: 'test',
    ALLOWED_RETURN_ORIGINS: 'https://restblu.example',
    DEFAULT_RETURN: 'https://restblu.example/',
    PAYMENT_RATE_LIMITER: { limit: async () => ({ success: true }) },
    PAYMENT_GLOBAL_LIMITER: { limit: async () => ({ success: true }) },
  };
  const transbankMethods = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const target = new URL(url);
    if (target.origin === paymentsApi) {
      assert.equal(target.pathname, '/webpay/status', 'la recuperación no inicia otro pago');
      return worker.fetch(new Request(url, options), env);
    }
    assert.equal(target.origin, env.TRANSBANK_API_BASE);
    assert.ok(target.pathname.endsWith(`/${token}`));
    transbankMethods.push(options.method);
    if (options.method === 'PUT') throw new Error('se perdió la respuesta de la confirmación');
    assert.equal(options.method, 'GET');
    return Response.json({ buy_order: reservationId, status: 'AUTHORIZED', response_code: 0 });
  });

  const callback = await worker.fetch(new Request(
    `${paymentsApi}/webpay/return?r=${reservationId}&token_ws=${token}`,
  ), env);
  assert.equal(callback.status, 303);
  const redirect = new URL(callback.headers.get('Location'));
  const savedReturn = JSON.parse(JSON.stringify({
    id: redirect.searchParams.get('pago'),
    estado: redirect.searchParams.get('estado'),
    token: redirect.searchParams.get('token'),
  }));
  assert.equal(savedReturn.estado, 'pendiente');
  assert.equal(isRecoverableWebpayReturn(savedReturn), true);
  let confirmations = 0;
  const result = await recoverWebpayReturn(savedReturn, paymentsApi, async (id, recoveredToken) => {
    assert.equal(id, reservationId);
    assert.equal(recoveredToken, token);
    confirmations += 1;
  });
  assert.equal(result, 'confirmed');
  assert.equal(confirmations, 1);
  assert.deepEqual(transbankMethods, ['PUT', 'GET']);
});
