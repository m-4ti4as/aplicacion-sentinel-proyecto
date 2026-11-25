'use strict';

// Indicadores y series del panel (RF-16, RF-18).
// Las series por día y por hora se leen de resumen_eventos_hora (agregado
// precalculado), de modo que el costo del panel no crece con el volumen de
// eventos. Solo el ranking de IPs y los fallos de las últimas 24 h consultan
// la tabla de eventos, apoyados en el índice cubriente
// (tipo_evento_id, creado_en, ip, email_intentado): MySQL no lee las filas.

const { one, all } = require('../db/pool');
const catalogos = require('./catalogos');
const { claveDia } = require('./resumen');

const DIA = 86400000;
const pad = (n) => String(n).padStart(2, '0');
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
const inicioDia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

async function admin() {
  const c = catalogos.get();
  const ahora = new Date();
  const ok = c.tipoEventoId.LOGIN_OK;
  const fallido = c.tipoEventoId.LOGIN_FALLIDO;
  const hoy = inicioDia(ahora);
  const desde7 = claveDia(new Date(hoy - 6 * DIA));
  const desde14 = new Date(hoy - 13 * DIA);
  const desde30 = claveDia(new Date(hoy - 29 * DIA));
  const hace24h = new Date(ahora - DIA);
  const hace30d = new Date(ahora - 30 * DIA);

  const [kEventos, kFallos, kAlertas, kAbiertos, kBloqueadas, diarios, porHora, topIps, porCategoria, alertas, resp] =
    await Promise.all([
      one('SELECT COALESCE(SUM(total), 0) AS n FROM resumen_eventos_hora WHERE dia >= ?', [desde7]),
      one('SELECT COUNT(*) AS n FROM eventos_acceso WHERE tipo_evento_id = ? AND creado_en >= ?', [fallido, hace24h]),
      one('SELECT COUNT(*) AS n FROM alertas WHERE revisada = 0'),
      one('SELECT COUNT(*) AS n FROM incidentes i JOIN estados_incidente e ON e.id = i.estado_id WHERE e.es_final = 0'),
      one('SELECT COUNT(*) AS n FROM usuarios WHERE bloqueado_hasta > ?', [ahora]),
      all(
        `SELECT dia, tipo_evento_id AS tipo, SUM(total) AS n
           FROM resumen_eventos_hora
          WHERE tipo_evento_id IN (?, ?) AND dia >= ?
          GROUP BY dia, tipo_evento_id`,
        [ok, fallido, claveDia(desde14)]
      ),
      all(
        `SELECT hora, SUM(total) AS n FROM resumen_eventos_hora
          WHERE tipo_evento_id = ? AND dia >= ? GROUP BY hora`,
        [fallido, desde30]
      ),
      // Indicador típico de credential stuffing: IPs con más fallos y cuentas distintas atacadas.
      all(
        `SELECT ip, COUNT(*) AS fallos, COUNT(DISTINCT email_intentado) AS cuentas
           FROM eventos_acceso
          WHERE tipo_evento_id = ? AND creado_en >= ?
          GROUP BY ip ORDER BY fallos DESC LIMIT 8`,
        [fallido, hace30d]
      ),
      all(
        `SELECT c.nombre, COUNT(i.id) AS n
           FROM categorias_incidente c LEFT JOIN incidentes i ON i.categoria_id = c.id
          GROUP BY c.id, c.nombre ORDER BY n DESC`
      ),
      all(
        `SELECT a.id, a.regla, a.descripcion, a.ip, a.creado_en, a.revisada, s.nombre AS severidad
           FROM alertas a JOIN severidades s ON s.id = a.severidad_id
          WHERE a.revisada = 0
          ORDER BY a.creado_en DESC LIMIT 6`
      ),
      respuesta(new Date(ahora - 90 * DIA), ahora),
    ]);

  // Serie de 14 días completa (incluye días sin eventos).
  const mapa = new Map(diarios.map((r) => [`${claveDia(new Date(r.dia))}|${r.tipo}`, Number(r.n)]));
  const diario = { etiquetas: [], exitosos: [], fallidos: [] };
  for (let i = 0; i < 14; i++) {
    const d = new Date(desde14.getFullYear(), desde14.getMonth(), desde14.getDate() + i);
    diario.etiquetas.push(`${pad(d.getDate())}-${MESES[d.getMonth()]}`);
    diario.exitosos.push(mapa.get(`${claveDia(d)}|${ok}`) || 0);
    diario.fallidos.push(mapa.get(`${claveDia(d)}|${fallido}`) || 0);
  }
  const horas = Array.from({ length: 24 }, () => 0);
  porHora.forEach((r) => (horas[r.hora] = Number(r.n)));

  return {
    kpi: {
      eventos7d: Number(kEventos.n),
      fallos24h: kFallos.n,
      alertasPendientes: kAlertas.n,
      incidentesAbiertos: kAbiertos.n,
      cuentasBloqueadas: kBloqueadas.n,
    },
    graficos: {
      diario,
      horas,
      categorias: { etiquetas: porCategoria.map((r) => r.nombre), valores: porCategoria.map((r) => Number(r.n)) },
    },
    topIps,
    alertas,
    respuesta: resp,
  };
}

