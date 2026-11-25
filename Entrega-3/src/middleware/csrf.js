'use strict';

const crypto = require('crypto');

// Token anti-CSRF por sesión (patrón synchronizer token). Todo formulario
// que modifica datos debe incluir <input type="hidden" name="_csrf">.

function tokenDe(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

function iguales(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function csrf(req, res, next) {
  res.locals.csrfToken = tokenDe(req);
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const enviado = (req.body && req.body._csrf) || req.get('x-csrf-token');
  if (iguales(enviado, req.session.csrfToken)) return next();

  return res.status(403).render('errors/error', {
    titulo: 'Solicitud rechazada',
    mensaje: 'El formulario expiró o no es válido. Vuelve a cargar la página e inténtalo de nuevo.',
    status: 403,
  });
}

/** Tras iniciar sesión se regenera la sesión y con ella el token. */
function renovar(req) {
  req.session.csrfToken = crypto.randomBytes(32).toString('hex');
}

module.exports = { csrf, renovar };
