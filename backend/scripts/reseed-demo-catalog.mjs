import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createLocalDatabase } from '../src/database/local-database.mjs';
import { propertyFromInput } from '../src/properties/property-service.mjs';

const BACKEND = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = resolve(BACKEND, '..');
const DATABASE = join(BACKEND, 'data', 'lumastay.sqlite');
const SCHEMA = join(BACKEND, 'src', 'database', 'schema.sql');
const PRIVATE_CONFIG = process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, 'RestBlu', '.env.local')
  : join(BACKEND, '.env.local');
const COLLECTIONS = [
  'public_properties',
  'reservation_verification_requests',
  'reservation_status',
  'reservation_intake',
  'cloud_reservations',
];

dotenv.config({ path: PRIVATE_CONFIG, quiet: true, override: true });

const owners = {
  torres: {
    ownerName: 'Camila Torres · Propietaria demo',
    ownerDocumentId: '1.111.111-4',
    ownerEmail: 'camila.torres@example.invalid',
    ownerPhone: '+56 9 1111 1111',
  },
  munoz: {
    ownerName: 'Diego Muñoz · Propietario demo',
    ownerDocumentId: '2.222.222-8',
    ownerEmail: 'diego.munoz@example.invalid',
    ownerPhone: '+56 9 2222 2222',
  },
  soto: {
    ownerName: 'Valentina Soto · Propietaria demo',
    ownerDocumentId: '3.333.333-1',
    ownerEmail: 'valentina.soto@example.invalid',
    ownerPhone: '+56 9 3333 3333',
  },
  reyes: {
    ownerName: 'Martín Reyes · Propietario demo',
    ownerDocumentId: '4.444.444-5',
    ownerEmail: 'martin.reyes@example.invalid',
    ownerPhone: '+56 9 4444 4444',
  },
  rojas: {
    ownerName: 'Paula Rojas · Propietaria demo',
    ownerDocumentId: '5.555.555-9',
    ownerEmail: 'paula.rojas@example.invalid',
    ownerPhone: '+56 9 5555 5555',
  },
};

