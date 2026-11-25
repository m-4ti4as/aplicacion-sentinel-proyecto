'use strict';

// Recalcula resumen_eventos_hora desde los eventos almacenados.
// Uso: npm run resumen:reconstruir

const { pool } = require('./pool');
const { waitForDb } = require('./init');
const { reconstruir } = require('../services/resumen');

(async () => {
  await waitForDb();
  const filas = await reconstruir(pool);
  console.log(`[resumen] ${filas} filas agregadas recalculadas.`);
})()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
