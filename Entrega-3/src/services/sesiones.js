'use strict';

// Ciclo de vida de las sesiones web ya abiertas: se revalidan contra la base en
// cada solicitud y se cierran cuando cambia la contraseña, el perfil o el estado
// de la cuenta.

const { pool } = require('../db/pool');
const tokens = require('./tokens');
const tiempoReal = require('./tiempoReal');

/** Cierra las sesiones y los sockets de un usuario, salvo la sesión indicada. */
async function cerrarDe(usuarioId, exceptoSid = null) {
  await pool.execute(
    "DELETE FROM sessions WHERE JSON_EXTRACT(data, '$.user.id') = ? AND session_id <> ?",
    [usuarioId, exceptoSid || '']
  );
  tiempoReal.desconectarUsuario(usuarioId, exceptoSid);
}

/**
 * Middleware: vuelve a leer el usuario en cada solicitud, de modo que una cuenta
 * desactivada o un cambio de perfil tienen efecto inmediato (mínimo privilegio).
 */
async function vigente(req, res, next) {
  if (!req.session || !req.session.user) return next();
  try {
    const actual = await tokens.usuarioPorId(req.session.user.id);
    if (!actual) {
      return req.session.regenerate((err) => next(err));
    }
    const previo = req.session.user;
    if (Object.keys(actual).some((k) => actual[k] !== previo[k])) req.session.user = actual;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { cerrarDe, vigente };
