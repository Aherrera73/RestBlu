import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { generateReservationPdf } from '../src/documents/reservation-document.mjs';

const output = resolve(process.argv[2] || 'tmp/pdfs/restblu-sample.pdf');
const reservation = {
  id: 'RB-DEMO-2026',
  propertyName: 'Brisa del Pacifico',
  propertyPlace: 'Algarrobo, Chile',
  checkIn: '2026-09-17',
  checkOut: '2026-09-24',
  guests: 2,
  nights: 7,
  nightlyPrice: 200000,
  total: 1400000,
  accessPin: '482731',
};
const customer = {
  name: 'Camila Fernandez',
  documentId: '12.345.678-5',
  email: 'camila@example.cl',
  phone: '+56 9 1234 5678',
};

await mkdir(dirname(output), { recursive: true });
await writeFile(output, await generateReservationPdf(reservation, customer));
console.log(output);
