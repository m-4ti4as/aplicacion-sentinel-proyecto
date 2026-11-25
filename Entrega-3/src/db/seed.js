'use strict';

// Datos de demostración de TransLogix Ltda. (empresa ficticia):
// 121 usuarios, 31 activos, 72 incidentes y más de 50.000 eventos de
// acceso de los últimos 60 días, con patrones de uso realistas y ataques
// simulados (credential stuffing, fuerza bruta, accesos fuera de horario).
// El generador es determinista: siempre produce los mismos datos.

const bcrypt = require('bcryptjs');
const config = require('../config');
const { pool } = require('./pool');
const { reconstruir: reconstruirResumen } = require('../services/resumen');

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261024);
const entre = (min, max) => min + Math.floor(rnd() * (max - min + 1));
const elegir = (arr) => arr[Math.floor(rnd() * arr.length)];
const prob = (p) => rnd() < p;
const sinTildes = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ñ/gi, 'n');
const MIN = 60000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

/** Fecha local: hace `dias` días, a la hora y minuto indicados. */
function enDia(base, dias, hora, minuto = 0, seg = 0) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - dias, 0, 0, 0);
  d.setHours(hora, minuto, seg, 0);
  return d;
}

// ---------------------------------------------------------------------
// Catálogos base (ids definidos en db/schema.sql)
// ---------------------------------------------------------------------
const AREA = { GER: 1, TI: 2, OPE: 3, TRA: 4, FIN: 5, COM: 6, RRHH: 7 };
const ROL = { ADMIN: 1, COLAB: 2 };
const TIPO_ACTIVO = { SRV: 1, PC: 2, NB: 3, APP: 4, BD: 5, RED: 6, MOV: 7 };
const CAT = { PHISHING: 1, MALWARE: 2, ACCESO: 3, PERDIDA: 4, FUGA: 5, INDISP: 6 };
const SEV = { BAJA: 1, MEDIA: 2, ALTA: 3, CRITICA: 4 };
const EST = { REPORTADO: 1, ANALISIS: 2, CONTENCION: 3, RESUELTO: 4, CERRADO: 5, DESCARTADO: 6 };
const EV = { LOGIN_OK: 1, LOGIN_FALLIDO: 2, LOGOUT: 3, CUENTA_BLOQUEADA: 4, RECUPERACION: 5, PASSWORD: 6, DENEGADO: 7, REGISTRO: 8 };

const NOMBRES = [
  'Matías', 'Sofía', 'Benjamín', 'Valentina', 'Vicente', 'Isidora', 'Martín', 'Florencia', 'Agustín', 'Antonia',
  'Joaquín', 'Catalina', 'Tomás', 'Javiera', 'Cristóbal', 'Fernanda', 'Diego', 'Constanza', 'Sebastián', 'Macarena',
  'Felipe', 'Daniela', 'Nicolás', 'Camila', 'Gonzalo', 'Paula', 'Andrés', 'Carolina', 'Rodrigo', 'Francisca',
  'Ignacio', 'Josefa', 'Pablo', 'Trinidad', 'Francisco', 'Valeria', 'Jorge', 'Bárbara', 'Luis', 'Natalia',
  'Héctor', 'Claudia', 'Mauricio', 'Paz', 'Cristian', 'Ximena', 'Patricio', 'Lorena', 'Esteban', 'Pía',
];
const APELLIDOS = [
  'González', 'Muñoz', 'Rojas', 'Díaz', 'Pérez', 'Soto', 'Contreras', 'Silva', 'Martínez', 'Sepúlveda',
  'Morales', 'Rodríguez', 'López', 'Fuentes', 'Hernández', 'Torres', 'Araya', 'Flores', 'Espinoza', 'Valenzuela',
  'Castillo', 'Tapia', 'Reyes', 'Gutiérrez', 'Castro', 'Pizarro', 'Álvarez', 'Vásquez', 'Sánchez', 'Fernández',
  'Ramírez', 'Carrasco', 'Gómez', 'Cortés', 'Herrera', 'Núñez', 'Jara', 'Vergara', 'Rivera', 'Figueroa',
];
// Nombres que aparecen en las capturas del informe.
const FIJOS = [
  ['Macarena', 'Espinoza', AREA.COM], ['Cristóbal', 'Morales', AREA.OPE], ['Joaquín', 'Díaz', AREA.TRA],
  ['Gonzalo', 'Rodríguez', AREA.FIN], ['Constanza', 'González', AREA.COM], ['Andrés', 'Valenzuela', AREA.TRA],
  ['Paula', 'López', AREA.FIN], ['Tomás', 'López', AREA.TRA], ['Constanza', 'Pérez', AREA.RRHH],
  ['Matías', 'Rojas', AREA.TI], ['Sofía', 'Rojas', AREA.COM], ['Carolina', 'Araya', AREA.OPE],
];
const PESOS_AREA = [
  [AREA.OPE, 34], [AREA.TRA, 30], [AREA.COM, 18], [AREA.FIN, 12], [AREA.RRHH, 7], [AREA.GER, 4], [AREA.TI, 3],
];
function areaAleatoria() {
  const total = PESOS_AREA.reduce((s, [, p]) => s + p, 0);
  let r = rnd() * total;
  for (const [a, p] of PESOS_AREA) {
    if ((r -= p) < 0) return a;
  }
  return AREA.OPE;
}

