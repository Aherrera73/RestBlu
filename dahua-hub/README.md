# RestBlu Dahua Hub

Servicio central para integrar varios terminales Dahua ubicados en distintas
propiedades y redes. Cada terminal se conecta **hacia afuera** al hub con
*Auto Register*, así que no hace falta que el PC esté en la misma red Wi-Fi
que el equipo.

```
Dahua (red de la propiedad) ──Internet──► ngrok TCP ──► hub :9500 (listener TCP)
                                                         │
                                         API REST :3200 ◄┘──► SQL Server (esquema hub)
```

**Estado:** registro y permanencia de los terminales, logs de
conexión/desconexión, API de terminales online, cola de comandos,
`FakeDahuaClient` y `DahuaClient` real: el hub inicia sesión en el Dahua por
la misma conexión del Auto Register y le envía comandos (crear/actualizar
usuario con PIN, QR y vigencia, eliminarlo, abrir puerta), probado con el
DHI-ASI6214S-PW a través de ngrok. Las reservas se guardan pero todavía no se
sincronizan solas con los terminales (`syncStatus = PENDING`).

## Puesta en marcha

1. SQL Server ya está configurado para RestBlu: el hub usa la misma base
   (`RestBlu`) en un esquema propio, `hub`, y toma las credenciales de
   `%LOCALAPPDATA%\RestBlu\.env.local`. Las tablas se crean solas al iniciar.
2. Alta de los terminales de prueba (PROP-0001 y PROP-0002), una sola vez:
   ```
   cd D:\RB\dahua-hub
   npm install
   npm run seed
   ```
3. Iniciar el hub: `Abrir_Dahua_Hub.bat` (en `D:\RB`) o `npm start`.
4. Comprobar: <http://127.0.0.1:3200/api/devices/online>

Opciones en `.env.example` (se copian a `%LOCALAPPDATA%\RestBlu\dahua-hub.env.local`).

### Probar sin hardware

En otra ventana:

```
npm run fake-device -- --id PROP-0001,PROP-0002
```

Simula dos Dahua que se registran y se quedan conectados (y reintentan si se
corta). Para probar el camino completo por Internet, apunta el simulador a
ngrok: `npm run fake-device -- --host 0.tcp.sa.ngrok.io --port 12345 --id PROP-0001`.

## Exponer el hub con ngrok (desarrollo)

**Forma rápida:** `Abrir_Tunel_Dahua.bat` (en `D:\RB`). Abre ngrok en su propia
ventana, comprueba que el túnel TCP apunte al puerto del hub y muestra la dirección
pública. Si el Dahua está desconectado, intenta reconfigurarlo desde su red
aunque la dirección no haya cambiado. Requiere que la cuenta CGI esté guardada
en el archivo privado de RestBlu; si falta, indica el paso manual.
En el gestor, la sección **09 Terminales** muestra el hub, el túnel y cada
terminal (en línea, HTTP/HTTPS, viviendas que atiende) con un botón **Probar**.

Paso a paso manual:

1. Crea una cuenta en <https://ngrok.com>. **Los túneles TCP exigen verificar
   la cuenta con una tarjeta**, aunque el plan sea gratis (no se cobra).
2. Instala ngrok (`winget install ngrok.ngrok`) y registra el token:
   `ngrok config add-authtoken <TU_TOKEN>`.
3. Con el hub iniciado: `ngrok tcp 9500`.
4. ngrok muestra algo como `Forwarding tcp://0.tcp.sa.ngrok.io:12345 -> localhost:9500`.
   Esa dirección y ese puerto son los que se configuran en el Dahua.

En el plan gratis ngrok asigna una dirección TCP aleatoria al iniciar. El
lanzador vuelve a configurar el Dahua automáticamente si este PC puede acceder
a su red local. Si el PC está en otra red, hay que aplicar el nuevo puerto en
el Dahua desde la red de la propiedad.

Para conservar el mismo host y puerto tras reiniciar ngrok, reserva una
dirección TCP en un plan que lo permita y pon `NGROK_TCP_ADDRESS=host:puerto`
en `%LOCALAPPDATA%\RestBlu\dahua-hub.env.local`. El lanzador iniciará ngrok
con `--url=host:puerto` y verificará que use esa dirección. El puerto interno
del hub sigue siendo `9500`.

## Configurar el Dahua

El DHI-ASI6214S-PW (firmware 3.003, 2025-04-17) tiene dos registros automáticos:

- `DVRIP.RegisterServer`: protocolo **privado** (binario, requiere el SDK). Debe quedar apagado.
- `VSP_CGI.AutoRegister`: protocolo **CGI/HTTP**, el que usa este hub.

