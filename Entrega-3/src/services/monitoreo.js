'use strict';

// Consultas de monitoreo: alertas (RF-14) y eventos de acceso (RF-15).

const { pool, one, all, limites } = require('../db/pool');
const tiempoReal = require('./tiempoReal');

async function listarAlertas({ pendientes = true, pagina = 1, porPagina = 20 } = {}) {
  const w = pendientes ? 'WHERE a.revisada = 0' : '';
  const total = (await one(`SELECT COUNT(*) AS n FROM alertas a ${w}`)).n;
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const p = Math.min(Math.max(1, pagina), paginas);
  const filas = await all(
    `SELECT a.id, a.regla, a.descripcion, a.ip, a.usuario_id, a.revisada, a.revisada_en, a.creado_en,
            s.nombre AS severidad, CONCAT(r.nombre, ' ', r.apellido) AS revisor
       FROM alertas a
       JOIN severidades s ON s.id = a.severidad_id
       LEFT JOIN usuarios r ON r.id = a.revisada_por
       ${w}
      ORDER BY a.revisada, s.nivel DESC, a.creado_en DESC
      LIMIT ? OFFSET ?`,
    limites(porPagina, p)
  );
  return { filas, total, pagina: p, paginas };
}

/** Marca una alerta como revisada. Devuelve false si no existía o ya estaba revisada. */
async function revisarAlerta(id, user) {
  const [r] = await pool.execute(
    'UPDATE alertas SET revisada = 1, revisada_por = ?, revisada_en = ? WHERE id = ? AND revisada = 0',
    [user.id, new Date(), id]
  );
  if (r.affectedRows) tiempoReal.aAdmins('alerta:revisada', { id, por: `${user.nombre} ${user.apellido}` });
  return r.affectedRows === 1;
}

function filtrosEventos(filtros) {
  const where = [];
  const params = [];
  if (filtros.tipo) {
    where.push('ev.tipo_evento_id = ?');
    params.push(filtros.tipo);
  }
  if (filtros.email) {
    where.push('ev.email_intentado LIKE ?');
    params.push(`%${filtros.email}%`);
  }
  if (filtros.ip) {
    where.push('ev.ip = ?');
    params.push(filtros.ip);
  }
  if (filtros.desde) {
    where.push('ev.creado_en >= ?');
    params.push(new Date(`${filtros.desde}T00:00:00`));
  }
  if (filtros.hasta) {
    const h = new Date(`${filtros.hasta}T00:00:00`);
    h.setDate(h.getDate() + 1);
    where.push('ev.creado_en < ?');
    params.push(h);
  }
  return { where, params };
}

// LEFT JOIN con el catálogo (la FK garantiza la coincidencia): obliga a MySQL a
// recorrer los eventos por su clave primaria y detenerse al completar la página.
const COLUMNAS_EVENTO = `ev.id, ev.ip, ev.user_agent, ev.email_intentado, ev.creado_en,
            t.codigo, t.descripcion AS evento, CONCAT(u.nombre, ' ', u.apellido) AS usuario`;

/** Paginación por desplazamiento (vista web, con número total de páginas). */
async function listarEventos(filtros, pagina = 1, porPagina = 25) {
  const { where, params } = filtrosEventos(filtros);
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = (await one(`SELECT COUNT(*) AS n FROM eventos_acceso ev ${w}`, params)).n;
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const p = Math.min(Math.max(1, pagina), paginas);
  const filas = await all(
    `SELECT ${COLUMNAS_EVENTO}
       FROM eventos_acceso ev
       LEFT JOIN tipos_evento t ON t.id = ev.tipo_evento_id
       LEFT JOIN usuarios u ON u.id = ev.usuario_id
       ${w}
      ORDER BY ev.id DESC
      LIMIT ? OFFSET ?`,
    [...params, ...limites(porPagina, p)]
  );
  return { filas, total, pagina: p, paginas };
}

/**
 * Paginación por cursor (keyset) para la API: "dame los N eventos anteriores
 * al id X". A diferencia de OFFSET, el costo no aumenta al avanzar en un
 * historial de millones de filas, porque MySQL salta directo por la clave primaria.
 */
async function eventosPorCursor(filtros, antesDe = null, limite = 50) {
  const { where, params } = filtrosEventos(filtros);
  if (antesDe) {
    where.push('ev.id < ?');
    params.push(antesDe);
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const filas = await all(
    `SELECT ${COLUMNAS_EVENTO}
       FROM eventos_acceso ev
       LEFT JOIN tipos_evento t ON t.id = ev.tipo_evento_id
       LEFT JOIN usuarios u ON u.id = ev.usuario_id
       ${w}
      ORDER BY ev.id DESC
      LIMIT ?`,
    [...params, String(limite + 1)]
  );
  const hayMas = filas.length > limite;
  if (hayMas) filas.pop();
  return { filas, siguiente: hayMas ? filas[filas.length - 1].id : null };
}

module.exports = { listarAlertas, revisarAlerta, listarEventos, eventosPorCursor };
