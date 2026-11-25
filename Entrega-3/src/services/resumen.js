'use strict';

// Mantención de la tabla agregada resumen_eventos_hora.

const pad = (n) => String(n).padStart(2, '0');
const claveDia = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Suma 1 al contador de la hora y tipo del evento (actualización en línea). */
async function incrementar(db, tipoEventoId, fecha) {
  await db.execute(
    `INSERT INTO resumen_eventos_hora (dia, hora, tipo_evento_id, total) VALUES (?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE total = total + 1`,
    [claveDia(fecha), fecha.getHours(), tipoEventoId]
  );
}

/**
 * Recalcula el resumen desde los eventos que siguen en eventos_acceso.
 * Solo toca los días que aún tienen eventos, de modo que los totales de
 * los días ya archivados se conservan.
 */
async function reconstruir(db) {
  const [[r]] = await db.query('SELECT MIN(creado_en) AS desde FROM eventos_acceso');
  if (!r.desde) return 0;
  const desde = claveDia(new Date(r.desde));
  await db.query('DELETE FROM resumen_eventos_hora WHERE dia >= ?', [desde]);
  const [res] = await db.query(
    `INSERT INTO resumen_eventos_hora (dia, hora, tipo_evento_id, total)
     SELECT DATE(creado_en), HOUR(creado_en), tipo_evento_id, COUNT(*)
       FROM eventos_acceso
      WHERE creado_en >= ?
      GROUP BY DATE(creado_en), HOUR(creado_en), tipo_evento_id`,
    [desde]
  );
  return res.affectedRows;
}

module.exports = { incrementar, reconstruir, claveDia };