La forma más simple de configurarlo es desde este PC, estando en la red del
Dahua, con el script del gestor (toma la dirección del túnel ngrok abierto):

```
cd D:\RB\backend
node scripts/configure-dahua-autoregister.mjs --id PROP-0001
```

También acepta `--host` y `--port` explícitos, y `--disable` para apagarlo.
Los valores que deja son: Enable `true`, DeviceID = Registration ID, Address =
IP actual del servidor, Domain = host de ngrok y Port = puerto de ngrok. Conserva
el ajuste HTTPS existente salvo que se indique `--https` o `--no-https`.

En el plan gratis de ngrok la IP puede cambiar aunque el dominio y el puerto
sigan iguales. Si el terminal deja de conectarse, vuelve a ejecutar el script
desde su red; al configurarlo a mano, actualiza también **Address / Dirección IP**.

### Cómo se comporta el equipo (probado el 2026-10-06)

Canal de comandos (`src/devices/device-channel.mjs`), sobre la misma conexión:

| Paso | Petición del hub | Respuesta del Dahua |
| --- | --- | --- |
| Login | `POST /cgi-bin/api/global/login` con Digest (realm `Login to …`) | `200 {"Token": "…"}` |
| Comandos | CGI normales (`AccessUser.cgi`, `AccessCard.cgi`, `magicBox.cgi`…) con la cabecera `X-cgi-Token` | Igual que en la red local |
| Sesión viva | `POST /cgi-bin/api/global/keep-alive {"timeout":60,"active":true}` cada 40 s | `200` |

Las fotos faciales se envían como `PhotoData` en una CGI `AccessFace` o
`FaceInfoManager`. El gestor ya reduce el JPEG a unos 98 KB; el hub transmite
el JSON en fragmentos de 1 KB por la conexión TLS del Auto Register y admite
hasta 280 KB para estas peticiones. Se comprobó con el DHI-ASI6214S-PW real a
través de ngrok: recibió una carga de prueba de 140 KB, rechazó su contenido
porque no era un JPEG válido y siguió respondiendo consultas en la misma
sesión. La inscripción de un rostro real requiere una foto autorizada.

Sin la cabecera `X-cgi-Token` el equipo responde `404` a todo salvo el login;
con un token inválido, `500`, y el hub vuelve a iniciar sesión.
Mientras hay sesión, el equipo deja de enviar los heartbeats de registro.


- Abre la conexión TCP y envía el registro en su siguiente ciclo de 30 s; por
  eso el hub espera hasta 90 s el registro (`DAHUA_HUB_REGISTRATION_TIMEOUT_MS`).
- El registro es `POST /cgi-bin/api/autoRegist/connect` con
  `{"DevClass":"DHI-ASI6214S-PW","DeviceID":"PROP-0001","ServerIP":"…"}`.
- Cada 30 s reenvía ese mismo POST como **heartbeat**. Si no recibe un `200`,
  corta la conexión a los pocos segundos y se vuelve a registrar. El hub
  responde a cada heartbeat (se ve en `session.heartbeats` de la API).
- Tras cada respuesta, el equipo devuelve un `404 Not Found`: se registra una
  vez por sesión y no afecta la conexión.
- El equipo atiende peticiones HTTP que la plataforma le envía por la misma
  conexión (respondió `404` a `magicBox.cgi`): los comandos de la siguiente
  etapa deben usar las rutas `/cgi-bin/api/…`.

## HTTPS (cifrado entre el Dahua y el hub)

El tráfico del Auto Register pasa por Internet (ngrok), así que conviene
cifrarlo. El puerto 9500 acepta a la vez terminales con y sin HTTPS: el hub
reconoce el inicio de un handshake TLS en el primer byte.

1. Generar la autoridad certificadora de RestBlu y el certificado del hub
   (una vez; la CA se reutiliza al volver a ejecutar):
   ```
   node scripts/generate-certificates.mjs
   ```
   Quedan en `%LOCALAPPDATA%\RestBlu\certs`. `restblu-ca.key` es privada: no se
   copia a ningún equipo.
2. En `%LOCALAPPDATA%\RestBlu\dahua-hub.env.local`:
   ```
   DAHUA_HUB_TLS_CERT=C:\Users\...\AppData\Local\RestBlu\certs\dahua-hub.crt
   DAHUA_HUB_TLS_KEY=C:\Users\...\AppData\Local\RestBlu\certs\dahua-hub.key
   ```
3. Reiniciar el hub y activar **HTTPs** en la fila del Registro Automático CGI
   del Dahua.

