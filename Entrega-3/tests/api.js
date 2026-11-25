'use strict';

// Pruebas de la API REST y de los eventos en tiempo real (CP-21 a CP-32).
//
//   docker compose up -d --build
//   npm run test:api
//
// Variable: BASE_URL (http://localhost:3000)

const { io } = require('socket.io-client');

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const API = `${BASE}/api/v1`;

let aprobadas = 0;
let fallidas = 0;
function check(cond, desc) {
  if (cond) aprobadas++;
  else fallidas++;
  console.log(`   ${cond ? '✔' : '✘'} ${desc}`);
  return cond;
}

async function api(metodo, ruta, { token, body, crudo } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined || crudo !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(API + ruta, { method: metodo, headers, body: crudo !== undefined ? crudo : body !== undefined ? JSON.stringify(body) : undefined });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* sin cuerpo JSON */
  }
  return { status: res.status, tipo: res.headers.get('content-type') || '', location: res.headers.get('location'), json };
}

const token = async (email, password) => (await api('POST', '/auth/token', { body: { email, password } })).json?.access_token;
const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));
/** Registra una cuenta Colaborador usando el formulario web (con su token CSRF). */
async function registrarCuenta() {
  const email = `api.prueba.${Date.now().toString(36)}@translogix.cl`;
  const g = await fetch(`${BASE}/registro`);
  const cookie = (g.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
  const csrf = ((await g.text()).match(/name="_csrf" value="([a-f0-9]+)"/) || [])[1];
  const r = await fetch(`${BASE}/registro`, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf, nombre: 'Prueba', apellido: 'Api', email, area_id: '3', password: 'Prueba#2026x', password2: 'Prueba#2026x', acepta: '1' }),
  });
  return r.status === 302 ? email : null;
}

const casos = [];
const caso = (id, titulo, fn) => casos.push({ id, titulo, fn });
const estado = {};

caso('CP-21', 'Emisión de token con credenciales válidas', async () => {
  const r = await api('POST', '/auth/token', { body: { email: 'admin@translogix.cl', password: 'Admin#2026' } });
  check(r.status === 200 && typeof r.json.access_token === 'string', 'HTTP 200 con access_token');
  check(r.json.token_type === 'Bearer' && r.json.expires_in === 900, 'token Bearer de 15 minutos');
  check(r.json.access_token.split('.').length === 3, 'formato JWT (header.payload.firma)');
  estado.admin = r.json.access_token;
  estado.colab = await token('colaborador@translogix.cl', 'Demo#2026');
  check(!!estado.colab, 'token del colaborador emitido');
});

caso('CP-22', 'Token con credenciales inválidas', async () => {
  const r = await api('POST', '/auth/token', { body: { email: 'admin@translogix.cl', password: 'mala' } });
  check(r.status === 401 && r.tipo.includes('application/problem+json'), 'HTTP 401 en formato RFC 7807');
  check(r.json.detail === 'Correo o contraseña incorrectos.', 'mensaje genérico (no revela si la cuenta existe)');
});

