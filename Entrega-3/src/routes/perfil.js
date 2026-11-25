'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { body } = require('express-validator');

const config = require('../config');
const { pool, one } = require('../db/pool');
const catalogos = require('../services/catalogos');
const eventos = require('../services/eventos');
const sesiones = require('../services/sesiones');
const { requireAuth } = require('../middleware/auth');
const { flash } = require('../middleware/locals');
const v = require('../utils/validacion');

const router = express.Router();

async function renderPerfil(req, res, { errores = {}, valores = null, status = 200 } = {}) {
  const u = await one(
    `SELECT u.nombre, u.apellido, u.email, u.area_id, u.ultimo_login, r.nombre AS rol
       FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = ?`,
    [req.session.user.id]
  );
  res.status(status).render('perfil/index', {
    titulo: 'Mi perfil',
    perfil: u,
    areas: catalogos.get().areas,
    errores,
    valores: valores || u,
  });
}

router.get('/perfil', requireAuth, async (req, res, next) => {
  try {
    await renderPerfil(req, res);
  } catch (err) {
    next(err);
  }
});

// Edición de datos (RF-05)
router.post(
  '/perfil',
  requireAuth,
  [
    v.reglaNombre('nombre', 'El nombre'),
    v.reglaNombre('apellido', 'El apellido'),
    body('area_id')
      .custom((val) => catalogos.get().areas.some((a) => a.id === Number(val)))
      .withMessage('Selecciona tu área'),
  ],
  async (req, res, next) => {
    try {
      const errores = v.errores(req);
      if (errores) return renderPerfil(req, res, { errores, valores: req.body, status: 422 });
      await pool.execute('UPDATE usuarios SET nombre = ?, apellido = ?, area_id = ? WHERE id = ?', [
        req.body.nombre,
        req.body.apellido,
        Number(req.body.area_id),
        req.session.user.id,
      ]);
      Object.assign(req.session.user, {
        nombre: req.body.nombre,
        apellido: req.body.apellido,
        areaId: Number(req.body.area_id),
      });
      flash(req, 'ok', 'Datos actualizados.');
      res.redirect('/perfil');
    } catch (err) {
      next(err);
    }
  }
);

// Cambio de contraseña verificando la actual (RF-05)
router.post(
  '/perfil/password',
  requireAuth,
  [
    body('actual').notEmpty().withMessage('Ingresa tu contraseña actual'),
    v.reglaPassword('nueva'),
    v.reglaConfirmar('nueva2', 'nueva'),
  ],
  async (req, res, next) => {
    try {
      const errores = v.errores(req) || {};
      const u = await one('SELECT password_hash FROM usuarios WHERE id = ?', [req.session.user.id]);
      if (!errores.actual && !(await bcrypt.compare(String(req.body.actual), u.password_hash))) {
        errores.actual = 'La contraseña actual no es correcta';
      }
      if (!errores.nueva && req.body.nueva === req.body.actual) {
        errores.nueva = 'La nueva contraseña debe ser distinta de la actual';
      }
      if (Object.keys(errores).length) return renderPerfil(req, res, { errores, status: 422 });

      const hash = await bcrypt.hash(req.body.nueva, config.security.bcryptCost);
      await pool.execute('UPDATE usuarios SET password_hash = ? WHERE id = ?', [hash, req.session.user.id]);
      await eventos.registrar('PASSWORD_CAMBIADA', { req, usuarioId: req.session.user.id, email: req.session.user.email });
      await sesiones.cerrarDe(req.session.user.id, req.sessionID);
      flash(req, 'ok', 'Contraseña actualizada. Se cerraron tus otras sesiones.');
      res.redirect('/perfil');
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