const UA_PC = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
];
const UA_MOVIL = [
  'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; moto g54 5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
];
const UA_BOT = [
  'python-requests/2.31.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36',
  'curl/8.4.0',
  'Go-http-client/1.1',
];

// IPs atacantes recurrentes (campañas de credential stuffing)
const IPS_ATACANTES = [
  '91.240.118.10', '179.43.150.161', '103.149.162.118', '185.220.101.145',
  '91.240.118.32', '103.149.162.193', '179.43.150.237', '179.43.150.124',
];

// ---------------------------------------------------------------------
// Activos (31)
// ---------------------------------------------------------------------
const UBIC = {
  STGO: 'Casa Matriz Santiago',
  QUIL: 'Centro de distribución Quilicura',
  VALPO: 'Sucursal Valparaíso',
  CONCE: 'Sucursal Concepción',
};
// [nombre, identificador, tipo, área, criticidad, ubicación, responsable ('admin'|'camila'|'diego'|'demo'|'matias'|null=área)]
const ACTIVOS = [
  ['Base de datos de clientes', 'DB-CRM-004', TIPO_ACTIVO.BD, AREA.TI, 'CRITICA', UBIC.VALPO, 'camila'],
  ['Base de datos de despachos', 'DB-DESP-005', TIPO_ACTIVO.BD, AREA.TI, 'CRITICA', UBIC.QUIL, 'camila'],
  ['Servidor de archivos', 'SRV-FILES-002', TIPO_ACTIVO.SRV, AREA.TI, 'CRITICA', UBIC.STGO, 'admin'],
  ['Servidor de correo', 'SRV-MAIL-003', TIPO_ACTIVO.SRV, AREA.TI, 'CRITICA', UBIC.QUIL, 'admin'],
  ['Servidor ERP', 'SRV-ERP-001', TIPO_ACTIVO.SRV, AREA.TI, 'CRITICA', UBIC.CONCE, 'camila'],
  ['Servidor de respaldos', 'SRV-BCK-030', TIPO_ACTIVO.SRV, AREA.TI, 'CRITICA', UBIC.STGO, 'diego'],
  ['Access point bodega 01', 'AP-BOD-012', TIPO_ACTIVO.RED, AREA.TI, 'ALTA', UBIC.CONCE, 'camila'],
  ['Access point bodega 02', 'AP-BOD-013', TIPO_ACTIVO.RED, AREA.TI, 'ALTA', UBIC.VALPO, 'admin'],
  ['Firewall perimetral 01', 'FW-008', TIPO_ACTIVO.RED, AREA.TI, 'ALTA', UBIC.VALPO, 'admin'],
  ['Firewall perimetral 02', 'FW-009', TIPO_ACTIVO.RED, AREA.TI, 'ALTA', UBIC.VALPO, 'camila'],
  ['Portal de seguimiento de envíos', 'APP-TRACKING-006', TIPO_ACTIVO.APP, AREA.TI, 'ALTA', UBIC.QUIL, 'admin'],
  ['Sistema de facturación', 'APP-FACT-007', TIPO_ACTIVO.APP, AREA.TI, 'ALTA', UBIC.CONCE, 'admin'],
  ['Switch core 01', 'SW-CORE-010', TIPO_ACTIVO.RED, AREA.TI, 'ALTA', UBIC.VALPO, 'admin'],
  ['Switch core 02', 'SW-CORE-011', TIPO_ACTIVO.RED, AREA.TI, 'ALTA', UBIC.VALPO, 'camila'],
  ['Sistema de gestión de bodega (WMS)', 'APP-WMS-028', TIPO_ACTIVO.APP, AREA.OPE, 'ALTA', UBIC.QUIL, 'diego'],
  ['Portal de remuneraciones', 'APP-RRHH-029', TIPO_ACTIVO.APP, AREA.RRHH, 'ALTA', UBIC.STGO, null],
  ['Correo corporativo', 'APP-MAIL-031', TIPO_ACTIVO.APP, AREA.TI, 'ALTA', UBIC.STGO, 'diego'],
  ['Computador gerencia general', 'PC-019', TIPO_ACTIVO.PC, AREA.GER, 'ALTA', UBIC.STGO, null],
  ['Notebook 04', 'NB-023', TIPO_ACTIVO.NB, AREA.FIN, 'ALTA', UBIC.STGO, null],
  ['Computador puesto 01', 'PC-014', TIPO_ACTIVO.PC, AREA.OPE, 'MEDIA', UBIC.STGO, 'demo'],
  ['Computador puesto 02', 'PC-015', TIPO_ACTIVO.PC, AREA.TI, 'MEDIA', UBIC.QUIL, 'matias'],
  ['Computador puesto 03', 'PC-016', TIPO_ACTIVO.PC, AREA.FIN, 'MEDIA', UBIC.STGO, null],
  ['Computador puesto 04', 'PC-017', TIPO_ACTIVO.PC, AREA.COM, 'MEDIA', UBIC.VALPO, null],
  ['Computador puesto 05', 'PC-018', TIPO_ACTIVO.PC, AREA.RRHH, 'MEDIA', UBIC.STGO, null],
  ['Notebook 01', 'NB-020', TIPO_ACTIVO.NB, AREA.COM, 'MEDIA', UBIC.STGO, null],
  ['Notebook 02', 'NB-021', TIPO_ACTIVO.NB, AREA.OPE, 'MEDIA', UBIC.QUIL, 'demo'],
  ['Notebook 03', 'NB-022', TIPO_ACTIVO.NB, AREA.TRA, 'MEDIA', UBIC.CONCE, null],
  ['Terminal de mano bodega 01', 'TM-024', TIPO_ACTIVO.MOV, AREA.OPE, 'MEDIA', UBIC.QUIL, 'demo'],
  ['Terminal de mano bodega 02', 'TM-025', TIPO_ACTIVO.MOV, AREA.OPE, 'MEDIA', UBIC.QUIL, null],
  ['Terminal de mano bodega 03', 'TM-026', TIPO_ACTIVO.MOV, AREA.OPE, 'BAJA', UBIC.CONCE, null],
  ['Teléfono jefatura de transporte', 'CEL-027', TIPO_ACTIVO.MOV, AREA.TRA, 'BAJA', UBIC.STGO, null],
];

