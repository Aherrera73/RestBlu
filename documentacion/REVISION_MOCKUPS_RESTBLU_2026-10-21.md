# RestBlu: revisión de las siete imágenes de referencia

Fecha: 21 de octubre de 2026.

## Resultado

Las imágenes describen un producto más amplio que el prototipo actual. Parte
de las funciones está implementada en el gestor o en las apps y no aparece
en la portada; otra parte todavía requiere desarrollo. Una pantalla del
mockup no demuestra que exista el servicio que la hace funcionar.

Se revisaron la aplicación activa en `D:\RB`, el portal web, el gestor local,
el hub Dahua y las fuentes Android/iOS. Esta comparación no certifica cobros,
aperturas físicas ni la compilación de iOS.

## Cambios aplicados en esta revisión

- Se conserva la identidad azul marino y turquesa, con fondos azul claro,
  tipografía sans serif y controles consistentes.
- Se mejora la portada, el buscador y las tarjetas con Framer Motion,
  respetando movimiento reducido y foco de teclado.
- Se agrega **Destinos**, con ciudades, cantidades y precios derivados del
  catálogo publicado. Elegir un destino filtra realmente los alojamientos.
- Se agrega **Ayuda**, con preguntas frecuentes y accesos al asistente
  existente, la cuenta y la consulta de reservas.
- El menú móvil permite entrar a Inicio, Alojamientos, Destinos,
  Experiencias, Para propietarios y Ayuda.
- Las experiencias ahora buscan alojamientos en su destino; antes el botón
  abría el catálogo sin aplicar la ubicación.
- Se corrigen mensajes que presentaban sincronización OTA, tarifas sugeridas
  o atención humana permanente como capacidades ya disponibles.

## Portal público: imágenes 1, 2 y 5

| Función mostrada | Estado real |
| --- | --- |
| Catálogo, búsqueda por destino, huéspedes y fechas | Implementado. |
| Calendario de disponibilidad por alojamiento | Implementado; no es un calendario administrativo completo. |
| Cuenta, correo verificado, reserva, pago Webpay y comprobante | Implementado en código; Webpay se documenta como integración de prueba. |
| Destinos separados en la navegación | Agregado en esta revisión usando el catálogo real. |
| Experiencias | Parcial: recomendaciones estáticas y búsqueda de alojamiento; no hay compra de actividades ni extras. |
| Centro de ayuda y asistente | Centro agregado; integra el asistente existente. No es chat humano con recepción. |
| Proyectos inmobiliarios y venta de departamentos | No encontrados. El modelo actual describe alojamientos para estadías, no unidades de venta, inventario comercial o procesos de inversión. |
| Publicación autónoma por propietarios | No encontrada. Las propiedades se administran desde el gestor local. |
| Reseñas verificadas | No encontradas como módulo. La calificación es un atributo editable del alojamiento. |

Fuentes: `frontend/modules/public-site/domain/types.ts`,
`frontend/modules/public-site/RestBluApp.tsx`,
`frontend/modules/public-site/components/PropertyAvailabilityCalendar.tsx`,
`frontend/modules/public-site/components/AccountDashboard.tsx` y
`frontend/modules/public-site/services/payments.ts`.

## App del huésped: imágenes 1, 2 y 3

| Función mostrada | Estado real |
| --- | --- |
| Reservas, Webpay, pase y PIN | Implementados en las fuentes Android/iOS. |
| Próximas reservas e historial | Implementados en Android y web; iOS lista reservas sin la misma agrupación. |
| QR temporal | Android consulta y comprueba vencimiento. iOS tiene actualización manual y no comprueba el vencimiento antes de mostrar la imagen. |
| Apertura directa y biometría del teléfono | Implementadas por solicitudes al gestor, sujetas a cuenta, reserva, vigencia, terminal y conexión. |
| Registro facial | Implementado con consentimiento, captura y envío cifrado para el terminal Dahua. El reconocimiento lo realiza el terminal; no equivale a la animación del mockup. |
| Asistente IA | Implementado; su disponibilidad depende del servicio configurado. No incluye todas las acciones y recomendaciones privadas de estadía mostradas. |
| Videollamada con videoportero, audio y captura | No encontrada. Abrir una puerta de forma remota no proporciona una llamada audiovisual. |
| Conversaciones con anfitrión, recepción o mantenimiento | No encontradas; el chat existente es IA y hay un canal de correo en la ayuda de la cuenta. |
| Notificaciones push | No encontradas en FCM/APNs ni en los permisos y servicios de las apps. |
| Check-in y check-out como acciones operativas | No encontrados. Mostrar las fechas no registra la llegada o salida del huésped. |
| Guía privada por estadía: Wi-Fi, reglas, transporte y contactos | No encontrada como módulo personalizado. Sí hay datos y amenidades del alojamiento. |

Evidencias puntuales:

- Android QR: `android-app/app/src/main/java/cl/lumastay/huesped/ui/screens/AccessScreen.kt:65`,
  actualización por minuto; `:198`, comprobación de vigencia.
- Android apertura: `android-app/app/src/main/java/cl/lumastay/huesped/core/data/FirebaseRestClient.kt:171`.
- iOS acceso: `ios-app/RestBlu/AccessView.swift:19`, imagen según estado;
  `:44`, actualización manual.
- iOS apertura y registro facial: `ios-app/RestBlu/RestBluAPI+PaymentsAccess.swift:34` y `:65`.
- Validación pendiente de iOS en Mac: `ios-app/README.md:49`.

