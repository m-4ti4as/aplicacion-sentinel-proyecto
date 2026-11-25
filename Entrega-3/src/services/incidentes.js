'use strict';

// Lógica de negocio de incidentes, usada por las vistas web y la API REST.

const { one, all, transaction, limites } = require('../db/pool');
const catalogos = require('./catalogos');
const tiempoReal = require('./tiempoReal');

const esAdmin = (user) => user && user.rol === 'Administrador';

/** Activos que el usuario puede asociar a un reporte. */
function activosPermitidos(user) {
  if (esAdmin(user)) {
    return all('SELECT id, nombre, identificador FROM activos ORDER BY nombre');
  }
  return all(
    `SELECT id, nombre, identificador FROM activos
      WHERE area_id = ? OR responsable_id = ? ORDER BY nombre`,
    [user.areaId, user.id]
  );
}

function administradores() {
  return all(
    `SELECT u.id, u.nombre, u.apellido FROM usuarios u JOIN roles r ON r.id = u.rol_id
      WHERE r.nombre = 'Administrador' AND u.activo = 1 ORDER BY u.nombre, u.apellido`
  );
}

/** Listado con filtros y paginación (RF-07). El colaborador solo ve lo suyo. */
async function listar(user, filtros, pagina = 1, porPagina = 15) {
  const where = [];
  const params = [];
  if (!esAdmin(user)) {
    where.push('i.reportado_por = ?');
    params.push(user.id);
  }
  if (filtros.estado) {
    where.push('i.estado_id = ?');
    params.push(filtros.estado);
  }
  if (filtros.severidad) {
    where.push('i.severidad_id = ?');
    params.push(filtros.severidad);
  }
  if (filtros.q) {
    where.push('(i.codigo LIKE ? OR i.titulo LIKE ?)');
    params.push(`%${filtros.q}%`, `%${filtros.q}%`);
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const total = (await one(`SELECT COUNT(*) AS n FROM incidentes i ${w}`, params)).n;
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const p = Math.min(Math.max(1, pagina), paginas);
  const filas = await all(
    `SELECT i.id, i.codigo, i.titulo, i.creado_en, i.fecha_deteccion,
            c.nombre AS categoria, s.nombre AS severidad, e.nombre AS estado, e.es_final,
            CONCAT(r.nombre, ' ', r.apellido) AS reportado_por,
            CONCAT(a.nombre, ' ', a.apellido) AS asignado_a
       FROM incidentes i
       JOIN categorias_incidente c ON c.id = i.categoria_id
       JOIN severidades s ON s.id = i.severidad_id
       JOIN estados_incidente e ON e.id = i.estado_id
       LEFT JOIN usuarios r ON r.id = i.reportado_por
       LEFT JOIN usuarios a ON a.id = i.asignado_a
       ${w}
      ORDER BY i.creado_en DESC
      LIMIT ? OFFSET ?`,
    [...params, ...limites(porPagina, p)]
  );
  return { filas, total, pagina: p, paginas };
}

function obtener(id) {
  return one(
    `SELECT i.*, c.nombre AS categoria, s.nombre AS severidad, s.sla_horas,
            e.nombre AS estado, e.es_final,
            CONCAT(r.nombre, ' ', r.apellido) AS reportado_nombre,
            CONCAT(a.nombre, ' ', a.apellido) AS asignado_nombre,
            ac.nombre AS activo_nombre, ac.identificador AS activo_identificador
       FROM incidentes i
       JOIN categorias_incidente c ON c.id = i.categoria_id
       JOIN severidades s ON s.id = i.severidad_id
       JOIN estados_incidente e ON e.id = i.estado_id
       LEFT JOIN usuarios r ON r.id = i.reportado_por
       LEFT JOIN usuarios a ON a.id = i.asignado_a
       LEFT JOIN activos ac ON ac.id = i.activo_id
      WHERE i.id = ?`,
    [id]
  );
}

/** Autorización a nivel de registro: el colaborador solo accede a lo que reportó. */
function puedeVer(user, inc) {
  return esAdmin(user) || inc.reportado_por === user.id;
}

function seguimientos(incidenteId) {
  return all(
    `SELECT sg.id, sg.comentario, sg.creado_en,
            CONCAT(u.nombre, ' ', u.apellido) AS autor,
            ea.nombre AS estado_anterior, en.nombre AS estado_nuevo
       FROM seguimientos_incidente sg
       LEFT JOIN usuarios u ON u.id = sg.usuario_id
       LEFT JOIN estados_incidente ea ON ea.id = sg.estado_anterior_id
       LEFT JOIN estados_incidente en ON en.id = sg.estado_nuevo_id
      WHERE sg.incidente_id = ?
      ORDER BY sg.creado_en, sg.id`,
    [incidenteId]
  );
}

function sla(inc) {
  const fin = inc.cerrado_en ? new Date(inc.cerrado_en) : new Date();
  const horas = Math.floor((fin - new Date(inc.creado_en)) / 3600000);
  return { horas: inc.sla_horas, transcurridas: horas, vencido: !inc.es_final && horas > inc.sla_horas };
}

/** Validaciones que dependen de la base de datos (las de formato van en validators.js). */
async function validarNuevo(user, datos) {
  const errores = {};
  const activoId = datos.activo_id ? Number(datos.activo_id) : null;
  if (activoId) {
    const permitidos = await activosPermitidos(user);
    if (!permitidos.some((a) => a.id === activoId)) errores.activo_id = 'Activo no válido';
  }
  return errores;
}

/** Crea el incidente con código correlativo INC-AAAA-NNNNN (RF-06). */
async function crear(user, datos) {
  const c = catalogos.get();
  const ahora = new Date();
  const anio = ahora.getFullYear();
  const reportadoId = c.estadoId.Reportado;
  const activoId = datos.activo_id ? Number(datos.activo_id) : null;

  const res = await transaction(async (conn) => {
    // Bloquea el último código del año para generar el correlativo sin colisiones.
    const [[ult]] = await conn.execute(
      `SELECT MAX(CAST(SUBSTRING(codigo, 10) AS UNSIGNED)) AS n
         FROM incidentes WHERE codigo LIKE ? FOR UPDATE`,
      [`INC-${anio}-%`]
    );
    const codigo = `INC-${anio}-${String((ult.n || 0) + 1).padStart(5, '0')}`;
    const [r] = await conn.execute(
      `INSERT INTO incidentes
         (codigo, titulo, descripcion, categoria_id, severidad_id, estado_id, activo_id,
          reportado_por, fecha_deteccion, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        codigo,
        datos.titulo,
        datos.descripcion,
        Number(datos.categoria_id),
        Number(datos.severidad_id),
        reportadoId,
        activoId,
        user.id,
        new Date(datos.fecha_deteccion),
        ahora,
      ]
    );
    await conn.execute(
      `INSERT INTO seguimientos_incidente (incidente_id, usuario_id, estado_anterior_id, estado_nuevo_id, comentario, creado_en)
       VALUES (?, ?, NULL, ?, 'Incidente reportado.', ?)`,
      [r.insertId, user.id, reportadoId, ahora]
    );
    return { id: r.insertId, codigo };
  });

  const sev = c.severidades.find((s) => s.id === Number(datos.severidad_id));
  tiempoReal.aAdmins('incidente:nuevo', {
    id: res.id,
    codigo: res.codigo,
    titulo: datos.titulo,
    severidad: sev ? sev.nombre : '',
    reportadoPor: `${user.nombre} ${user.apellido}`,
  });
  return res;
}

/**
 * Valida un seguimiento (RF-09). Solo el administrador puede cambiar
 * estado, severidad y responsable; el colaborador solo comenta.
 */
async function validarSeguimiento(user, inc, datos) {
  const c = catalogos.get();
  const errores = {};
  const cambios = { estado: inc.estado_id, severidad: inc.severidad_id, asignado: inc.asignado_a };
  if (esAdmin(user)) {
    if (datos.estado_id !== undefined) cambios.estado = Number(datos.estado_id);
    if (datos.severidad_id !== undefined) cambios.severidad = Number(datos.severidad_id);
    if (datos.asignado_a !== undefined) cambios.asignado = datos.asignado_a ? Number(datos.asignado_a) : null;
    if (!c.estados.some((e) => e.id === cambios.estado)) errores.estado_id = 'Estado no válido';
    if (!c.severidades.some((s) => s.id === cambios.severidad)) errores.severidad_id = 'Severidad no válida';
    if (cambios.asignado && cambios.asignado !== inc.asignado_a) {
      const admins = await administradores();
      if (!admins.some((a) => a.id === cambios.asignado)) errores.asignado_a = 'Responsable no válido';
    }
  }
  return { errores, cambios };
}

async function registrarSeguimiento(user, inc, comentario, cambios) {
  const c = catalogos.get();
  const ahora = new Date();
  const cambiaEstado = cambios.estado !== inc.estado_id;
  const estadoNuevo = c.estados.find((e) => e.id === cambios.estado);

  await transaction(async (conn) => {
    await conn.execute(
      `UPDATE incidentes SET estado_id = ?, severidad_id = ?, asignado_a = ?, cerrado_en = ? WHERE id = ?`,
      [cambios.estado, cambios.severidad, cambios.asignado, estadoNuevo.es_final ? inc.cerrado_en || ahora : null, inc.id]
    );
    await conn.execute(
      `INSERT INTO seguimientos_incidente
         (incidente_id, usuario_id, estado_anterior_id, estado_nuevo_id, comentario, creado_en)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [inc.id, user.id, cambiaEstado ? inc.estado_id : null, cambiaEstado ? cambios.estado : null, comentario, ahora]
    );
  });

  // Aviso en vivo al colaborador que reportó (si no es quien hizo el cambio).
  if (inc.reportado_por && inc.reportado_por !== user.id) {
    tiempoReal.aUsuario(inc.reportado_por, 'incidente:actualizado', {
      id: inc.id,
      codigo: inc.codigo,
      estado: estadoNuevo.nombre,
      cambioEstado: cambiaEstado,
      autor: `${user.nombre} ${user.apellido}`,
    });
  }
  if (cambiaEstado && estadoNuevo.es_final && !inc.es_final) {
    tiempoReal.aAdmins('incidente:cerrado', { id: inc.id, codigo: inc.codigo, estado: estadoNuevo.nombre });
  }
}

module.exports = {
  esAdmin,
  activosPermitidos,
  administradores,
  listar,
  obtener,
  puedeVer,
  seguimientos,
  sla,
  validarNuevo,
  crear,
  validarSeguimiento,
  registrarSeguimiento,
};
