'use strict';

// API REST v1 de SentinelData. Reutiliza los mismos servicios y reglas de
// validación que la interfaz web, por lo que ambos canales aplican
// exactamente los mismos controles de seguridad y de negocio.

const express = require('express');
const { body } = require('express-validator');

const config = require('../config');
const catalogos = require('../services/catalogos');
const autenticacion = require('../services/autenticacion');
const tokens = require('../services/tokens');
const incidentes = require('../services/incidentes');
const activos = require('../services/activos');
const monitoreo = require('../services/monitoreo');
const metricas = require('../services/metricas');
const reglas = require('../validators');
const { reglaEmail } = require('../utils/validacion');
const { problema, erroresValidacion, responderValidacion, autenticar, soloAdmin, denegar, ruta, entero } = require('./comun');

const router = express.Router();

const paginacion = (r, porPagina) => ({ pagina: r.pagina, por_pagina: porPagina, total: r.total, paginas: r.paginas });

// ---------------------------------------------------------------------
// Autenticación
// ---------------------------------------------------------------------
router.post(
  '/auth/token',
  [reglaEmail('email'), body('password').isString().notEmpty().withMessage('Ingresa tu contraseña')],
  ruta(async (req, res) => {
    if (erroresValidacion(req)) {
      return problema(res, 401, 'Credenciales inválidas', autenticacion.MSG_LOGIN);
    }
    const r = await autenticacion.autenticar(req.body.email, req.body.password, req);
    if (!r.ok) {
      return problema(res, r.status, r.status === 423 ? 'Cuenta bloqueada' : 'Credenciales inválidas', r.mensaje);
    }
    res.set('Cache-Control', 'no-store');
    res.json({
      access_token: tokens.firmar(r.usuario),
      token_type: 'Bearer',
      expires_in: config.jwt.minutos * 60,
      usuario: { id: r.usuario.id, nombre: r.usuario.nombre, apellido: r.usuario.apellido, email: r.usuario.email, rol: r.usuario.rol },
    });
  })
);

// Todo lo que sigue exige autenticación.
router.use(autenticar);

router.get('/me', (req, res) => {
  const u = req.user;
  res.json({ datos: { id: u.id, nombre: u.nombre, apellido: u.apellido, email: u.email, rol: u.rol, area_id: u.areaId } });
});

router.get('/catalogos', (req, res) => {
  const c = catalogos.get();
  res.json({
    datos: {
      categorias: c.categorias,
      severidades: c.severidades,
      estados: c.estados,
      tipos_activo: c.tiposActivo,
      areas: c.areas,
      tipos_evento: c.tiposEvento,
      criticidades: catalogos.CRITICIDADES,
    },
  });
});

// ---------------------------------------------------------------------
// Incidentes
// ---------------------------------------------------------------------
router.get(
  '/incidentes',
  ruta(async (req, res) => {
    const porPagina = entero(req.query.por_pagina, 20, 100);
    const filtros = {
      estado: entero(req.query.estado, ''),
      severidad: entero(req.query.severidad, ''),
      q: String(req.query.q || '').trim().slice(0, 100),
    };
    const r = await incidentes.listar(req.user, filtros, entero(req.query.pagina, 1), porPagina);
    res.json({ datos: r.filas, paginacion: paginacion(r, porPagina) });
  })
);

router.post(
  '/incidentes',
  reglas.incidente,
  ruta(async (req, res) => {
    const errores = erroresValidacion(req, await incidentes.validarNuevo(req.user, req.body));
    if (errores) return responderValidacion(res, errores);
    const { id, codigo } = await incidentes.crear(req.user, req.body);
    res.status(201).location(`/api/v1/incidentes/${id}`).json({ datos: { id, codigo } });
  })
);

async function cargarIncidente(req, res) {
  const id = entero(req.params.id, null);
  const inc = id && (await incidentes.obtener(id));
  if (!inc) {
    problema(res, 404, 'No encontrado', 'El incidente no existe.');
    return null;
  }
  // Autorización a nivel de registro: el colaborador solo accede a lo que reportó.
  if (!incidentes.puedeVer(req.user, inc)) {
    await denegar(req, res);
    return null;
  }
  return inc;
}

router.get(
  '/incidentes/:id',
  ruta(async (req, res) => {
    const inc = await cargarIncidente(req, res);
    if (!inc) return;
    res.json({ datos: { ...inc, sla: incidentes.sla(inc), seguimientos: await incidentes.seguimientos(inc.id) } });
  })
);

