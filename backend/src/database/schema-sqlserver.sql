-- Esquema RestBlu para SQL Server. Equivale a schema.sql (SQLite).
-- Las fechas se guardan como texto ISO 8601, igual que en SQLite, para que el
-- gestor compare y ordene exactamente igual en ambos motores.
-- Cada bloque separado por GO se ejecuta por separado y es idempotente.

IF OBJECT_ID('dbo.app_metadata', 'U') IS NULL
CREATE TABLE dbo.app_metadata (
  [key] NVARCHAR(120) NOT NULL PRIMARY KEY,
  value NVARCHAR(MAX) NOT NULL
);
GO

IF OBJECT_ID('dbo.clientes', 'U') IS NULL
CREATE TABLE dbo.clientes (
  id INT NOT NULL PRIMARY KEY,
  nombre_completo NVARCHAR(200) NOT NULL,
  rut NVARCHAR(20) NOT NULL DEFAULT '',
  correo NVARCHAR(200) NOT NULL DEFAULT '',
  telefono NVARCHAR(60) NOT NULL DEFAULT '',
  correo_verificado BIT NOT NULL DEFAULT 0,
  nacionalidad NVARCHAR(80) NOT NULL DEFAULT 'Chile',
  fecha_nacimiento NVARCHAR(20) NULL,
  contacto_emergencia_nombre NVARCHAR(200) NOT NULL DEFAULT '',
  contacto_emergencia_telefono NVARCHAR(60) NOT NULL DEFAULT '',
  notas NVARCHAR(MAX) NOT NULL DEFAULT '',
  estado NVARCHAR(20) NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo')),
  ultima_estadia_at NVARCHAR(40) NULL,
  owner_uid NVARCHAR(128) NOT NULL DEFAULT '',
  creado_at NVARCHAR(40) NOT NULL,
  actualizado_at NVARCHAR(40) NOT NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_clientes_rut_unico')
CREATE UNIQUE INDEX idx_clientes_rut_unico ON dbo.clientes(rut) WHERE rut <> '';
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_clientes_correo_unico')
CREATE UNIQUE INDEX idx_clientes_correo_unico ON dbo.clientes(correo) WHERE correo <> '';
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_clientes_estado')
CREATE INDEX idx_clientes_estado ON dbo.clientes(estado);
GO

IF OBJECT_ID('dbo.correo_sesiones_verificadas', 'U') IS NULL
CREATE TABLE dbo.correo_sesiones_verificadas (
  owner_uid NVARCHAR(128) NOT NULL,
  correo NVARCHAR(200) NOT NULL,
  rut NVARCHAR(20) NOT NULL,
  verificado_at NVARCHAR(40) NOT NULL,
  PRIMARY KEY (owner_uid, correo, rut)
);
GO

IF OBJECT_ID('dbo.alojamientos', 'U') IS NULL
CREATE TABLE dbo.alojamientos (
  id INT NOT NULL PRIMARY KEY,
  nombre NVARCHAR(200) NOT NULL,
  tipo NVARCHAR(80) NOT NULL,
  ubicacion NVARCHAR(200) NOT NULL,
  direccion NVARCHAR(300) NOT NULL DEFAULT '',
  comuna NVARCHAR(120) NOT NULL DEFAULT '',
  region NVARCHAR(120) NOT NULL DEFAULT '',
  descripcion NVARCHAR(MAX) NOT NULL DEFAULT '',
  propietario_nombre NVARCHAR(200) NOT NULL DEFAULT '',
  propietario_rut NVARCHAR(20) NOT NULL DEFAULT '',
  propietario_correo NVARCHAR(200) NOT NULL DEFAULT '',
  propietario_telefono NVARCHAR(60) NOT NULL DEFAULT '',
  huespedes_max INT NOT NULL DEFAULT 1 CHECK (huespedes_max > 0),
  dormitorios INT NOT NULL DEFAULT 1 CHECK (dormitorios > 0),
  camas INT NOT NULL DEFAULT 1 CHECK (camas > 0),
  banos INT NOT NULL DEFAULT 1 CHECK (banos > 0),
  precio_noche INT NOT NULL DEFAULT 0 CHECK (precio_noche >= 0),
  moneda NVARCHAR(8) NOT NULL DEFAULT 'CLP',
  calificacion FLOAT NOT NULL DEFAULT 0 CHECK (calificacion BETWEEN 0 AND 5),
  hora_check_in NVARCHAR(5) NOT NULL DEFAULT '15:00',
  hora_check_out NVARCHAR(5) NOT NULL DEFAULT '11:00',
  latitud FLOAT NULL,
  longitud FLOAT NULL,
  publicado BIT NOT NULL DEFAULT 1,
  creado_at NVARCHAR(40) NOT NULL,
  actualizado_at NVARCHAR(40) NOT NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_alojamientos_publicados_ubicacion')
CREATE INDEX idx_alojamientos_publicados_ubicacion ON dbo.alojamientos(publicado, ubicacion);
GO

IF OBJECT_ID('dbo.alojamiento_imagenes', 'U') IS NULL
CREATE TABLE dbo.alojamiento_imagenes (
  id INT IDENTITY(1, 1) NOT NULL PRIMARY KEY,
  alojamiento_id INT NOT NULL REFERENCES dbo.alojamientos(id) ON DELETE CASCADE,
  url NVARCHAR(2000) NOT NULL,
  texto_alternativo NVARCHAR(400) NOT NULL DEFAULT '',
  es_principal BIT NOT NULL DEFAULT 0,
  orden INT NOT NULL DEFAULT 0
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_alojamiento_imagenes_orden')
CREATE INDEX idx_alojamiento_imagenes_orden ON dbo.alojamiento_imagenes(alojamiento_id, es_principal DESC, orden);
GO

IF OBJECT_ID('dbo.alojamiento_etiquetas', 'U') IS NULL
CREATE TABLE dbo.alojamiento_etiquetas (
  alojamiento_id INT NOT NULL REFERENCES dbo.alojamientos(id) ON DELETE CASCADE,
  etiqueta NVARCHAR(80) NOT NULL,
  PRIMARY KEY (alojamiento_id, etiqueta)
);
GO

IF OBJECT_ID('dbo.estadias', 'U') IS NULL
CREATE TABLE dbo.estadias (
  codigo NVARCHAR(80) NOT NULL PRIMARY KEY,
  cliente_id INT NOT NULL REFERENCES dbo.clientes(id),
  alojamiento_id INT NOT NULL REFERENCES dbo.alojamientos(id),
  huesped_nombre NVARCHAR(200) NOT NULL DEFAULT '',
  huesped_rut NVARCHAR(20) NOT NULL DEFAULT '',
  huesped_correo NVARCHAR(200) NOT NULL DEFAULT '',
  huesped_telefono NVARCHAR(60) NOT NULL DEFAULT '',
  alojamiento_nombre NVARCHAR(200) NOT NULL,
  alojamiento_ubicacion NVARCHAR(200) NOT NULL,
  fecha_check_in NVARCHAR(10) NOT NULL,
  fecha_check_out NVARCHAR(10) NOT NULL,
  hora_check_in NVARCHAR(5) NOT NULL DEFAULT '15:00',
  hora_check_out NVARCHAR(5) NOT NULL DEFAULT '11:00',
  huespedes INT NOT NULL DEFAULT 1 CHECK (huespedes > 0),
  adultos INT NOT NULL DEFAULT 1 CHECK (adultos >= 0),
  ninos INT NOT NULL DEFAULT 0 CHECK (ninos >= 0),
  noches INT NOT NULL DEFAULT 1 CHECK (noches > 0),
  tarifa_noche INT NOT NULL DEFAULT 0 CHECK (tarifa_noche >= 0),
  subtotal INT NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tarifa_limpieza INT NOT NULL DEFAULT 0 CHECK (tarifa_limpieza >= 0),
  tarifa_servicio INT NOT NULL DEFAULT 0 CHECK (tarifa_servicio >= 0),
  impuestos INT NOT NULL DEFAULT 0 CHECK (impuestos >= 0),
  total INT NOT NULL DEFAULT 0 CHECK (total >= 0),
  moneda NVARCHAR(8) NOT NULL DEFAULT 'CLP',
  estado NVARCHAR(60) NOT NULL DEFAULT 'pendiente-verificacion',
  vence_at NVARCHAR(40) NULL,
  vencida_at NVARCHAR(40) NULL,
  owner_uid NVARCHAR(128) NOT NULL DEFAULT '',
  pago_estado NVARCHAR(40) NOT NULL DEFAULT 'no-realizado-demo',
  pago_referencia NVARCHAR(120) NOT NULL DEFAULT '',
  pin_acceso NVARCHAR(12) NOT NULL DEFAULT '',
  solicitudes_especiales NVARCHAR(MAX) NOT NULL DEFAULT '',
  token_verificacion_hash NVARCHAR(128) NULL,
  token_verificacion_pendiente NVARCHAR(128) NULL,
  correo_verificacion_enviado_at NVARCHAR(40) NULL,
  error_correo_verificacion NVARCHAR(MAX) NULL,
  correo_verificado_at NVARCHAR(40) NULL,
  comprobante_enviado_at NVARCHAR(40) NULL,
  error_comprobante NVARCHAR(MAX) NULL,
  error_verificacion NVARCHAR(MAX) NULL,
  biometria_perfil_id NVARCHAR(200) NULL,
  biometria_plantilla_cifrada NVARCHAR(MAX) NULL,
  biometria_estado NVARCHAR(40) NOT NULL DEFAULT 'sin-registrar',
  biometria_consentimiento_at NVARCHAR(40) NULL,
  biometria_registrada_at NVARCHAR(40) NULL,
  biometria_expira_at NVARCHAR(40) NULL,
  biometria_revocada_at NVARCHAR(40) NULL,
  biometria_ultima_verificacion_at NVARCHAR(40) NULL,
  biometria_ultimo_puntaje FLOAT NULL,
  biometria_ultimo_error NVARCHAR(MAX) NULL,
  dahua_user_id NVARCHAR(40) NULL,
  dahua_rec_no NVARCHAR(40) NULL,
  dahua_estado NVARCHAR(40) NOT NULL DEFAULT 'sin-registrar',
  dahua_error NVARCHAR(MAX) NULL,
  dahua_registrado_at NVARCHAR(40) NULL,
  dahua_verificado_at NVARCHAR(40) NULL,
  dahua_revocado_at NVARCHAR(40) NULL,
  dahua_qr_codigo NVARCHAR(20) NULL,
  dahua_qr_estado NVARCHAR(40) NOT NULL DEFAULT 'sin-registrar',
  dahua_qr_error NVARCHAR(MAX) NULL,
  dahua_qr_registrado_at NVARCHAR(40) NULL,
  pago_token NVARCHAR(120) NOT NULL DEFAULT '',
  pago_detalle NVARCHAR(200) NOT NULL DEFAULT '',
  creado_at NVARCHAR(40) NOT NULL,
  actualizado_at NVARCHAR(40) NOT NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_estadias_cliente_fecha')
CREATE INDEX idx_estadias_cliente_fecha ON dbo.estadias(cliente_id, fecha_check_in DESC);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_estadias_alojamiento_fecha')
CREATE INDEX idx_estadias_alojamiento_fecha ON dbo.estadias(alojamiento_id, fecha_check_in DESC);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_estadias_estado')
CREATE INDEX idx_estadias_estado ON dbo.estadias(estado);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_estadias_rango_fechas')
CREATE INDEX idx_estadias_rango_fechas ON dbo.estadias(fecha_check_in, fecha_check_out);
GO

-- Impide dos estadías vigentes del mismo alojamiento con fechas superpuestas.
CREATE OR ALTER TRIGGER dbo.prevenir_estadias_solapadas
ON dbo.estadias
AFTER INSERT, UPDATE
AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (
    SELECT 1
    FROM inserted AS nueva
    JOIN dbo.estadias AS existente
      ON existente.alojamiento_id = nueva.alojamiento_id
     AND existente.codigo <> nueva.codigo
     AND nueva.fecha_check_in < existente.fecha_check_out
     AND nueva.fecha_check_out > existente.fecha_check_in
    WHERE LOWER(nueva.estado) NOT IN ('cancelada', 'cancelado', 'rechazada', 'rechazado', 'anulada', 'anulado', 'error', 'expirada')
      AND LOWER(existente.estado) NOT IN ('cancelada', 'cancelado', 'rechazada', 'rechazado', 'anulada', 'anulado', 'error', 'expirada')
  )
  BEGIN
    THROW 50001, 'El alojamiento ya tiene una estadía que ocupa esas fechas.', 1;
  END
END;
GO

IF OBJECT_ID('dbo.estadia_eventos', 'U') IS NULL
CREATE TABLE dbo.estadia_eventos (
  id INT IDENTITY(1, 1) NOT NULL PRIMARY KEY,
  estadia_codigo NVARCHAR(80) NOT NULL REFERENCES dbo.estadias(codigo) ON DELETE CASCADE,
  tipo NVARCHAR(60) NOT NULL,
  detalle NVARCHAR(MAX) NOT NULL DEFAULT '',
  creado_at NVARCHAR(40) NOT NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_estadia_eventos_codigo_fecha')
CREATE INDEX idx_estadia_eventos_codigo_fecha ON dbo.estadia_eventos(estadia_codigo, creado_at DESC);
GO

-- Movimientos registrados por el terminal Dahua (aperturas y rechazos).
IF OBJECT_ID('dbo.accesos_eventos', 'U') IS NULL
CREATE TABLE dbo.accesos_eventos (
  id INT IDENTITY(1, 1) NOT NULL PRIMARY KEY,
  dahua_rec_no INT NOT NULL,
  ocurrido_at NVARCHAR(40) NOT NULL,
  tipo NVARCHAR(20) NOT NULL DEFAULT '',
  metodo INT NULL,
  autorizado BIT NOT NULL DEFAULT 0,
  codigo_error INT NULL,
  dahua_user_id NVARCHAR(40) NOT NULL DEFAULT '',
  persona NVARCHAR(200) NOT NULL DEFAULT '',
  estadia_codigo NVARCHAR(80) NULL,
  alojamiento_id INT NULL,
  CONSTRAINT uq_accesos_registro UNIQUE (dahua_rec_no, ocurrido_at)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_accesos_alojamiento_fecha')
CREATE INDEX idx_accesos_alojamiento_fecha ON dbo.accesos_eventos(alojamiento_id, ocurrido_at DESC);
GO

CREATE OR ALTER VIEW dbo.vista_estadias_detalladas AS
SELECT
  e.codigo, e.estado,
  c.nombre_completo AS cliente, c.rut, c.correo, c.telefono,
  a.nombre AS alojamiento, a.tipo AS tipo_alojamiento, a.ubicacion,
  e.fecha_check_in, e.hora_check_in, e.fecha_check_out, e.hora_check_out,
  e.noches, e.huespedes, e.adultos, e.ninos, e.tarifa_noche, e.subtotal,
  e.tarifa_limpieza, e.tarifa_servicio, e.impuestos, e.total, e.moneda,
  e.pago_estado, e.pago_referencia, e.dahua_qr_estado, e.dahua_estado,
  e.correo_verificacion_enviado_at, e.correo_verificado_at, e.comprobante_enviado_at, e.creado_at
FROM dbo.estadias e
JOIN dbo.clientes c ON c.id = e.cliente_id
JOIN dbo.alojamientos a ON a.id = e.alojamiento_id;
GO

CREATE OR ALTER VIEW dbo.vista_clientes_historial AS
SELECT
  c.id, c.nombre_completo, c.rut, c.correo, c.telefono, c.correo_verificado,
  c.nacionalidad, c.estado,
  COUNT(e.codigo) AS total_estadias,
  COALESCE(SUM(e.noches), 0) AS noches_acumuladas,
  COALESCE(SUM(CAST(e.total AS BIGINT)), 0) AS valor_total_estadias,
  MAX(e.fecha_check_out) AS ultima_fecha_check_out,
  c.ultima_estadia_at
FROM dbo.clientes c
LEFT JOIN dbo.estadias e ON e.cliente_id = c.id
GROUP BY c.id, c.nombre_completo, c.rut, c.correo, c.telefono, c.correo_verificado, c.nacionalidad, c.estado, c.ultima_estadia_at;
GO

CREATE OR ALTER VIEW dbo.vista_alojamientos_resumen AS
SELECT
  a.id, a.nombre, a.tipo, a.ubicacion, a.comuna, a.region, a.huespedes_max,
  a.dormitorios, a.camas, a.banos, a.precio_noche, a.calificacion, a.publicado,
  (SELECT COUNT(*) FROM dbo.estadias e WHERE e.alojamiento_id = a.id) AS total_estadias,
  (SELECT COALESCE(SUM(e.noches), 0) FROM dbo.estadias e WHERE e.alojamiento_id = a.id) AS noches_reservadas,
  (SELECT COALESCE(SUM(CAST(e.total AS BIGINT)), 0) FROM dbo.estadias e WHERE e.alojamiento_id = a.id) AS valor_total_estadias,
  (SELECT COUNT(*) FROM dbo.alojamiento_imagenes i WHERE i.alojamiento_id = a.id) AS total_imagenes,
  (SELECT STRING_AGG(t.etiqueta, ', ') FROM dbo.alojamiento_etiquetas t WHERE t.alojamiento_id = a.id) AS etiquetas
FROM dbo.alojamientos a;
GO

-- Columnas agregadas después de la migración (hub Dahua).
IF COL_LENGTH('dbo.alojamientos', 'dahua_registration_id') IS NULL
ALTER TABLE dbo.alojamientos ADD dahua_registration_id NVARCHAR(64) NOT NULL CONSTRAINT df_alojamientos_dahua_registration DEFAULT '';
GO
IF COL_LENGTH('dbo.estadias', 'dahua_terminal') IS NULL
ALTER TABLE dbo.estadias ADD dahua_terminal NVARCHAR(64) NOT NULL CONSTRAINT df_estadias_dahua_terminal DEFAULT '';
GO
IF COL_LENGTH('dbo.accesos_eventos', 'terminal') IS NULL
ALTER TABLE dbo.accesos_eventos ADD terminal NVARCHAR(64) NOT NULL CONSTRAINT df_accesos_terminal DEFAULT '';
GO
IF COL_LENGTH('dbo.alojamientos', 'manual_publico') IS NULL
ALTER TABLE dbo.alojamientos ADD manual_publico NVARCHAR(MAX) NOT NULL CONSTRAINT df_alojamientos_manual_publico DEFAULT '';
GO
IF COL_LENGTH('dbo.alojamientos', 'manual_huesped') IS NULL
ALTER TABLE dbo.alojamientos ADD manual_huesped NVARCHAR(MAX) NOT NULL CONSTRAINT df_alojamientos_manual_huesped DEFAULT '';
GO
-- Valoraciones de las respuestas de la IA (👍 / 👎).
IF OBJECT_ID('dbo.ia_valoraciones', 'U') IS NULL
CREATE TABLE dbo.ia_valoraciones (
  id INT IDENTITY(1, 1) NOT NULL PRIMARY KEY,
  solicitud_id NVARCHAR(80) NOT NULL CONSTRAINT uq_ia_valoraciones_solicitud UNIQUE,
  canal NVARCHAR(20) NOT NULL,
  pregunta NVARCHAR(MAX) NOT NULL DEFAULT '',
  respuesta NVARCHAR(MAX) NOT NULL DEFAULT '',
  valoracion NVARCHAR(10) NOT NULL CHECK (valoracion IN ('up', 'down')),
  owner_uid NVARCHAR(128) NOT NULL DEFAULT '',
  creado_at NVARCHAR(40) NOT NULL
);
GO
