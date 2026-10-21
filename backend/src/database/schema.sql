PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY,
  nombre_completo TEXT NOT NULL,
  rut TEXT NOT NULL DEFAULT '',
  correo TEXT NOT NULL DEFAULT '',
  telefono TEXT NOT NULL DEFAULT '',
  correo_verificado INTEGER NOT NULL DEFAULT 0 CHECK (correo_verificado IN (0, 1)),
  nacionalidad TEXT NOT NULL DEFAULT 'Chile',
  fecha_nacimiento TEXT,
  contacto_emergencia_nombre TEXT NOT NULL DEFAULT '',
  contacto_emergencia_telefono TEXT NOT NULL DEFAULT '',
  notas TEXT NOT NULL DEFAULT '',
  estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo')),
  ultima_estadia_at TEXT,
  owner_uid TEXT NOT NULL DEFAULT '',
  creado_at TEXT NOT NULL,
  actualizado_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_rut_unico
ON clientes(rut) WHERE rut <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_correo_unico
ON clientes(correo) WHERE correo <> '';

CREATE INDEX IF NOT EXISTS idx_clientes_estado
ON clientes(estado);

-- Una verificación reutilizable sólo por la misma sesión Firebase y el mismo
-- par correo/RUT. No se considera verificado sólo por escribir un correo.
CREATE TABLE IF NOT EXISTS correo_sesiones_verificadas (
  owner_uid TEXT NOT NULL,
  correo TEXT NOT NULL,
  rut TEXT NOT NULL,
  verificado_at TEXT NOT NULL,
  PRIMARY KEY (owner_uid, correo, rut)
);

