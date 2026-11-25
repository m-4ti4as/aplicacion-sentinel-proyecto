'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { body } = require('express-validator');

const config = require('../config');
const { pool, one, all, limites } = require('../db/pool');
const catalogos = require('../services/catalogos');
const { requireAdmin } = require('../middleware/auth');
const { flash } = require('../middleware/locals');
const v = require('../utils/validacion');
const monitoreo = require('../services/monitoreo');
const sesiones = require('../services/sesiones');

const router = express.Router();

// Todo lo que cuelga de /admin exige perfil Administrador (verificado en el servidor).
router.use(requireAdmin);

// ---------------------------------------------------------------------
// Alertas de seguridad (RF-14)
// ---------------------------------------------------------------------
router.get('/alertas', async (req, res, next) => {
  try {
    const vista = req.query.vista === 'todas' ? 'todas' : 'pendientes';
    const r = await monitoreo.listarAlertas({ pendientes: vista === 'pendientes', pagina: v.idDe(req.query.pagina) || 1 });
    res.render('admin/alertas', { titulo: 'Alertas de seguridad', ...r, vista });
  } catch (err) {
    next(err);
  }
});

router.post('/alertas/:id/revisar', async (req, res, next) => {
  try {
    const id = v.idDe(req.params.id);
    if (id) await monitoreo.revisarAlerta(id, req.session.user);
    flash(req, 'ok', 'Alerta marcada como revisada.');
    res.redirect(req.body.volver === '/panel' ? '/panel' : '/admin/alertas');
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// Registro de eventos de acceso con filtros y paginación (RF-15)
// ---------------------------------------------------------------------
function filtrosEventos(query) {
  const fecha = (x) => (/^\d{4}-\d{2}-\d{2}$/.test(x || '') ? x : '');
  return {
    tipo: v.idDe(query.tipo) || '',
    email: String(query.email || '').trim().toLowerCase().slice(0, 190),
    ip: String(query.ip || '').trim().slice(0, 45),
    desde: fecha(query.desde),
    hasta: fecha(query.hasta),
  };
}

router.get('/eventos', async (req, res, next) => {
  try {
    const filtros = filtrosEventos(req.query);
    const r = await monitoreo.listarEventos(filtros, v.idDe(req.query.pagina) || 1);
    const sinFiltros = !Object.values(filtros).some(Boolean);
    res.render('admin/eventos', {
      titulo: 'Eventos de acceso',
      ...r,
      filtros,
      tipos: catalogos.get().tiposEvento,
      // La tabla se actualiza en vivo solo en la primera página sin filtros.
      enVivo: sinFiltros && r.pagina === 1,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// Gestión de usuarios (RF-17)
// ---------------------------------------------------------------------
router.get('/usuarios', async (req, res, next) => {
  try {
    const POR = 20;
    const q = String(req.query.q || '').trim().slice(0, 100);
    const pagina = Math.max(1, v.idDe(req.query.pagina) || 1);
    const where = [];
    const params = [];
    if (q) {
      where.push("(u.email LIKE ? OR CONCAT(u.nombre, ' ', u.apellido) LIKE ?)");
      params.push(`%${q}%`, `%${q}%`);
    }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = (await one(`SELECT COUNT(*) AS n FROM usuarios u ${w}`, params)).n;
    const paginas = Math.max(1, Math.ceil(total / POR));
    const p = Math.min(pagina, paginas);
    const filas = await all(
      `SELECT u.id, u.nombre, u.apellido, u.email, u.activo, u.bloqueado_hasta, u.ultimo_login,
              r.nombre AS rol, a.nombre AS area
         FROM usuarios u
         JOIN roles r ON r.id = u.rol_id
         JOIN areas a ON a.id = u.area_id
         ${w}
        ORDER BY r.id, u.nombre, u.apellido
        LIMIT ? OFFSET ?`,
      [...params, ...limites(POR, p)]
    );
    res.render('admin/usuarios', { titulo: 'Usuarios', filas, q, pagina: p, paginas, total, ahora: new Date() });
  } catch (err) {
    next(err);
  }
});

const reglasUsuario = (nuevo) => [
  v.reglaNombre('nombre', 'El nombre'),
  v.reglaNombre('apellido', 'El apellido'),
  v.reglaEmail('email'),
  body('rol_id')
    .custom((val) => catalogos.get().roles.some((r) => r.id === Number(val)))
    .withMessage('Selecciona el perfil'),
  body('area_id')
    .custom((val) => catalogos.get().areas.some((a) => a.id === Number(val)))
    .withMessage('Selecciona el área'),
  nuevo
    ? v.reglaPassword('password')
    : body('password')
        .custom((val) => !val || v.passwordRobusta(val))
        .withMessage(v.MSG_PASSWORD),
];

function renderForm(res, { usuario = null, errores = {}, valores = {}, status = 200 }) {
  const c = catalogos.get();
  res.status(status).render('admin/usuario-form', {
    titulo: usuario ? 'Editar usuario' : 'Crear usuario',
    usuario,
    roles: c.roles,
    areas: c.areas,
    errores,
    valores,
  });
}

router.get('/usuarios/nuevo', (req, res) => {
  renderForm(res, { valores: { rol_id: catalogos.get().rolId.Colaborador, activo: 1 } });
});

router.post('/usuarios', reglasUsuario(true), async (req, res, next) => {
  try {
    const errores = v.errores(req) || {};
    if (!errores.email && (await one('SELECT id FROM usuarios WHERE email = ?', [req.body.email]))) {
      errores.email = 'Ya existe una cuenta con este correo';
    }
    if (Object.keys(errores).length) return renderForm(res, { errores, valores: req.body, status: 422 });

    const hash = await bcrypt.hash(req.body.password, config.security.bcryptCost);
    await pool.execute(
      `INSERT INTO usuarios (rol_id, area_id, nombre, apellido, email, password_hash, activo)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(req.body.rol_id),
        Number(req.body.area_id),
        req.body.nombre,
        req.body.apellido,
        req.body.email,
        hash,
        req.body.activo === '1' ? 1 : 0,
      ]
    );
    flash(req, 'ok', `Usuario ${req.body.email} creado.`);
    res.redirect('/admin/usuarios');
  } catch (err) {
    next(err);
  }
});

router.get('/usuarios/:id/editar', async (req, res, next) => {
  try {
    const u = await one('SELECT * FROM usuarios WHERE id = ?', [v.idDe(req.params.id) || 0]);
    if (!u) return next();
    renderForm(res, { usuario: u, valores: u });
  } catch (err) {
    next(err);
  }
});

router.post('/usuarios/:id', reglasUsuario(false), async (req, res, next) => {
  try {
    const u = await one('SELECT * FROM usuarios WHERE id = ?', [v.idDe(req.params.id) || 0]);
    if (!u) return next();
    const errores = v.errores(req) || {};
    if (!errores.email && (await one('SELECT id FROM usuarios WHERE email = ? AND id <> ?', [req.body.email, u.id]))) {
      errores.email = 'Ya existe una cuenta con este correo';
    }
    const activo = req.body.activo === '1' ? 1 : 0;
    // Un administrador no puede quitarse a sí mismo el perfil ni desactivarse.
    if (u.id === req.session.user.id) {
      if (Number(req.body.rol_id) !== u.rol_id) errores.rol_id = 'No puedes cambiar tu propio perfil';
      if (!activo) errores.activo = 'No puedes desactivar tu propia cuenta';
    }
    if (Object.keys(errores).length) {
      return renderForm(res, { usuario: u, errores, valores: { ...req.body, activo }, status: 422 });
    }

    const campos = ['rol_id = ?', 'area_id = ?', 'nombre = ?', 'apellido = ?', 'email = ?', 'activo = ?'];
    const params = [Number(req.body.rol_id), Number(req.body.area_id), req.body.nombre, req.body.apellido, req.body.email, activo];
    if (req.body.password) {
      campos.push('password_hash = ?');
      params.push(await bcrypt.hash(req.body.password, config.security.bcryptCost));
    }
    await pool.execute(`UPDATE usuarios SET ${campos.join(', ')} WHERE id = ?`, [...params, u.id]);

    // Al desactivar la cuenta, cambiar su perfil o su contraseña se cierran sus
    // sesiones y conexiones en vivo (salvo la del propio administrador).
    if ((!activo && u.activo) || Number(req.body.rol_id) !== u.rol_id || req.body.password) {
      await sesiones.cerrarDe(u.id, u.id === req.session.user.id ? req.sessionID : null);
    }
    flash(req, 'ok', `Usuario ${req.body.email} actualizado.`);
    res.redirect('/admin/usuarios');
  } catch (err) {
    next(err);
  }
});

router.post('/usuarios/:id/desbloquear', async (req, res, next) => {
  try {
    const id = v.idDe(req.params.id);
    if (id) {
      await pool.execute('UPDATE usuarios SET bloqueado_hasta = NULL, intentos_fallidos = 0 WHERE id = ?', [id]);
    }
    flash(req, 'ok', 'Cuenta desbloqueada.');
    res.redirect('/admin/usuarios');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
