'use strict';

// Tokens de acceso (JWT) para la API REST y los clientes de Socket.IO.
// Vida corta (15 min por defecto), firmados con HS256 y validados con
// emisor, audiencia y algoritmo fijos. En cada solicitud se vuelve a leer
// el usuario desde la base: si la cuenta se desactivó o cambió de perfil,
// el token deja de servir aunque no haya expirado.

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { one } = require('../db/pool');

function firmar(usuario) {
  return jwt.sign({ rol: usuario.rol }, config.jwt.secret, {
    algorithm: 'HS256',
    subject: String(usuario.id),
    expiresIn: config.jwt.minutos * 60,
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
    jwtid: crypto.randomUUID(),
  });
}

/** Devuelve el payload o lanza un error si el token no es válido. */
function verificar(token) {
  return jwt.verify(token, config.jwt.secret, {
    algorithms: ['HS256'],
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  });
}

async function usuarioPorId(id) {
  const u = await one(
    `SELECT u.id, u.nombre, u.apellido, u.email, u.area_id, u.activo, r.nombre AS rol
       FROM usuarios u JOIN roles r ON r.id = u.rol_id
      WHERE u.id = ?`,
    [id]
  );
  if (!u || !u.activo) return null;
  return { id: u.id, nombre: u.nombre, apellido: u.apellido, email: u.email, rol: u.rol, areaId: u.area_id };
}

/** Usuario vigente a partir de un token, o null. */
async function usuarioDesdeToken(token) {
  try {
    const payload = verificar(token);
    const id = Number(payload.sub);
    if (!Number.isInteger(id)) return null;
    return await usuarioPorId(id);
  } catch {
    return null;
  }
}

module.exports = { firmar, verificar, usuarioDesdeToken, usuarioPorId };