Android puede mostrar un QR informativo cuando no tiene un QR físico vigente.
Debe distinguirse claramente del código que abre el terminal.

## Dashboard del propietario: imagen 4

No se encontró un dashboard independiente con permisos por propietario.
El gestor actual tiene una autenticación administrativa `manager`; guardar
el contacto del dueño de un alojamiento no implementa una cuenta de dueño.
`ownerUid` en las reservas identifica al huésped que las creó.

| Función mostrada | Estado real |
| --- | --- |
| Administración de alojamientos y tarifas por noche | Disponible en el gestor local. |
| Calendario administrativo de ocupación | No encontrado como pantalla de gestión. |
| Panel financiero, ingresos y comparación por período | No encontrado como módulo equivalente al mockup. |
| Comisiones y liquidaciones | No encontradas en el esquema actual. |
| Bandeja de mensajes y reseñas de huéspedes | No encontradas. |
| Precios inteligentes, predicción de ocupación y demanda regional | No encontrados como motores de análisis o automatización. |

Fuentes: `backend/src/server/manager-auth.mjs:30`,
`backend/public/index.html:17`, `backend/src/database/schema.sql:63` y `:96`.

## Administración y accesos: imágenes 6 y 7

| Función mostrada | Estado real |
| --- | --- |
| Alojamientos, viajeros, reservas y acceso Dahua | Implementados en el gestor. |
| Alta de persona, QR, PIN y rostro por reserva | Implementados, con condiciones de confirmación y configuración. |
| Apertura manual y desde el teléfono | Implementadas con validaciones y límites de frecuencia. |
| Revocación al terminar la reserva | Implementada con tareas de reintento. |
| Terminales conectados y asignación por alojamiento | Implementados. No equivalen a inventarios de cámaras, NVR y videoporteros. |
| Historial de accesos | Implementado con actualización por sondeo: copia del terminal cada 60 s y pantalla de Seguridad cada 30 s. |
| Alertas | Reglas para desconexiones, rechazos repetidos y entradas fuera de estadía. |
| Auditoría completa de cambios del administrador | Parcial: hay eventos y logs, pero no una bitácora completa de actor, valor anterior y valor nuevo para cada cambio. |
| Detector de fraude IA con puntuación, análisis de sentimiento y editor de automatizaciones | No encontrados. Las alertas por reglas no implementan estos modelos. |
| Módulo de reconocimiento propio LF2TECH | No encontrado como componente independiente equivalente al diagrama. El registro se integra con el terminal Dahua. |
| Cerradura, relé, sensor de puerta, botón de salida, fuente y UPS | Son requisitos físicos del montaje; el código no demuestra su instalación ni su estado real. |

Evidencias: `backend/src/dahua/reservation-access.mjs:137`,
`backend/src/server/index.mjs:1992`, `:2340`, `:2389`, `:2999`, `:3865` y `:4018`;
`backend/src/ai/assistant-context.mjs:186` y `:217`;
`backend/public/assets/js/app.js:1316`.

Hay una diferencia de producto importante: el QR del terminal tiene una ventana
configurada de **1.440 minutos**, no los 15 minutos mostrados en la referencia
(`backend/src/dahua/reservation-access.mjs:25`). La política actual se diseñó
para el QR del PDF; no se modificó durante un cambio visual. La vigencia de la
persona asociada a la reserva es una comprobación adicional.

## Prioridad propuesta para completar el producto

1. **Propietarios y publicación:** roles, separación de datos por dueño,
   solicitud de publicación y revisión administrativa. Es la base del dashboard.
2. **Operación de estadías:** calendario administrativo, guía por alojamiento,
   check-in/check-out y corrección de la vigencia visible del QR en iOS.
3. **Comunicación:** conversaciones huésped/anfitrión, soporte humano y push.
4. **Finanzas:** ingresos, comisiones y liquidaciones con datos y reglas definidos.
5. **Videoportero:** protocolo y equipos compatibles, señalización, audio/video
   y permisos de acceso. Requiere una integración específica.
6. **Analítica avanzada:** primero historial fiable; después predicción,
   recomendaciones tarifarias y evaluación de fraude.

## Comprobaciones de esta entrega

- Pruebas del frontend existentes: 12 aprobadas.
- Comprobación de tipos y compilación del frontend correctas.
- Sin errores del analizador en los componentes nuevos de portada y exploración.
- Navegación Destinos → Pucón comprobada: catálogo filtrado a sus dos alojamientos.
- Explorar destinos también funciona después de indicar solo una fecha: se limpia
  el par incompleto y el catálogo permite elegir ambas fechas antes de reservar.
- Centro de ayuda, preguntas desplegables y apertura del asistente comprobados.
- Menú móvil y ausencia de desplazamiento horizontal comprobados a 375 px.
- Gestor y frontend iniciados localmente. No se publicaron cambios en Internet.

La revisión de las funciones nativas y físicas fue de código. No se ejecutaron
cobros, llamadas, pruebas biométricas ni aperturas de puertas para esta revisión.

Al iniciar el gestor, el intento de mantener cargado el modelo IA registró un
error CUDA del servidor configurado. Se comprobó que la interfaz del chat abre,
pero no se validó una respuesta del modelo en vivo. Este problema de servicio
debe distinguirse de la ausencia de una pantalla o de una integración.

El análisis estático del componente principal conserva las incidencias previas
de React y accesibilidad; los componentes nuevos no agregan incidencias.