CREATE TABLE IF NOT EXISTS alojamientos (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL,
  ubicacion TEXT NOT NULL,
  direccion TEXT NOT NULL DEFAULT '',
  comuna TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  descripcion TEXT NOT NULL DEFAULT '',
  propietario_nombre TEXT NOT NULL DEFAULT '',
  propietario_rut TEXT NOT NULL DEFAULT '',
  propietario_correo TEXT NOT NULL DEFAULT '',
  propietario_telefono TEXT NOT NULL DEFAULT '',
  huespedes_max INTEGER NOT NULL DEFAULT 1 CHECK (huespedes_max > 0),
  dormitorios INTEGER NOT NULL DEFAULT 1 CHECK (dormitorios > 0),
  camas INTEGER NOT NULL DEFAULT 1 CHECK (camas > 0),
  banos INTEGER NOT NULL DEFAULT 1 CHECK (banos > 0),
  precio_noche INTEGER NOT NULL DEFAULT 0 CHECK (precio_noche >= 0),
  moneda TEXT NOT NULL DEFAULT 'CLP',
  calificacion REAL NOT NULL DEFAULT 0 CHECK (calificacion BETWEEN 0 AND 5),
  hora_check_in TEXT NOT NULL DEFAULT '15:00',
  hora_check_out TEXT NOT NULL DEFAULT '11:00',
  latitud REAL,
  longitud REAL,
  publicado INTEGER NOT NULL DEFAULT 1 CHECK (publicado IN (0, 1)),
  creado_at TEXT NOT NULL,
  actualizado_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alojamientos_publicados_ubicacion
ON alojamientos(publicado, ubicacion);

CREATE TABLE IF NOT EXISTS alojamiento_imagenes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alojamiento_id INTEGER NOT NULL REFERENCES alojamientos(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  texto_alternativo TEXT NOT NULL DEFAULT '',
  es_principal INTEGER NOT NULL DEFAULT 0 CHECK (es_principal IN (0, 1)),
  orden INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_alojamiento_imagenes_orden
ON alojamiento_imagenes(alojamiento_id, es_principal DESC, orden);

CREATE TABLE IF NOT EXISTS alojamiento_etiquetas (
  alojamiento_id INTEGER NOT NULL REFERENCES alojamientos(id) ON DELETE CASCADE,
  etiqueta TEXT NOT NULL,
  PRIMARY KEY (alojamiento_id, etiqueta)
);

CREATE TABLE IF NOT EXISTS estadias (
  codigo TEXT PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  alojamiento_id INTEGER NOT NULL REFERENCES alojamientos(id),
  huesped_nombre TEXT NOT NULL DEFAULT '',
  huesped_rut TEXT NOT NULL DEFAULT '',
  huesped_correo TEXT NOT NULL DEFAULT '',
  huesped_telefono TEXT NOT NULL DEFAULT '',
  alojamiento_nombre TEXT NOT NULL,
  alojamiento_ubicacion TEXT NOT NULL,
  fecha_check_in TEXT NOT NULL,
  fecha_check_out TEXT NOT NULL,
  hora_check_in TEXT NOT NULL DEFAULT '15:00',
  hora_check_out TEXT NOT NULL DEFAULT '11:00',
  huespedes INTEGER NOT NULL DEFAULT 1 CHECK (huespedes > 0),
  adultos INTEGER NOT NULL DEFAULT 1 CHECK (adultos >= 0),
  ninos INTEGER NOT NULL DEFAULT 0 CHECK (ninos >= 0),
  noches INTEGER NOT NULL DEFAULT 1 CHECK (noches > 0),
  tarifa_noche INTEGER NOT NULL DEFAULT 0 CHECK (tarifa_noche >= 0),
  subtotal INTEGER NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tarifa_limpieza INTEGER NOT NULL DEFAULT 0 CHECK (tarifa_limpieza >= 0),
  tarifa_servicio INTEGER NOT NULL DEFAULT 0 CHECK (tarifa_servicio >= 0),
  impuestos INTEGER NOT NULL DEFAULT 0 CHECK (impuestos >= 0),
  total INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
  moneda TEXT NOT NULL DEFAULT 'CLP',
  estado TEXT NOT NULL DEFAULT 'pendiente-verificacion',
  vence_at TEXT,
  vencida_at TEXT,
  owner_uid TEXT NOT NULL DEFAULT '',
  pago_estado TEXT NOT NULL DEFAULT 'no-realizado-demo',
  pago_referencia TEXT NOT NULL DEFAULT '',
  pin_acceso TEXT NOT NULL DEFAULT '',
  solicitudes_especiales TEXT NOT NULL DEFAULT '',
  token_verificacion_hash TEXT,
  token_verificacion_pendiente TEXT,
  correo_verificacion_enviado_at TEXT,
  error_correo_verificacion TEXT,
  correo_verificado_at TEXT,
  comprobante_enviado_at TEXT,
  error_comprobante TEXT,
  error_verificacion TEXT,
  biometria_perfil_id TEXT,
  biometria_plantilla_cifrada TEXT,
  biometria_estado TEXT NOT NULL DEFAULT 'sin-registrar',
  biometria_consentimiento_at TEXT,
  biometria_registrada_at TEXT,
  biometria_expira_at TEXT,
  biometria_revocada_at TEXT,
  biometria_ultima_verificacion_at TEXT,
  biometria_ultimo_puntaje REAL,
  biometria_ultimo_error TEXT,
  dahua_user_id TEXT,
  dahua_rec_no TEXT,
  dahua_estado TEXT NOT NULL DEFAULT 'sin-registrar',
  dahua_error TEXT,
  dahua_registrado_at TEXT,
  dahua_verificado_at TEXT,
  dahua_revocado_at TEXT,
  dahua_qr_codigo TEXT,
  dahua_qr_estado TEXT NOT NULL DEFAULT 'sin-registrar',
  dahua_qr_error TEXT,
  dahua_qr_registrado_at TEXT,
  pago_token TEXT NOT NULL DEFAULT '',
  pago_detalle TEXT NOT NULL DEFAULT '',
  creado_at TEXT NOT NULL,
  actualizado_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_estadias_cliente_fecha
ON estadias(cliente_id, fecha_check_in DESC);

CREATE INDEX IF NOT EXISTS idx_estadias_alojamiento_fecha
ON estadias(alojamiento_id, fecha_check_in DESC);

CREATE INDEX IF NOT EXISTS idx_estadias_estado
ON estadias(estado);

CREATE INDEX IF NOT EXISTS idx_estadias_rango_fechas
ON estadias(fecha_check_in, fecha_check_out);

DROP TRIGGER IF EXISTS prevenir_estadias_solapadas;
CREATE TRIGGER prevenir_estadias_solapadas
BEFORE INSERT ON estadias
WHEN LOWER(NEW.estado) NOT IN (
  'cancelada', 'cancelado', 'rechazada', 'rechazado',
  'anulada', 'anulado', 'error', 'expirada'
)
AND EXISTS (
  SELECT 1
  FROM estadias AS existente
  WHERE existente.alojamiento_id = NEW.alojamiento_id
    AND LOWER(existente.estado) NOT IN (
      'cancelada', 'cancelado', 'rechazada', 'rechazado',
      'anulada', 'anulado', 'error', 'expirada'
    )
    AND NEW.fecha_check_in < existente.fecha_check_out
    AND NEW.fecha_check_out > existente.fecha_check_in
)
BEGIN
  SELECT RAISE(ABORT, 'El alojamiento ya tiene una estadía que ocupa esas fechas.');
END;

CREATE TRIGGER IF NOT EXISTS prevenir_actualizaciones_solapadas
BEFORE UPDATE OF alojamiento_id, fecha_check_in, fecha_check_out, estado ON estadias
WHEN LOWER(NEW.estado) NOT IN (
  'cancelada', 'cancelado', 'rechazada', 'rechazado',
  'anulada', 'anulado', 'error', 'expirada'
)
AND EXISTS (
  SELECT 1 FROM estadias AS existente
  WHERE existente.codigo <> OLD.codigo
    AND existente.alojamiento_id = NEW.alojamiento_id
    AND LOWER(existente.estado) NOT IN (
      'cancelada', 'cancelado', 'rechazada', 'rechazado',
      'anulada', 'anulado', 'error', 'expirada'
    )
    AND NEW.fecha_check_in < existente.fecha_check_out
    AND NEW.fecha_check_out > existente.fecha_check_in
)
BEGIN
  SELECT RAISE(ABORT, 'El alojamiento ya tiene una estadía que ocupa esas fechas.');
END;

CREATE TABLE IF NOT EXISTS estadia_eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estadia_codigo TEXT NOT NULL REFERENCES estadias(codigo) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  detalle TEXT NOT NULL DEFAULT '',
  creado_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_estadia_eventos_codigo_fecha
ON estadia_eventos(estadia_codigo, creado_at DESC);

CREATE VIEW IF NOT EXISTS vista_estadias_detalladas AS
SELECT
  e.codigo,
  e.estado,
  c.nombre_completo AS cliente,
  c.rut,
  c.correo,
  c.telefono,
  a.nombre AS alojamiento,
  a.tipo AS tipo_alojamiento,
  a.ubicacion,
  e.fecha_check_in,
  e.hora_check_in,
  e.fecha_check_out,
  e.hora_check_out,
  e.noches,
  e.huespedes,
  e.adultos,
  e.ninos,
  e.tarifa_noche,
  e.subtotal,
  e.tarifa_limpieza,
  e.tarifa_servicio,
  e.impuestos,
  e.total,
  e.moneda,
  e.pin_acceso,
  e.correo_verificacion_enviado_at,
  e.correo_verificado_at,
  e.comprobante_enviado_at,
  e.creado_at
FROM estadias e
JOIN clientes c ON c.id = e.cliente_id
JOIN alojamientos a ON a.id = e.alojamiento_id;

CREATE VIEW IF NOT EXISTS vista_clientes_historial AS
SELECT
  c.id,
  c.nombre_completo,
  c.rut,
  c.correo,
  c.telefono,
  c.correo_verificado,
  c.nacionalidad,
  c.estado,
  COUNT(e.codigo) AS total_estadias,
  COALESCE(SUM(e.noches), 0) AS noches_acumuladas,
  COALESCE(SUM(e.total), 0) AS valor_total_estadias,
  MAX(e.fecha_check_out) AS ultima_fecha_check_out,
  c.ultima_estadia_at
FROM clientes c
LEFT JOIN estadias e ON e.cliente_id = c.id
GROUP BY c.id;

CREATE VIEW IF NOT EXISTS vista_alojamientos_resumen AS
SELECT
  a.id,
  a.nombre,
  a.tipo,
  a.ubicacion,
  a.comuna,
  a.region,
  a.huespedes_max,
  a.dormitorios,
  a.camas,
  a.banos,
  a.precio_noche,
  a.calificacion,
  a.publicado,
  (SELECT COUNT(*) FROM estadias e WHERE e.alojamiento_id = a.id) AS total_estadias,
  (SELECT COALESCE(SUM(e.noches), 0) FROM estadias e WHERE e.alojamiento_id = a.id) AS noches_reservadas,
  (SELECT COALESCE(SUM(e.total), 0) FROM estadias e WHERE e.alojamiento_id = a.id) AS valor_total_estadias,
  (SELECT COUNT(*) FROM alojamiento_imagenes i WHERE i.alojamiento_id = a.id) AS total_imagenes,
  (SELECT GROUP_CONCAT(t.etiqueta, ', ') FROM alojamiento_etiquetas t WHERE t.alojamiento_id = a.id) AS etiquetas
FROM alojamientos a;

PRAGMA optimize;

-- Movimientos registrados por el terminal Dahua (aperturas y rechazos). Se
-- copian periódicamente desde el equipo y se asocian a la estadía y a la
-- vivienda por el UserID que el gestor asignó a la reserva.
CREATE TABLE IF NOT EXISTS accesos_eventos (
  id INTEGER PRIMARY KEY,
  dahua_rec_no INTEGER NOT NULL,
  ocurrido_at TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT '',
  metodo INTEGER,
  autorizado INTEGER NOT NULL DEFAULT 0 CHECK (autorizado IN (0, 1)),
  codigo_error INTEGER,
  dahua_user_id TEXT NOT NULL DEFAULT '',
  persona TEXT NOT NULL DEFAULT '',
  estadia_codigo TEXT,
  alojamiento_id INTEGER,
  UNIQUE (dahua_rec_no, ocurrido_at)
);

CREATE INDEX IF NOT EXISTS idx_accesos_alojamiento_fecha
ON accesos_eventos(alojamiento_id, ocurrido_at DESC);

-- Valoraciones de las respuestas de la IA (👍 / 👎).
CREATE TABLE IF NOT EXISTS ia_valoraciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  solicitud_id TEXT NOT NULL UNIQUE,
  canal TEXT NOT NULL,
  pregunta TEXT NOT NULL DEFAULT '',
  respuesta TEXT NOT NULL DEFAULT '',
  valoracion TEXT NOT NULL CHECK (valoracion IN ('up', 'down')),
  owner_uid TEXT NOT NULL DEFAULT '',
  creado_at TEXT NOT NULL
);

-- Acceso privado de titulares de alojamientos, separado de owner_uid huésped.
CREATE TABLE IF NOT EXISTS propietarios (
  id TEXT PRIMARY KEY,
  firebase_uid TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  correo TEXT NOT NULL COLLATE NOCASE UNIQUE,
  telefono TEXT NOT NULL DEFAULT '',
  activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  creado_at TEXT NOT NULL,
  actualizado_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS propietario_alojamientos (
  alojamiento_id INTEGER PRIMARY KEY REFERENCES alojamientos(id) ON DELETE CASCADE,
  propietario_id TEXT NOT NULL REFERENCES propietarios(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_propietario_alojamientos ON propietario_alojamientos(propietario_id);
