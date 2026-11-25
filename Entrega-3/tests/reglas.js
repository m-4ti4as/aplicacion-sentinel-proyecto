'use strict';

// Pruebas de integración de las cuatro reglas de detección (CP-40 a CP-43) y de
// la coherencia del resumen agregado (CP-44). Usan los servicios con fechas
// controladas, directamente sobre MySQL (variables DB_*):
//
//   npm run test:reglas
//
// Los datos de prueba usan IP del rango de documentación 203.0.113.0/24 y se
// eliminan al terminar.

const { pool, one } = require('../src/db/pool');
const catalogos = require('../src/services/catalogos');
const eventos = require('../src/services/eventos');
const deteccion = require('../src/services/deteccion');

let aprobadas = 0;
let fallidas = 0;
function check(cond, desc) {
  if (cond) aprobadas++;
  else fallidas++;
  console.log(`   ${cond ? '✔' : '✘'} ${desc}`);
}
const IP = '203.0.113.77';
const req = (ip) => ({ ip, get: () => 'prueba-reglas' });
const alertas = async (regla, ip = IP) => Number((await one('SELECT COUNT(*) AS n FROM alertas WHERE regla = ? AND ip = ?', [regla, ip])).n);
async function limpiar() {
  await pool.query("DELETE FROM alertas WHERE ip LIKE '203.0.113.%'");
  await pool.query("DELETE FROM eventos_acceso WHERE ip LIKE '203.0.113.%'");
}

(async () => {
  await catalogos.cargar();
  await limpiar();
  const u = await one("SELECT id, email FROM usuarios WHERE email = 'colaborador@translogix.cl'");
  const fallo = (email) => eventos.insertar(pool, 'LOGIN_FALLIDO', { req: req(IP), email });

  console.log('CP-40 · FUERZA_BRUTA: alerta al bloquear la cuenta');
  await deteccion.alertaFuerzaBruta(u, IP);
  check((await alertas('FUERZA_BRUTA')) === 1, 'alerta Alta con la cuenta y la IP de origen');

  console.log('CP-41 · IP_SOSPECHOSA: 10 fallos o más contra 3 cuentas o más en 15 min');
  for (let i = 0; i < 9; i++) await fallo(`cuenta${i % 3}@translogix.cl`);
  check((await deteccion.evaluarIpSospechosa(IP)) === false, '9 fallos contra 3 cuentas: sin alerta');
  await fallo('cuenta0@translogix.cl');
  check((await deteccion.evaluarIpSospechosa(IP)) === true, '10 fallos contra 3 cuentas: alerta');
  await fallo('cuenta1@translogix.cl');
  check((await deteccion.evaluarIpSospechosa(IP)) === false && (await alertas('IP_SOSPECHOSA')) === 1, 'una sola alerta por IP en la ventana');
  const otra = '203.0.113.78';
  for (let i = 0; i < 12; i++) await eventos.insertar(pool, 'LOGIN_FALLIDO', { req: req(otra), email: `cuenta${i % 2}@translogix.cl` });
  check((await deteccion.evaluarIpSospechosa(otra)) === false, '12 fallos contra solo 2 cuentas: sin alerta');

  console.log('CP-42 · IP_NUEVA: IP no utilizada en 90 días');
  check((await deteccion.esIpNueva(u.id, IP)) === true, 'IP nunca usada: es nueva');
  await deteccion.alertaIpNueva(u, IP);
  check((await alertas('IP_NUEVA')) === 1, 'alerta Media generada');
  await eventos.insertar(pool, 'LOGIN_OK', { req: req(IP), usuarioId: u.id, email: u.email, fecha: new Date(Date.now() - 89 * 86400000) });
  check((await deteccion.esIpNueva(u.id, IP)) === false, 'usada hace 89 días: no es nueva');
  await pool.execute('UPDATE eventos_acceso SET creado_en = ? WHERE ip = ? AND usuario_id = ?', [new Date(Date.now() - 91 * 86400000), IP, u.id]);
  check((await deteccion.esIpNueva(u.id, IP)) === true, 'usada hace 91 días: vuelve a ser nueva');

  console.log('CP-43 · FUERA_HORARIO: antes de las 07:00 o desde las 20:00');
  const hora = (h, m) => {
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
  };
  check((await deteccion.evaluarFueraHorario(u, IP, hora(6, 59))) === true, '06:59 genera alerta');
  check((await deteccion.evaluarFueraHorario(u, IP, hora(7, 0))) === false, '07:00 no genera alerta');
  check((await deteccion.evaluarFueraHorario(u, IP, hora(19, 59))) === false, '19:59 no genera alerta');
  check((await deteccion.evaluarFueraHorario(u, IP, hora(20, 0))) === true, '20:00 genera alerta');

  await limpiar();

  console.log('CP-44 · El resumen agregado coincide con los eventos');
  const a = await one('SELECT SUM(total) AS n FROM resumen_eventos_hora');
  const b = await one('SELECT COUNT(*) AS n FROM eventos_acceso');
  check(Number(a.n) === Number(b.n), `resumen ${a.n} = eventos ${b.n}`);

  console.log(`\nResultado: ${aprobadas} de ${aprobadas + fallidas} verificaciones aprobadas.`);
})()
  .catch((err) => {
    console.error(err);
    fallidas++;
  })
  .finally(async () => {
    await pool.end();
    process.exit(fallidas ? 1 : 0);
  });
