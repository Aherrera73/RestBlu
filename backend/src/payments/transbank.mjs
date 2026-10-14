// Consulta a Webpay Plus (Transbank) el estado de una transacción. El gestor no
// confía en lo que informa el navegador: antes de dar por pagada una reserva
// verifica aquí que Transbank la autorizó, por el monto y la orden correctos.

// Ambiente de integración: credenciales públicas de prueba de Transbank.
const INTEGRATION = {
  baseUrl: 'https://webpay3gint.transbank.cl',
  commerceCode: '597055555532',
  apiKey: '579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C',
};

const API_PATH = '/rswebpaytransaction/api/webpay/v1.2/transactions';

export function transbankConfig(env = process.env) {
  return {
    baseUrl: String(env.TRANSBANK_API_BASE || INTEGRATION.baseUrl).replace(/\/+$/, ''),
    commerceCode: String(env.TRANSBANK_COMMERCE_CODE || INTEGRATION.commerceCode),
    apiKey: String(env.TRANSBANK_API_KEY || INTEGRATION.apiKey),
  };
}

export function isWebpayToken(value) {
  return /^[A-Za-z0-9]{20,100}$/.test(String(value || ''));
}

export async function webpayTransactionStatus(token, config = transbankConfig()) {
  if (!isWebpayToken(token)) throw new Error('El token de Webpay no es válido.');
  let response;
  try {
    response = await fetch(`${config.baseUrl}${API_PATH}/${encodeURIComponent(token)}`, {
      headers: {
        'Tbk-Api-Key-Id': config.commerceCode,
        'Tbk-Api-Key-Secret': config.apiKey,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error('No fue posible consultar el pago en Transbank. Se reintentará.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Transbank no entregó el estado del pago (${data.error_message || `HTTP ${response.status}`}).`);
  }
  return data;
}

// Resultado de la verificación: aprobado sólo si Transbank autorizó el pago de
// esa orden por ese monto.
export function evaluateWebpayPayment(status, { buyOrder, amount }) {
  if (String(status.buy_order) !== String(buyOrder)) {
    return { approved: false, reason: 'El pago de Webpay corresponde a otra reserva.' };
  }
  if (Number(status.amount) !== Number(amount)) {
    return { approved: false, reason: 'El monto pagado en Webpay no coincide con el total de la reserva.' };
  }
  if (status.status !== 'AUTHORIZED' || Number(status.response_code) !== 0) {
    return { approved: false, reason: 'Webpay rechazó el pago. La reserva sigue pendiente y no hubo cobro.' };
  }
  return {
    approved: true,
    authorizationCode: String(status.authorization_code || ''),
    cardLast4: String(status.card_detail?.card_number || '').slice(-4),
    paymentType: String(status.payment_type_code || ''),
  };
}
