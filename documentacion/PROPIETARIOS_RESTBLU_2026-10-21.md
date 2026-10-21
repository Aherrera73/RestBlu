# Propietarios de RestBlu

Se añadió un registro de propietarios en el gestor y un panel privado en la web,
con la identidad azul de RestBlu. El panel consulta datos reales y permite ver
resumen, calendario, reservas, propiedades e importes de reservas pagadas.

## Cómo habilitar a un propietario

1. Abre el gestor local en `http://127.0.0.1:3100` y entra con su acceso administrativo habitual.
2. En **Propietarios**, pulsa **Registrar propietario** e indica nombre, correo
   y, opcionalmente, teléfono.
3. Selecciona sus alojamientos y deja **Acceso al panel habilitado** marcado.
   Un propietario puede tener varios alojamientos; cada alojamiento tiene una
   única asignación de propietario. Guarda la ficha.
4. El propietario entra en **Para propietarios** o en
   `http://127.0.0.1:3000/propietarios`, con el mismo correo registrado.
5. Si aún no tiene contraseña, escribe el correo y pulsa **Establecer o recuperar
   contraseña**. El propietario recibe y completa el enlace de Firebase.
   También puede usar Google si su cuenta tiene el mismo correo.
6. Si el correo todavía no está verificado, solicita el código desde esa pantalla
   y complétalo. Después se abre el panel, sin exigir el RUT del flujo de reservas.

Registrar una ficha vincula la cuenta Firebase existente o crea una identidad
sin contraseña. El gestor no pide contraseñas, no las muestra y no envía una
invitación automática. El envío de recuperación o verificación ocurre sólo
cuando la persona pulsa el botón correspondiente.

Los datos privados del propietario que ya existían dentro de la ficha de un
alojamiento siguen siendo información de contacto para las estadías; por sí
solos no habilitan un usuario ni un panel.

## Administración del acceso

- **Editar** permite cambiar nombre, teléfono, asignaciones y estado.
- El correo y el UID quedan vinculados a la identidad inicial. No se reasignan
  desde una petición del navegador ni cambiando el contacto de una propiedad.
- Deshabilitar el perfil deniega las siguientes consultas, sin borrar la cuenta
  Firebase ni las reservas. La pestaña ya cargada puede conservar su copia de
  los datos hasta actualizarla o cerrar sesión.
- Para transferir un alojamiento, retíralo primero de la asignación anterior.
  Deshabilitar a una persona conserva sus asignaciones.
- Las cuentas vinculadas al registro de propietarios no se eliminan desde
  **Cuentas**: se conserva la identidad para evitar dejar un perfil sin vínculo.
- No se crearon propietarios ni se enviaron correos reales durante estas pruebas.

## Qué muestra el panel

- **Resumen:** reservas pagadas, ocupación, reservas confirmadas y propiedades activas.
- **Calendario:** noches de estadías confirmadas con pago; la salida no ocupa noche.
- **Reservas:** todas las estadías con fechas válidas que se solapan con el mes,
  mostrando su estado, alojamiento, nombre del huésped e importe.
- **Propiedades:** ficha resumida de los alojamientos asignados, tarifa y publicación.
- **Importes pagados:** evolución de seis meses, con filtros por mes y alojamiento.

Los importes son brutos y se atribuyen al mes de entrada de la reserva. Se cuentan
sólo reservas con estado `confirmada` y pago `aprobado-demo`, que es la etiqueta
heredada que utiliza el servicio actual también para Webpay. La ocupación une las
noches solapadas por alojamiento y las divide por las noches del mes de las
propiedades actualmente activas. No reconstruye cambios históricos de publicación.

Este panel es de consulta. Las tarifas y fichas se editan desde el gestor.
Comisiones, liquidaciones, contabilidad neta, mensajería y predicciones de IA
requieren módulos adicionales; no se presentan datos de ejemplo como resultados.

## Aislamiento y almacenamiento

