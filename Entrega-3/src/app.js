'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const { pool } = require('./db/pool');
const { csrf } = require('./middleware/csrf');
const { locals } = require('./middleware/locals');
const sesiones = require('./services/sesiones');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', config.trustProxy);

// ---------------------------------------------------------------------
// Cabeceras HTTP de seguridad (RNF-04). Sin JavaScript ni estilos en línea.
// ---------------------------------------------------------------------
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        ...(config.isProd ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    hsts: config.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'same-origin' },
  })
);

// ---------------------------------------------------------------------
// Archivos estáticos (CSS, JS propio y Chart.js servido desde node_modules)
// ---------------------------------------------------------------------
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: config.isProd ? '7d' : 0 }));
app.get('/vendor/chart.umd.js', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist', 'chart.umd.js'));
});

// Chequeo de salud: va antes de las sesiones para no crear una en cada consulta.
app.get('/health', (req, res) => res.json({ ok: true }));

app.use(express.urlencoded({ extended: false, limit: '64kb' }));

// ---------------------------------------------------------------------
// Sesiones del lado del servidor (tabla `sessions`). La cookie solo lleva
// un identificador firmado. Expira tras 30 min de inactividad (rolling).
// ---------------------------------------------------------------------
const store = new MySQLStore(
  {
    createDatabaseTable: true,
    clearExpired: true,
    checkExpirationInterval: 15 * 60 * 1000,
    expiration: config.session.minutes * 60 * 1000,
  },
  pool
);
app.locals.sessionStore = store;

const sessionMiddleware = session({
  name: 'sid',
  secret: config.session.secret,
  store,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.session.secure,
    maxAge: config.session.minutes * 60 * 1000,
  },
});
app.use(sessionMiddleware);
// Socket.IO reutiliza la misma sesión para autenticar las conexiones en vivo.
app.locals.sessionMiddleware = sessionMiddleware;

// La cuenta se relee en cada solicitud: desactivarla o cambiar su perfil es inmediato.
app.use(sesiones.vigente);

app.use(locals);

// API REST: tiene su propia autenticación (JWT o sesión + X-CSRF-Token),
// respuestas JSON y manejo de errores, por eso va antes del CSRF de formularios.
app.use('/api', require('./api'));

app.use(csrf);

// Evita que el navegador guarde en caché páginas con datos privados.
app.use((req, res, next) => {
  if (req.session.user) res.set('Cache-Control', 'no-store');
  next();
});

// ---------------------------------------------------------------------
// Límite de solicitudes a las rutas de autenticación (RNF-04)
// ---------------------------------------------------------------------
const limiteAuth = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.security.authRateLimit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => req.method !== 'POST',
  handler: (req, res) =>
    res.status(429).render('errors/error', {
      titulo: 'Demasiados intentos',
      mensaje: 'Se superó el número de intentos permitidos desde tu conexión. Espera unos minutos e inténtalo de nuevo.',
      status: 429,
    }),
});
app.use(['/login', '/registro', '/recuperar'], limiteAuth);

// ---------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------
app.get('/', (req, res) => res.redirect(req.session.user ? '/panel' : '/login'));

app.use(require('./routes/auth'));
app.use(require('./routes/panel'));
app.use(require('./routes/incidentes'));
app.use(require('./routes/activos'));
app.use(require('./routes/perfil'));
app.use('/admin', require('./routes/admin'));

app.use((req, res) => {
  res.status(404).render('errors/error', {
    titulo: 'Página no encontrada',
    mensaje: 'La dirección que buscas no existe o fue movida.',
    status: 404,
  });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).render('errors/error', {
    titulo: 'Error inesperado',
    mensaje: 'Ocurrió un error al procesar la solicitud. Si persiste, contacta al área de TI.',
    status: 500,
  });
});

module.exports = app;
