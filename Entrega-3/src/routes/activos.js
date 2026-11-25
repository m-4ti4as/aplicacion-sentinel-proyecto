'use strict';

const express = require('express');

const catalogos = require('../services/catalogos');
const activos = require('../services/activos');
const { requireAuth, requireAdmin, esAdmin } = require('../middleware/auth');
const { flash } = require('../middleware/locals');
const reglas = require('../validators');
const v = require('../utils/validacion');

const router = express.Router();

// ---------------------------------------------------------------------
// Inventario (RF-11): el administrador ve todo; el colaborador, lo suyo.
// ---------------------------------------------------------------------
router.get('/activos', requireAuth, async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 100);
    const r = await activos.listar(req.session.user, q, v.idDe(req.query.pagina) || 1);
    res.render('activos/lista', { titulo: esAdmin(req) ? 'Inventario de activos' : 'Mis activos', ...r, q });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// Registro y edición - formulario de negocio 2 (RF-10)
// ---------------------------------------------------------------------
async function renderForm(res, { activo = null, errores = {}, valores = {}, status = 200 }) {
  const c = catalogos.get();
  res.status(status).render('activos/form', {
    titulo: activo ? 'Editar activo' : 'Registrar activo',
    activo,
    tipos: c.tiposActivo,
    areas: c.areas,
    criticidades: catalogos.CRITICIDADES,
    usuarios: await activos.usuariosActivos(),
    errores,
    valores,
  });
}

router.get('/activos/nuevo', requireAdmin, async (req, res, next) => {
  try {
    await renderForm(res, { valores: { criticidad: 'MEDIA' } });
  } catch (err) {
    next(err);
  }
});

router.post('/activos', requireAdmin, reglas.activo, async (req, res, next) => {
  try {
    const { errores, responsableId } = await activos.validar(req.body);
    Object.assign(errores, v.errores(req) || {});
    if (Object.keys(errores).length) return renderForm(res, { errores, valores: req.body, status: 422 });
    await activos.crear(req.body, responsableId);
    flash(req, 'ok', `Activo «${req.body.nombre}» registrado.`);
    res.redirect('/activos');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return renderForm(res, { errores: { identificador: 'Ya existe un activo con este identificador' }, valores: req.body, status: 422 });
    }
    next(err);
  }
});

router.get('/activos/:id/editar', requireAdmin, async (req, res, next) => {
  try {
    const activo = await activos.obtener(v.idDe(req.params.id) || 0);
    if (!activo) return next();
    await renderForm(res, { activo, valores: activo });
  } catch (err) {
    next(err);
  }
});

router.post('/activos/:id', requireAdmin, reglas.activo, async (req, res, next) => {
  try {
    const activo = await activos.obtener(v.idDe(req.params.id) || 0);
    if (!activo) return next();
    const { errores, responsableId } = await activos.validar(req.body, activo.id);
    Object.assign(errores, v.errores(req) || {});
    if (Object.keys(errores).length) return renderForm(res, { activo, errores, valores: req.body, status: 422 });
    await activos.actualizar(activo.id, req.body, responsableId);
    flash(req, 'ok', `Activo «${req.body.nombre}» actualizado.`);
    res.redirect('/activos');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return renderForm(res, { errores: { identificador: 'Ya existe un activo con este identificador' }, valores: req.body, status: 422 });
    }
    next(err);
  }
});

module.exports = router;
