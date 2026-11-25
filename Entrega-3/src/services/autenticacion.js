'use strict';

// Verificación de credenciales compartida por el formulario web (POST /login)
// y la API REST (POST /api/v1/auth/token): mismo bloqueo por intentos,
// mismas reglas de detección y mismo registro de eventos.

const bcrypt = require('bcryptjs');
const config = require('../config');
const { one, all, transaction } = require('../db/pool');
const catalogos = require('./catalogos');
const eventos = require('./eventos');
const deteccion = require('./deteccion');
const tiempoReal = require('./tiempoReal');

// Hash de referencia para comparar cuando el correo no existe y así
// igualar el tiempo de respuesta (evita enumerar cuentas por tiempo).
const HASH_FICTICIO = bcrypt.hashSync('no-es-una-clave-real', config.security.bcryptCost);

const MSG_LOGIN = 'Correo o contraseña incorrectos.';
const minutosRestantes = (hasta) => Math.max(1, Math.ceil((new Date(hasta) - Date.now()) / 60000));

const msgBloqueada = (hasta) =>
  `La cuenta está bloqueada temporalmente por intentos fallidos. Inténtalo en ${minutosRestantes(hasta)} min o recupera tu contraseña.`;
const msgRecienBloqueada = () =>
  `La cuenta fue bloqueada por ${config.security.bloqueoMinutos} minutos tras ${config.security.maxIntentos} intentos fallidos.`;

const vigente = (hasta) => hasta && new Date(hasta) > new Date();
const rechazo = (status, mensaje) => ({ ok: false, status, mensaje });

/**
 * Correo sin cuenta: responde igual que una cuenta real (mismo aviso de bloqueo
 * al quinto intento), para que el bloqueo no revele qué correos existen (RNF-05).
 */
async function falloSinCuenta(email, req) {
  const { maxIntentos, bloqueoMinutos } = config.security;
  const ventana = bloqueoMinutos * 60000;
  const previos = await all(
    `SELECT creado_en FROM eventos_acceso
      WHERE email_intentado = ? AND usuario_id IS NULL AND tipo_evento_id = ? AND creado_en >= ?
      ORDER BY creado_en LIMIT ${Number(maxIntentos)}`,
    [email.slice(0, 190), catalogos.get().tipoEventoId.LOGIN_FALLIDO, new Date(Date.now() - ventana)]
  );
  await eventos.registrar('LOGIN_FALLIDO', { req, email });
  if (previos.length >= maxIntentos) {
    return rechazo(423, msgBloqueada(new Date(previos[maxIntentos - 1].creado_en).getTime() + ventana));
  }
  if (previos.length === maxIntentos - 1) return rechazo(423, msgRecienBloqueada());
  return rechazo(401, MSG_LOGIN);
}

/**
 * Registra el resultado del intento en una sola transacción: bloquea la fila del
 * usuario (FOR UPDATE), inserta el evento y actualiza el contador o el bloqueo.
 * Así varios intentos simultáneos no pueden superar el máximo permitido.
 */
function aplicarIntento(u, ok, email, req) {
  const { maxIntentos, bloqueoMinutos } = config.security;
  return transaction(async (conn) => {
    const [[fila]] = await conn.execute(
      'SELECT activo, intentos_fallidos, bloqueado_hasta FROM usuarios WHERE id = ? FOR UPDATE',
      [u.id]
    );
    const opts = { req, usuarioId: u.id, email };
    // Cuenta bloqueada: se rechaza aunque la contraseña sea correcta (CP-04).
    if (vigente(fila.bloqueado_hasta)) {
      return { tipo: 'bloqueada', hasta: fila.bloqueado_hasta, eventos: [await eventos.insertar(conn, 'LOGIN_FALLIDO', opts)] };
    }
    if (ok && fila.activo) {
      const ahora = new Date();
      const nuevaIp = await deteccion.esIpNueva(u.id, eventos.ipDe(req), ahora, conn);
      await conn.execute('UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_login = ? WHERE id = ?', [ahora, u.id]);
      return { tipo: 'ok', ahora, nuevaIp, eventos: [await eventos.insertar(conn, 'LOGIN_OK', { ...opts, fecha: ahora })] };
    }
    const evs = [await eventos.insertar(conn, 'LOGIN_FALLIDO', opts)];
    if (ok) return { tipo: 'fallo', eventos: evs }; // cuenta desactivada
    const intentos = fila.intentos_fallidos + 1;
    if (intentos < maxIntentos) {
      await conn.execute('UPDATE usuarios SET intentos_fallidos = ? WHERE id = ?', [intentos, u.id]);
      return { tipo: 'fallo', eventos: evs };
    }
    const hasta = new Date(Date.now() + bloqueoMinutos * 60000);
    await conn.execute('UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = ? WHERE id = ?', [hasta, u.id]);
    evs.push(await eventos.insertar(conn, 'CUENTA_BLOQUEADA', opts));
    return { tipo: 'recien-bloqueada', hasta, eventos: evs };
  });
}

/**
 * @returns {Promise<{ok: true, usuario: object} | {ok: false, status: number, mensaje: string}>}
 */
async function autenticar(email, password, req) {
  email = String(email || '').trim().toLowerCase();
  password = String(password || '');

  const u = await one(
    `SELECT u.id, u.nombre, u.apellido, u.email, u.password_hash, u.area_id, r.nombre AS rol
       FROM usuarios u JOIN roles r ON r.id = u.rol_id
      WHERE u.email = ?`,
    [email]
  );
  const ip = eventos.ipDe(req);
  const ok = await bcrypt.compare(password, u ? u.password_hash : HASH_FICTICIO);

  if (!u) {
    const r = await falloSinCuenta(email, req);
    await deteccion.evaluarIpSospechosa(ip);
    return r;
  }

  const res = await aplicarIntento(u, ok, email, req);
  // Recién con la transacción confirmada se actualiza el resumen y se avisa en vivo.
  for (const ev of res.eventos) await eventos.publicar(ev);

  if (res.tipo === 'ok') {
    if (res.nuevaIp) await deteccion.alertaIpNueva(u, ip, res.ahora);
    await deteccion.evaluarFueraHorario(u, ip, res.ahora);
    return {
      ok: true,
      usuario: { id: u.id, nombre: u.nombre, apellido: u.apellido, email: u.email, rol: u.rol, areaId: u.area_id },
    };
  }

  if (res.tipo === 'recien-bloqueada') {
    await deteccion.alertaFuerzaBruta(u, ip);
    tiempoReal.aAdmins('cuenta:bloqueada', { email: u.email, hasta: res.hasta.toISOString() });
  }
  await deteccion.evaluarIpSospechosa(ip);
  if (res.tipo === 'recien-bloqueada') return rechazo(423, msgRecienBloqueada());
  if (res.tipo === 'bloqueada') return rechazo(423, msgBloqueada(res.hasta));
  return rechazo(401, MSG_LOGIN);
}

module.exports = { autenticar, MSG_LOGIN };
