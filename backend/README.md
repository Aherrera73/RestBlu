# Gestor local RestBlu

Programa independiente ubicado en `backend` para administrar los datos que usa la demo pública de RestBlu. No forma parte de la interfaz de reservas.

## Qué administra

- **Alojamientos:** crear, editar, publicar u ocultar propiedades, precios, capacidad, etiquetas e imágenes cargadas desde el computador.
- **Clientes:** consultar y editar los datos recibidos desde una reserva, agregar notas y activar o desactivar la ficha.
- **Reservas:** revisar código, cliente, alojamiento, fechas, huéspedes y total referencial.
- **Verificación:** enviar el enlace al correo de la reserva y habilitar el pago de demostración después de validarlo.
- **Comprobante:** generar y enviar un PDF con QR y PIN después de verificar el correo y aprobar el pago de demostración.
- **Respaldo:** descargar una copia JSON con todos los datos locales.
- **Base SQLite:** consultar las tablas y relaciones directamente desde DBeaver.
- **Sincronización Firestore:** recibir en SQLite las reservas hechas desde teléfonos u otros computadores y publicar los alojamientos activos para todos los dispositivos.

## Cómo iniciarlo

- `Abrir_Gestor_RestBlu.bat`: abre solamente el gestor en `http://127.0.0.1:3100`.
- `Abrir_RestBlu_Completo.bat`: inicia el gestor y la plataforma pública en ventanas separadas, y abre ambos sitios.

Los archivos `.bat` están en la carpeta superior `Arriendos (2)`.

## Configurar correo y sincronización móvil

1. Ejecuta `Configurar_Correo_RestBlu.bat`.
2. El configurador revisará la configuración sin imprimir correos, contraseñas, rutas privadas ni el contenido de credenciales.
3. Completa `SMTP_HOST`, `SMTP_USER` y `SMTP_PASS` con la cuenta que enviará los mensajes. Si usas Gmail, activa la verificación en dos pasos y usa una **contraseña de aplicación**; no uses tu contraseña normal.
4. Descarga desde Firebase una clave JSON de una cuenta de servicio y escribe su ruta absoluta en `FIREBASE_SERVICE_ACCOUNT_PATH`. No compartas ni adjuntes ese archivo.
5. Guarda el archivo y cierra el Bloc de notas. El configurador volverá a comprobarlo y reiniciará el gestor.

La configuración privada se guarda en `%LOCALAPPDATA%\RestBlu\.env.local`, fuera de la carpeta del proyecto. El JSON de Firebase y `.env.local` son privados: no deben copiarse al sitio público, subirse a Git ni incluirse en un ZIP compartido. El configurador nunca prueba la contraseña contra Internet; solo detecta campos vacíos o de ejemplo, valida el formato básico y comprueba que el JSON indicado exista sin abrir su contenido.

La aplicación puede abrirse con configuración pendiente para administrar datos locales, pero no enviará correos ni importará reservas hechas desde teléfonos. Puedes repetir la revisión sin abrir el editor con:

```bat
Configurar_Correo_RestBlu.bat --check
```

También puedes ejecutarla desde `backend` con `npm run check:setup`. El código de salida es `0` cuando la configuración básica está lista, `2` cuando sigue pendiente y `1` si la revisión no pudo ejecutarse.

## Probar RestBlu IA

El gestor incluye la sección **RestBlu IA**, que consulta un servidor compatible con
la API de OpenAI mediante el backend local. La clave nunca se entrega al
navegador. Este asistente interno trabaja en modo de solo lectura y recibe el
registro de clientes, estadías y alojamientos para poder responder consultas del
gestor, incluyendo datos personales cuando la pregunta los requiere. Usa sólo un
servidor de IA privado y autorizado para este propósito.

Agrega estas variables al mismo archivo privado `.env.local`:

```env
AI_BASE_URL=https://tu-servidor.example:8443/v1
AI_API_KEY=sk-local-reemplazar
AI_MODEL=ia-local:latest
```

Después reinicia el gestor y abre **05 RestBlu IA**.

La web pública tiene un asistente separado. Ese chat recibe exclusivamente el
catálogo publicado, las fechas ocupadas y la búsqueda actual; nunca recibe la
tabla de clientes. En Firebase Hosting las preguntas pasan por Firestore al
gestor encendido, que consulta la API de IA configurada. El registro facial
publicado también usa Firestore como tránsito: la foto viaja cifrada, el gestor
la elimina de la solicitud tras procesarla y conserva sólo la plantilla cifrada
en SQLite. Ninguna clave privada se coloca en el frontend. Si el gestor está
apagado, las solicitudes quedan pendientes hasta que se abra nuevamente.

## Flujo de demostración

### Dahua y acceso facial asociado a reservas

