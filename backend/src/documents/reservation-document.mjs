import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { dahuaUserId } from '../dahua/reservation-access.mjs';

const COLORS = {
  ink: '#103d50',
  teal: '#0b8e92',
  mint: '#55d8cb',
  pale: '#eaf6f4',
  line: '#d8e8e5',
  muted: '#66818a',
  white: '#ffffff',
};

function money(value) {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function date(value) {
  if (!value) return 'Por definir';
  return new Intl.DateTimeFormat('es-CL', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00`));
}

export function reservationQrText(reservation, customer) {
  return [
    'RESTBLU - PASE DIGITAL',
    `Reserva: ${reservation.id}`,
    `Huesped: ${customer.name}`,
    `RUT: ${customer.documentId}`,
    `Alojamiento: ${reservation.propertyName}`,
    `Ubicacion: ${reservation.propertyPlace}`,
    `Check-in: ${reservation.checkIn} ${reservation.checkInTime || '15:00'}`,
    `Check-out: ${reservation.checkOut} ${reservation.checkOutTime || '11:00'}`,
    `Huespedes: ${reservation.guests}`,
    `PIN: ${reservation.accessPin}`,
    'Estado: CORREO VERIFICADO',
  ].join('\n');
}

// El QR del PDF es el QR de acceso del Dahua, generado al crear el PDF y
// válido 24 horas (el máximo que admite el lector). Si el QR aún no está en el
// terminal, el QR del PDF enlaza al pase de la reserva en la web (passUrl).
export async function generateReservationPdf(reservation, customer, {
  passUrl = '', accessQrContent = '', accessQrExpiresAt = '',
} = {}) {
  const accessQr = accessQrContent;
  const accessQrUntil = accessQrExpiresAt
    ? new Intl.DateTimeFormat('es-CL', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago',
    }).format(new Date(accessQrExpiresAt))
    : '';
  const qr = await QRCode.toBuffer(accessQr || passUrl || reservationQrText(reservation, customer), {
    type: 'png',
    width: 420,
    margin: 2,
    color: { dark: COLORS.ink, light: COLORS.white },
    errorCorrectionLevel: 'M',
  });

  return new Promise((resolve, reject) => {
    const document = new PDFDocument({
      size: 'A4',
      margin: 0,
      info: {
        Title: `Comprobante RestBlu ${reservation.id}`,
        Author: 'RestBlu',
        Subject: 'Comprobante de reserva y pase digital',
      },
    });
    const chunks = [];
    document.on('data', (chunk) => chunks.push(chunk));
    document.on('error', reject);
    document.on('end', () => resolve(Buffer.concat(chunks)));

    document.rect(0, 0, 595.28, 150).fill(COLORS.ink);
    document.roundedRect(48, 36, 48, 48, 13).fill(COLORS.mint);
    document
      .moveTo(59, 62)
      .bezierCurveTo(65, 56, 72, 68, 84, 59)
      .lineWidth(4)
      .lineCap('round')
      .strokeColor(COLORS.ink)
      .stroke();
    document
      .fillColor(COLORS.white)
      .font('Helvetica-Bold')
      .fontSize(25)
      .text('Rest', 112, 37, { continued: true })
      .fillColor(COLORS.mint)
      .text('Blu');
    document
      .fillColor('#b8d9dc')
      .font('Helvetica-Bold')
      .fontSize(8)
      .text('ESTADIAS INTELIGENTES', 113, 70, { characterSpacing: 1.5 });
    document
      .fillColor(COLORS.mint)
      .font('Helvetica-Bold')
      .fontSize(9)
      .text('COMPROBANTE Y PASE DIGITAL', 48, 111, { characterSpacing: 1.1 });
    document
      .fillColor(COLORS.white)
      .fontSize(18)
      .text('Reserva confirmada', 48, 126);

    document.roundedRect(420, 102, 126, 27, 13).fill('#dcf7ee');
    document
      .fillColor('#087759')
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .text('CORREO VERIFICADO', 428, 111, { width: 110, align: 'center' });

    document.roundedRect(48, 174, 304, 66, 14).fill(COLORS.pale);
    document
      .fillColor(COLORS.muted)
      .font('Helvetica-Bold')
      .fontSize(8)
      .text('CODIGO DE RESERVA', 67, 190, { characterSpacing: 0.8 });
    document
      .fillColor(COLORS.teal)
      .font('Courier-Bold')
      .fontSize(17)
      .text(reservation.id, 67, 208);

    const section = (title, y) => {
      document
        .fillColor(COLORS.teal)
        .font('Helvetica-Bold')
        .fontSize(9)
        .text(title.toUpperCase(), 48, y, { characterSpacing: 0.9 });
      document.moveTo(48, y + 17).lineTo(352, y + 17).strokeColor(COLORS.line).stroke();
      return y + 28;
    };
    const row = (label, value, y, strong = false) => {
      document.fillColor(COLORS.muted).font('Helvetica').fontSize(9).text(label, 48, y);
      document
        .fillColor(strong ? COLORS.teal : COLORS.ink)
        .font(strong ? 'Helvetica-Bold' : 'Helvetica')
        .text(String(value || '-'), 145, y, { width: 207, align: 'right' });
      document.moveTo(48, y + 17).lineTo(352, y + 17).strokeColor('#e7efee').stroke();
      return y + 24;
    };

    let y = section('Alojamiento', 270);
    y = row('Propiedad', reservation.propertyName, y);
    y = row('Ubicacion', reservation.propertyPlace, y);
    y = row('Check-in', `${date(reservation.checkIn)} - ${reservation.checkInTime || '15:00'}`, y);
    y = row('Check-out', `${date(reservation.checkOut)} - ${reservation.checkOutTime || '11:00'}`, y);
    y = row('Estadia', `${reservation.nights} noche(s) - ${reservation.guests} huesped(es)`, y);

    y = section('Huesped principal', y + 10);
    y = row('Nombre', customer.name, y);
    y = row('RUT', customer.documentId, y);
    y = row('Correo', customer.email, y);
    y = row('Telefono', customer.phone, y);

    y = section('Resumen del valor', y + 10);
    y = row('Tarifa por noche', money(reservation.nightlyPrice), y);
    y = row('Total referencial', money(reservation.total), y, true);
    row('Pago', reservation.paymentStatus === 'aprobado-demo'
      ? `Webpay aprobado${reservation.paymentReference ? ` - aut. ${reservation.paymentReference}` : ''}`
      : 'Pendiente', y);

    document.roundedRect(382, 174, 165, 386, 18).lineWidth(1).strokeColor(COLORS.line).stroke();
    document
      .fillColor(COLORS.teal)
      .font('Helvetica-Bold')
      .fontSize(9)
      .text('PASE DE ACCESO', 399, 194, { width: 132, align: 'center', characterSpacing: 0.9 });
    document.image(qr, 399, 222, { fit: [132, 132] });
    document
      .fillColor(COLORS.muted)
      .font('Helvetica')
      .fontSize(8)
      .text(accessQr
        ? `Muestralo en el lector de acceso. Valido hasta el ${accessQrUntil}; despues descarga de nuevo el PDF o usa la web.`
        : passUrl
          ? 'Escanealo con tu telefono para abrir tu pase: ahi esta el QR que abre la puerta.'
          : 'Datos de la reserva. El QR de acceso esta en la web o la app RestBlu.', 399, 364, {
        width: 132,
        align: 'center',
        lineGap: 2,
      });
    document.roundedRect(399, 414, 132, 92, 12).fill(COLORS.ink);
    document
      .fillColor('#9edbd5')
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .text('PIN TEMPORAL', 407, 429, { width: 116, align: 'center', characterSpacing: 0.7 });
    document
      .fillColor(COLORS.white)
      .font('Courier-Bold')
      .fontSize(24)
      .text(reservation.accessPin, 407, 449, { width: 116, align: 'center', characterSpacing: 2 });
    document
      .fillColor('#9edbd5')
      .font('Helvetica-Bold')
      .fontSize(7)
      .text('ID DE USUARIO DAHUA', 407, 480, { width: 116, align: 'center' });
    document
      .fillColor(COLORS.white)
      .font('Courier-Bold')
      .fontSize(8)
      .text(dahuaUserId(reservation.id), 405, 492, { width: 120, align: 'center' });
    document
      .fillColor(COLORS.muted)
      .font('Helvetica')
      .fontSize(7.5)
      .text('En el terminal, elige acceso por contrasena e ingresa el ID y el PIN.', 399, 520, { width: 132, align: 'center' });

    document.rect(0, 785, 595.28, 57).fill('#f3f8f7');
    document
      .fillColor(COLORS.muted)
      .font('Helvetica')
      .fontSize(8)
      .text(
        `RestBlu - Emitido ${new Intl.DateTimeFormat('es-CL', { dateStyle: 'long', timeStyle: 'short' }).format(new Date())}`,
        48,
        803,
        { width: 499, align: 'center' },
      );
    document
      .fontSize(7)
      .text('Pago procesado por Webpay (Transbank). El QR de acceso funciona solo durante la estadia.', 48, 818, {
        width: 499,
        align: 'center',
      });

    document.end();
  });
}