El rol de titular usa tablas independientes `propietarios` y
`propietario_alojamientos`, en SQLite y SQL Server. No reutiliza
`reservation.ownerUid`, que identifica al huésped. Las asignaciones tienen una
restricción exclusiva y los cambios son transaccionales. La migración crea tablas
y actualiza la versión del esquema; no convierte contactos antiguos en usuarios.

El endpoint local exige un token Firebase vigente y comprobado contra revocación,
correo verificado, cuenta habilitada y rol activo. El servidor filtra los datos
por las asignaciones, aunque el navegador intente enviar otro UID. La respuesta
no incluye RUT, contactos privados del huésped, PIN, QR, biometría, tokens de pago
ni credenciales de dispositivos. No se guarda el panel en localStorage.

Para el sitio alojado se preparó `owner_dashboard_requests`: las reglas vinculan
cada solicitud al UID y a la sesión autenticada; sólo su autor puede leerla.
El gestor vuelve a comprobar identidad, revocación y asignaciones antes de
responder. Las respuestas dejan de ser legibles después de nueve minutos y se
eliminan por lotes en segundo plano. El gestor debe estar encendido.

## Estado de la entrega y comprobaciones

- Frontend: 20 pruebas aprobadas, comprobación de tipos y compilación correctas.
- Gestor: 45 pruebas aprobadas, incluidas alta, persistencia, aislamiento entre
  propietarios, revocación, validación y puente de consultas en línea.
- Flujo del formulario del gestor probado con datos ficticios, sin registros reales.
- El gestor se reinició y el registro vacío respondió correctamente sobre la
  base SQL Server configurada. Se guardó un respaldo local previo en la carpeta temporal.
- La ruta `/propietarios` respondió HTTP 200 con el formulario de acceso renderizado.
- La inspección visual interactiva quedó pendiente porque el control del navegador
  está desactivado en los ajustes de Work. No se probó un ingreso real ni un envío
  de correo real; las identidades de las pruebas HTTP son simuladas y aisladas.

**Publicado el 21 de octubre de 2026** en `https://restblu.web.app` y
`https://restblu.web.app/propietarios`. Se desplegaron Hosting y las reglas de
Firestore en el proyecto existente. El gestor actualizado sigue en ejecución
local y debe permanecer encendido para procesar las consultas en línea.

Firebase CLI validó la compilación de las reglas antes de publicarlas. Se
comprobó que la única diferencia respecto de las reglas anteriores es el bloque
de consultas de propietarios, preservando los permisos existentes. Después del
despliegue se confirmó que las reglas activas coinciden con el archivo local.
No se realizaron pruebas con un emulador de reglas ni un ingreso con una cuenta real.

La portada y la ruta de propietarios respondieron HTTP 200 y su contenido
coincide con los archivos exportados. También se verificaron los nueve recursos
locales de JavaScript, estilos y fuentes referenciados por ambas páginas, y la
política de contenido publicada. La inspección visual interactiva sigue pendiente.

La exportación oficial generó `index.html`, `propietarios.html` y sus datos de
hidratación. El entorno restringido había bloqueado la conexión local del
prerenderizador y omitido las rutas; se repitió esa etapa con acceso al servidor
temporal. Antes de publicar otra compilación hay que verificar que estén ambos
HTML en `dist/client`, y regenerar su política con `security:csp`.

## Conexión de cuentas en desarrollo

Se ajustó el acceso local después de observar un error de conexión antes de
recibir la respuesta de Firebase. El servidor de desarrollo reenvía únicamente
las rutas autorizadas de cuentas y renovación de sesión a los servicios HTTPS
de Firebase, con validación TLS y sin reenviar cookies ni cabeceras de autorización.
El navegador se conecta al mismo origen de RestBlu. No se registran contraseñas.
En producción se mantienen las direcciones oficiales directas de Firebase.

Se comprobó la conexión directa y la conexión local con solicitudes vacías:
Firebase respondió `MISSING_EMAIL` y `MISSING_REFRESH_TOKEN`, respectivamente.
Esas respuestas prueban el transporte, sin intentar el acceso a una cuenta real.
La causa concreta del bloqueo dentro del navegador sigue sin poder observarse
porque su control está desactivado. Recarga la página antes de volver a intentar.