El registro facial confirmado por una reserva se sincroniza con el terminal
Dahua mediante los mismos CGI V2/V1 usados por `Acceso-Claro-Dahua`. Sólo el
gestor local contacta al dispositivo: la web no recibe la cuenta ni el
certificado. La persona se crea con un ID derivado del código de reserva, foto
JPEG de 500 × 500 píxeles, puerta 1 y vigencia desde el check-in hasta el
check-out. No hay apertura remota automática. La foto no se almacena en
SQLite; el terminal la conserva hasta la revocación.

1. Ejecuta `Configurar_Dahua_Reservas.bat` en la carpeta principal e ingresa
   la cuenta CGI exclusiva. La contraseña no se muestra ni debe enviarse por
   chat. El configurador sólo hace una consulta de lectura para comprobar
   HTTPS, el certificado y la autenticación; luego exige escribir `ACTIVAR`
   por tratarse de una cerradura real con pagos ficticios.
2. Publica primero la web con el consentimiento actualizado (o instala la
   aplicación Android actualizada) y reinicia el gestor. Las versiones antiguas
   no expresan consentimiento para Dahua y el gestor rechaza esas solicitudes.
   Tras verificar correo y pago de demostración, RestBlu descifra la captura
   sólo en memoria, da de alta persona/rostro directamente en Dahua y elimina
   la captura temporal. No requiere el comparador biométrico externo ni crea
   una plantilla paralela para altas nuevas.
3. Consulta `dahuaStatus` de la reserva: `verificado` significa que la
   consulta posterior encontró el rostro; `registrado-sin-verificar` requiere
   revisión; `error` o `pendiente-configuracion` no confirman acceso.
4. Al terminar o invalidarse la reserva, la vigencia fijada en el terminal
   caduca y el gestor intenta eliminar rostro y persona. Si el dispositivo
   está desconectado, queda `revocacion-pendiente` y se reintenta al volver.

Esto sigue siendo un laboratorio: `aprobado-demo` no representa un pago real.
No conectes una puerta de producción al flujo de pagos ficticios. El QR del
PDF actual es un comprobante legible con datos de la reserva; **no** es una
credencial Dahua. Para habilitar QR físico se necesita confirmar el formato
compatible del firmware y emitir un token dedicado sin datos personales.

1. Abre `Abrir_RestBlu_Completo.bat`.
2. En el gestor, entra a **Alojamientos** y selecciona **Nuevo alojamiento**.
3. Completa los datos y deja activa la opción **Publicado en RestBlu**.
4. Guarda. El gestor publicará el alojamiento en Firestore y la web alojada actualizará el catálogo en un máximo aproximado de cinco segundos.
5. En `https://restblu.web.app`, desde este equipo o cualquier otro dispositivo, busca el destino, selecciona fechas y solicita una reserva. El RUT se formatea y valida automáticamente.
6. Abre el correo recibido y verifica la dirección. Mientras esté pendiente, el pago, el QR y el PIN permanecen bloqueados.
7. Regresa a la reserva y completa el pago con una tarjeta ficticia de prueba. Solo si se aprueba, RestBlu confirma la reserva y genera el comprobante PDF con el QR y el PIN temporal. No se efectúa ningún cobro real.
8. Regresa al gestor. La reserva aparecerá en **Reservas** y la persona quedará registrada en **Clientes**.
9. Usa **Exportar respaldo** para descargar una copia de seguridad.

## Almacenamiento y alcance

- El gestor escucha únicamente en `127.0.0.1:3100`; no queda expuesto a otros equipos de la red.
- Firestore funciona como puente seguro entre la web alojada y el gestor. Cada dispositivo utiliza una identidad anónima de Firebase y solo puede consultar sus propias reservas.
- Las reservas del sitio publicado permanecen pendientes en Firestore hasta que se abra `Abrir_Gestor_RestBlu.bat`; entonces se incorporan a SQLite y se envían sus correos.
- Desde que el gestor acepta una reserva, su estado pendiente (verificación de correo o pago) retiene las fechas durante 60 minutos. Si vence, se marca como expirada, el enlace de verificación ya no sirve y las fechas vuelven a estar disponibles. Se puede ajustar el plazo con `RESTBLU_PENDING_RESERVATION_MINUTES` en el archivo privado `.env.local` (entre 5 y 1440 minutos). Una reserva que ya estaba pendiente antes de esta actualización recibe el plazo al iniciar el gestor actualizado por primera vez. Mientras el gestor esté apagado, la solicitud nueva sigue pendiente en Firestore y este plazo local aún no comienza.
- Cada reserva conserva una copia del nombre, RUT, correo y teléfono ingresados en ese momento. Cambiar después la ficha del cliente no modifica el correo ni el comprobante de esa reserva.
- La información se guarda en `data/lumastay.sqlite`. El archivo JSON anterior se conserva como respaldo de la migración y deja de ser la fuente principal.
- La base contiene tablas separadas para `alojamientos`, `alojamiento_imagenes`, `alojamiento_etiquetas`, `clientes`, `estadias`, `estadia_eventos` y `app_metadata`.
- Si el gestor está cerrado, Firestore conserva las reservas pendientes. La copia SQLite y el envío de correos se actualizan cuando el gestor vuelva a abrirse.
- Las imágenes nuevas se copian a la carpeta local `uploads` y se muestran en RestBlu sin depender de un enlace externo. Se aceptan JPG, PNG, WEBP y GIF de hasta 8 MB cada una.
- Este sistema sigue siendo una demostración: sincroniza Firestore y SQLite y simula pagos con tarjetas ficticias; no procesa pagos reales. La integración Dahua sólo se activa de forma explícita para el laboratorio y puede habilitar una cerradura real durante la vigencia de una reserva de prueba.

