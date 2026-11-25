-- =====================================================================
-- SentinelData - Modelo relacional (MySQL 8.4, tercera forma normal)
-- 14 tablas de dominio + 1 tabla de agregación (resumen_eventos_hora)
-- + tabla técnica `sessions` (creada por la app) = 16 tablas.
-- Todas las sentencias son idempotentes: se pueden ejecutar varias veces.
-- =====================================================================

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
-- Catálogos de cuentas
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id          TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre      VARCHAR(30)  NOT NULL,
  descripcion VARCHAR(200) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_roles_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS areas (
  id     SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(80) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_areas_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------
-- Usuarios y recuperación de contraseña
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  rol_id            TINYINT UNSIGNED NOT NULL,
  area_id           SMALLINT UNSIGNED NOT NULL,
  nombre            VARCHAR(60)  NOT NULL,
  apellido          VARCHAR(60)  NOT NULL,
  email             VARCHAR(190) NOT NULL,
  password_hash     CHAR(60)     NOT NULL COMMENT 'bcrypt, costo 12',
  activo            TINYINT(1)   NOT NULL DEFAULT 1,
  intentos_fallidos TINYINT UNSIGNED NOT NULL DEFAULT 0,
  bloqueado_hasta   DATETIME NULL,
  ultimo_login      DATETIME NULL,
  creado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_usuarios_email (email),
  KEY idx_usuarios_rol (rol_id),
  KEY idx_usuarios_area (area_id),
  CONSTRAINT fk_usuarios_rol  FOREIGN KEY (rol_id)  REFERENCES roles (id),
  CONSTRAINT fk_usuarios_area FOREIGN KEY (area_id) REFERENCES areas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS tokens_recuperacion (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id INT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL COMMENT 'SHA-256 del token; el token en claro solo viaja por correo',
  expira_en  DATETIME NOT NULL,
  usado_en   DATETIME NULL,
  creado_en  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_tokens_hash (token_hash),
  KEY idx_tokens_usuario (usuario_id),
  CONSTRAINT fk_tokens_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------
-- Inventario de activos
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tipos_activo (
  id     SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(60) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_tipos_activo_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS activos (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tipo_activo_id SMALLINT UNSIGNED NOT NULL,
  area_id        SMALLINT UNSIGNED NOT NULL,
  responsable_id INT UNSIGNED NULL,
  nombre         VARCHAR(120) NOT NULL,
  identificador  VARCHAR(60)  NOT NULL COMMENT 'N° de serie, hostname o IP',
  criticidad     ENUM('BAJA','MEDIA','ALTA','CRITICA') NOT NULL DEFAULT 'MEDIA',
  ubicacion      VARCHAR(120) NULL,
  creado_en      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_activos_identificador (identificador),
  KEY idx_activos_tipo (tipo_activo_id),
  KEY idx_activos_area (area_id),
  KEY idx_activos_responsable (responsable_id),
  CONSTRAINT fk_activos_tipo        FOREIGN KEY (tipo_activo_id) REFERENCES tipos_activo (id),
  CONSTRAINT fk_activos_area        FOREIGN KEY (area_id)        REFERENCES areas (id),
  CONSTRAINT fk_activos_responsable FOREIGN KEY (responsable_id) REFERENCES usuarios (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------
-- Incidentes
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categorias_incidente (
  id          SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre      VARCHAR(60)  NOT NULL,
  descripcion VARCHAR(200) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_categorias_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS severidades (
  id        TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre    VARCHAR(20) NOT NULL,
  nivel     TINYINT UNSIGNED NOT NULL,
  sla_horas SMALLINT UNSIGNED NOT NULL COMMENT 'Tiempo de respuesta comprometido',
  PRIMARY KEY (id),
  UNIQUE KEY uk_severidades_nombre (nombre),
  UNIQUE KEY uk_severidades_nivel (nivel)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS estados_incidente (
  id       TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre   VARCHAR(30) NOT NULL,
  orden    TINYINT UNSIGNED NOT NULL,
  es_final TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_estados_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS incidentes (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo          VARCHAR(20)  NOT NULL COMMENT 'INC-AAAA-NNNNN',
  titulo          VARCHAR(150) NOT NULL,
  descripcion     TEXT         NOT NULL,
  categoria_id    SMALLINT UNSIGNED NOT NULL,
  severidad_id    TINYINT UNSIGNED  NOT NULL,
  estado_id       TINYINT UNSIGNED  NOT NULL,
  activo_id       INT UNSIGNED NULL,
  reportado_por   INT UNSIGNED NULL,
  asignado_a      INT UNSIGNED NULL,
  fecha_deteccion DATETIME NOT NULL,
  creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  cerrado_en      DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_incidentes_codigo (codigo),
  KEY idx_incidentes_estado (estado_id, creado_en),
  KEY idx_incidentes_reportado (reportado_por, creado_en),
  KEY idx_incidentes_asignado (asignado_a),
  KEY idx_incidentes_categoria (categoria_id),
  KEY idx_incidentes_severidad (severidad_id),
  KEY idx_incidentes_activo (activo_id),
  CONSTRAINT fk_incidentes_categoria FOREIGN KEY (categoria_id)  REFERENCES categorias_incidente (id),
  CONSTRAINT fk_incidentes_severidad FOREIGN KEY (severidad_id)  REFERENCES severidades (id),
  CONSTRAINT fk_incidentes_estado    FOREIGN KEY (estado_id)     REFERENCES estados_incidente (id),
  CONSTRAINT fk_incidentes_activo    FOREIGN KEY (activo_id)     REFERENCES activos (id)  ON DELETE SET NULL,
  CONSTRAINT fk_incidentes_reporta   FOREIGN KEY (reportado_por) REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT fk_incidentes_asignado  FOREIGN KEY (asignado_a)    REFERENCES usuarios (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS seguimientos_incidente (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  incidente_id       INT UNSIGNED NOT NULL,
  usuario_id         INT UNSIGNED NULL,
  estado_anterior_id TINYINT UNSIGNED NULL,
  estado_nuevo_id    TINYINT UNSIGNED NULL,
  comentario         TEXT NOT NULL,
  creado_en          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_seguimientos_incidente (incidente_id, creado_en),
  KEY idx_seguimientos_usuario (usuario_id),
  CONSTRAINT fk_seguimientos_incidente FOREIGN KEY (incidente_id)       REFERENCES incidentes (id) ON DELETE CASCADE,
  CONSTRAINT fk_seguimientos_usuario   FOREIGN KEY (usuario_id)         REFERENCES usuarios (id)   ON DELETE SET NULL,
  CONSTRAINT fk_seguimientos_anterior  FOREIGN KEY (estado_anterior_id) REFERENCES estados_incidente (id),
  CONSTRAINT fk_seguimientos_nuevo     FOREIGN KEY (estado_nuevo_id)    REFERENCES estados_incidente (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------
-- Eventos de acceso (alto volumen) y alertas
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tipos_evento (
  id          TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo      VARCHAR(30)  NOT NULL,
  descripcion VARCHAR(100) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_tipos_evento_codigo (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS eventos_acceso (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tipo_evento_id  TINYINT UNSIGNED NOT NULL,
  usuario_id      INT UNSIGNED NULL,
  email_intentado VARCHAR(190) NULL,
  ip              VARCHAR(45)  NOT NULL,
  user_agent      VARCHAR(255) NULL,
  creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_eventos_tipo_fecha_ip (tipo_evento_id, creado_en, ip, email_intentado), -- cubre el ranking de IP del panel
  KEY idx_eventos_usuario_fecha (usuario_id, creado_en),
  KEY idx_eventos_ip_fecha      (ip, creado_en),
  KEY idx_eventos_email_fecha   (email_intentado, creado_en),
  KEY idx_eventos_fecha         (creado_en),
  CONSTRAINT fk_eventos_tipo    FOREIGN KEY (tipo_evento_id) REFERENCES tipos_evento (id),
  CONSTRAINT fk_eventos_usuario FOREIGN KEY (usuario_id)     REFERENCES usuarios (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS alertas (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  regla        VARCHAR(30)  NOT NULL COMMENT 'FUERZA_BRUTA | IP_SOSPECHOSA | IP_NUEVA | FUERA_HORARIO',
  descripcion  VARCHAR(255) NOT NULL,
  severidad_id TINYINT UNSIGNED NOT NULL,
  usuario_id   INT UNSIGNED NULL,
  ip           VARCHAR(45) NULL,
  revisada     TINYINT(1) NOT NULL DEFAULT 0,
  revisada_por INT UNSIGNED NULL,
  revisada_en  DATETIME NULL,
  creado_en    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_alertas_revisada (revisada, creado_en),
  KEY idx_alertas_regla_ip (regla, ip, creado_en),
  KEY idx_alertas_usuario (usuario_id),
  CONSTRAINT fk_alertas_severidad FOREIGN KEY (severidad_id) REFERENCES severidades (id),
  CONSTRAINT fk_alertas_usuario   FOREIGN KEY (usuario_id)   REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT fk_alertas_revisor   FOREIGN KEY (revisada_por) REFERENCES usuarios (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------
-- Agregado precalculado de eventos (Big Data: pre-agregación)
-- Una fila por día, hora y tipo de evento. Se actualiza en línea con
-- INSERT ... ON DUPLICATE KEY UPDATE en cada evento registrado. El panel
-- lee de aquí en vez de recorrer eventos_acceso, y los totales sobreviven
-- al archivado de eventos antiguos. Es una desnormalización deliberada:
-- `total` es un dato derivado que se puede reconstruir desde eventos_acceso.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS resumen_eventos_hora (
  dia            DATE NOT NULL,
  hora           TINYINT UNSIGNED NOT NULL,
  tipo_evento_id TINYINT UNSIGNED NOT NULL,
  total          INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (dia, hora, tipo_evento_id),
  KEY idx_resumen_tipo_dia (tipo_evento_id, dia),
  CONSTRAINT fk_resumen_tipo FOREIGN KEY (tipo_evento_id) REFERENCES tipos_evento (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------
-- Datos de catálogo
-- ---------------------------------------------------------------------
INSERT IGNORE INTO roles (id, nombre, descripcion) VALUES
  (1, 'Administrador', 'Administrador de seguridad: gestiona incidentes, activos, usuarios, alertas y eventos.'),
  (2, 'Colaborador',   'Reporta incidentes, consulta los suyos y ve los activos a su cargo.');

INSERT IGNORE INTO areas (id, nombre) VALUES
  (1, 'Gerencia General'),
  (2, 'Tecnologías de la Información'),
  (3, 'Operaciones y Bodega'),
  (4, 'Transporte y Distribución'),
  (5, 'Finanzas y Facturación'),
  (6, 'Comercial y Atención al Cliente'),
  (7, 'Recursos Humanos');

INSERT IGNORE INTO tipos_activo (id, nombre) VALUES
  (1, 'Servidor'),
  (2, 'Computador'),
  (3, 'Notebook'),
  (4, 'Aplicación'),
  (5, 'Base de datos'),
  (6, 'Equipo de red'),
  (7, 'Dispositivo móvil');

INSERT IGNORE INTO categorias_incidente (id, nombre, descripcion) VALUES
  (1, 'Phishing',             'Correos, mensajes o llamadas que intentan obtener credenciales o información.'),
  (2, 'Malware',              'Virus, troyanos, ransomware u otro software malicioso.'),
  (3, 'Acceso no autorizado', 'Uso indebido de cuentas, accesos físicos o lógicos sin autorización.'),
  (4, 'Pérdida de equipo',    'Pérdida o robo de notebooks, teléfonos, terminales o medios de almacenamiento.'),
  (5, 'Fuga de información',  'Divulgación o envío de información a destinatarios no autorizados.'),
  (6, 'Indisponibilidad',     'Caída o degradación de sistemas o servicios.');

INSERT IGNORE INTO severidades (id, nombre, nivel, sla_horas) VALUES
  (1, 'Baja',    1, 72),
  (2, 'Media',   2, 24),
  (3, 'Alta',    3, 8),
  (4, 'Crítica', 4, 4);

INSERT IGNORE INTO estados_incidente (id, nombre, orden, es_final) VALUES
  (1, 'Reportado',     1, 0),
  (2, 'En análisis',   2, 0),
  (3, 'En contención', 3, 0),
  (4, 'Resuelto',      4, 1),
  (5, 'Cerrado',       5, 1),
  (6, 'Descartado',    6, 1);

INSERT IGNORE INTO tipos_evento (id, codigo, descripcion) VALUES
  (1, 'LOGIN_OK',                'Inicio de sesión exitoso'),
  (2, 'LOGIN_FALLIDO',           'Intento de inicio de sesión fallido'),
  (3, 'LOGOUT',                  'Cierre de sesión'),
  (4, 'CUENTA_BLOQUEADA',        'Cuenta bloqueada por intentos fallidos'),
  (5, 'RECUPERACION_SOLICITADA', 'Solicitud de recuperación de contraseña'),
  (6, 'PASSWORD_CAMBIADA',       'Cambio de contraseña'),
  (7, 'ACCESO_DENEGADO',         'Acceso denegado a un recurso'),
  (8, 'REGISTRO',                'Registro de cuenta nueva');
