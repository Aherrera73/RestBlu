# RestBlu para iPhone

Aplicación nativa en SwiftUI para iOS 17 o posterior. Usa el mismo proyecto Firebase, el gestor RestBlu y el Worker Webpay de la web y Android. Incluye catálogo, búsqueda, cuenta y verificación de correo, reservas, pago, pase QR/PIN, apertura desde el teléfono con Face ID o Touch ID, registro facial cifrado, PDF y Blu IA.

## Primer inicio en el Mac

1. Instala **Xcode** desde App Store y ábrelo una vez para aceptar sus componentes. Inicia sesión con tu Apple ID en **Xcode → Settings → Accounts**.
2. Descarga el repositorio. Si tienes Git en Terminal:

   ```bash
   git clone https://github.com/Aherrera73/RestBlu.git
   cd RestBlu/ios-app
   open RestBlu.xcodeproj
   ```

   También puedes descargar el ZIP desde GitHub, descomprimirlo y abrir `ios-app/RestBlu.xcodeproj` con doble clic.
3. En Xcode, haz clic en el icono azul **RestBlu** a la izquierda y selecciona el **target RestBlu**. En **Signing & Capabilities**, activa **Automatically manage signing** y elige tu **Team**. Si Xcode marca que el identificador ya existe, cambia **Bundle Identifier** por uno único, por ejemplo `cl.tunombre.restblu.ios`.
4. Arriba, selecciona el esquema **RestBlu** y un **iPhone Simulator**. Pulsa ▶︎ o `Cmd + R`. El simulador permite probar catálogo, cuenta, reservas y Blu; la cámara, el Secure Enclave y la puerta requieren un iPhone físico y los servicios configurados.
5. Para usar tu iPhone: conéctalo al Mac, desbloquéalo y acepta la confianza en ambos equipos. Selecciónalo junto al botón ▶︎ y pulsa `Cmd + R`. Si iOS solicita **Developer Mode**, actívalo en **Settings → Privacy & Security → Developer Mode**, reinicia el equipo y vuelve a ejecutar.

No hace falta instalar CocoaPods ni paquetes Swift: el proyecto usa los frameworks incluidos con iOS. Si agregas archivos `.swift`, ejecuta `python3 generate_xcodeproj.py` y vuelve a abrir el proyecto.

## Requisitos del sistema RestBlu

- La app apunta al Firebase del proyecto. La clave de API de Firebase incluida en el código identifica ese proyecto; la autorización se controla con Firebase Auth y las reglas de Firestore.
- Publica `frontend/firestore.rules` antes de crear reservas desde iPhone: la regla `reservation_intake` ahora admite `source = ios-app`.
- Publica la versión actualizada de `payments-worker/src/index.js` antes de pagar desde iPhone: añade el retorno `restblu-ios://webpay`. No hay que cambiar la URL del Worker dentro de la app si se usa el despliegue actual.
- El gestor local debe estar encendido y sincronizando con Firestore para procesar reservas, comprobar pagos, generar QR/PDF, responder a Blu y enviar comandos Dahua. Webpay está configurado para **integración**.
- La apertura física requiere un terminal Dahua configurado y una reserva confirmada. Face ID/Touch ID para firma de apertura necesita un iPhone real con biometría configurada.

## Comprobación con el Mac

Desde `ios-app`:

```bash
xcodebuild -project RestBlu.xcodeproj -scheme RestBlu -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

Para una prueba real, verifica este recorrido: crear cuenta → código por correo → reservar → procesar en el gestor → pagar una sola vez en Webpay → consultar estado → ver QR/PIN y PDF. La app guarda el token de un intento de pago y consulta a Webpay antes de aceptar un resultado; cerrar Safari no inicia un segundo cobro automáticamente.

## Estructura

- `RestBluApp.swift`, `RestBluStore.swift`: inicio, estado y flujos.
- `RestBluAPI*.swift`, `FirestoreCodec.swift`: Firebase Auth, Firestore, Worker Webpay y puentes del gestor.
- `PhoneAccessKey.swift`, `SecureSession.swift`: clave de apertura del Secure Enclave y sesión en Keychain.
- `*View.swift`: pantallas SwiftUI.
- `Info.plist`: retorno desde Webpay y permisos de cámara/Face ID.

La app y el proyecto Xcode se prepararon en Windows; la compilación y las pruebas en simulador/iPhone quedan pendientes hasta abrirlo en el Mac.