## Terminales Dahua por Internet (hub)

El gestor puede llegar a los Dahua de cada alojamiento a través del hub
(`D:\RB\dahua-hub`), aunque estén en otra red: el hub mantiene la conexión
de Auto Register del terminal y ejecuta en él las mismas CGI que el gestor
usaría en la red local (QR, rostro, revocación, clave del QR dinámico).

En `%LOCALAPPDATA%\RestBlu\.env.local`:

```
DAHUA_HUB_URL=http://127.0.0.1:3200
DAHUA_HUB_API_KEY=...            # la misma clave exige el hub
DAHUA_HUB_DEFAULT_DEVICE=PROP-0001   # terminal de los alojamientos sin uno asignado
```

- Cada alojamiento tiene el campo **Terminal Dahua** (Registration ID) en el
  formulario del gestor; el gestor informa la asignación al hub.
- Terminal de una reserva: el del alojamiento, si no el `DAHUA_HUB_DEFAULT_DEVICE`,
  y si no hay hub, el Dahua de la red local (`DAHUA_BASE_URL`).
- Cada reserva recuerda en qué terminal quedó (`estadias.dahua_terminal`); su QR,
  rostro y revocación siempre van a ese equipo. Las reservas registradas antes del
  hub quedan en la red local.
- El registro de entradas y salidas se copia cada minuto de cada terminal: el de
  la red local y los conectados al hub. Cada movimiento guarda su terminal
  (`accesos_eventos.terminal`); los que no traen reserva (rechazos, botón de
  salida) se asocian a la vivienda si su terminal está asignado a una sola.
- En **Seguridad**, cada vivienda muestra su terminal, si está en línea y un
  botón **Asignar terminal** (edita el mismo campo del alojamiento).
- En **Espacios publicados** y **Seguridad**, **Abrir puerta** envía inmediatamente
  la orden al canal 1 del terminal asignado. Requiere un Registration ID propio
  y exclusivo para la vivienda; si falta o está compartido, el botón indica
  el problema y queda deshabilitado. Tras un intento se esperan 10 segundos
  antes de repetir la orden. La apertura manual solo se acepta desde el gestor
  local y se registra en su consola.
- La sección **09 Terminales** del gestor lista los terminales del hub, el túnel ngrok y permite probar cada uno (`GET /api/dahua/terminals`, `POST /api/dahua/terminals/{id}/test`).
- `GET /api/dahua/hub` muestra el estado del hub, los terminales online y la
  asignación de cada alojamiento.

## Asistentes de IA (Blu y RestBlu IA)

Usan el servidor Ollama configurado en `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`
(`src/ai/ai-client.mjs`; la lógica de contexto está en `src/ai/assistant-context.mjs`).

- **Rapidez:** el gestor mantiene el modelo cargado en la GPU con una consulta
  mínima cada 4 minutos (`AI_KEEP_WARM=0` lo desactiva); sin eso, la primera
  pregunta tras unos minutos sin uso tarda ~1 minuto en cargar el modelo. Las
  preguntas de la web y la app se toman al instante con un listener de
  Firestore y la respuesta se publica mientras se escribe (`partialAnswer`).
- **Disponibilidad calculada por el código**, no por el modelo; Blu sólo la explica.
- **Blu personal:** con sesión iniciada responde sobre las reservas de esa cuenta
  (check-in, QR, dirección y manual del huésped sólo si la estadía está confirmada).
- **Manual de la vivienda:** en el formulario del alojamiento, *Información para
  viajeros* (pública) y *Manual del huésped* (sólo estadías confirmadas).
- **Botones:** las respuestas traen `suggestions` con los alojamientos nombrados y la
  búsqueda actual, para reservar directamente.
- **Idioma:** se detecta el de la pregunta (español, inglés, portugués) y se indica al modelo.
- **Resumen del día y alertas:** `GET /api/admin/daily-summary` (Pulso y Seguridad):
  llegadas, salidas, pagos por vencer, terminales desconectados, rechazos seguidos
  (3 o más en 10 minutos) y entradas fuera de la estadía. RestBlu IA también lo usa.
