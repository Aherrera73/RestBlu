export type WebpayReturn = { id: string; estado: string; token: string };

export function isRecoverableWebpayReturn(value: unknown): value is WebpayReturn {
  if (!value || typeof value !== 'object') return false;
  const payment = value as Partial<WebpayReturn>;
  return (payment.estado === 'aprobado' || payment.estado === 'pendiente') &&
    typeof payment.id === 'string' && /^(LS|RB)-[A-Z0-9-]{10,50}$/.test(payment.id) &&
    typeof payment.token === 'string' && /^[A-Za-z0-9]{20,100}$/.test(payment.token);
}

// Un retorno sin confirmación puede corresponder a un cobro aprobado. Sólo
// un resultado definitivo permite confirmar la reserva o volver a pagar.
export async function recoverWebpayReturn(
  payment: WebpayReturn,
  paymentsApi: string,
  confirmPayment: (id: string, token: string) => Promise<void>,
): Promise<'confirmed' | 'pending' | 'rejected'> {
  if (!isRecoverableWebpayReturn(payment)) {
    throw new Error('El retorno de Webpay no contiene un identificador de pago válido.');
  }
  if (payment.estado === 'pendiente') {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 2_000));
      let response: Response;
      try {
        response = await fetch(`${paymentsApi}/webpay/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reservationId: payment.id, token: payment.token }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        throw new Error('No fue posible conectar con Webpay. El intento se conserva para reconsultarlo.');
      }
      if (!response.ok) {
        throw new Error('No fue posible verificar el resultado en Webpay. El intento se conserva para reconsultarlo.');
      }
      const result = await response.json().catch(() => null) as { state?: string; reservationId?: string } | null;
      if (result?.reservationId !== payment.id || !['approved', 'pending', 'rejected'].includes(result.state || '')) {
        throw new Error('Webpay no entregó un resultado válido para esta reserva. El pago sigue en verificación.');
      }
      if (result.state === 'rejected') return 'rejected';
      if (result.state === 'approved') break;
      if (attempt === 5) return 'pending';
    }
  }
  // El gestor vuelve a verificar con Transbank la orden y el monto antes
  // de habilitar el pase; el navegador nunca confirma el cobro por sí solo.
  await confirmPayment(payment.id, payment.token);
  return 'confirmed';
}