// ---------------------------------------------------------------------
// Plantillas de incidentes
// ---------------------------------------------------------------------
const PLANTILLAS = {
  [CAT.PHISHING]: [
    ['Correo sospechoso solicitando credenciales del ERP', 'Llegó un correo que dice ser de soporte TI y pide ingresar usuario y contraseña del ERP en un enlace externo. No ingresé datos.', ['SRV-ERP-001', 'APP-MAIL-031']],
    ['Factura falsa de proveedor con enlace de descarga', 'Recibí una supuesta factura de un proveedor habitual con un enlace para descargarla. El dominio del remitente no coincide con el del proveedor.', ['APP-MAIL-031', 'APP-FACT-007']],
    ['Mensaje de WhatsApp suplantando a gerencia', 'Un número desconocido con la foto del gerente pidió comprar tarjetas de regalo con urgencia.', []],
    ['Correo de falsa empresa de courier con enlace acortado', 'Correo que informa un "envío retenido" y pide pagar un cargo en un enlace acortado.', ['APP-MAIL-031']],
    ['Llamada pidiendo código de verificación', 'Una persona llamó diciendo ser del banco y pidió el código que llegó por SMS. Corté la llamada.', []],
  ],
  [CAT.MALWARE]: [
    ['Antivirus detecta troyano en notebook', 'El antivirus mostró una alerta de troyano al abrir un archivo comprimido descargado desde el correo.', ['NB-020', 'NB-021', 'NB-022', 'NB-023']],
    ['Ventanas emergentes y lentitud en computador', 'El computador abre ventanas de publicidad solo y está muy lento desde ayer.', ['PC-016', 'PC-017', 'PC-018', 'PC-014']],
    ['Adjunto ejecutó una macro desconocida', 'Abrí una planilla adjunta y se habilitaron macros. Después apareció una ventana negra que se cerró sola.', ['PC-015', 'PC-016']],
    ['Pendrive con archivo sospechoso en bodega', 'Se encontró un pendrive en bodega. Al conectarlo apareció un acceso directo con nombre extraño.', ['TM-025', 'PC-014']],
  ],
  [CAT.ACCESO]: [
    ['Persona ajena en la sala de servidores', 'Vi a una persona sin credencial dentro de la sala de servidores. Dijo ser técnico externo, pero no estaba agendado.', ['SRV-FILES-002', 'SW-CORE-010']],
    ['Inicio de sesión no reconocido en mi cuenta', 'En mis últimos accesos aparece un inicio de sesión que no realicé, desde una IP que no conozco.', []],
    ['Uso de credenciales de otro usuario', 'Un compañero está usando la cuenta de otra persona para registrar despachos.', ['APP-WMS-028']],
    ['Acceso al portal de remuneraciones fuera de horario', 'Se observan consultas al portal de remuneraciones durante la madrugada con una cuenta de RR. HH.', ['APP-RRHH-029']],
  ],
  [CAT.PERDIDA]: [
    ['Robo de notebook en terreno', 'Me robaron el notebook de la empresa desde el vehículo durante una visita a cliente.', ['NB-021', 'NB-022', 'NB-020']],
    ['Pérdida de terminal de mano en bodega', 'No encontramos un terminal de mano desde el cambio de turno.', ['TM-024', 'TM-025', 'TM-026']],
    ['Teléfono corporativo extraviado en ruta', 'Extravié el teléfono corporativo durante la ruta de despacho.', ['CEL-027']],
    ['Pendrive con planillas de despacho extraviado', 'Perdí un pendrive con planillas de despachos de la semana.', []],
  ],
  [CAT.FUGA]: [
    ['Planilla de clientes enviada a correo externo', 'Por error se envió una planilla con datos de clientes a una dirección externa.', ['DB-CRM-004', 'APP-MAIL-031']],
    ['Guías de despacho publicadas en grupo de WhatsApp', 'Se compartieron fotos de guías de despacho con direcciones de clientes en un grupo con personas externas.', ['DB-DESP-005']],
    ['Respaldo enviado a destinatario equivocado', 'Un archivo de respaldo de facturación se envió al proveedor equivocado.', ['APP-FACT-007', 'SRV-BCK-030']],
  ],
  [CAT.INDISP]: [
    ['Portal de seguimiento no responde', 'Los clientes reportan que el portal de seguimiento de envíos no carga.', ['APP-TRACKING-006']],
    ['ERP lento y con errores al facturar', 'El ERP tarda varios minutos en responder y muestra errores al emitir facturas.', ['SRV-ERP-001', 'APP-FACT-007']],
    ['Caída de red en centro de distribución', 'Sin conexión de red en el centro de distribución; los terminales de mano no sincronizan.', ['SW-CORE-011', 'AP-BOD-012', 'AP-BOD-013']],
    ['Servidor de correo sin servicio', 'No se pueden enviar ni recibir correos desde la mañana.', ['SRV-MAIL-003', 'APP-MAIL-031']],
  ],
};
const CONTENCION = {
  [CAT.PHISHING]: 'Se bloquea el remitente y el dominio en el filtro de correo; se revisa si otros usuarios recibieron el mensaje.',
  [CAT.MALWARE]: 'Se aísla el equipo de la red y se ejecuta un análisis completo con el antivirus corporativo.',
  [CAT.ACCESO]: 'Se restablecen las credenciales afectadas, se cierran las sesiones activas y se revisan los registros de acceso.',
  [CAT.PERDIDA]: 'Se aplican medidas de contención: bloqueo de remitente/IP y aislamiento del equipo afectado. Se revocan accesos del equipo.',
  [CAT.FUGA]: 'Se solicita la eliminación del archivo al destinatario y se evalúa la notificación según la Ley N° 21.719.',
  [CAT.INDISP]: 'Se reinician los servicios afectados y se habilita el procedimiento alternativo mientras se identifica la causa.',
};

