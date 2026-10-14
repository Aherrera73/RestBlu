# RestBlu Android

Aplicación nativa para el huésped de la demo RestBlu. Es un programa independiente del portal web y del gestor local.

## Funciones incluidas

- Consulta el catálogo publicado en `public_properties` de Firebase Firestore.
- Busca por nombre, ciudad, tipo o etiqueta y filtra por capacidad.
- Selecciona fechas y cantidad de huéspedes.
- Abre el detalle y una galería de imágenes a pantalla completa.
- Registra reservas en línea desde cualquier dispositivo con internet.
- Inicia pagos con Webpay y espera la confirmación del gestor antes de habilitar el acceso.
- Formatea y valida el RUT chileno mientras se escribe.
- Conserva las reservas del huésped en el dispositivo.
- Exige una verificación nueva para cada reserva.
- Mantiene QR y PIN bloqueados mientras la reserva esté pendiente.
- Consulta en Firestore el estado procesado por el gestor local.
- Muestra el pase QR y el PIN después de la verificación.
- Informa que el comprobante PDF fue enviado al correo verificado.
- Muestra disponibilidad por día en el calendario del alojamiento.
- Permite consultar RestBlu IA desde un chat nativo con el mismo contexto público de búsqueda que la web.
- Permite registrar el rostro en Dahua para una reserva verificada: prepara un JPEG cuadrado de 500 × 500, cifra la foto en el teléfono y la envía a la cola temporal del gestor.
- Permite abrir el terminal Dahua con la biometría fuerte del teléfono durante la estadía. Android protege una clave de firma con su diálogo biométrico; la huella no se transmite a RestBlu ni a Dahua.
- Incluye las secciones públicas de experiencias, propietarios y una simulación de accesos claramente separada del pase real.

## Diseño adaptable

La interfaz está construida con Jetpack Compose y no usa anchos fijos de teléfono:

- En teléfonos verticales muestra navegación inferior y contenido en una columna.
- En móviles grandes, tablets y orientación horizontal cambia a navegación lateral.
- El catálogo calcula automáticamente la cantidad de columnas disponible.
- El detalle y el pase se distribuyen en dos paneles cuando existe espacio.
- Formularios, listas y diálogos son desplazables para evitar cortes con teclados, fuentes grandes o pantallas pequeñas.

## Abrir y ejecutar

1. Ejecuta `Abrir_RestBlu_Android.bat` desde la carpeta principal del proyecto, o abre la carpeta `android-app` desde Android Studio.
2. Espera a que termine la sincronización de Gradle.
3. Selecciona un emulador o conecta un teléfono con Depuración USB activada.
4. Pulsa **Run app**.

El APK de prueba compilado queda en:

`app/build/outputs/apk/debug/app-debug.apk`

Antes de instalar un APK de depuración nuevo sobre la app que ya está en un
teléfono, comprueba que ambos estén firmados con la misma clave. Si Android
rechaza la actualización por firma distinta, **no desinstales la app actual**
sin respaldar primero sus reservas y sesión: la lista local y el acceso a los
estados de Firestore dependen de datos guardados en esa instalación.

## Apertura con biometría del teléfono

Instala `RestBlu-Android-2.1.0-Biometria-Telefono.apk`, entra con la cuenta de la reserva y abre **Acceso → Abrir con biometría del teléfono**. La primera apertura vincula ese teléfono a la cuenta. Android puede ofrecer huella u otra biometría fuerte configurada en el equipo.

El gestor valida la firma del teléfono, la cuenta, el pago, el horario de check-in a check-out y el terminal asociado. Necesita internet en el teléfono, el gestor funcionando y el Dahua conectado al hub o a la red local. Una solicitud se ejecuta una sola vez; no se reenvía automáticamente una orden de apertura que pudo haberse completado. Si cambias o reinstalas el teléfono, utiliza el QR o el PIN hasta restablecer la vinculación.

## Flujo de una reserva

1. Android usa la cuenta verificada del huésped en Firebase.
2. La reserva se guarda en `reservation_intake` con estado pendiente.
3. El huésped completa el pago en Webpay; el gestor verifica el resultado con Transbank.
4. El huésped abre el enlace exclusivo recibido por correo.
5. El backend valida la verificación, envía el comprobante PDF y publica el resultado en `reservation_status`.
6. Android actualiza la reserva y habilita el QR y el PIN.

La verificación del correo se completa en el enlace web recibido; luego se pulsa **Actualizar** en la reserva de Android. Para registrar el rostro hay que tener una reserva ya verificada y el gestor biométrico disponible. La captura de registro no sustituye la prueba de vida que se realiza durante la comprobación de acceso en el gestor.

## Convivencia con el gestor local

Firebase recibe las reservas aunque el computador esté apagado y las conserva pendientes. Cuando se ejecuta `Abrir_Gestor_RestBlu.bat`, el backend las importa a SQLite, envía los correos y publica el estado para Android. La versión local usa el mismo flujo SMTP en `localhost`.

Si la APK se cierra después de enviar una solicitud, revisa el estado en **Reservas > Actualizar** antes de intentar nuevamente. La pantalla nunca representa un cobro bancario real: `aprobado-demo` significa sólo que el gestor aceptó una tarjeta ficticia.

El chat de IA y el registro facial también envían solicitudes a Firestore. Necesitan que el gestor local procese la cola; el chat requiere su servidor de IA y el registro facial requiere el terminal Dahua configurado y accesible. El comparador biométrico externo no participa en las altas nuevas. Si el gestor o Dahua están apagados, la app muestra un error o una espera; no simula una respuesta exitosa.

## Seguridad

- No contiene el archivo Firebase Admin SDK.
- No contiene la contraseña de aplicación del correo.
- La API key visible identifica el proyecto Firebase, pero las autorizaciones reales dependen de las reglas de Firestore y de la sesión anónima.
- Los datos del perfil y la lista de reservas se almacenan localmente en el dispositivo.
- La foto facial se cifra con una clave pública antes de enviarse; la clave privada permanece en el gestor. El gestor elimina la foto cifrada de la solicitud una vez procesada.
- La apertura desde el teléfono exige una reserva confirmada, firma de su clave protegida por biometría y una comprobación nueva del gestor. La pestaña **Más > Demo** sigue siendo sólo una simulación.

## Imágenes cargadas desde el gestor

Las imágenes con URL pública se ven desde cualquier dispositivo. Una imagen cuya URL sea `127.0.0.1` solo existe en el computador del gestor; Android mostrará un marcador de imagen no disponible. La publicación permanente de archivos debe migrarse a Firebase Storage o a otro almacenamiento público.
