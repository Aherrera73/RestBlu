# Módulo público RestBlu

Este módulo contiene la experiencia que ve el huésped. `RestBluApp.tsx` coordina las pantallas; `domain` contiene las reglas que no dependen de la interfaz; `services` concentra las comunicaciones externas; y `config.ts` reúne la configuración pública.

La ruta `app/page.tsx` debe permanecer pequeña y limitarse a cargar este módulo.

## Asistente público

`components/PublicAiAssistant.tsx` muestra la viñeta flotante y el chat adaptable.
`services/ai.ts` usa el backend local durante el desarrollo. En Firebase
Hosting envía una solicitud a Firestore; el gestor encendido consulta la API
de IA ya configurada y publica la respuesta. La clave privada nunca llega al
navegador ni se envían fichas de clientes. El registro facial usa el mismo
puente: cifra la captura en el dispositivo con una clave pública del gestor,
el gestor la procesa con la API biométrica y borra la captura de Firestore.
La plantilla facial cifrada permanece únicamente en SQLite local.
