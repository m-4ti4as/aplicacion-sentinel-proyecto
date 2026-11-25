'use strict';

// Motor de detección de anomalías (RF-13). Las cuatro reglas se evalúan
// en línea, en el momento de cada intento de inicio de sesión, apoyándose
// en los índices compuestos de eventos_acceso.

const { pool, one } = require('../db/pool');
const config = require('../config');
const catalogos = require('./catalogos');
const tiempoReal = require('./tiempoReal');

const minutosAtras = (min, desde = new Date()) => new Date(desde.getTime() - min * 60 * 1000);

async function crearAlerta({ regla, descripcion, severidad, usuarioId = null, ip = null, fecha = new Date() }) {
  const sevId = catalogos.get().severidadId[severidad];
  const desc = descripcion.slice(0, 255);
  const [r] = await pool.execute(
    `INSERT INTO alertas (regla, descripcion, severidad_id, usuario_id, ip, creado_en)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [regla, desc, sevId, usuarioId, ip, fecha]
  );
  // Aviso inmediato en los paneles de los administradores conectados.
  tiempoReal.aAdmins('alerta:nueva', {
    id: r.insertId,
    regla,
    descripcion: desc,
    severidad,
    ip,
    fecha: fecha.toISOString(),
  });
}

/**
 * Regla 1 - FUERZA_BRUTA: la cuenta alcanzó el máximo de intentos fallidos
 * consecutivos. La llama el servicio de autenticación al bloquear la cuenta.
 */
async function alertaFuerzaBruta(usuario, ip) {
  await crearAlerta({
    regla: 'FUERZA_BRUTA',
    descripcion: `Cuenta ${usuario.email} bloqueada ${config.security.bloqueoMinutos} min tras ${config.security.maxIntentos} intentos fallidos desde ${ip}`,
    severidad: 'Alta',
    usuarioId: usuario.id,
    ip,
  });
}

/**
 * Regla 2 - IP_SOSPECHOSA: una misma IP acumula >= 10 fallos contra >= 3
 * cuentas distintas en 15 minutos (credential stuffing / password spraying).
 * Se genera como máximo una alerta por IP en cada ventana.
 */
async function evaluarIpSospechosa(ip, ahora = new Date()) {
  const d = config.deteccion;
  const desde = minutosAtras(d.ventanaMinutos, ahora);
  const tipoFallido = catalogos.get().tipoEventoId.LOGIN_FALLIDO;
  const r = await one(
    `SELECT COUNT(*) AS fallos, COUNT(DISTINCT email_intentado) AS cuentas
       FROM eventos_acceso
      WHERE ip = ? AND tipo_evento_id = ? AND creado_en >= ?`,
    [ip, tipoFallido, desde]
  );
  if (r.fallos < d.ipSospechosaFallos || r.cuentas < d.ipSospechosaCuentas) return false;

  const previa = await one(
    `SELECT id FROM alertas WHERE regla = 'IP_SOSPECHOSA' AND ip = ? AND creado_en >= ? LIMIT 1`,
    [ip, desde]
  );
  if (previa) return false;

  await crearAlerta({
    regla: 'IP_SOSPECHOSA',
    descripcion: `La IP ${ip} acumula ${r.fallos} fallos contra ${r.cuentas} cuentas en ${d.ventanaMinutos} min`,
    severidad: 'Crítica',
    ip,
    fecha: ahora,
  });
  return true;
}

/**
 * Regla 3 - IP_NUEVA: inicio de sesión exitoso desde una IP que el usuario
 * no utilizó en los últimos 90 días. No aplica al primer inicio de sesión.
 * Debe consultarse ANTES de registrar el LOGIN_OK actual.
 */
async function esIpNueva(usuarioId, ip, ahora = new Date(), db = pool) {
  const desde = new Date(ahora.getTime() - config.deteccion.ipNuevaDias * 86400000);
  const tipoOk = catalogos.get().tipoEventoId.LOGIN_OK;
  const [[r]] = await db.execute(
    `SELECT COUNT(*) AS total, SUM(ip = ?) AS desde_ip
       FROM eventos_acceso
      WHERE usuario_id = ? AND tipo_evento_id = ? AND creado_en >= ?`,
    [ip, usuarioId, tipoOk, desde]
  );
  return Number(r.total || 0) > 0 && Number(r.desde_ip || 0) === 0;
}

function alertaIpNueva(usuario, ip, ahora = new Date()) {
  return crearAlerta({
    regla: 'IP_NUEVA',
    descripcion: `Inicio de sesión de ${usuario.email} desde una IP no utilizada en ${config.deteccion.ipNuevaDias} días (${ip})`,
    severidad: 'Media',
    usuarioId: usuario.id,
    ip,
    fecha: ahora,
  });
}

/** Regla 4 - FUERA_HORARIO: inicio de sesión exitoso fuera del horario laboral. */
async function evaluarFueraHorario(usuario, ip, ahora = new Date()) {
  const h = ahora.getHours();
  const { horarioInicio, horarioFin } = config.deteccion;
  if (h >= horarioInicio && h < horarioFin) return false;
  const hh = String(h).padStart(2, '0') + ':' + String(ahora.getMinutes()).padStart(2, '0');
  await crearAlerta({
    regla: 'FUERA_HORARIO',
    descripcion: `Inicio de sesión de ${usuario.email} fuera del horario laboral (${hh} h)`,
    severidad: 'Baja',
    usuarioId: usuario.id,
    ip,
    fecha: ahora,
  });
  return true;
}

module.exports = { alertaFuerzaBruta, evaluarIpSospechosa, esIpNueva, alertaIpNueva, evaluarFueraHorario, crearAlerta };
