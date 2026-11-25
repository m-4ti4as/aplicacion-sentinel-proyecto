'use strict';

// Punto de entrada de la API REST (/api). Se monta antes del middleware
// CSRF de formularios: la API autentica con JWT (que el navegador no envía
// solo, así que no es vulnerable a CSRF) o con sesión + X-CSRF-Token.

const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const spec = require('./openapi');
const { problema } = require('./comun');

const router = express.Router();

// Respuestas de la API nunca se guardan en caché intermedia.
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// ---------------------------------------------------------------------
// Documentación
// ---------------------------------------------------------------------
router.get('/openapi.json', (req, res) => res.json(spec));
router.get('/docs', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.render('api/docs', { titulo: 'API REST', spec, base: `${config.appUrl}/api/v1` });
});

// ---------------------------------------------------------------------
// Límites de solicitudes
// ---------------------------------------------------------------------
const limite = (max) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) =>
      problema(res, 429, 'Demasiadas solicitudes', 'Se superó el límite de solicitudes. Espera unos minutos.'),
  });
router.use('/v1/auth', limite(config.security.authRateLimit));
router.use('/v1', limite(config.api.rateLimit));

// Cuerpo JSON acotado; un JSON mal formado responde 400 en formato RFC 7807.
router.use(express.json({ limit: '64kb' }));

router.use('/v1', require('./v1'));

router.use((req, res) => problema(res, 404, 'No encontrado', `No existe el recurso ${req.method} ${req.originalUrl}.`));

// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return problema(res, 400, 'JSON no válido', 'El cuerpo de la solicitud no es un JSON válido.');
  }
  if (err.type === 'entity.too.large') {
    return problema(res, 413, 'Solicitud demasiado grande', 'El cuerpo supera el tamaño máximo permitido.');
  }
  if (err.code === 'ER_DUP_ENTRY') {
    return problema(res, 409, 'Conflicto', 'Ya existe un registro con ese valor único.');
  }
  console.error('[api]', err);
  // Nunca se exponen detalles internos (trazas, SQL) al cliente.
  problema(res, 500, 'Error interno', 'Ocurrió un error al procesar la solicitud.');
});

module.exports = router;
