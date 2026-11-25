'use strict';

// Pruebas de seguridad de sesiones y autenticación (CP-33 a CP-39) contra la
// aplicación en ejecución:  npm run test:seguridad

const { io } = require('socket.io-client');
const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

let aprobadas = 0;
let fallidas = 0;
function check(cond, desc) {
  if (cond) aprobadas++;
  else fallidas++;
  console.log(`   ${cond ? '✔' : '✘'} ${desc}`);
  return cond;
}
const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

class Cliente {
  constructor() {
    this.cookies = new Map();
  }
  cookie() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  async pedir(path, opts = {}) {
    const res = await fetch(BASE + path, { redirect: 'manual', ...opts, headers: { cookie: this.cookie(), ...(opts.headers || {}) } });
    for (const c of res.headers.getSetCookie()) {
      const [k, ...v] = c.split(';')[0].split('=');
      this.cookies.set(k, v.join('='));
      this.crudo = c;
    }
    return { status: res.status, location: res.headers.get('location'), headers: res.headers, html: await res.text() };
  }
  get(path) {
    return this.pedir(path);
  }
  async post(path, datos, desde = path) {
    const csrf = ((await this.get(desde)).html.match(/name="_csrf" value="([a-f0-9]+)"/) || [])[1] || '';
    return this.pedir(path, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...datos, _csrf: csrf }),
    });
  }
  login(email, password) {
    return this.post('/login', { email, password });
  }
}
const token = (email, password) =>
  fetch(`${BASE}/api/v1/auth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }).then(async (r) => ({ status: r.status, json: await r.json() }));

const CLAVE = 'Prueba#2026x';
let n = 0;
async function cuenta() {
  const email = `seg.prueba.${Date.now().toString(36)}${n++}@translogix.cl`;
  const r = await new Cliente().post('/registro', {
    nombre: 'Prueba', apellido: 'Seguridad', email, area_id: '3', password: CLAVE, password2: CLAVE, acepta: '1',
  });
  if (r.status !== 302) throw new Error('no se pudo registrar la cuenta de prueba');
  return email;
}
async function admin() {
  const a = new Cliente();
  await a.login('admin@translogix.cl', 'Admin#2026');
  return a;
}
/** Edita la cuenta desde el formulario de administración. */
async function editar(a, email, cambios) {
  const lista = await a.get(`/admin/usuarios?q=${encodeURIComponent(email)}`);
  const id = lista.html.match(/\/admin\/usuarios\/(\d+)\/editar/)[1];
  return a.post(`/admin/usuarios/${id}`, { nombre: 'Prueba', apellido: 'Seguridad', email, rol_id: '2', area_id: '3', activo: '1', password: '', ...cambios }, `/admin/usuarios/${id}/editar`);
}

const casos = [];
const caso = (id, titulo, fn) => casos.push({ id, titulo, fn });

caso('CP-33', 'Veinte intentos fallidos simultáneos no superan el máximo de cinco', async () => {
  const email = await cuenta();
  const r = await Promise.all(Array.from({ length: 20 }, (_, i) => token(email, `Mala#${i}xx`)));
  const simples = r.filter((x) => x.status === 401).length;
  check(simples === 4, `solo 4 intentos evaluados antes del bloqueo (401: ${simples}, 423: ${r.filter((x) => x.status === 423).length})`);
  check((await token(email, CLAVE)).status === 423, 'la contraseña correcta se rechaza con la cuenta bloqueada');
});

caso('CP-34', 'El bloqueo no revela si un correo existe', async () => {
  const real = await cuenta();
  const falso = `no.existe.${Date.now().toString(36)}@translogix.cl`;
  const a = [];
  const b = [];
  for (let i = 0; i < 6; i++) {
    a.push(await token(real, 'Mala#2026'));
    b.push(await token(falso, 'Mala#2026'));
  }
  check(a.map((x) => x.status).join() === b.map((x) => x.status).join(), `misma secuencia de respuestas (${b.map((x) => x.status).join(', ')})`);
  check(a.every((x, i) => x.json.detail === b[i].json.detail), 'mismos mensajes con y sin cuenta');
});

