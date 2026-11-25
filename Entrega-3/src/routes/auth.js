'use strict';

const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { body } = require('express-validator');

const config = require('../config');
const { pool, one, transaction } = require('../db/pool');
const catalogos = require('../services/catalogos');
const eventos = require('../services/eventos');
const autenticacion = require('../services/autenticacion');
const mailer = require('../services/mailer');
const sesiones = require('../services/sesiones');
const tiempoReal = require('../services/tiempoReal');
const { soloInvitados } = require('../middleware/auth');
const { renovar } = require('../middleware/csrf');
const { flash } = require('../middleware/locals');
const v = require('../utils/validacion');

const router = express.Router();

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---------------------------------------------------------------------
// Inicio de sesión (RF-01, RF-04). La verificación vive en
// services/autenticacion.js y la comparte la API REST.
// ---------------------------------------------------------------------
router.get('/login', soloInvitados, (req, res) => {
  res.render('auth/login', { titulo: 'Iniciar sesión' });
});

router.post(
  '/login',
  soloInvitados,
  [v.reglaEmail('email'), body('password').notEmpty().withMessage('Ingresa tu contraseña')],
  async (req, res, next) => {
    try {
      const email = String(req.body.email || '').trim().toLowerCase();
      const fallo = (status, error) =>
        res.status(status).render('auth/login', { titulo: 'Iniciar sesión', error, valores: { email } });

      if (v.errores(req)) return fallo(422, autenticacion.MSG_LOGIN);

      const r = await autenticacion.autenticar(email, req.body.password, req);
      if (!r.ok) return fallo(r.status, r.mensaje);

      const volverA = req.session.volverA;
      // Se regenera la sesión para prevenir la fijación de sesión.
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.user = r.usuario;
        renovar(req);
        const destino = typeof volverA === 'string' && volverA.startsWith('/') && !volverA.startsWith('//') ? volverA : '/panel';
        req.session.save((err2) => (err2 ? next(err2) : res.redirect(destino)));
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------
// Cierre de sesión
// ---------------------------------------------------------------------
router.post('/logout', async (req, res, next) => {
  try {
    const u = req.session.user;
    if (u) await eventos.registrar('LOGOUT', { req, usuarioId: u.id, email: u.email });
    const sid = req.sessionID;
    req.session.destroy(() => {
      tiempoReal.desconectarSesion(sid);
      res.clearCookie('sid');
      res.redirect('/login');
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// Registro de colaboradores (RF-02)
// ---------------------------------------------------------------------
router.get('/registro', soloInvitados, (req, res) => {
  res.render('auth/registro', { titulo: 'Crear cuenta', areas: catalogos.get().areas });
});

router.post(
  '/registro',
  soloInvitados,
  [
    v.reglaNombre('nombre', 'El nombre'),
    v.reglaNombre('apellido', 'El apellido'),
    v.reglaEmail('email'),
    body('area_id')
      .custom((val) => catalogos.get().areas.some((a) => a.id === Number(val)))
      .withMessage('Selecciona tu área'),
    v.reglaPassword('password'),
    v.reglaConfirmar('password2', 'password'),
    body('acepta').equals('1').withMessage('Debes aceptar la política de uso'),
  ],
  async (req, res, next) => {
    try {
      const valores = {
        nombre: req.body.nombre,
        apellido: req.body.apellido,
        email: req.body.email,
        area_id: req.body.area_id,
      };
      const render = (errores) =>
        res.status(422).render('auth/registro', { titulo: 'Crear cuenta', areas: catalogos.get().areas, errores, valores });

      const errores = v.errores(req);
      if (errores) return render(errores);

      const existe = await one('SELECT id FROM usuarios WHERE email = ?', [valores.email]);
      if (existe) return render({ email: 'Ya existe una cuenta con este correo' });

      const hash = await bcrypt.hash(req.body.password, config.security.bcryptCost);
      const [r] = await pool.execute(
        `INSERT INTO usuarios (rol_id, area_id, nombre, apellido, email, password_hash)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [catalogos.get().rolId.Colaborador, Number(valores.area_id), valores.nombre, valores.apellido, valores.email, hash]
      );
      await eventos.registrar('REGISTRO', { req, usuarioId: r.insertId, email: valores.email });
      flash(req, 'ok', 'Cuenta creada con perfil Colaborador. Ya puedes iniciar sesión.');
      res.redirect('/login');
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(422).render('auth/registro', {
          titulo: 'Crear cuenta',
          areas: catalogos.get().areas,
          errores: { email: 'Ya existe una cuenta con este correo' },
          valores: req.body,
        });
      }
      next(err);
    }
  }
);

// ---------------------------------------------------------------------
// Recuperación de contraseña (RF-03)
// ---------------------------------------------------------------------
const MSG_RECUPERAR =
  'Si el correo corresponde a una cuenta activa, recibirás un enlace para restablecer tu contraseña. Revisa tu bandeja de entrada.';

router.get('/recuperar', soloInvitados, (req, res) => {
  res.render('auth/recuperar', { titulo: 'Recuperar contraseña' });
});

router.post('/recuperar', soloInvitados, [v.reglaEmail('email')], async (req, res, next) => {
  try {
    const errores = v.errores(req);
    if (errores) {
      return res.status(422).render('auth/recuperar', { titulo: 'Recuperar contraseña', errores, valores: req.body });
    }
    const email = req.body.email;
    const u = await one('SELECT id, nombre, email FROM usuarios WHERE email = ? AND activo = 1', [email]);
    await eventos.registrar('RECUPERACION_SOLICITADA', { req, usuarioId: u ? u.id : null, email });

    if (u) {
      const token = crypto.randomBytes(32).toString('hex'); // 256 bits
      const ahora = new Date();
      const expira = new Date(ahora.getTime() + config.security.tokenMinutos * 60000);
      await transaction(async (conn) => {
        // Invalida los enlaces anteriores que no se hayan usado.
        await conn.execute('UPDATE tokens_recuperacion SET usado_en = ? WHERE usuario_id = ? AND usado_en IS NULL', [ahora, u.id]);
        await conn.execute(
          'INSERT INTO tokens_recuperacion (usuario_id, token_hash, expira_en, creado_en) VALUES (?, ?, ?, ?)',
          [u.id, sha256(token), expira, ahora]
        );
      });
      // Se envía en segundo plano: ni el tiempo de respuesta ni un error de SMTP
      // deben revelar si la cuenta existe.
      mailer
        .enviarRecuperacion({
          para: u.email,
          nombre: u.nombre,
          enlace: `${config.appUrl}/restablecer/${token}`,
          minutos: config.security.tokenMinutos,
        })
        .catch((err) => console.error('[mail] no se pudo enviar el correo de recuperación:', err.message));
    }
    flash(req, 'ok', MSG_RECUPERAR);
    res.redirect('/recuperar');
  } catch (err) {
    next(err);
  }
});

async function tokenValido(token) {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return one(
    `SELECT t.id, t.usuario_id, u.email
       FROM tokens_recuperacion t JOIN usuarios u ON u.id = t.usuario_id
      WHERE t.token_hash = ? AND t.usado_en IS NULL AND t.expira_en > ? AND u.activo = 1`,
    [sha256(token), new Date()]
  );
}

const enlaceInvalido = (res) =>
  res.status(400).render('auth/restablecer', { titulo: 'Restablecer contraseña', invalido: true });

router.get('/restablecer/:token', soloInvitados, async (req, res, next) => {
  try {
    const t = await tokenValido(req.params.token);
    if (!t) return enlaceInvalido(res);
    res.render('auth/restablecer', { titulo: 'Restablecer contraseña', token: req.params.token });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/restablecer/:token',
  soloInvitados,
  [v.reglaPassword('password'), v.reglaConfirmar('password2', 'password')],
  async (req, res, next) => {
    try {
      const t = await tokenValido(req.params.token);
      if (!t) return enlaceInvalido(res);
      const errores = v.errores(req);
      if (errores) {
        return res
          .status(422)
          .render('auth/restablecer', { titulo: 'Restablecer contraseña', token: req.params.token, errores });
      }
      const hash = await bcrypt.hash(req.body.password, config.security.bcryptCost);
      const ahora = new Date();
      const usado = await transaction(async (conn) => {
        // La condición "usado_en IS NULL" evita que dos envíos simultáneos usen el mismo token.
        const [r] = await conn.execute('UPDATE tokens_recuperacion SET usado_en = ? WHERE id = ? AND usado_en IS NULL', [ahora, t.id]);
        if (r.affectedRows !== 1) return false;
        await conn.execute(
          'UPDATE usuarios SET password_hash = ?, intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?',
          [hash, t.usuario_id]
        );
        return true;
      });
      if (!usado) return enlaceInvalido(res);
      await sesiones.cerrarDe(t.usuario_id);
      await eventos.registrar('PASSWORD_CAMBIADA', { req, usuarioId: t.usuario_id, email: t.email });
      flash(req, 'ok', 'Tu contraseña fue actualizada. Ya puedes iniciar sesión.');
      res.redirect('/login');
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
