import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './index.js';

const env = {
  TRANSBANK_API_BASE: 'https://transbank.example',
  TRANSBANK_COMMERCE_CODE: 'test',
  TRANSBANK_API_KEY: 'test',
  ALLOWED_RETURN_ORIGINS: 'https://restblu.web.app',
  DEFAULT_RETURN: 'https://restblu.web.app/',
};
const token = 'A'.repeat(64);
const reservationId = 'RB-TEST12-ABCDEF012345';

test('la consulta de recuperación sólo informa el resultado de la reserva correcta', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => Response.json({
    buy_order: reservationId, status: 'AUTHORIZED', response_code: 0,
    card_detail: { card_number: '1234' },
  });
  const request = () => new Request('https://restblu-pagos.example/webpay/status', {
    method: 'POST', body: JSON.stringify({ reservationId, token }),
  });
  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { state: 'approved', reservationId });

  globalThis.fetch = async () => Response.json({ buy_order: 'RB-OTHER1-ABCDEF012345', status: 'AUTHORIZED', response_code: 0 });
  assert.equal((await worker.fetch(request(), env)).status, 409);
});

test('si Transbank no confirma el retorno, la app conserva el token para reconsultar', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => { throw new Error('red caída'); };
  const request = new Request(`https://restblu-pagos.example/webpay/return?r=${reservationId}&app=1&token_ws=${token}`);
  const response = await worker.fetch(request, env);
  const page = await response.text();
  assert.equal(response.status, 200);
  assert.match(page, /Pago en verificación/);
  assert.match(page, /restblu:\/\/webpay\?/);
  assert.match(page, /estado=pendiente/);
  assert.match(page, new RegExp(token));
});

test('un pago fallido sí se muestra como rechazado', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => Response.json({ buy_order: reservationId, status: 'FAILED', response_code: -1 });
  const request = new Request('https://restblu-pagos.example/webpay/status', {
    method: 'POST', body: JSON.stringify({ reservationId, token }),
  });
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.state, 'rejected');
});