caso('CP-35', 'El cambio de perfil tiene efecto inmediato', async () => {
  const email = await cuenta();
  const a = await admin();
  await editar(a, email, { rol_id: '1' });
  const u = new Cliente();
  await u.login(email, CLAVE);
  check((await u.get('/admin/usuarios')).status === 200, 'con perfil Administrador entra a /admin/usuarios');
  await editar(a, email, { rol_id: '2' });
  const r = await u.get('/admin/usuarios');
  check(r.status === 302 && r.location === '/login', 'al quitarle el perfil su sesión se cierra');
});

caso('CP-36', 'Una cuenta desactivada pierde el acceso web, la API y el tiempo real', async () => {
  const email = await cuenta();
  const u = new Cliente();
  await u.login(email, CLAVE);
  const jwt = (await token(email, CLAVE)).json.access_token;
  const s = io(BASE, { auth: { token: jwt }, transports: ['websocket'], reconnection: false });
  await new Promise((ok) => s.on('conectado', ok));
  let cortado = false;
  s.on('disconnect', () => (cortado = true));
  await editar(await admin(), email, { activo: '' });
  await esperar(400);
  check((await u.get('/panel')).location === '/login', 'la sesión web se cierra');
  const me = await fetch(`${BASE}/api/v1/me`, { headers: { authorization: `Bearer ${jwt}` } });
  check(me.status === 401, 'el JWT vigente responde 401');
  check(cortado, 'la conexión en vivo se corta');
  s.close();
});

caso('CP-37', 'Cambiar la contraseña cierra las demás sesiones', async () => {
  const email = await cuenta();
  const uno = new Cliente();
  const dos = new Cliente();
  await uno.login(email, CLAVE);
  await dos.login(email, CLAVE);
  const r = await uno.post('/perfil/password', { actual: CLAVE, nueva: 'Cambio#2026z', nueva2: 'Cambio#2026z' }, '/perfil');
  check(r.status === 302, 'contraseña actualizada');
  check((await uno.get('/panel')).status === 200, 'la sesión que hizo el cambio continúa');
  check((await dos.get('/panel')).location === '/login', 'la otra sesión se cerró');
});

caso('CP-38', 'Cabeceras HTTP de seguridad y atributos de la cookie', async () => {
  const c = new Cliente();
  const r = await c.get('/login');
  const csp = r.headers.get('content-security-policy') || '';
  check(csp.includes("script-src 'self'") && !csp.includes('unsafe-inline'), 'CSP sin scripts en línea');
  check(r.headers.get('x-frame-options') === 'DENY', 'X-Frame-Options: DENY');
  check(r.headers.get('x-content-type-options') === 'nosniff', 'X-Content-Type-Options: nosniff');
  check(!r.headers.get('x-powered-by'), 'sin X-Powered-By');
  check(/HttpOnly/i.test(c.crudo) && /SameSite=Lax/i.test(c.crudo), 'cookie HttpOnly y SameSite=Lax');
});

caso('CP-39', 'Un texto con HTML se muestra escapado (XSS)', async () => {
  const email = await cuenta();
  const c = new Cliente();
  await c.login(email, CLAVE);
  const d = new Date(Date.now() - 3600000);
  const p = (x) => String(x).padStart(2, '0');
  const r = await c.post('/incidentes', {
    titulo: '<script>alert(1)</script> prueba', categoria_id: '1', severidad_id: '1', activo_id: '',
    fecha_deteccion: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`,
    descripcion: '<img src=x onerror=alert(1)> texto de prueba',
  }, '/incidentes/nuevo');
  const det = await c.get(r.location);
  check(det.html.includes('&lt;script&gt;') && !det.html.includes('<script>alert(1)'), 'título escapado');
  check(!det.html.includes('<img src=x'), 'descripción escapada');
});

(async () => {
  console.log(`Pruebas de seguridad contra ${BASE}\n`);
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
