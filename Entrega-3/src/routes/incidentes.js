'use strict';

const express = require('express');

const catalogos = require('../services/catalogos');
const incidentes = require('../services/incidentes');
const { requireAuth, esAdmin, denegar } = require('../middleware/auth');
const { flash } = require('../middleware/locals');
const reglas = require('../validators');
const v = require('../utils/validacion');

const router = express.Router();

// ---------------------------------------------------------------------
// Listado con filtros (RF-07)
// ---------------------------------------------------------------------
router.get('/incidentes', requireAuth, async (req, res, next) => {
  try {
    const filtros = {
      estado: v.idDe(req.query.estado) || '',
      severidad: v.idDe(req.query.severidad) || '',
      q: String(req.query.q || '').trim().slice(0, 100),
    };
    const r = await incidentes.listar(req.session.user, filtros, v.idDe(req.query.pagina) || 1);
    res.render('incidentes/lista', {
      titulo: esAdmin(req) ? 'Incidentes' : 'Mis incidentes',
      ...r,
      filtros,
      estados: catalogos.get().estados,
      severidades: catalogos.get().severidades,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// Reporte de incidente - formulario de negocio 1 (RF-06)
// ---------------------------------------------------------------------
async function renderNuevo(req, res, { errores = {}, valores = {}, status = 200 } = {}) {
  const c = catalogos.get();
  res.status(status).render('incidentes/nuevo', {
    titulo: 'Reportar incidente',
    categorias: c.categorias,
    severidades: c.severidades,
    activos: await incidentes.activosPermitidos(req.session.user),
    errores,
    valores,
  });
}

router.get('/incidentes/nuevo', requireAuth, async (req, res, next) => {
  try {
    await renderNuevo(req, res);
  } catch (err) {
    next(err);
  }
});

router.post('/incidentes', requireAuth, reglas.incidente, async (req, res, next) => {
  try {
    const errores = { ...(await incidentes.validarNuevo(req.session.user, req.body)), ...(v.errores(req) || {}) };
    if (Object.keys(errores).length) {
      return renderNuevo(req, res, { errores, valores: req.body, status: 422 });
    }
    const { id, codigo } = await incidentes.crear(req.session.user, req.body);
    flash(req, 'ok', `Incidente ${codigo} reportado. El equipo de seguridad te mantendrá informado.`);
    res.redirect(`/incidentes/${id}`);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// Detalle y línea de tiempo (RF-08)
// ---------------------------------------------------------------------
async function renderDetalle(req, res, inc, { errores = {}, valores = {}, status = 200 } = {}) {
  res.status(status).render('incidentes/detalle', {
    titulo: inc.codigo,
    inc,
    seguimientos: await incidentes.seguimientos(inc.id),
    sla: incidentes.sla(inc),
    estados: catalogos.get().estados,
    severidades: catalogos.get().severidades,
    admins: esAdmin(req) ? await incidentes.administradores() : [],
    errores,
    valores,
  });
}

/**
 * Carga el incidente y aplica la autorización a nivel de registro.
 * Devuelve el incidente, null si no existe o false si ya respondió 403.
 */
async function cargar(req, res) {
  const id = v.idDe(req.params.id);
  const inc = id && (await incidentes.obtener(id));
  if (!inc) return null;
  if (!incidentes.puedeVer(req.session.user, inc)) {
    await denegar(req, res);
    return false;
  }
  return inc;
}

router.get('/incidentes/:id', requireAuth, async (req, res, next) => {
  try {
    const inc = await cargar(req, res);
    if (inc === null) return next();
    if (!inc) return;
    await renderDetalle(req, res, inc);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// Seguimiento - formulario de negocio 3 (RF-09)
// ---------------------------------------------------------------------
router.post('/incidentes/:id/seguimientos', requireAuth, reglas.seguimiento, async (req, res, next) => {
  try {
    const inc = await cargar(req, res);
    if (inc === null) return next();
    if (!inc) return;
    const { errores, cambios } = await incidentes.validarSeguimiento(req.session.user, inc, req.body);
    Object.assign(errores, v.errores(req) || {});
    if (Object.keys(errores).length) {
      return renderDetalle(req, res, inc, { errores, valores: req.body, status: 422 });
    }
    await incidentes.registrarSeguimiento(req.session.user, inc, req.body.comentario, cambios);
    flash(req, 'ok', 'Seguimiento registrado.');
    res.redirect(`/incidentes/${inc.id}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
