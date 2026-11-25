'use strict';

// Utilidades comunes de la API REST: errores con formato RFC 7807
// (application/problem+json), autenticación por JWT o sesión y control
// de acceso por perfil.

const crypto = require('crypto');
const { validationResult } = require('express-validator');
const tokens = require('../services/tokens');
const eventos = require('../services/eventos');

/** Responde un error estándar RFC 7807. */
function problema(res, status, titulo, detalle, extra = {}) {
  res
    .status(status)
    .type('application/problem+json')
    .json({ type: 'about:blank', title: titulo, status, detail: detalle, ...extra });
}

/** 422 con los errores por campo, o null si la validación pasó. */
function erroresValidacion(req, extras = {}) {
  const errores = { ...extras };
  for (const e of validationResult(req).array()) {
    if (!errores[e.path]) errores[e.path] = e.msg;
  }
  return Object.keys(errores).length ? errores : null;
}

function responderValidacion(res, errores) {
  problema(res, 422, 'Datos no válidos', 'Uno o más campos no cumplen las reglas de validación.', { errores });
}

const SEGUROS = ['GET', 'HEAD', 'OPTIONS'];

function csrfValido(req) {
  const a = req.get('x-csrf-token');
  const b = req.session && req.session.csrfToken;
  return typeof a === 'string' && typeof b === 'string' && a.length === b.length &&
    crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Autenticación de la API:
 *  1. Authorization: Bearer <JWT>  (clientes externos e integraciones)
 *  2. Cookie de sesión del navegador (la propia interfaz web). En métodos
 *     que modifican datos exige además la cabecera X-CSRF-Token.
 */
async function autenticar(req, res, next) {
  try {
    const h = req.get('authorization') || '';
    if (h.startsWith('Bearer ')) {
      const user = await tokens.usuarioDesdeToken(h.slice(7).trim());
      if (!user) {
        res.set('WWW-Authenticate', 'Bearer error="invalid_token"');
        return problema(res, 401, 'No autenticado', 'El token de acceso no es válido, expiró o la cuenta está desactivada.');
      }
      req.user = user;
      req.authMetodo = 'jwt';
      return next();
    }
    if (req.session && req.session.user) {
      if (!SEGUROS.includes(req.method) && !csrfValido(req)) {
        return problema(res, 403, 'Solicitud rechazada', 'Falta la cabecera X-CSRF-Token o no es válida.');
      }
      req.user = req.session.user;
      req.authMetodo = 'sesion';
      return next();
    }
    res.set('WWW-Authenticate', 'Bearer');
    return problema(res, 401, 'No autenticado', 'Envía un token en la cabecera Authorization: Bearer <token>.');
  } catch (err) {
    next(err);
  }
}

/** Mínimo privilegio: solo el perfil Administrador. Registra los intentos denegados. */
async function soloAdmin(req, res, next) {
  if (req.user && req.user.rol === 'Administrador') return next();
  return denegar(req, res);
}

async function denegar(req, res) {
  try {
    await eventos.registrar('ACCESO_DENEGADO', { req, usuarioId: req.user?.id || null, email: req.user?.email || null });
  } catch (err) {
    console.error('[api] no se pudo registrar ACCESO_DENEGADO', err);
  }
  return problema(res, 403, 'Acceso denegado', 'Tu perfil no tiene permisos sobre este recurso. El intento fue registrado.');
}

/** Envuelve un controlador async para enviar sus errores al manejador central. */
const ruta = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Entero positivo acotado, o el valor por defecto. */
function entero(v, def, max = Infinity) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : def;
}

module.exports = { problema, erroresValidacion, responderValidacion, autenticar, soloAdmin, denegar, ruta, entero };
