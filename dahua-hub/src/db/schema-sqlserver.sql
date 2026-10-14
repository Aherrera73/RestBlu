-- Servicio central Dahua de RestBlu. Vive en el esquema "hub" de la base
-- RestBlu para no mezclarse con las tablas del gestor (dbo). Fechas en UTC.
-- Cada bloque separado por GO es idempotente.

IF SCHEMA_ID('hub') IS NULL EXEC('CREATE SCHEMA hub');
GO

-- Propiedad física donde hay uno o más terminales.
IF OBJECT_ID('hub.properties', 'U') IS NULL
CREATE TABLE hub.properties (
  id INT IDENTITY(1, 1) NOT NULL PRIMARY KEY,
  name NVARCHAR(200) NOT NULL,
  address NVARCHAR(300) NOT NULL DEFAULT '',
  -- Alojamiento equivalente en el gestor RestBlu (dbo.alojamientos), si existe.
  restblu_property_id INT NULL,
  created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'uq_hub_properties_restblu')
CREATE UNIQUE INDEX uq_hub_properties_restblu ON hub.properties(restblu_property_id) WHERE restblu_property_id IS NOT NULL;
GO

-- Terminal Dahua. registration_id es el "Registration ID" / "Device ID" que
-- se configura en Auto Register (PROP-0001, PROP-0002…).
IF OBJECT_ID('hub.devices', 'U') IS NULL
CREATE TABLE hub.devices (
  id INT IDENTITY(1, 1) NOT NULL PRIMARY KEY,
  registration_id NVARCHAR(64) NOT NULL CONSTRAINT uq_hub_devices_registration UNIQUE,
  property_id INT NULL REFERENCES hub.properties(id),
  name NVARCHAR(200) NOT NULL DEFAULT '',
  device_class NVARCHAR(80) NOT NULL DEFAULT '',
  status NVARCHAR(10) NOT NULL DEFAULT 'OFFLINE' CHECK (status IN ('ONLINE', 'OFFLINE')),
  last_remote_address NVARCHAR(100) NOT NULL DEFAULT '',
  last_connected_at DATETIME2(3) NULL,
  last_disconnected_at DATETIME2(3) NULL,
  last_seen_at DATETIME2(3) NULL,
  enabled BIT NOT NULL DEFAULT 1,
  created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

-- Historial de registros, rechazos y desconexiones.
IF OBJECT_ID('hub.device_connection_logs', 'U') IS NULL
CREATE TABLE hub.device_connection_logs (
  id BIGINT IDENTITY(1, 1) NOT NULL PRIMARY KEY,
  device_id INT NULL REFERENCES hub.devices(id),
  registration_id NVARCHAR(64) NOT NULL DEFAULT '',
  event NVARCHAR(30) NOT NULL,
  remote_address NVARCHAR(100) NOT NULL DEFAULT '',
  detail NVARCHAR(1000) NOT NULL DEFAULT '',
  created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_hub_logs_registration_fecha')
CREATE INDEX idx_hub_logs_registration_fecha ON hub.device_connection_logs(registration_id, created_at DESC);
GO

-- Reserva con acceso por PIN. La sincronización con los terminales todavía no
-- está implementada: sync_status queda en PENDING.
IF OBJECT_ID('hub.reservations', 'U') IS NULL
CREATE TABLE hub.reservations (
  id INT IDENTITY(1, 1) NOT NULL PRIMARY KEY,
  property_id INT NOT NULL REFERENCES hub.properties(id),
  external_code NVARCHAR(80) NULL,
  guest_name NVARCHAR(200) NOT NULL,
  pin NVARCHAR(12) NOT NULL,
  valid_from DATETIME2(3) NOT NULL,
  valid_to DATETIME2(3) NOT NULL,
  status NVARCHAR(12) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CANCELLED')),
  sync_status NVARCHAR(10) NOT NULL DEFAULT 'PENDING' CHECK (sync_status IN ('PENDING', 'SYNCED', 'FAILED')),
  last_sync_error NVARCHAR(1000) NULL,
  synced_at DATETIME2(3) NULL,
  created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT ck_hub_reservations_rango CHECK (valid_to > valid_from)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'uq_hub_reservations_external')
CREATE UNIQUE INDEX uq_hub_reservations_external ON hub.reservations(external_code) WHERE external_code IS NOT NULL;
GO

-- Cola de comandos hacia los terminales. Mientras un comando se ejecuta
-- sigue en PENDING con locked_until; si falla se reintenta hasta
-- max_attempts y luego queda en FAILED.
IF OBJECT_ID('hub.device_commands', 'U') IS NULL
CREATE TABLE hub.device_commands (
  id BIGINT IDENTITY(1, 1) NOT NULL PRIMARY KEY,
  device_id INT NOT NULL REFERENCES hub.devices(id),
  reservation_id INT NULL REFERENCES hub.reservations(id),
  type NVARCHAR(40) NOT NULL,
  payload NVARCHAR(MAX) NOT NULL DEFAULT '{}',
  status NVARCHAR(10) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED')),
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  locked_until DATETIME2(3) NULL,
  next_attempt_at DATETIME2(3) NULL,
  last_error NVARCHAR(1000) NULL,
  result NVARCHAR(MAX) NULL,
  created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  executed_at DATETIME2(3) NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_hub_commands_pendientes')
CREATE INDEX idx_hub_commands_pendientes ON hub.device_commands(status, device_id, id);
GO
