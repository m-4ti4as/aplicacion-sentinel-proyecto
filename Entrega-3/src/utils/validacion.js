'use strict';

const { body, validationResult } = require('express-validator');

// Política de contraseñas (NIST SP 800-63B + requisitos del proyecto):
// mínimo 8 caracteres, con mayúscula, minúscula, número y símbolo.
// Máximo 72 bytes porque bcrypt ignora lo que sigue.
const MSG_PASSWORD = 'Mínimo 8 caracteres, con mayúscula, minúscula, número y símbolo';

function passwordRobusta(valor) {
  const v = String(valor || '');
  return (
    v.length >= 8 &&
    Buffer.byteLength(v, 'utf8') <= 72 &&
    /[a-z]/.test(v) &&
    /[A-Z]/.test(v) &&
    /\d/.test(v) &&
    /[^A-Za-z0-9]/.test(v)
  );
}

const reglaPassword = (campo) =>
  body(campo).custom((v) => passwordRobusta(v)).withMessage(MSG_PASSWORD);

const reglaConfirmar = (campo, original) =>
  body(campo)
    .custom((v, { req }) => v === req.body[original])
    .withMessage('Las contraseñas no coinciden');

const reglaNombre = (campo, etiqueta = 'Este campo') =>
  body(campo)
    .trim()
    .isLength({ min: 2 }).withMessage('Debe tener al menos 2 caracteres')
    .bail()
    .isLength({ max: 60 }).withMessage(`${etiqueta} admite hasta 60 caracteres`)
    .bail()
    .matches(/^[\p{L}][\p{L}\s'.-]*$/u).withMessage('Solo se permiten letras, espacios y guiones');

const reglaEmail = (campo = 'email') =>
  body(campo)
    .trim()
    .toLowerCase()
    .notEmpty().withMessage('Ingresa tu correo')
    .bail()
    .isEmail().withMessage('El formato no es válido')
    .bail()
    .isLength({ max: 190 }).withMessage('El correo es demasiado largo');

/** Devuelve { campo: mensaje } con el primer error de cada campo, o null. */
function errores(req) {
  const r = validationResult(req);
  if (r.isEmpty()) return null;
  const out = {};
  for (const e of r.array()) {
    if (!out[e.path]) out[e.path] = e.msg;
  }
  return out;
}

/** Entero positivo o null. */
function idDe(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

module.exports = { passwordRobusta, reglaPassword, reglaConfirmar, reglaNombre, reglaEmail, errores, idDe, MSG_PASSWORD };
