'use strict';

const mysql = require('mysql2/promise');
const config = require('../config');

// Todas las consultas de la aplicación usan sentencias preparadas del servidor
// (pool.execute con parámetros "?"), nunca concatenación de datos del usuario.
// Las cargas masivas (seed) y las tareas sin parámetros usan pool.query.
const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  ssl: config.db.ssl,
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  timezone: 'local',
  dateStrings: false,
  decimalNumbers: true,
});

/** Ejecuta fn(conn) dentro de una transacción. */
async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** Devuelve la primera fila o null. */
async function one(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows[0] || null;
}

async function all(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/**
 * Parámetros de LIMIT ? OFFSET ?. MySQL 8 los exige como enteros y mysql2 envía
 * los números de JavaScript como DOUBLE, por eso viajan como texto numérico.
 */
const limites = (porPagina, pagina) => [String(Math.trunc(porPagina)), String(Math.trunc((pagina - 1) * porPagina))];

module.exports = { pool, transaction, one, all, limites };
