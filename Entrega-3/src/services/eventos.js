'use strict';

const { pool } = require('../db/pool');
const catalogos = require('./catalogos');
const resumen = require('./resumen');
const tiempoReal = require('./tiempoReal');

/** IP del cliente normalizada (sin el prefijo IPv4-mapeado de IPv6). */
function ipDe(req) {
  const ip = (req && (req.ip || req.socket?.remoteAddress)) || '0.0.0.0';
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

function userAgentDe(req) {
  const ua = (req && req.get && req.get('user-agent')) || '';
  return ua.slice(0, 255) || null;
}

/**
 * Inserta el evento (RF-12). Recibe la conexión para poder participar en la
 * transacción de quien llama; no publica nada hasta que se confirme.
 * @param {string} codigo  LOGIN_OK, LOGIN_FALLIDO, LOGOUT, CUENTA_BLOQUEADA, ...
 * @param {object} opts    { req, usuarioId, email, fecha }
 */
async function insertar(db, codigo, { req, usuarioId = null, email = null, fecha = new Date() } = {}) {
  const tipoId = catalogos.get().tipoEventoId[codigo];
  if (!tipoId) throw new Error(`Tipo de evento desconocido: ${codigo}`);
  const ip = ipDe(req);
  const userAgent = userAgentDe(req);
  const emailNorm = email ? String(email).trim().toLowerCase().slice(0, 190) : null;
  const [r] = await db.execute(
    `INSERT INTO eventos_acceso (tipo_evento_id, usuario_id, email_intentado, ip, user_agent, creado_en)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [tipoId, usuarioId, emailNorm, ip, userAgent, fecha]
  );
  return { id: r.insertId, codigo, tipoId, email: emailNorm, ip, userAgent, fecha };
}

/** Actualiza el resumen agregado y avisa en vivo. Se llama con el evento ya confirmado. */
async function publicar(ev) {
  try {
    await resumen.incrementar(pool, ev.tipoId, ev.fecha);
  } catch (err) {
    // El resumen es un dato derivado: si falla se puede reconstruir (npm run resumen:reconstruir).
    console.error('[resumen] no se pudo actualizar:', err.message);
  }
  tiempoReal.aAdmins('evento:nuevo', {
    id: ev.id,
    codigo: ev.codigo,
    evento: catalogos.get().tiposEvento.find((t) => t.id === ev.tipoId).descripcion,
    email: ev.email,
    ip: ev.ip,
    userAgent: ev.userAgent,
    fecha: ev.fecha.toISOString(),
  });
}

/** Registra un evento de acceso y lo publica a los administradores conectados. */
async function registrar(codigo, opts) {
  const ev = await insertar(pool, codigo, opts);
  await publicar(ev);
  return ev;
}

module.exports = { registrar, insertar, publicar, ipDe, userAgentDe };