Probado el 2026-10-06 con el DHI-ASI6214S-PW: se conectó por TLS sin tener que
instalarle la CA y los comandos funcionaron por el canal cifrado. Ese firmware
no exigió validar el certificado; para que lo valide se puede instalar
`restblu-ca.crt` como certificado de confianza en el equipo. Si un terminal
rechaza el certificado, queda un log `PROTOCOL_ERROR` que empieza con `TLS:`.

## API REST

Escucha en `127.0.0.1:3200`. Si se define `DAHUA_HUB_API_KEY`, cada petición
debe traer la cabecera `x-api-key`.

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/api/health` | Estado del hub, puerto TCP y conexiones abiertas |
| GET | `/api/devices/online` | Terminales conectados ahora, con datos de la sesión |
| GET | `/api/devices` | Todos los terminales con `online` y su última conexión |
| GET | `/api/devices/{registrationId}` | Un terminal |
| POST | `/api/devices` | Alta: `{ "registrationId": "PROP-0003", "name": "...", "propertyId": 1 }` |
| GET | `/api/devices/{registrationId}/logs` | Registros, rechazos y desconexiones del terminal |
| GET | `/api/connection-logs?registrationId=&limit=` | Log de conexiones de todos los terminales |
| POST | `/api/devices/{registrationId}/commands` | Encola `{ "type": "PING", "payload": {} }` |
| GET | `/api/commands?status=PENDING&registrationId=` | Cola de comandos |
| GET | `/api/commands/{id}` | Un comando |
| POST | `/api/devices/{registrationId}/cgi` | Proxy CGI para el gestor: `{ "method", "path", "params", "json" }` → `{ "status", "text" }` |
| GET | `/api/restblu-properties` | Alojamientos del gestor y sus terminales |
| PUT | `/api/restblu-properties/{id}` | Asignación: `{ "name": "...", "registrationIds": ["PROP-0001"] }` |
| GET | `/api/devices/{registrationId}/fake-state` | Usuarios del terminal simulado (sólo modo fake) |
| GET/POST | `/api/properties` | Propiedades |
| GET/POST | `/api/reservations` | Reservas con PIN y vigencia (aún sin sincronizar) |

Tipos de comando: `PING`, `GET_DEVICE_INFO`, `UPSERT_ACCESS_USER`,
`REMOVE_ACCESS_USER`, `OPEN_DOOR`. Ejemplo:

```
POST /api/devices/PROP-0001/commands
{ "type": "UPSERT_ACCESS_USER",
  "payload": { "userId": "RB0001", "name": "Ana Pérez", "pin": "482913", "cardNo": "AB12CD34EF",
               "validFrom": "2026-10-10T15:00:00-03:00", "validTo": "2026-10-12T11:00:00-03:00" } }
```

La vigencia se convierte a la hora del terminal (`DAHUA_HUB_DEVICE_TIMEZONE`). Un comando queda `PENDING` hasta que su
terminal esté online; si falla se reintenta (5 s, 10 s, 20 s… hasta 5 min) y
al agotar `maxAttempts` queda `FAILED`. Una función no implementada falla de
inmediato sin reintentos.

## Estructura

```
src/
  main.mjs                         arranque: arma todo y lo detiene ordenadamente
  config.mjs                       variables DAHUA_HUB_* y credenciales SQL
  registration/
    registration-server.mjs        listener TCP: registro, reemplazo, timeouts, logs
    http-registration.mjs          parser del registro Auto Register (CGI/HTTP)
    device-registry.mjs            sesiones online en memoria
  devices/
    access-device-client.mjs       contrato IAccessDeviceClient
    fake-dahua-client.mjs          terminal simulado (sin hardware)
    dahua-client.mjs               terminal real: usuarios, PIN, QR, puerta (por el canal)
    device-channel.mjs             login Digest + X-cgi-Token + keep-alive sobre la conexión
    digest.mjs                     autenticación HTTP Digest
    client-factory.mjs             elige fake o dahua
  commands/command-worker.mjs      cola PENDING / SUCCESS / FAILED
  api/http-api.mjs                 API REST
  db/schema-sqlserver.sql          tablas hub.*
  db/sqlserver-store.mjs           almacenamiento SQL Server
  db/memory-store.mjs              almacenamiento en memoria (pruebas)
scripts/fake-device.mjs            simulador de Dahua
scripts/seed-dev.mjs               alta de PROP-0001 y PROP-0002
```

`npm test` ejecuta las pruebas con almacenamiento en memoria; no tocan SQL Server.
