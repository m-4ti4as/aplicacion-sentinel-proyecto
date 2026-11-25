'use strict';

// Prueba de volumen del panel (RNF-06, RNF-11). Trabaja sobre una base APARTE,
// cuyo nombre debe terminar en "_vol", con los datos de demostración cargados:
// replica los eventos hasta llegar al tamaño indicado y compara las consultas
// del panel sobre la tabla de eventos y sobre el resumen agregado.
//
//   DB_NAME=sentinel_vol npm run test:volumen -- 500000 1000000

const config = require('../src/config');
const { pool, one, all } = require('../src/db/pool');
const catalogos = require('../src/services/catalogos');
const metricas = require('../src/services/metricas');
const monitoreo = require('../src/services/monitoreo');
const { reconstruir, claveDia } = require('../src/services/resumen');

if (!config.db.database.endsWith('_vol')) {
  console.error('Esta prueba agrega filas: usa una base cuyo nombre termine en "_vol".');
  process.exit(2);
}
const objetivos = process.argv.slice(2).map(Number).filter(Boolean);

/** Mediana de 7 ejecuciones, en ms. */
async function medir(fn) {
  const t = [];
  for (let i = 0; i < 8; i++) {
    const a = process.hrtime.bigint();
    await fn();
    if (i) t.push(Number(process.hrtime.bigint() - a) / 1e6); // la primera calienta la caché
  }
  return t.sort((x, y) => x - y)[3].toFixed(1);
}

async function informe() {
  const c = catalogos.get().tipoEventoId;
  const { n, max } = await one('SELECT COUNT(*) AS n, MAX(id) AS max FROM eventos_acceso');
  const r = (await one('SELECT COUNT(*) AS n FROM resumen_eventos_hora')).n;
  const desde = claveDia(new Date(Date.now() - 13 * 86400000));
  const directa = await medir(() =>
    all('SELECT DATE(creado_en) AS dia, tipo_evento_id AS tipo, COUNT(*) AS n FROM eventos_acceso WHERE tipo_evento_id IN (?, ?) AND creado_en >= ? GROUP BY DATE(creado_en), tipo_evento_id', [c.LOGIN_OK, c.LOGIN_FALLIDO, new Date(desde + 'T00:00:00')]));
  const agregada = await medir(() =>
    all('SELECT dia, tipo_evento_id AS tipo, SUM(total) AS n FROM resumen_eventos_hora WHERE tipo_evento_id IN (?, ?) AND dia >= ? GROUP BY dia, tipo_evento_id', [c.LOGIN_OK, c.LOGIN_FALLIDO, desde]));
  const panel = await medir(() => metricas.admin());
  const cursorIni = await medir(() => monitoreo.eventosPorCursor({}, null, 50));
  const cursorFin = await medir(() => monitoreo.eventosPorCursor({}, Math.floor(max * 0.02), 50));
  const ultima = Math.floor((n * 0.98) / 50);
  const offsetFin = await medir(() => all('SELECT ev.id, t.codigo FROM eventos_acceso ev JOIN tipos_evento t ON t.id = ev.tipo_evento_id ORDER BY ev.id DESC LIMIT 50 OFFSET ' + ultima * 50));
  console.log(JSON.stringify({ eventos: n, filasResumen: r, serie14d_directa_ms: directa, serie14d_resumen_ms: agregada, panel_completo_ms: panel, cursor_inicio_ms: cursorIni, cursor_98pct_ms: cursorFin, offset_98pct_ms: offsetFin }));
}

(async () => {
  await catalogos.cargar();
  await informe();
  for (const objetivo of objetivos) {
    let n = Number((await one('SELECT COUNT(*) AS n FROM eventos_acceso')).n);
    while (n < objetivo) {
      const lote = Math.min(n, objetivo - n, 100000);
      await pool.query(
        `INSERT INTO eventos_acceso (tipo_evento_id, usuario_id, email_intentado, ip, user_agent, creado_en)
         SELECT tipo_evento_id, usuario_id, email_intentado, ip, user_agent, creado_en FROM eventos_acceso ORDER BY id LIMIT ${lote}`
      );
      n += lote;
    }
    await pool.query('ANALYZE TABLE eventos_acceso');
    await reconstruir(pool);
    await informe();
  }
})()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