// ---------------------------------------------------------------------
// Generador
// ---------------------------------------------------------------------
async function insertarLotes(conn, sql, filas, tam = 2000) {
  for (let i = 0; i < filas.length; i += tam) {
    await conn.query(sql, [filas.slice(i, i + tam)]);
  }
}

async function seed() {
  const t0 = Date.now();
  console.log('[seed] generando datos de demostración...');
  const ahora = new Date();
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // ------------------------------------------------------------- usuarios
    const cost = config.security.bcryptCost;
    const hashAdmin = await bcrypt.hash('Admin#2026', cost);
    const hashDemo = await bcrypt.hash('Demo#2026', cost);

    const usuarios = [];
    const emails = new Set();
    const agregar = (nombre, apellido, area, rol, email, hash, extra = {}) => {
      email = email || `${sinTildes(nombre)}.${sinTildes(apellido)}@translogix.cl`.toLowerCase().replace(/\s+/g, '');
      if (emails.has(email)) {
        let n = 2;
        while (emails.has(email.replace('@', n + '@'))) n++;
        email = email.replace('@', n + '@');
      }
      emails.add(email);
      const u = { nombre, apellido, area, rol, email, hash, activo: 1, ...extra };
      usuarios.push(u);
      return u;
    };

    const admin = agregar('Administrador', 'Seguridad', AREA.TI, ROL.ADMIN, 'admin@translogix.cl', hashAdmin, { clave: 'admin' });
    const camila = agregar('Camila', 'Rojas', AREA.TI, ROL.ADMIN, 'camila.rojas@translogix.cl', hashDemo, { clave: 'camila' });
    const diego = agregar('Diego', 'Fuentes', AREA.TI, ROL.ADMIN, 'diego.fuentes@translogix.cl', hashDemo, { clave: 'diego' });
    const demo = agregar('Colaborador', 'Demo', AREA.OPE, ROL.COLAB, 'colaborador@translogix.cl', hashDemo, { clave: 'demo' });
    for (const [n, a, area] of FIJOS) {
      const u = agregar(n, a, area, ROL.COLAB, null, hashDemo);
      if (n === 'Matías' && a === 'Rojas') u.clave = 'matias';
    }
    while (usuarios.length < 121) {
      agregar(elegir(NOMBRES), elegir(APELLIDOS), areaAleatoria(), ROL.COLAB, null, hashDemo);
    }
    // Dos cuentas desactivadas (ex trabajadores)
    usuarios[usuarios.length - 1].activo = 0;
    usuarios[usuarios.length - 2].activo = 0;

    const creadoUsuarios = new Date(ahora.getTime() - 120 * DIA);
    await insertarLotes(
      conn,
      'INSERT INTO usuarios (rol_id, area_id, nombre, apellido, email, password_hash, activo, creado_en) VALUES ?',
      usuarios.map((u) => [u.rol, u.area, u.nombre, u.apellido, u.email, u.hash, u.activo, creadoUsuarios])
    );
    const [filasU] = await conn.query('SELECT id, email FROM usuarios');
    const idPorEmail = new Map(filasU.map((r) => [r.email, r.id]));
    usuarios.forEach((u) => (u.id = idPorEmail.get(u.email)));
    const porClave = Object.fromEntries(usuarios.filter((u) => u.clave).map((u) => [u.clave, u]));
    const admins = [admin, camila, diego];
    const colaboradores = usuarios.filter((u) => u.rol === ROL.COLAB && u.activo);

    // Perfil de red de cada usuario
    const subred = { [AREA.GER]: 1, [AREA.TI]: 2, [AREA.OPE]: 3, [AREA.TRA]: 4, [AREA.FIN]: 1, [AREA.COM]: 4, [AREA.RRHH]: 1 };
    usuarios.forEach((u, i) => {
      const terreno = u.area === AREA.OPE || u.area === AREA.TRA;
      u.ip = `10.20.${subred[u.area]}.${10 + ((i * 7) % 240)}`;
      u.ua = terreno && prob(0.45) ? elegir(UA_MOVIL) : elegir(UA_PC);
      u.ipAlt = prob(0.4) ? (prob(0.5) ? `190.151.${entre(1, 254)}.${entre(1, 254)}` : `10.20.${entre(1, 4)}.${entre(10, 250)}`) : null;
      u.terreno = terreno;
    });
    // IPs de las capturas para las cuentas de demostración
    admin.ip = '10.20.2.9';
    demo.ip = '10.20.4.23';

    // -------------------------------------------------------------- activos
    const usuariosPorArea = {};
    colaboradores.forEach((u) => (usuariosPorArea[u.area] = usuariosPorArea[u.area] || []).push(u));
    const filasActivos = ACTIVOS.map(([nombre, ident, tipo, area, crit, ubic, resp]) => {
      const r = resp ? porClave[resp] : elegir(usuariosPorArea[area] || colaboradores);
      return [tipo, area, r ? r.id : null, nombre, ident, crit, ubic, creadoUsuarios];
    });
    await insertarLotes(
      conn,
      'INSERT INTO activos (tipo_activo_id, area_id, responsable_id, nombre, identificador, criticidad, ubicacion, creado_en) VALUES ?',
      filasActivos
    );
    const [filasA] = await conn.query('SELECT id, identificador FROM activos');
    const activoId = new Map(filasA.map((r) => [r.identificador, r.id]));

    // ----------------------------------------------------------- incidentes
    const incidentes = [];
    const nuevoInc = (o) => incidentes.push(o);

    // Los 6 incidentes del colaborador de demostración (como en las capturas)
    const demoIncs = [
      [CAT.PHISHING, 'Mensaje de "soporte TI" pidiendo contraseña del ERP', 'Recibí un correo de "soporte TI" que pedía confirmar mi contraseña del ERP en un enlace. No hice clic.', SEV.BAJA, EST.REPORTADO, 0.4, null],
      [CAT.ACCESO, 'Persona ajena en la sala de servidores', 'Vi a una persona sin credencial saliendo de la sala de servidores del centro de distribución.', SEV.ALTA, EST.REPORTADO, 2.5, 'SRV-FILES-002'],
      [CAT.PERDIDA, 'Robo de notebook en terreno', 'Me robaron el notebook de la empresa desde el vehículo durante una visita a cliente.', SEV.MEDIA, EST.CONTENCION, 8.4, 'NB-021'],
      [CAT.MALWARE, 'Pendrive desconocido conectado en terminal de bodega', 'Un pendrive sin rotular estaba conectado al terminal de mano de bodega al iniciar el turno.', SEV.MEDIA, EST.ANALISIS, 11, 'TM-024'],
      [CAT.INDISP, 'Portal de seguimiento no responde', 'Los clientes llaman porque el portal de seguimiento de envíos no carga.', SEV.ALTA, EST.RESUELTO, 14.1, 'APP-TRACKING-006'],
      [CAT.MALWARE, 'Antivirus detecta troyano en notebook', 'El antivirus mostró una alerta de troyano al abrir un adjunto comprimido.', SEV.MEDIA, EST.RESUELTO, 23.5, 'NB-021'],
    ];
    for (const [cat, titulo, desc, sev, est, diasAtras, act] of demoIncs) {
      const creado = new Date(ahora.getTime() - diasAtras * DIA);
      creado.setSeconds(0, 0);
      nuevoInc({ cat, titulo, desc, sev, est, creado, reporta: demo, activo: act, responsable: est === EST.REPORTADO ? null : camila });
    }

    // 66 incidentes adicionales distribuidos en 120 días
    const cats = [CAT.PHISHING, CAT.PHISHING, CAT.PHISHING, CAT.MALWARE, CAT.MALWARE, CAT.ACCESO, CAT.ACCESO, CAT.PERDIDA, CAT.PERDIDA, CAT.FUGA, CAT.INDISP, CAT.INDISP];
    while (incidentes.length < 72) {
      const cat = elegir(cats);
      const [titulo, desc, acts] = elegir(PLANTILLAS[cat]);
      const diasAtras = rnd() < 0.3 ? rnd() * 12 : 12 + rnd() * 108;
      const creado = new Date(ahora.getTime() - diasAtras * DIA);
      creado.setHours(entre(8, 19), entre(0, 59), 0, 0);
      if (creado > ahora) creado.setTime(ahora.getTime() - entre(1, 6) * HORA);
      let est;
      if (diasAtras < 3) est = elegir([EST.REPORTADO, EST.REPORTADO, EST.ANALISIS, EST.CONTENCION]);
      else if (diasAtras < 12) est = elegir([EST.ANALISIS, EST.CONTENCION, EST.RESUELTO, EST.DESCARTADO]);
      else est = elegir([EST.RESUELTO, EST.RESUELTO, EST.CERRADO, EST.CERRADO, EST.CERRADO, EST.DESCARTADO]);
      const sev = cat === CAT.FUGA || (cat === CAT.INDISP && prob(0.5)) ? elegir([SEV.ALTA, SEV.CRITICA]) : elegir([SEV.BAJA, SEV.MEDIA, SEV.MEDIA, SEV.ALTA]);
      nuevoInc({
        cat, titulo, desc, sev, est, creado,
        reporta: prob(0.1) ? elegir(admins) : elegir(colaboradores),
        activo: acts.length && prob(0.8) ? elegir(acts) : null,
        responsable: est === EST.REPORTADO ? null : elegir(admins),
      });
    }

    // Códigos correlativos por año según la fecha de creación
    incidentes.sort((a, b) => a.creado - b.creado);
    const correlativo = {};
    const seguimientos = [];
    for (const inc of incidentes) {
      const anio = inc.creado.getFullYear();
      correlativo[anio] = (correlativo[anio] || 0) + 1;
      inc.codigo = `INC-${anio}-${String(correlativo[anio]).padStart(5, '0')}`;
      inc.deteccion = new Date(inc.creado.getTime() - entre(5, 120) * MIN);

      // Línea de tiempo coherente con el estado final
      const pasos = { [EST.REPORTADO]: [], [EST.ANALISIS]: [EST.ANALISIS], [EST.CONTENCION]: [EST.ANALISIS, EST.CONTENCION],
        [EST.RESUELTO]: [EST.ANALISIS, EST.CONTENCION, EST.RESUELTO], [EST.CERRADO]: [EST.ANALISIS, EST.CONTENCION, EST.RESUELTO, EST.CERRADO],
        [EST.DESCARTADO]: [EST.ANALISIS, EST.DESCARTADO] }[inc.est];
      let t = inc.creado.getTime();
      inc.segs = [{ usuario: inc.reporta, de: null, a: EST.REPORTADO, texto: 'Incidente reportado.', fecha: new Date(t) }];
      let anterior = EST.REPORTADO;
      for (const p of pasos) {
        const previo = t;
        t += entre(1, p === EST.CERRADO ? 72 : 18) * HORA + entre(0, 59) * MIN;
        // Nunca en el futuro y siempre después del paso anterior.
        if (t >= ahora.getTime()) t = previo + Math.max(MIN, Math.floor((ahora.getTime() - previo) / 2));
        const texto = {
          [EST.ANALISIS]: 'Se inicia el análisis. Se solicitan antecedentes y evidencias al reportante.',
          [EST.CONTENCION]: CONTENCION[inc.cat],
          [EST.RESUELTO]: 'Se erradica la amenaza y se verifica la operación normal. Se informa al reportante.',
          [EST.CERRADO]: 'Caso cerrado. Se registran las lecciones aprendidas y se actualiza la guía de respuesta.',
          [EST.DESCARTADO]: 'Tras el análisis se determina que no corresponde a un incidente de seguridad (falso positivo).',
        }[p];
        inc.segs.push({ usuario: inc.responsable, de: anterior, a: p, texto, fecha: new Date(t) });
        anterior = p;
        if (p === EST.ANALISIS && prob(0.25) && t + 10 * MIN < ahora.getTime()) {
          t += Math.min(entre(10, 120) * MIN, Math.floor((ahora.getTime() - t) / 2));
          inc.segs.push({ usuario: inc.reporta, de: null, a: null, texto: 'Agrego antecedentes: no hice clic en ningún enlace y no entregué información.', fecha: new Date(t) });
        }
      }
      inc.cerrado = [EST.RESUELTO, EST.CERRADO, EST.DESCARTADO].includes(inc.est) ? inc.segs[inc.segs.length - 1].fecha : null;
    }

    await insertarLotes(
      conn,
      `INSERT INTO incidentes (codigo, titulo, descripcion, categoria_id, severidad_id, estado_id, activo_id,
         reportado_por, asignado_a, fecha_deteccion, creado_en, actualizado_en, cerrado_en) VALUES ?`,
      incidentes.map((i) => [
        i.codigo, i.titulo, i.desc, i.cat, i.sev, i.est, i.activo ? activoId.get(i.activo) : null,
        i.reporta.id, i.responsable ? i.responsable.id : null, i.deteccion, i.creado,
        i.segs[i.segs.length - 1].fecha, i.cerrado,
      ])
    );
    const [filasI] = await conn.query('SELECT id, codigo FROM incidentes');
    const incId = new Map(filasI.map((r) => [r.codigo, r.id]));
    for (const i of incidentes) {
      for (const s of i.segs) {
        seguimientos.push([incId.get(i.codigo), s.usuario ? s.usuario.id : null, s.de, s.a, s.texto, s.fecha]);
      }
    }
    await insertarLotes(
      conn,
      'INSERT INTO seguimientos_incidente (incidente_id, usuario_id, estado_anterior_id, estado_nuevo_id, comentario, creado_en) VALUES ?',
      seguimientos
    );

    // -------------------------------------------------- eventos de acceso
    const eventos = [];
    const alertas = [];
    const ev = (tipo, u, email, ip, ua, fecha) => {
      if (fecha <= ahora) eventos.push([tipo, u ? u.id : null, email, ip, ua, fecha]);
    };
    const alerta = (regla, desc, sev, u, ip, fecha) => {
      if (fecha <= ahora) alertas.push({ regla, desc, sev, usuario: u ? u.id : null, ip, fecha });
    };
    const pad = (n) => String(n).padStart(2, '0');
    const ultimoLogin = new Map();
    const ipsVistas = new Map(usuarios.map((u) => [u.id, new Set([u.ip])]));

    const DIAS = 60;
    const activos = usuarios.filter((u) => u.activo);
    for (let d = DIAS - 1; d >= 0; d--) {
      const dia = enDia(ahora, d, 0);
      const dow = dia.getDay(); // 0 domingo
      for (const u of activos) {
        const laboral = dow >= 1 && dow <= 5 ? true : dow === 6 && u.terreno ? prob(0.5) : false;
        if (!laboral || !prob(0.9)) continue;

        // Las sesiones expiran tras 30 min de inactividad: varios inicios por día.
        const sesiones = u.terreno ? entre(2, 6) : entre(3, 7);
        let minuto = entre(7 * 60 + 30, 9 * 60 + 15);
        for (let s = 0; s < sesiones && minuto < 19 * 60 + 30; s++) {
          let ip = u.ip;
          if (u.ipAlt && prob(0.02)) ip = u.ipAlt;
          const inicio = enDia(ahora, d, Math.floor(minuto / 60), minuto % 60, entre(0, 59));

          if (prob(0.07)) {
            // Error de tipeo antes de entrar
            const n = prob(0.8) ? 1 : 2;
            for (let k = n; k >= 1; k--) ev(EV.LOGIN_FALLIDO, u, u.email, ip, u.ua, new Date(inicio.getTime() - k * entre(15, 50) * 1000));
          }
          if (!ipsVistas.get(u.id).has(ip)) {
            ipsVistas.get(u.id).add(ip);
            alerta('IP_NUEVA', `Inicio de sesión de ${u.email} desde una IP no utilizada en 90 días (${ip})`, SEV.MEDIA, u, ip, inicio);
          }
          ev(EV.LOGIN_OK, u, u.email, ip, u.ua, inicio);
          ultimoLogin.set(u.id, inicio);
          const dur = entre(25, 110);
          if (prob(0.75)) ev(EV.LOGOUT, u, u.email, ip, u.ua, new Date(inicio.getTime() + dur * MIN));
          minuto += dur + entre(10, 90);
        }

        // Inicio de sesión fuera del horario laboral (poco frecuente)
        if (prob(0.012)) {
          const h = prob(0.7) ? entre(20, 23) : entre(5, 6);
          const f = enDia(ahora, d, h, entre(0, 59), entre(0, 59));
          ev(EV.LOGIN_OK, u, u.email, u.ip, u.ua, f);
          if (prob(0.6)) ev(EV.LOGOUT, u, u.email, u.ip, u.ua, new Date(f.getTime() + entre(5, 40) * MIN));
          alerta('FUERA_HORARIO', `Inicio de sesión de ${u.email} fuera del horario laboral (${pad(h)}:${pad(f.getMinutes())} h)`, SEV.BAJA, u, u.ip, f);
          if (!ultimoLogin.has(u.id) || ultimoLogin.get(u.id) < f) ultimoLogin.set(u.id, f);
        }
      }
    }

    // Campañas de credential stuffing desde IPs externas
    const objetivos = usuarios.map((u) => u.email);
    const inexistentes = Array.from({ length: 80 }, (_, i) => `${elegir(['ventas', 'contacto', 'rrhh', 'soporte', 'admin', 'gerencia', 'bodega', 'finanzas'])}${i}@translogix.cl`);
    for (const ip of IPS_ATACANTES) {
      const n = entre(7, 10);
      for (let c = 0; c < n; c++) {
        const d = entre(0, DIAS - 1);
        const dow = enDia(ahora, d, 0).getDay();
        // Más actividad de noche y en fines de semana
        const hora = dow === 0 || dow === 6 ? entre(0, 23) : elegir([0, 1, 2, 3, 4, 12, 13, 20, 21, 22, 23]);
        const inicio = enDia(ahora, d, hora, entre(0, 59));
        const intentos = entre(120, 320);
        const dur = entre(15, 45) * MIN;
        const ua = elegir(UA_BOT);
        const cuentas = new Set();
        for (let k = 0; k < intentos; k++) {
          const email = prob(0.75) ? elegir(objetivos) : elegir(inexistentes);
          cuentas.add(email);
          const u = usuarios.find((x) => x.email === email) || null;
          ev(EV.LOGIN_FALLIDO, u, email, ip, ua, new Date(inicio.getTime() + Math.floor((k / intentos) * dur)));
        }
        alerta('IP_SOSPECHOSA', `La IP ${ip} acumula ${Math.min(intentos, 270)} fallos contra ${Math.min(cuentas.size, 120)} cuentas en 15 min`, SEV.CRITICA, null, ip, new Date(inicio.getTime() + 2 * MIN));
      }
    }

    // Ruido de fondo: escaneos breves desde muchas IPs
    for (let i = 0; i < 45; i++) {
      const ip = `${elegir([45, 77, 89, 141, 154, 176, 193, 194, 212])}.${entre(1, 254)}.${entre(1, 254)}.${entre(1, 254)}`;
      const ua = elegir(UA_BOT);
      for (let b = entre(1, 3); b > 0; b--) {
        const inicio = enDia(ahora, entre(0, DIAS - 1), entre(0, 23), entre(0, 59));
        const n = entre(5, 25);
        for (let k = 0; k < n; k++) {
          const email = elegir(prob(0.6) ? objetivos : inexistentes);
          ev(EV.LOGIN_FALLIDO, usuarios.find((x) => x.email === email) || null, email, ip, ua, new Date(inicio.getTime() + k * entre(5, 40) * 1000));
        }
      }
    }

    // Episodios de fuerza bruta contra cuentas puntuales (bloqueo + alerta)
    for (let i = 0; i < 7; i++) {
      const u = elegir(colaboradores);
      const ip = `${elegir([185, 103, 45])}.${entre(1, 254)}.${entre(1, 254)}.${entre(1, 254)}`;
      const inicio = enDia(ahora, entre(1, DIAS - 1), entre(0, 23), entre(0, 59));
      const ua = elegir(UA_BOT);
      for (let k = 0; k < 5; k++) ev(EV.LOGIN_FALLIDO, u, u.email, ip, ua, new Date(inicio.getTime() + k * 20 * 1000));
      const fin = new Date(inicio.getTime() + 100 * 1000);
      ev(EV.CUENTA_BLOQUEADA, u, u.email, ip, ua, fin);
      alerta('FUERZA_BRUTA', `Cuenta ${u.email} bloqueada 15 min tras 5 intentos fallidos desde ${ip}`, SEV.ALTA, u, ip, fin);
    }

    // Otros eventos: recuperaciones, cambios de contraseña, accesos denegados
    for (let i = 0; i < 40; i++) {
      const u = elegir(colaboradores);
      const f = enDia(ahora, entre(0, DIAS - 1), entre(8, 18), entre(0, 59));
      ev(EV.RECUPERACION, u, u.email, u.ip, u.ua, f);
      if (prob(0.8)) ev(EV.PASSWORD, u, u.email, u.ip, u.ua, new Date(f.getTime() + entre(2, 20) * MIN));
    }
    for (let i = 0; i < 25; i++) {
      const u = elegir(colaboradores);
      ev(EV.DENEGADO, u, u.email, u.ip, u.ua, enDia(ahora, entre(0, DIAS - 1), entre(8, 18), entre(0, 59)));
    }

    // Accesos recientes de las cuentas de demostración (como en las capturas)
    ev(EV.LOGOUT, demo, demo.email, demo.ip, UA_PC[0], new Date(ahora.getTime() - 26 * HORA));
    ev(EV.LOGIN_OK, demo, demo.email, demo.ip, UA_PC[0], new Date(ahora.getTime() - 9 * HORA));

    // Orden cronológico: el id autoincremental queda alineado con la fecha,
    // como ocurre en producción (lo aprovecha la paginación por cursor).
    eventos.sort((a, b) => a[5] - b[5]);
    await insertarLotes(
      conn,
      'INSERT INTO eventos_acceso (tipo_evento_id, usuario_id, email_intentado, ip, user_agent, creado_en) VALUES ?',
      eventos
    );
    // Agregado por día, hora y tipo para el panel analítico.
    await reconstruirResumen(conn);

    // --------------------------------------------------------------- alertas
    // Las alertas antiguas aparecen revisadas; las de los últimos días, pendientes.
    alertas.sort((a, b) => a.fecha - b.fecha);
    const limitePendiente = ahora.getTime() - 5 * DIA;
    await insertarLotes(
      conn,
      'INSERT INTO alertas (regla, descripcion, severidad_id, usuario_id, ip, revisada, revisada_por, revisada_en, creado_en) VALUES ?',
      alertas.map((a) => {
        const revisada = a.fecha.getTime() < limitePendiente;
        const rev = revisada ? elegir(admins) : null;
        return [
          a.regla, a.desc.slice(0, 255), a.sev, a.usuario, a.ip, revisada ? 1 : 0,
          rev ? rev.id : null, revisada ? new Date(a.fecha.getTime() + entre(1, 30) * HORA) : null, a.fecha,
        ];
      })
    );

    // Último inicio de sesión de cada usuario
    for (const [id, f] of ultimoLogin) {
      await conn.execute('UPDATE usuarios SET ultimo_login = ? WHERE id = ?', [f, id]);
    }

    await conn.commit();
    console.log(
      `[seed] listo en ${((Date.now() - t0) / 1000).toFixed(1)} s: ${usuarios.length} usuarios, ${ACTIVOS.length} activos, ` +
        `${incidentes.length} incidentes, ${eventos.length} eventos, ${alertas.length} alertas`
    );
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { seed };
