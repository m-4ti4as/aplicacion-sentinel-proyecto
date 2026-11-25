'use strict';

// Archivado de eventos de acceso antiguos (almacenamiento "frío").
//
// Exporta a archivos JSON Lines comprimidos (un archivo por mes) los eventos
// anteriores al corte y luego los elimina de MySQL en lotes. Los totales
// por día y hora se conservan en resumen_eventos_hora, de modo que los
// indicadores históricos no se pierden. Los archivos .jsonl.gz están listos
// para subirse a almacenamiento de objetos (Amazon S3, Google Cloud Storage)
// y consultarse con motores como BigQuery o Athena.
//
// Uso:
//   npm run eventos:archivar                  # eventos de hace más de 12 meses
//   npm run eventos:archivar -- --meses 6
//   npm run eventos:archivar -- --dias 45 --dir ./archivo
//   npm run eventos:archivar -- --simular     # solo informa, no exporta ni borra

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pool } = require('./pool');
const { waitForDb } = require('./init');

const LOTE = 5000;

function argumentos() {
  const a = process.argv.slice(2);
  const valor = (n) => {
    const i = a.indexOf(n);
    return i >= 0 ? a[i + 1] : undefined;
  };
  return {
    meses: Number(valor('--meses') || 12),
    dias: valor('--dias') ? Number(valor('--dias')) : null,
    dir: path.resolve(valor('--dir') || path.join(__dirname, '..', '..', 'archivo')),
    simular: a.includes('--simular'),
  };
}

function fechaCorte({ meses, dias }) {
  const hoy = new Date();
  if (dias) return new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - dias);
  // Por meses se corta al inicio del mes, para archivar meses completos.
  return new Date(hoy.getFullYear(), hoy.getMonth() - meses, 1);
}

const pad = (n) => String(n).padStart(2, '0');

async function main() {
  const opts = argumentos();
  const corte = fechaCorte(opts);
  await waitForDb();

  const [[info]] = await pool.query(
    'SELECT COUNT(*) AS n, MIN(creado_en) AS desde, MAX(creado_en) AS hasta FROM eventos_acceso WHERE creado_en < ?',
    [corte]
  );
  console.log(`[archivo] corte: ${corte.toLocaleString('es-CL')} · eventos a archivar: ${info.n}`);
  if (!info.n) return;
  if (opts.simular) {
    console.log(`[archivo] (simulación) rango ${info.desde.toLocaleString('es-CL')} → ${info.hasta.toLocaleString('es-CL')}`);
    return;
  }

  fs.mkdirSync(opts.dir, { recursive: true });
  const salidas = new Map(); // 'AAAA-MM' -> { gzip, cantidad, archivo }
  const salidaDe = (fecha) => {
    const clave = `${fecha.getFullYear()}-${pad(fecha.getMonth() + 1)}`;
    if (!salidas.has(clave)) {
      const archivo = path.join(opts.dir, `eventos-${clave}.jsonl.gz`);
      const gzip = zlib.createGzip({ level: 9 });
      const destino = fs.createWriteStream(archivo, { flags: 'a' });
      gzip.pipe(destino);
      salidas.set(clave, { gzip, destino, cantidad: 0, archivo });
    }
    return salidas.get(clave);
  };

  // 1) Exportar en lotes ordenados por id (paginación por cursor).
  let ultimo = 0;
  let exportados = 0;
  for (;;) {
    const [filas] = await pool.query(
      `SELECT ev.id, t.codigo AS tipo, ev.usuario_id, ev.email_intentado, ev.ip, ev.user_agent, ev.creado_en
         FROM eventos_acceso ev JOIN tipos_evento t ON t.id = ev.tipo_evento_id
        WHERE ev.creado_en < ? AND ev.id > ?
        ORDER BY ev.id LIMIT ?`,
      [corte, ultimo, LOTE]
    );
    if (!filas.length) break;
    for (const f of filas) {
      const s = salidaDe(f.creado_en);
      s.gzip.write(JSON.stringify({ ...f, creado_en: f.creado_en.toISOString() }) + '\n');
      s.cantidad++;
    }
    ultimo = filas[filas.length - 1].id;
    exportados += filas.length;
  }
  await Promise.all(
    [...salidas.values()].map(
      (s) => new Promise((ok, mal) => {
        // Se espera el cierre del archivo: recién ahí los datos están en disco
        // y es seguro borrarlos de la base.
        s.destino.on('close', ok);
        s.destino.on('error', mal);
        s.gzip.on('error', mal);
        s.gzip.end();
      })
    )
  );
  for (const s of salidas.values()) console.log(`[archivo] ${s.archivo}: ${s.cantidad} eventos`);

  // 2) Eliminar de la base en lotes pequeños (no bloquea la tabla por mucho tiempo).
  let borrados = 0;
  for (;;) {
    const [r] = await pool.query('DELETE FROM eventos_acceso WHERE creado_en < ? AND id <= ? ORDER BY id LIMIT ?', [corte, ultimo, LOTE]);
    borrados += r.affectedRows;
    if (r.affectedRows < LOTE) break;
  }
  console.log(`[archivo] exportados ${exportados}, eliminados ${borrados}. Los totales siguen en resumen_eventos_hora.`);
}

main()
  .catch((err) => {
    console.error('[archivo] error:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
