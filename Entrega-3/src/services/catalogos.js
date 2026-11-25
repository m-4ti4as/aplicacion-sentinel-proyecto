'use strict';

const { all } = require('../db/pool');

// Los catálogos cambian muy poco: se cargan una vez y se mantienen en memoria.
const cache = {};

async function cargar() {
  const [roles, areas, tiposActivo, categorias, severidades, estados, tiposEvento] = await Promise.all([
    all('SELECT id, nombre, descripcion FROM roles ORDER BY id'),
    all('SELECT id, nombre FROM areas ORDER BY nombre'),
    all('SELECT id, nombre FROM tipos_activo ORDER BY nombre'),
    all('SELECT id, nombre, descripcion FROM categorias_incidente ORDER BY nombre'),
    all('SELECT id, nombre, nivel, sla_horas FROM severidades ORDER BY nivel'),
    all('SELECT id, nombre, orden, es_final FROM estados_incidente ORDER BY orden'),
    all('SELECT id, codigo, descripcion FROM tipos_evento ORDER BY id'),
  ]);
  Object.assign(cache, { roles, areas, tiposActivo, categorias, severidades, estados, tiposEvento });
  cache.tipoEventoId = Object.fromEntries(tiposEvento.map((t) => [t.codigo, t.id]));
  cache.severidadId = Object.fromEntries(severidades.map((s) => [s.nombre, s.id]));
  cache.estadoId = Object.fromEntries(estados.map((e) => [e.nombre, e.id]));
  cache.rolId = Object.fromEntries(roles.map((r) => [r.nombre, r.id]));
  return cache;
}

function get() {
  if (!cache.roles) throw new Error('Catálogos no cargados');
  return cache;
}

const CRITICIDADES = ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'];

module.exports = { cargar, get, CRITICIDADES };
