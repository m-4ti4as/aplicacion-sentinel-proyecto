'use strict';

const eventos = require('../services/eventos');

const esAdmin = (req) => req.session?.user?.rol === 'Administrador';

/** Responde 403, registra el intento como ACCESO_DENEGADO y muestra la página de error. */
async function denegar(req, res) {
  try {
    await eventos.registrar('ACCESO_DENEGADO', {
      req,
      usuarioId: req.session?.user?.id || null,
      email: req.session?.user?.email || null,
    });
  } catch (err) {
    console.error('[auth] no se pudo registrar ACCESO_DENEGADO', err);
  }
  res.status(403).render('errors/error', {
    titulo: 'Acceso denegado',
    mensaje: 'No tienes permisos para acceder a este recurso. El intento fue registrado.',
    status: 403,
  });
}

function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  if (req.method === 'GET') req.session.volverA = req.originalUrl;
  return res.redirect('/login');
}

/** Verificación de perfil en el servidor en cada solicitud (mínimo privilegio). */
function requireAdmin(req, res, next) {
  if (!req.session?.user) return res.redirect('/login');
  if (esAdmin(req)) return next();
  return denegar(req, res);
}

function soloInvitados(req, res, next) {
  if (req.session?.user) return res.redirect('/panel');
  next();
}

module.exports = { requireAuth, requireAdmin, soloInvitados, denegar, esAdmin };
