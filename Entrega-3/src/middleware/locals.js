'use strict';

const formato = require('../utils/formato');

/** Mensajes flash simples guardados en la sesión. */
function flash(req, tipo, texto) {
  req.session.flash = req.session.flash || [];
  req.session.flash.push({ tipo, texto });
}

/**
 * Guarda la sesión antes de redirigir. Si no, el navegador puede pedir la página
 * siguiente antes de que termine la escritura en MySQL y perder el mensaje flash.
 */
function redirigirConSesion(req, res, next) {
  const redirect = res.redirect.bind(res);
  res.redirect = (...args) => {
    if (!req.session) return redirect(...args);
    req.session.save((err) => (err ? next(err) : redirect(...args)));
  };
}

function locals(req, res, next) {
  redirigirConSesion(req, res, next);
  res.locals.user = req.session.user || null;
  res.locals.esAdmin = req.session.user?.rol === 'Administrador';
  res.locals.flash = req.session.flash || [];
  delete req.session.flash;
  res.locals.path = req.path;
  res.locals.f = formato;
  res.locals.errores = {};
  res.locals.valores = {};
  next();
}

module.exports = { locals, flash };
