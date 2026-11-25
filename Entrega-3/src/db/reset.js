'use strict';

// Borra todas las tablas y vuelve a crear el esquema con los datos de
// demostración. Uso: npm run db:reset  (solo para desarrollo y pruebas).

const config = require('../config');
const { pool } = require('./pool');
const { ensureSchema, waitForDb } = require('./init');
const { seed } = require('./seed');

const TABLAS = [
  'resumen_eventos_hora', 'alertas', 'eventos_acceso', 'tipos_evento', 'seguimientos_incidente',
  'incidentes', 'estados_incidente', 'severidades', 'categorias_incidente',
  'activos', 'tipos_activo', 'tokens_recuperacion', 'usuarios', 'areas', 'roles',
];

(async () => {
  if (config.isProd && process.argv[2] !== '--force') {
    console.error('db:reset está deshabilitado en producción (usa --force si realmente lo necesitas).');
    process.exit(1);
  }
  await waitForDb();
  await pool.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of TABLAS) {
    await pool.query(`DROP TABLE IF EXISTS \`${t}\``);
  }
  await pool.query('SET FOREIGN_KEY_CHECKS = 1');
  // La tabla de sesiones la crea la aplicación: se vacía (no se borra) para no romper una instancia en marcha.
  await pool.query('DELETE FROM sessions').catch((err) => {
    if (err.code !== 'ER_NO_SUCH_TABLE') throw err;
  });
  console.log('[db] tablas eliminadas');
  await ensureSchema();
  await seed();
  await pool.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
