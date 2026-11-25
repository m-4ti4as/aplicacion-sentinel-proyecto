'use strict';

// Pruebas de extremo a extremo del Anexo A (CP-01 a CP-17).
// Interactúan con el sistema en ejecución por HTTP, como lo haría un navegador.
//
//   docker compose up -d --build
//   npm run test:e2e
//
// Variables: BASE_URL (http://localhost:3000), MAILPIT_URL (http://localhost:8025)
// Recomendado ejecutarlas sobre una base recién inicializada (npm run db:reset).

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const MAILPIT = (process.env.MAILPIT_URL || 'http://localhost:8025').replace(/\/$/, '');

let aprobadas = 0;
let fallidas = 0;
const casos = [];

function check(cond, desc) {
  if (cond) {
    aprobadas++;
    console.log(`   ✔ ${desc}`);
  } else {
    fallidas++;
    console.log(`   ✘ ${desc}`);
  }
  return cond;
}

/** Cliente HTTP mínimo con cookies (una "pestaña" de navegador). */
class Cliente {
  constructor() {
    this.cookies = new Map();
  }
  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  guardar(res) {
    const sets = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of sets) {
      const [par] = c.split(';');
      const i = par.indexOf('=');
      const k = par.slice(0, i).trim();
      const v = par.slice(i + 1).trim();
      if (/expires=Thu, 01 Jan 1970/i.test(c) || v === '') this.cookies.delete(k);
      else this.cookies.set(k, v);
    }
  }
  async get(path) {
    const res = await fetch(BASE + path, { headers: { cookie: this.cookieHeader() }, redirect: 'manual' });
    this.guardar(res);
    return { status: res.status, location: res.headers.get('location'), html: await res.text() };
  }
  async post(path, datos, { conCsrf = true, desde = null } = {}) {
    const body = new URLSearchParams(datos);
    if (conCsrf) {
      const pagina = await this.get(desde || path);
      const m = pagina.html.match(/name="_csrf" value="([a-f0-9]+)"/);
      if (m) body.set('_csrf', m[1]);
    }
    const res = await fetch(BASE + path, {
      method: 'POST',
      headers: { cookie: this.cookieHeader(), 'content-type': 'application/x-www-form-urlencoded' },
      body,
      redirect: 'manual',
    });
    this.guardar(res);
    return { status: res.status, location: res.headers.get('location'), html: await res.text() };
  }
  async login(email, password) {
    return this.post('/login', { email, password });
  }
}

function caso(id, titulo, fn) {
  casos.push({ id, titulo, fn });
}

const ADMIN = ['admin@translogix.cl', 'Admin#2026'];
const COLAB = ['colaborador@translogix.cl', 'Demo#2026'];
const sufijo = Date.now().toString(36);
const PRUEBA = { email: `prueba.e2e.${sufijo}@translogix.cl`, password: 'Prueba#2026x', nueva: 'Nueva#2026yz' };
const estado = {};

// ---------------------------------------------------------------------
caso('CP-01', 'Inicio de sesión con credenciales válidas', async () => {
  const a = new Cliente();
  const r1 = await a.login(...ADMIN);
  check(r1.status === 302 && r1.location === '/panel', 'administrador redirigido al panel');
  const p1 = await a.get('/panel');
  check(p1.html.includes('Panel de seguridad'), 'administrador ve el panel de seguridad');
  const c = new Cliente();
  await c.login(...COLAB);
  const p2 = await c.get('/panel');
  check(p2.html.includes('Mi panel') && !p2.html.includes('Panel de seguridad'), 'colaborador ve su panel');
});

caso('CP-02', 'Inicio de sesión con carga de inyección SQL', async () => {
  const c = new Cliente();
  const r = await c.login("admin@translogix.cl' OR '1'='1", "' OR '1'='1");
  check(r.status !== 302, 'acceso rechazado');
  check(r.html.includes('Correo o contraseña incorrectos.'), 'mensaje genérico');
  const r2 = await c.login('admin@translogix.cl', "' OR '1'='1' -- ");
  check(r2.status === 401 && r2.html.includes('Correo o contraseña incorrectos.'), 'inyección en la contraseña rechazada');
});

caso('CP-06', 'Registro con datos válidos', async () => {
  const c = new Cliente();
  const r = await c.post('/registro', {
    nombre: 'Prueba', apellido: 'Automatizada', email: PRUEBA.email, area_id: '3',
    password: PRUEBA.password, password2: PRUEBA.password, acepta: '1',
  });
  check(r.status === 302 && r.location === '/login', 'cuenta creada y redirección a login');
  const r2 = await c.login(PRUEBA.email, PRUEBA.password);
  check(r2.status === 302, 'la cuenta nueva puede iniciar sesión');
  const p = await c.get('/panel');
  check(p.html.includes('Mi panel'), 'perfil Colaborador asignado');
  await c.post('/logout', {}, { desde: '/panel' });
});

