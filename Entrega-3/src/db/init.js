'use strict';

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('../config');
const { pool } = require('./pool');

const SCHEMA_FILE = path.join(__dirname, '..', '..', 'db', 'schema.sql');

/** Espera a que MySQL acepte conexiones (útil al arrancar con Docker). */
async function waitForDb(retries = 30) {
  for (let i = 1; i <= retries; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (i === retries) throw err;
      console.log(`[db] esperando a MySQL (${i}/${retries}): ${err.code || err.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

/** Ajustes para bases creadas con una versión anterior del esquema. */
async function migrar(conn) {
  const [filas] = await conn.query(
    `SELECT DISTINCT index_name AS nombre FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'eventos_acceso'`
  );
  const indices = new Set(filas.map((f) => f.nombre));
  const cambios = [];
  if (!indices.has('idx_eventos_email_fecha')) cambios.push('ADD INDEX idx_eventos_email_fecha (email_intentado, creado_en)');
  if (!indices.has('idx_eventos_tipo_fecha_ip')) cambios.push('ADD INDEX idx_eventos_tipo_fecha_ip (tipo_evento_id, creado_en, ip, email_intentado)');
  if (indices.has('idx_eventos_tipo_fecha')) cambios.push('DROP INDEX idx_eventos_tipo_fecha');
  if (cambios.length) {
    await conn.query(`ALTER TABLE eventos_acceso ${cambios.join(', ')}`);
    console.log('[db] índices de eventos_acceso actualizados');
  }
}

/** Crea las tablas y catálogos si no existen. */
async function ensureSchema() {
  const sql = fs.readFileSync(SCHEMA_FILE, 'utf8');
  const conn = await mysql.createConnection({
    ...config.db,
    multipleStatements: true,
    charset: 'utf8mb4',
  });
  try {
    await conn.query(sql);
    await migrar(conn);
  } finally {
    await conn.end();
  }
}

async function isEmpty() {
  const [rows] = await pool.query('SELECT COUNT(*) AS n FROM usuarios');
  return rows[0].n === 0;
}

async function initDatabase() {
  await waitForDb();
  await ensureSchema();
  if (config.seedDemo && (await isEmpty())) {
    const { seed } = require('./seed');
    await seed();
  }
}

module.exports = { initDatabase, ensureSchema, waitForDb };