caso('CP-23', 'Acceso sin token, con token alterado y con JSON mal formado', async () => {
  const sin = await api('GET', '/incidentes');
  check(sin.status === 401, 'sin token → 401');
  const partes = estado.admin.split('.');
  const payload = JSON.parse(Buffer.from(partes[1], 'base64url').toString());
  payload.rol = 'Administrador';
  payload.sub = '999999';
  const alterado = [partes[0], Buffer.from(JSON.stringify(payload)).toString('base64url'), partes[2]].join('.');
  check((await api('GET', '/me', { token: alterado })).status === 401, 'payload alterado (firma inválida) → 401');
  const none = [Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url'), partes[1], ''].join('.');
  check((await api('GET', '/me', { token: none })).status === 401, 'algoritmo "none" rechazado → 401');
  const malo = await api('POST', '/incidentes', { token: estado.colab, crudo: '{"titulo": ' });
  check(malo.status === 400 && malo.json.title === 'JSON no válido', 'JSON mal formado → 400');
});

caso('CP-24', 'Control de acceso por perfil en la API', async () => {
  for (const ruta of ['/alertas', '/eventos', '/metricas/panel']) {
    check((await api('GET', ruta, { token: estado.colab })).status === 403, `colaborador → ${ruta} = 403`);
  }
  const r = await api('POST', '/activos', { token: estado.colab, body: { nombre: 'x' } });
  check(r.status === 403, 'colaborador no puede crear activos');
});

caso('CP-25', 'Colaborador solo ve sus incidentes (autorización por registro)', async () => {
  const propios = await api('GET', '/incidentes?por_pagina=100', { token: estado.colab });
  const todos = await api('GET', '/incidentes?por_pagina=100', { token: estado.admin });
  check(propios.status === 200 && propios.json.paginacion.total < todos.json.paginacion.total, 'listado filtrado por reportante');
  const ids = new Set(propios.json.datos.map((i) => i.id));
  const ajeno = todos.json.datos.find((i) => !ids.has(i.id));
  check(!!ajeno && (await api('GET', `/incidentes/${ajeno.id}`, { token: estado.colab })).status === 403, 'incidente ajeno → 403');
});

caso('CP-26', 'Validación de datos en la API', async () => {
  const r = await api('POST', '/incidentes', {
    token: estado.colab,
    body: { titulo: 'abc', categoria_id: 99, severidad_id: 2, fecha_deteccion: '2099-01-01T10:00', descripcion: 'corta' },
  });
  check(r.status === 422, 'HTTP 422');
  const e = r.json.errores || {};
  check(!!(e.titulo && e.categoria_id && e.fecha_deteccion && e.descripcion), 'errores por campo: título, categoría, fecha futura y descripción');
});

caso('CP-27', 'Reporte de incidente por la API y notificación en tiempo real', async () => {
  const socketAdmin = io(BASE, { auth: { token: estado.admin }, transports: ['websocket'] });
  const recibidos = [];
  socketAdmin.on('incidente:nuevo', (d) => recibidos.push(d));
  await new Promise((ok) => socketAdmin.on('conectado', ok));
  check(socketAdmin.connected, 'socket del administrador conectado con JWT');

  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date(Date.now() - 20 * 60000);
  const r = await api('POST', '/incidentes', {
    token: estado.colab,
    body: {
      titulo: 'Correo sospechoso reportado por API',
      categoria_id: 1,
      severidad_id: 2,
      fecha_deteccion: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
      descripcion: 'Correo que solicita credenciales del ERP (prueba de API).',
    },
  });
  check(r.status === 201 && /^INC-\d{4}-\d{5}$/.test(r.json.datos.codigo), 'HTTP 201 con código INC-AAAA-NNNNN');
  check(r.location === `/api/v1/incidentes/${r.json.datos.id}`, 'cabecera Location');
  await esperar(500);
  check(recibidos.some((x) => x.id === r.json.datos.id), 'evento incidente:nuevo recibido en vivo por el administrador');
  socketAdmin.close();
  estado.incidente = r.json.datos.id;
});

caso('CP-28', 'Cambio de estado por la API notifica al colaborador', async () => {
  const socketColab = io(BASE, { auth: { token: estado.colab }, transports: ['websocket'] });
  const recibidos = [];
  socketColab.on('incidente:actualizado', (d) => recibidos.push(d));
  await new Promise((ok) => socketColab.on('conectado', ok));
  const r = await api('POST', `/incidentes/${estado.incidente}/seguimientos`, {
    token: estado.admin,
    body: { comentario: 'Se inicia el análisis (prueba de API).', estado_id: 2 },
  });
  check(r.status === 201 && r.json.datos.estado === 'En análisis', 'estado cambiado a En análisis');
  await esperar(500);
  check(recibidos.some((x) => x.id === estado.incidente && x.estado === 'En análisis'), 'evento incidente:actualizado recibido por el reportante');
  socketColab.close();
});

caso('CP-29', 'Alerta de fuerza bruta en tiempo real', async () => {
  const socketAdmin = io(BASE, { auth: { token: estado.admin }, transports: ['websocket'] });
  const alertas = [];
  const eventos = [];
  socketAdmin.on('alerta:nueva', (a) => alertas.push(a));
  socketAdmin.on('evento:nuevo', (e) => eventos.push(e));
  await new Promise((ok) => socketAdmin.on('conectado', ok));

  // Cuenta desechable (registrada por el formulario web) para no bloquear las de demostración.
  const email = await registrarCuenta();
  check(!!email, 'cuenta de prueba registrada');
  for (let i = 0; i < 5; i++) await api('POST', '/auth/token', { body: { email, password: `Mala#${i}x` } });
  await esperar(700);
  check(eventos.filter((e) => e.codigo === 'LOGIN_FALLIDO' && e.email === email).length >= 5, 'cada intento fallido llega como evento:nuevo');
  check(alertas.some((a) => a.regla === 'FUERZA_BRUTA' && a.descripcion.includes(email)), 'alerta FUERZA_BRUTA recibida en vivo');
  const bloqueada = await api('POST', '/auth/token', { body: { email, password: 'Prueba#2026x' } });
  check(bloqueada.status === 423, 'la cuenta queda bloqueada (423) también para la API');
  socketAdmin.close();
});

caso('CP-30', 'Revisión de alerta por la API', async () => {
  const lista = await api('GET', '/alertas?por_pagina=100', { token: estado.admin });
  const a = lista.json.datos.find((x) => x.regla === 'FUERZA_BRUTA');
  const r = await api('PATCH', `/alertas/${a.id}`, { token: estado.admin, body: { revisada: true } });
  check(r.status === 200 && r.json.datos.revisada === true, 'alerta marcada como revisada');
  check((await api('PATCH', `/alertas/${a.id}`, { token: estado.admin, body: { revisada: true } })).status === 404, 'segunda revisión → 404');
});

caso('CP-31', 'Paginación por cursor en eventos de acceso', async () => {
  const p1 = await api('GET', '/eventos?limite=100', { token: estado.admin });
  check(p1.status === 200 && p1.json.datos.length === 100 && p1.json.siguiente, 'primera página con cursor siguiente');
  const p2 = await api('GET', `/eventos?limite=100&antes_de=${p1.json.siguiente}`, { token: estado.admin });
  const ids1 = new Set(p1.json.datos.map((e) => e.id));
  check(p2.json.datos.every((e) => !ids1.has(e.id) && e.id < p1.json.siguiente), 'segunda página sin repetidos y en orden descendente');
  const t0 = Date.now();
  await api('GET', '/metricas/panel', { token: estado.admin });
  check(Date.now() - t0 < 2000, `métricas del panel en ${Date.now() - t0} ms (< 2 s, RNF-06)`);
});

caso('CP-32', 'Socket.IO rechaza conexiones sin autenticación', async () => {
  const s = io(BASE, { transports: ['websocket'], reconnection: false });
  const error = await new Promise((ok) => {
    s.on('connect_error', (e) => ok(e.message));
    s.on('connect', () => ok(null));
  });
  check(error === 'no autenticado', 'conexión rechazada: "no autenticado"');
  s.close();
});

(async () => {
  try {
    const h = await fetch(`${BASE}/health`);
    if (!h.ok) throw new Error(`HTTP ${h.status}`);
  } catch (err) {
    console.error(`No se pudo conectar con ${BASE}: ${err.message}`);
    process.exit(2);
  }
  console.log(`Pruebas de API REST y tiempo real contra ${BASE}\n`);
  for (const c of casos) {
    console.log(`${c.id} · ${c.titulo}`);
    try {
      await c.fn();
    } catch (err) {
      check(false, `error inesperado: ${err.message}`);
    }
  }
  console.log(`\nResultado: ${aprobadas} de ${aprobadas + fallidas} verificaciones aprobadas.`);
  process.exit(fallidas ? 1 : 0);
})();