caso('CP-05', 'Registro con contraseña débil y correo inválido', async () => {
  const c = new Cliente();
  const r = await c.post('/registro', {
    nombre: 'A', apellido: '', email: 'correo-invalido', area_id: '', password: '123', password2: '1', acepta: '',
  });
  check(r.status === 422, 'HTTP 422');
  check(r.html.includes('El formato no es válido'), 'error de correo junto al campo');
  check(r.html.includes('Mínimo 8 caracteres, con mayúscula, minúscula, número y símbolo'), 'error de política de contraseña');
  check(r.html.includes('Debe tener al menos 2 caracteres'), 'error de nombre');
});

caso('CP-03', 'Cinco intentos fallidos consecutivos', async () => {
  const c = new Cliente();
  let r;
  for (let i = 0; i < 5; i++) r = await c.login(PRUEBA.email, 'Incorrecta#1');
  check(r.status === 423 && /bloqueada/i.test(r.html), 'cuenta bloqueada al quinto intento');
  const a = new Cliente();
  await a.login(...ADMIN);
  const al = await a.get('/admin/alertas');
  check(al.html.includes('FUERZA BRUTA') && al.html.includes(PRUEBA.email), 'alerta FUERZA_BRUTA generada');
});

caso('CP-04', 'Contraseña correcta con la cuenta bloqueada', async () => {
  const c = new Cliente();
  const r = await c.login(PRUEBA.email, PRUEBA.password);
  check(r.status === 423 && /bloqueada temporalmente/i.test(r.html), 'acceso rechazado con aviso de bloqueo');
});