router.post(
  '/incidentes/:id/seguimientos',
  reglas.seguimiento,
  ruta(async (req, res) => {
    const inc = await cargarIncidente(req, res);
    if (!inc) return;
    const { errores, cambios } = await incidentes.validarSeguimiento(req.user, inc, req.body);
    const todos = erroresValidacion(req, errores);
    if (todos) return responderValidacion(res, todos);
    await incidentes.registrarSeguimiento(req.user, inc, req.body.comentario.trim(), cambios);
    const act = await incidentes.obtener(inc.id);
    res.status(201).json({ datos: { id: act.id, codigo: act.codigo, estado: act.estado, severidad: act.severidad } });
  })
);

// ---------------------------------------------------------------------
// Activos
// ---------------------------------------------------------------------
router.get(
  '/activos',
  ruta(async (req, res) => {
    const porPagina = entero(req.query.por_pagina, 20, 100);
    const r = await activos.listar(req.user, String(req.query.q || '').trim().slice(0, 100), entero(req.query.pagina, 1), porPagina);
    res.json({ datos: r.filas, paginacion: paginacion(r, porPagina) });
  })
);

router.post(
  '/activos',
  soloAdmin,
  reglas.activo,
  ruta(async (req, res) => {
    const { errores, responsableId } = await activos.validar(req.body);
    const todos = erroresValidacion(req, errores);
    if (todos) return responderValidacion(res, todos);
    const id = await activos.crear(req.body, responsableId);
    res.status(201).location(`/api/v1/activos/${id}`).json({ datos: await activos.obtener(id) });
  })
);

router.put(
  '/activos/:id',
  soloAdmin,
  reglas.activo,
  ruta(async (req, res) => {
    const activo = await activos.obtener(entero(req.params.id, 0));
    if (!activo) return problema(res, 404, 'No encontrado', 'El activo no existe.');
    const { errores, responsableId } = await activos.validar(req.body, activo.id);
    const todos = erroresValidacion(req, errores);
    if (todos) return responderValidacion(res, todos);
    await activos.actualizar(activo.id, req.body, responsableId);
    res.json({ datos: await activos.obtener(activo.id) });
  })
);

// ---------------------------------------------------------------------
// Monitoreo (solo administradores)
// ---------------------------------------------------------------------
router.get(
  '/alertas',
  soloAdmin,
  ruta(async (req, res) => {
    const porPagina = entero(req.query.por_pagina, 20, 100);
    const r = await monitoreo.listarAlertas({
      pendientes: req.query.estado !== 'todas',
      pagina: entero(req.query.pagina, 1),
      porPagina,
    });
    res.json({ datos: r.filas, paginacion: paginacion(r, porPagina) });
  })
);

router.patch(
  '/alertas/:id',
  soloAdmin,
  [body('revisada').isBoolean({ strict: true }).withMessage('Envía "revisada": true').bail().equals('true').withMessage('Solo se admite "revisada": true')],
  ruta(async (req, res) => {
    const errores = erroresValidacion(req);
    if (errores) return responderValidacion(res, errores);
    const id = entero(req.params.id, null);
    const ok = id && (await monitoreo.revisarAlerta(id, req.user));
    if (!ok) return problema(res, 404, 'No encontrado', 'La alerta no existe o ya estaba revisada.');
    res.json({ datos: { id, revisada: true } });
  })
);

router.get(
  '/eventos',
  soloAdmin,
  ruta(async (req, res) => {
    const fecha = (x) => (/^\d{4}-\d{2}-\d{2}$/.test(x || '') ? x : '');
    const filtros = {
      tipo: entero(req.query.tipo, ''),
      email: String(req.query.email || '').trim().toLowerCase().slice(0, 190),
      ip: String(req.query.ip || '').trim().slice(0, 45),
      desde: fecha(req.query.desde),
      hasta: fecha(req.query.hasta),
    };
    const limite = entero(req.query.limite, 50, 200);
    const r = await monitoreo.eventosPorCursor(filtros, entero(req.query.antes_de, null), limite);
    res.json({ datos: r.filas, siguiente: r.siguiente, limite });
  })
);

router.get(
  '/metricas/panel',
  soloAdmin,
  ruta(async (req, res) => {
    res.json({ datos: await metricas.admin() });
  })
);

module.exports = router;
