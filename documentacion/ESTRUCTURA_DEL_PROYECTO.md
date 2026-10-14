# Estructura modular de RestBlu

La carpeta principal está separada por capas. El proyecto mantiene dos programas que se comunican mediante Firebase:

1. `frontend`: sitio público para buscar alojamientos, reservar, verificar el correo y obtener el pase.
2. `backend`: API y aplicación local para administrar alojamientos, clientes, estadías y la base SQLite.

```text
Arriendos (2)/
├─ frontend/                    Web pública RestBlu
├─ backend/                     API, gestor local, SQLite, correo y PDF
├─ documentacion/               Registro, minutas y guía técnica
├─ respaldos/                   ZIP anteriores del proyecto
├─ Abrir_RestBlu.bat            Abre solamente el frontend
├─ Abrir_Gestor_RestBlu.bat     Abre solamente el backend y su panel
└─ Abrir_RestBlu_Completo.bat   Abre ambos programas
```

## Frontend: `frontend`

```text
frontend/
├─ app/                         Rutas, diseño global y metadatos de Vinext
│  ├─ page.tsx                  Entrada mínima hacia el módulo público
│  ├─ layout.tsx
│  └─ globals.css
├─ modules/public-site/         Funcionalidad propia de RestBlu
│  ├─ RestBluApp.tsx            Coordinación de pantallas y estado de la demo
│  ├─ config.ts                 Direcciones y configuración pública
│  ├─ domain/
│  │  ├─ types.ts               Modelos de alojamiento, reserva y búsqueda
│  │  └─ reservation.ts         Fechas, RUT, valores, códigos, PIN y QR
│  └─ services/
│     └─ firebase.ts            Sesión, catálogo, reservas y verificación en la nube
├─ components/ui/               Componentes visuales reutilizables
├─ lib/                         Utilidades generales de interfaz
├─ public/                      Logo, favicon y recursos públicos
├─ firebase.json                Publicación en Firebase Hosting
└─ firestore.rules              Permisos de la base en línea
```

Para modificar una regla de negocio de las reservas se trabaja en `domain/`. Para cambiar la conexión en línea se trabaja en `services/`. Para cambiar una pantalla se trabaja en `RestBluApp.tsx`. La carpeta `app/` queda reservada para las rutas del sitio.

## Backend y gestor local: `backend`

```text
backend/
├─ server.mjs                   Entrada estable usada por npm y los BAT
├─ src/
│  ├─ server/index.mjs          Servidor, rutas y sincronización principal
│  ├─ database/
│  │  ├─ local-database.mjs     Lectura y escritura de SQLite
│  │  └─ schema.sql             Tablas, índices y vistas
│  ├─ documents/
│  │  └─ reservation-document.mjs  PDF y contenido del QR
│  ├─ properties/
│  │  └─ property-service.mjs   Validación y publicación de alojamientos
│  ├─ customers/
│  │  └─ customer-service.mjs   Validación y normalización de clientes
│  └─ shared/
│     └─ normalizers.mjs        RUT, correo, números y texto seguro
├─ public/
│  ├─ index.html                Estructura del panel
│  └─ assets/
│     ├─ css/styles.css         Diseño del panel
│     └─ js/
│        ├─ app.js              Eventos y coordinación de la interfaz
│        ├─ services/api.js     Comunicación con el servidor local
│        └─ shared/formatters.js Formatos seguros para pantalla
├─ data/                        Base SQLite y respaldo histórico
├─ uploads/                     Imágenes cargadas desde el gestor
├─ database/verify-database.mjs Comprobación de integridad
└─ scripts/                     Herramientas auxiliares
```

Los datos reales continúan en `backend/data/` y `backend/uploads/`; no se transformaron. Los archivos BAT de la carpeta principal conservan sus nombres y siguen usando `backend/server.mjs`, por lo que la forma de abrir la demostración local no cambia.

## Modos de procesamiento

- En `localhost`, el frontend llama directamente al backend local: este usa SMTP, SQLite y el enlace de verificación existente.
- En Firebase Hosting, el frontend guarda la solicitud en Firestore para que el gestor local la procese al estar abierto.
- Al iniciar el gestor, las solicitudes pendientes de `reservation_intake` se sincronizan hacia SQLite y se envían los correos correspondientes.

## Regla para futuros cambios

- Pantallas y experiencia del huésped: `frontend/modules/public-site`.
- Reglas de alojamientos o clientes: servicio correspondiente en `backend/src`.
- Cambios de tablas: `backend/src/database/schema.sql` y `backend/src/database/local-database.mjs`.
- Correo local: `backend/src/server`.
- Correo SMTP y verificación: `backend/src/server`.
- PDF para correo y descarga: `backend/src/documents`.
- No guardar contraseñas ni el JSON privado de Firebase dentro del proyecto.
