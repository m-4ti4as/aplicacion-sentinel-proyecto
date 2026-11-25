'use strict';

require('dotenv').config();

// La zona horaria se fija antes de crear cualquier fecha: las reglas de
// horario laboral y los gráficos por hora trabajan en hora de Chile.
process.env.TZ = process.env.TZ || 'America/Santiago';

const int = (v, def) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
};
const bool = (v, def) => (v === undefined || v === '' ? def : String(v).toLowerCase() === 'true');

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';

const config = {
  env,
  isProd,
  port: int(process.env.PORT, 3000),
  appUrl: (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  trustProxy: int(process.env.TRUST_PROXY, 0),

  session: {
    secret: process.env.SESSION_SECRET || '',
    minutes: int(process.env.SESSION_MINUTES, 30),
    // En producción la cookie solo viaja por HTTPS. Se puede forzar con COOKIE_SECURE.
    secure: bool(process.env.COOKIE_SECURE, isProd),
  },

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: int(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'sentinel',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sentinel',
    // TLS hacia MySQL administrado (DB_SSL=true). DB_SSL_CA: certificado CA en PEM.
    ssl: bool(process.env.DB_SSL, false)
      ? { minVersion: 'TLSv1.2', rejectUnauthorized: true, ...(process.env.DB_SSL_CA ? { ca: process.env.DB_SSL_CA.replace(/\\n/g, '\n') } : {}) }
      : undefined,
  },

  // Tokens de acceso para la API REST (JWT firmado con HMAC-SHA256)
  jwt: {
    secret: process.env.JWT_SECRET || '',
    minutos: int(process.env.JWT_MINUTES, 15),
    issuer: 'sentineldata',
    audience: 'sentineldata-api',
  },

  api: {
    // Solicitudes por IP (o por token) cada 15 minutos
    rateLimit: int(process.env.API_RATE_LIMIT, 300),
  },

  seedDemo: bool(process.env.SEED_DEMO, true),

  mail: {
    host: process.env.SMTP_HOST || 'localhost',
    port: int(process.env.SMTP_PORT, 1025),
    secure: bool(process.env.SMTP_SECURE, false),
    // Exige STARTTLS cuando no se usa TLS directo (por defecto en producción).
    requireTLS: bool(process.env.SMTP_REQUIRE_TLS, isProd),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'SentinelData <no-reply@translogix.cl>',
  },

  security: {
    bcryptCost: int(process.env.BCRYPT_COST, 12),
    maxIntentos: int(process.env.MAX_INTENTOS, 5),
    bloqueoMinutos: int(process.env.BLOQUEO_MINUTOS, 15),
    authRateLimit: int(process.env.AUTH_RATE_LIMIT, 30),
    tokenMinutos: 30,
  },

  deteccion: {
    horarioInicio: int(process.env.HORARIO_INICIO, 7),
    horarioFin: int(process.env.HORARIO_FIN, 20),
    ipSospechosaFallos: 10,
    ipSospechosaCuentas: 3,
    ventanaMinutos: 15,
    ipNuevaDias: 90,
  },
};

if (!config.session.secret) {
  if (isProd) {
    throw new Error('SESSION_SECRET es obligatorio en producción.');
  }
  config.session.secret = 'solo-desarrollo-' + require('crypto').randomBytes(16).toString('hex');
}
if (!config.jwt.secret) {
  if (isProd) {
    throw new Error('JWT_SECRET es obligatorio en producción.');
  }
  config.jwt.secret = 'solo-desarrollo-jwt-' + require('crypto').randomBytes(16).toString('hex');
}

module.exports = config;
