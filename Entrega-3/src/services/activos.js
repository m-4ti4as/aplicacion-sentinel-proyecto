'use strict';

// Inventario de activos de información (RF-10, RF-11).

const { pool, one, all, limites } = require('../db/pool');

const esAdmin = (user) => user && user.rol === 'Administrador';

async function listar(user, q, pagina = 1, porPagina = 15) {
  const where = [];
  const params = [];
  if (!esAdmin(user)) {
    where.push('a.responsable_id = ?');
    params.push(user.id);
  }
  if (q) {
    where.push('(a.nombre LIKE ? OR a.identificador LIKE ? OR a.ubicacion LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = (await one(`SELECT COUNT(*) AS n FROM activos a ${w}`, params)).n;
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const p = Math.min(Math.max(1, pagina), paginas);
  const filas = await all(
    `SELECT a.id, a.nombre, a.identificador, a.criticidad, a.ubicacion,
            a.tipo_activo_id, t.nombre AS tipo, a.area_id, ar.nombre AS area,
            a.responsable_id, CONCAT(u.nombre, ' ', u.apellido) AS responsable,
            (SELECT COUNT(*) FROM incidentes i WHERE i.activo_id = a.id) AS incidentes
       FROM activos a
       JOIN tipos_activo t ON t.id = a.tipo_activo_id
       JOIN areas ar ON ar.id = a.area_id
       LEFT JOIN usuarios u ON u.id = a.responsable_id
       ${w}
      ORDER BY FIELD(a.criticidad, 'CRITICA', 'ALTA', 'MEDIA', 'BAJA'), a.nombre
      LIMIT ? OFFSET ?`,
    [...params, ...limites(porPagina, p)]
  );
  return { filas, total, pagina: p, paginas };
}

const obtener = (id) => one('SELECT * FROM activos WHERE id = ?', [id]);

const usuariosActivos = () =>
  all('SELECT id, nombre, apellido FROM usuarios WHERE activo = 1 ORDER BY nombre, apellido');

/** Validaciones que dependen de la base: responsable vigente e identificador único. */
async function validar(datos, idActual = null) {
  const errores = {};
  const responsableId = datos.responsable_id ? Number(datos.responsable_id) : null;
  if (datos.responsable_id) {
    const u = Number.isInteger(responsableId) && (await one('SELECT id FROM usuarios WHERE id = ? AND activo = 1', [responsableId]));
    if (!u) errores.responsable_id = 'Responsable no válido';
  }
  if (typeof datos.identificador === 'string' && datos.identificador) {
    const dup = await one('SELECT id FROM activos WHERE identificador = ? AND id <> ?', [datos.identificador, idActual || 0]);
    if (dup) errores.identificador = 'Ya existe un activo con este identificador';
  }
  return { errores, responsableId };
}

const valoresDe = (d, responsableId) => [
  Number(d.tipo_activo_id),
  Number(d.area_id),
  responsableId,
  d.nombre,
  d.identificador,
  d.criticidad,
  d.ubicacion || null,
];

async function crear(datos, responsableId) {
  const [r] = await pool.execute(
    `INSERT INTO activos (tipo_activo_id, area_id, responsable_id, nombre, identificador, criticidad, ubicacion)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    valoresDe(datos, responsableId)
  );
  return r.insertId;
}

async function actualizar(id, datos, responsableId) {
  await pool.execute(
    `UPDATE activos SET tipo_activo_id = ?, area_id = ?, responsable_id = ?, nombre = ?,
            identificador = ?, criticidad = ?, ubicacion = ?
      WHERE id = ?`,
    [...valoresDe(datos, responsableId), id]
  );
}

module.exports = { listar, obtener, usuariosActivos, validar, crear, actualizar };