const rawProperties = [
  {
    name: 'Refugio Arrayán', place: 'Pucón, Chile', type: 'Cabaña completa',
    address: 'Camino al Volcán 1450', commune: 'Pucón', region: 'La Araucanía',
    description: 'Cabaña familiar rodeada de bosque, con terraza y espacio de trabajo.',
    guests: 6, beds: 3, bedCount: 4, baths: 2, price: 148000, rating: 4.9,
    tags: 'Bosque, Familia, Teletrabajo', ...owners.torres,
    image: 'https://images.unsplash.com/photo-1449158743715-0a90ebb6d2d8?auto=format&fit=crop&w=1200&q=85',
    gallery: [
      { src: 'https://images.unsplash.com/photo-1523217582562-09d0def993a6?auto=format&fit=crop&w=1000&q=85', alt: 'Terraza del Refugio Arrayán' },
      { src: 'https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?auto=format&fit=crop&w=1000&q=85', alt: 'Interior del Refugio Arrayán' },
    ],
  },
  {
    name: 'Loft Puerto Norte', place: 'Puerto Varas, Chile', type: 'Loft',
    address: 'Av. Costanera 820', commune: 'Puerto Varas', region: 'Los Lagos',
    description: 'Loft moderno cercano al lago y al centro de Puerto Varas.',
    guests: 2, beds: 1, bedCount: 1, baths: 1, price: 92000, rating: 4.8,
    tags: 'Lago, Parejas, Centro', ...owners.torres,
    image: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1200&q=85',
    gallery: [
      { src: 'https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=1000&q=85', alt: 'Zona de trabajo del loft' },
      { src: 'https://images.unsplash.com/photo-1560185127-6ed189bf02f4?auto=format&fit=crop&w=1000&q=85', alt: 'Living del loft' },
    ],
  },
  {
    name: 'Bosque Nevado', place: 'Nevados de Chillán, Chile', type: 'Refugio de montaña',
    address: 'Camino Termas de Chillán km 72', commune: 'Pinto', region: 'Ñuble',
    description: 'Refugio calefaccionado para descansar cerca de senderos y centros de montaña.',
    guests: 5, beds: 2, bedCount: 4, baths: 2, price: 175000, rating: 4.9,
    tags: 'Montaña, Nieve, Naturaleza', ...owners.torres,
    image: 'https://images.unsplash.com/photo-1486915309851-b0cc1f8a0084?auto=format&fit=crop&w=1200&q=85',
    gallery: [
      { src: 'https://images.unsplash.com/photo-1520984032042-162d526883e0?auto=format&fit=crop&w=1000&q=85', alt: 'Exterior del refugio' },
      { src: 'https://images.unsplash.com/photo-1542718610-a1d656d1884c?auto=format&fit=crop&w=1000&q=85', alt: 'Interior de montaña' },
    ],
  },
  {
    name: 'Villa Dunas', place: 'Concón, Chile', type: 'Casa costera',
    address: 'Av. Borgoño 22100', commune: 'Concón', region: 'Valparaíso',
    description: 'Casa luminosa con espacios amplios y acceso rápido a la costa.',
    guests: 8, beds: 4, bedCount: 6, baths: 3, price: 238000, rating: 4.7,
    tags: 'Mar, Grupos, Terraza', ...owners.munoz,
    image: 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1200&q=85',
    gallery: [
      { src: 'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=1000&q=85', alt: 'Fachada de Villa Dunas' },
      { src: 'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1000&q=85', alt: 'Living de Villa Dunas' },
    ],
  },
  {
    name: 'Patio del Maipo', place: 'San José de Maipo, Chile', type: 'Casa de campo',
    address: 'Camino al Volcán 18760', commune: 'San José de Maipo', region: 'Metropolitana',
    description: 'Casa de campo con quincho y patio, ideal para descansar junto a la cordillera.',
    guests: 7, beds: 3, bedCount: 5, baths: 2, price: 169000, rating: 4.8,
    tags: 'Cordillera, Quincho, Familia', ...owners.munoz,
    image: 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=1200&q=85',
    gallery: [
      { src: 'https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?auto=format&fit=crop&w=1000&q=85', alt: 'Patio de la casa' },
      { src: 'https://images.unsplash.com/photo-1600566753051-f0b89df2dd90?auto=format&fit=crop&w=1000&q=85', alt: 'Comedor de la casa' },
    ],
  },
  {
    name: 'Cabaña Lago Azul', place: 'Frutillar, Chile', type: 'Cabaña',
    address: 'Ruta V-155 3120', commune: 'Frutillar', region: 'Los Lagos',
    description: 'Cabaña tranquila con vista al entorno rural y cercanía al lago.',
    guests: 4, beds: 2, bedCount: 3, baths: 1, price: 118000, rating: 4.9,
    tags: 'Lago, Naturaleza, Descanso', ...owners.soto,
    image: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=85',
    gallery: [
      { src: 'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=1000&q=85', alt: 'Entorno natural de la cabaña' },
      { src: 'https://images.unsplash.com/photo-1600585152915-d208bec867a1?auto=format&fit=crop&w=1000&q=85', alt: 'Living de la cabaña' },
    ],
  },
  {
    name: 'Departamento Cerro Alegre', place: 'Valparaíso, Chile', type: 'Departamento',
    address: 'Templeman 645', commune: 'Valparaíso', region: 'Valparaíso',
    description: 'Departamento renovado para recorrer a pie los principales miradores del cerro.',
    guests: 3, beds: 1, bedCount: 2, baths: 1, price: 86000, rating: 4.7,
    tags: 'Ciudad, Cultura, Vista', ...owners.reyes,
    image: 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1200&q=85',
    gallery: [
      { src: 'https://images.unsplash.com/photo-1493809842364-78817add7ffb?auto=format&fit=crop&w=1000&q=85', alt: 'Sala del departamento' },
      { src: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1000&q=85', alt: 'Dormitorio del departamento' },
    ],
  },
  {
    name: 'Casa Horizonte', place: 'La Serena, Chile', type: 'Casa completa',
    address: 'Av. del Mar 4700', commune: 'La Serena', region: 'Coquimbo',
    description: 'Casa amplia para vacaciones familiares cerca de la playa.',
    guests: 6, beds: 3, bedCount: 5, baths: 2, price: 156000, rating: 4.8,
    tags: 'Playa, Familia, Estacionamiento', ...owners.rojas,
    image: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=85',
    gallery: [
      { src: 'https://images.unsplash.com/photo-1600607688969-a5bfcd646154?auto=format&fit=crop&w=1000&q=85', alt: 'Exterior de Casa Horizonte' },
      { src: 'https://images.unsplash.com/photo-1600573472550-8090b5e0745e?auto=format&fit=crop&w=1000&q=85', alt: 'Interior de Casa Horizonte' },
    ],
  },
];

const createdAt = new Date().toISOString();
const properties = rawProperties.map((property, index) => propertyFromInput(
  { ...property, active: true, checkInTime: '15:00', checkOutTime: '11:00' },
  { id: index + 1, createdAt },
));

if (!process.argv.includes('--confirm=RESET_ALL_DEMO_DATA')) {
  console.log(JSON.stringify({
    mode: 'preview',
    properties: properties.map(({ id, name, ownerName }) => ({ id, name, ownerName })),
    owners: Object.keys(owners).length,
  }, null, 2));
  process.exit(0);
}

if (!existsSync(DATABASE)) throw new Error('No se encontró la base SQLite de RestBlu.');
const credentialsPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (!credentialsPath || !existsSync(credentialsPath)) {
  throw new Error('No se encontró la cuenta de servicio configurada para Firebase.');
}

const credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
const app = getApps()[0] || initializeApp({ credential: cert(credentials) });
const store = getFirestore(app);
const snapshots = {};
for (const name of COLLECTIONS) {
  const snapshot = await store.collection(name).get();
  snapshots[name] = snapshot.docs.map((document) => ({ id: document.id, data: document.data() }));
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDirectory = join(PROJECT, 'respaldos', `antes_reinicio_total_${stamp}`);
await mkdir(backupDirectory, { recursive: true });
await copyFile(DATABASE, join(backupDirectory, 'lumastay.sqlite'));
await writeFile(
  join(backupDirectory, 'firebase.json'),
  `${JSON.stringify({ exportedAt: createdAt, collections: snapshots }, null, 2)}\n`,
  'utf8',
);

for (const name of COLLECTIONS) {
  while (true) {
    const snapshot = await store.collection(name).limit(400).get();
    if (snapshot.empty) break;
    const batch = store.batch();
    for (const document of snapshot.docs) batch.delete(document.ref);
    await batch.commit();
  }
}

const database = createLocalDatabase({
  databasePath: DATABASE,
  legacyJsonPath: join(BACKEND, 'data', 'legacy-not-used.json'),
  schemaPath: SCHEMA,
});
database.saveDatabase({
  meta: { version: 5, updatedAt: createdAt },
  properties,
  customers: [],
  reservations: [],
});
const counts = database.tableCounts();
database.close();

const compact = new DatabaseSync(DATABASE);
compact.exec("DELETE FROM sqlite_sequence WHERE name IN ('estadia_eventos', 'alojamiento_imagenes'); VACUUM;");
compact.close();

console.log(JSON.stringify({
  mode: 'completed',
  backupDirectory,
  properties: counts.properties,
  owners: Object.keys(owners).length,
  customers: counts.customers,
  reservations: counts.reservations,
  remoteCollectionsCleared: COLLECTIONS,
}, null, 2));