caso('CP-07', 'Solicitud de recuperación de contraseña', async () => {
  const c = new Cliente();
  const r = await c.post('/recuperar', { email: PRUEBA.email });
  check(r.status === 302, 'solicitud aceptada');
  const r2 = await c.post('/recuperar', { email: `no.existe.${sufijo}@translogix.cl` });
  check(r2.status === 302 && r2.location === r.location, 'misma respuesta para un correo inexistente');
  let enlace = null;
  try {
    for (let i = 0; i < 10 && !enlace; i++) {
      await new Promise((ok) => setTimeout(ok, 500));
      const lista = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent('to:' + PRUEBA.email)}`)).json();
      const msg = lista.messages && lista.messages[0];
      if (msg) {
        const det = await (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)).json();
        const m = String(det.Text || det.HTML).match(/\/restablecer\/([a-f0-9]{64})/);
        if (m) enlace = `/restablecer/${m[1]}`;
      }
    }
  } catch (err) {
    console.log(`   (Mailpit no disponible en ${MAILPIT}: ${err.message})`);
  }
  check(!!enlace, 'correo recibido con enlace de un solo uso');
  estado.enlace = enlace;
});

caso('CP-08', 'Restablecer la contraseña y reutilizar el enlace', async () => {
  if (!estado.enlace) return check(false, 'requiere el enlace de CP-07');
  const c = new Cliente();
  const g = await c.get(estado.enlace);
  check(g.status === 200 && g.html.includes('Nueva contraseña'), 'el enlace abre el formulario');
  const r = await c.post(estado.enlace, { password: PRUEBA.nueva, password2: PRUEBA.nueva });
  check(r.status === 302 && r.location === '/login', 'primera vez exitosa');
  const r2 = await c.post(estado.enlace, { password: PRUEBA.nueva, password2: PRUEBA.nueva }, { desde: '/login' });
  check(r2.status === 400 && r2.html.includes('Enlace inválido'), 'segunda vez «Enlace inválido»');
  const l = await c.login(PRUEBA.email, PRUEBA.nueva);
  check(l.status === 302, 'la recuperación desbloquea la cuenta y la nueva contraseña funciona');
});

caso('CP-09', 'Envío de un formulario sin token CSRF', async () => {
  const c = new Cliente();
  await c.login(...COLAB);
  const r = await c.post('/incidentes', { titulo: 'Sin token CSRF', categoria_id: '1' }, { conCsrf: false });
  check(r.status === 403, 'solicitud rechazada (HTTP 403)');
});

caso('CP-10', 'Colaborador accede a funciones de administración', async () => {
  const c = new Cliente();
  await c.login(...COLAB);
  for (const ruta of ['/admin/usuarios', '/admin/eventos', '/activos/nuevo']) {
    const r = await c.get(ruta);
    check(r.status === 403 && r.html.includes('Acceso denegado'), `${ruta} → 403`);
  }
  const a = new Cliente();
  await a.login(...ADMIN);
  const ev = await a.get('/admin/eventos?tipo=7&email=colaborador%40translogix.cl');
  check(ev.html.includes('Acceso denegado a un recurso'), 'intentos registrados como ACCESO_DENEGADO');
});

caso('CP-11', 'Colaborador abre un incidente que no reportó', async () => {
  const a = new Cliente();
  await a.login(...ADMIN);
  const lista = await a.get('/incidentes?pagina=3');
  const ids = [...lista.html.matchAll(/href="\/incidentes\/(\d+)"/g)].map((m) => m[1]);
  const c = new Cliente();
  await c.login(...COLAB);
  const propios = new Set([...(await c.get('/incidentes')).html.matchAll(/href="\/incidentes\/(\d+)"/g)].map((m) => m[1]));
  const ajeno = ids.find((id) => !propios.has(id));
  const r = await c.get(`/incidentes/${ajeno}`);
  check(!!ajeno && r.status === 403, `incidente ajeno ${ajeno} → 403`);
});

caso('CP-12', 'Cambio de contraseña con la actual incorrecta', async () => {
  const c = new Cliente();
  await c.login(...COLAB);
  const r = await c.post('/perfil/password', { actual: 'NoEsLaActual#1', nueva: 'Otra#Clave2026', nueva2: 'Otra#Clave2026' }, { desde: '/perfil' });
  check(r.status === 422 && r.html.includes('La contraseña actual no es correcta'), 'error mostrado');
});

caso('CP-13', 'Reporte de incidente con datos válidos', async () => {
  const c = new Cliente();
  await c.login(...COLAB);
  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date(Date.now() - 30 * 60000);
  const fecha = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const r = await c.post(
    '/incidentes',
    {
      titulo: 'Correo sospechoso de prueba e2e',
      categoria_id: '1',
      severidad_id: '2',
      fecha_deteccion: fecha,
      activo_id: '',
      descripcion: 'Llegó un correo solicitando credenciales. Prueba automatizada.',
    },
    { desde: '/incidentes/nuevo' }
  );
  check(r.status === 302 && /^\/incidentes\/\d+$/.test(r.location || ''), 'incidente creado');
  const det = await c.get(r.location);
  check(/INC-\d{4}-\d{5}/.test(det.html), 'código INC-AAAA-NNNNN asignado');
  estado.incidente = r.location;
});

caso('CP-14', 'Administrador cambia el estado a En análisis', async () => {
  if (!estado.incidente) return check(false, 'requiere el incidente de CP-13');
  const a = new Cliente();
  await a.login(...ADMIN);
  const r = await a.post(
    `${estado.incidente}/seguimientos`,
    { estado_id: '2', severidad_id: '2', asignado_a: '', comentario: 'Se inicia el análisis (prueba e2e).' },
    { desde: estado.incidente }
  );
  check(r.status === 302, 'seguimiento registrado');
  const det = await a.get(estado.incidente);
  check(det.html.includes('Reportado → En análisis'), 'cambio visible en la línea de tiempo');
});

caso('CP-15', 'Registro de un activo con identificador duplicado', async () => {
  const a = new Cliente();
  await a.login(...ADMIN);
  const r = await a.post(
    '/activos',
    { nombre: 'Servidor duplicado', identificador: 'SRV-ERP-001', tipo_activo_id: '1', area_id: '2', criticidad: 'ALTA', responsable_id: '', ubicacion: '' },
    { desde: '/activos/nuevo' }
  );
  check(r.status === 422 && r.html.includes('Ya existe un activo con este identificador'), 'error de identificador duplicado');
});

caso('CP-16', 'Búsqueda de incidentes con carga de inyección SQL', async () => {
  const c = new Cliente();
  await c.login(...COLAB);
  const r = await c.get(`/incidentes?q=${encodeURIComponent("' OR 1=1 -- ")}`);
  check(r.status === 200, 'búsqueda sin errores');
  check(r.html.includes('No hay incidentes que coincidan'), 'sin resultados indebidos');
});

caso('CP-17', 'Administrador crea un usuario Colaborador', async () => {
  const a = new Cliente();
  await a.login(...ADMIN);
  const email = `nuevo.e2e.${sufijo}@translogix.cl`;
  const r = await a.post(
    '/admin/usuarios',
    { nombre: 'Usuario', apellido: 'Creado', email, rol_id: '2', area_id: '4', password: 'Creado#2026', activo: '1' },
    { desde: '/admin/usuarios/nuevo' }
  );
  check(r.status === 302, 'usuario creado');
  const l = await a.get(`/admin/usuarios?q=${encodeURIComponent(email)}`);
  check(l.html.includes(email), 'visible en el listado');
});

// ---------------------------------------------------------------------
(async () => {
  try {
    const h = await fetch(`${BASE}/health`);
    if (!h.ok) throw new Error(`HTTP ${h.status}`);
  } catch (err) {
    console.error(`No se pudo conectar con ${BASE}: ${err.message}`);
    process.exit(2);
  }
  console.log(`Pruebas e2e contra ${BASE}\n`);
  for (const c of casos) {
    console.log(`${c.id} · ${c.titulo}`);
    try {
      await c.fn();
    } catch (err) {
      check(false, `error inesperado: ${err.message}`);
    }
  }
  const total = aprobadas + fallidas;
  console.log(`\nResultado: ${aprobadas} de ${total} verificaciones aprobadas.`);
  process.exit(fallidas ? 1 : 0);
})();