/**
 * Tiempos de gestión de los incidentes reportados desde `desde`. La primera
 * respuesta es el primer cambio de estado que registra el equipo de seguridad;
 * el SLA de la severidad es el plazo comprometido para esa primera respuesta.
 */
async function respuesta(desde, ahora = new Date()) {
  const r = await one(
    `SELECT COUNT(*) AS total,
            SUM(p.fecha IS NOT NULL) AS respondidos,
            AVG(TIMESTAMPDIFF(MINUTE, i.creado_en, p.fecha)) AS min_respuesta,
            AVG(TIMESTAMPDIFF(MINUTE, i.creado_en, i.cerrado_en)) AS min_resolucion,
            SUM(p.fecha IS NOT NULL AND TIMESTAMPDIFF(MINUTE, i.creado_en, p.fecha) <= s.sla_horas * 60) AS en_plazo,
            SUM(p.fecha IS NULL AND TIMESTAMPDIFF(MINUTE, i.creado_en, ?) > s.sla_horas * 60) AS vencidos
       FROM incidentes i
       JOIN severidades s ON s.id = i.severidad_id
       LEFT JOIN (SELECT incidente_id, MIN(creado_en) AS fecha
                    FROM seguimientos_incidente
                   WHERE estado_anterior_id IS NOT NULL
                   GROUP BY incidente_id) p ON p.incidente_id = i.id
      WHERE i.creado_en >= ?`,
    [ahora, desde]
  );
  const horas = (min) => (min === null || min === undefined ? null : Math.round((Number(min) / 60) * 10) / 10);
  const evaluables = Number(r.respondidos || 0) + Number(r.vencidos || 0);
  return {
    incidentes: Number(r.total || 0),
    primeraRespuestaHoras: horas(r.min_respuesta),
    resolucionHoras: horas(r.min_resolucion),
    cumplimientoSla: evaluables ? Math.round((Number(r.en_plazo || 0) / evaluables) * 100) : null,
  };
}

async function colaborador(userId) {
  const [resumen, recientes, accesos] = await Promise.all([
    one(
      `SELECT COUNT(*) AS total, SUM(e.es_final = 0) AS en_curso, SUM(e.es_final = 1) AS cerrados
         FROM incidentes i JOIN estados_incidente e ON e.id = i.estado_id
        WHERE i.reportado_por = ?`,
      [userId]
    ),
    all(
      `SELECT i.id, i.codigo, i.titulo, i.creado_en, s.nombre AS severidad, e.nombre AS estado, e.es_final
         FROM incidentes i
         JOIN severidades s ON s.id = i.severidad_id
         JOIN estados_incidente e ON e.id = i.estado_id
        WHERE i.reportado_por = ?
        ORDER BY i.creado_en DESC LIMIT 5`,
      [userId]
    ),
    all(
      `SELECT t.codigo, t.descripcion, ev.ip, ev.creado_en
         FROM eventos_acceso ev JOIN tipos_evento t ON t.id = ev.tipo_evento_id
        WHERE ev.usuario_id = ?
        ORDER BY ev.creado_en DESC LIMIT 6`,
      [userId]
    ),
  ]);
  return {
    resumen: {
      total: Number(resumen.total || 0),
      enCurso: Number(resumen.en_curso || 0),
      cerrados: Number(resumen.cerrados || 0),
    },
    recientes,
    accesos,
  };
}

module.exports = { admin, colaborador, respuesta };