- **Valoraciones 👍 / 👎:** se guardan en `ia_valoraciones` y se ven en RestBlu IA
  (`GET /api/admin/ai-feedback`).

## Base de datos SQL Server

El gestor puede trabajar con SQLite (archivo local, opción por omisión) o con
SQL Server. Se elige en el archivo privado `%LOCALAPPDATA%\RestBlu\.env.local`:

```
RESTBLU_DB_ENGINE=sqlserver
RESTBLU_SQLSERVER_HOST=localhost
RESTBLU_SQLSERVER_PORT=1433
RESTBLU_SQLSERVER_DATABASE=RestBlu
RESTBLU_SQLSERVER_USER=restblu_app
RESTBLU_SQLSERVER_PASSWORD=...
```

Opcionales: `RESTBLU_SQLSERVER_INSTANCE` (instancia con nombre, en lugar del
puerto), `RESTBLU_SQLSERVER_ENCRYPT=false` y `RESTBLU_SQLSERVER_TRUST_CERTIFICATE=false`.

- El esquema está en `src/database/schema-sqlserver.sql` (mismas tablas, índices,
  vistas y control de fechas superpuestas que la versión SQLite). El gestor lo
  aplica al arrancar.
- La primera vez que el gestor arranca contra una base SQL Server vacía, copia
  todos los datos de `data/lumastay.sqlite`. Para repetir la copia (reemplaza lo
  que haya en SQL Server): `node scripts/migrate-sqlite-to-sqlserver.mjs --confirm=COPIAR_A_SQLSERVER`.
- `scripts/reset-reservation-data.mjs` limpia las reservas en el motor configurado.
- Para volver a SQLite basta con `RESTBLU_DB_ENGINE=sqlite`. Los datos no se
  copian de vuelta automáticamente.
- En DBeaver: **Nueva conexión → SQL Server**, servidor `localhost`, puerto `1433`,
  base `RestBlu`, autenticación *SQL Server* con el usuario y la contraseña del
  archivo privado. Marca *Trust server certificate* en la pestaña de propiedades
  del controlador.

## Abrir la base en DBeaver (SQLite)

1. Ejecuta `Abrir_Base_RestBlu_DBeaver.bat`. DBeaver se abrirá y una URL JDBC quedará copiada.
2. Selecciona **Nueva conexión**.
3. Elige **SQLite**.
4. En **JDBC URL**, pega con `Ctrl+V` una dirección con este formato: `jdbc:sqlite:C:/ruta/al/proyecto/backend/data/lumastay.sqlite`.
5. Guarda la conexión con el nombre `RestBlu Local`.
6. Expande **Tables** para consultar los registros y **Views** para abrir los resúmenes detallados.

Si el portapapeles de Windows no funciona, abre `Conexion_RestBlu_JDBC.txt`, que el BAT genera junto al proyecto con la misma URL lista para copiar.

DBeaver puede consultar la base mientras el gestor está abierto. Para copiar o mover el archivo SQLite, cierra primero RestBlu para que también se consoliden los archivos temporales de SQLite.

## Verificación facial automática (demo)

Esta verificación 1:1 del gestor es una función heredada y sólo está disponible
para reservas que ya tenían una plantilla local antes del registro directo en
Dahua. Las altas nuevas se verifican en el propio terminal.

En **Biometría**, selecciona una reserva con plantilla activa y concede acceso a
la cámara. Ya no hay que pulsar «Capturar y verificar», seguir gestos ni colocar
la cara dentro de un óvalo. El navegador observa de forma pasiva un cambio
natural de los ojos con la cara estable y entonces envía una captura al
comparador 1:1. Una cara diferente
puede reintentarlo automáticamente hasta tres veces por sesión, con una pausa
entre intentos. Si el rostro desaparece o entra otra persona, la observación se
reinicia. Cerrar el cuadro detiene la cámara. Si no se observa una señal
suficiente, no se envía ninguna captura ni se afirma una coincidencia.

El análisis de movimientos utiliza MediaPipe Face Landmarker en el navegador.
La primera vez necesita descargar el código y el modelo desde jsDelivr y
Google; si no hay conexión, la comprobación falla cerrada y no compara ninguna
foto. El servidor biométrico actual indica `liveness_checked: false`: esto
**no es una prueba de vida certificada ni un sensor de movimiento físico**.
Dificulta el uso de una foto fija,
pero un video, una cámara virtual o una petición directa a la API local pueden
eludir el desafío del navegador. No conectes este resultado a una puerta real.
Para producción, el servidor biométrico debe validar la prueba de vida por su
cuenta antes de devolver una coincidencia autorizable.
