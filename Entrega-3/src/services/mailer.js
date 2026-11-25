'use strict';

const nodemailer = require('nodemailer');
const config = require('../config');

const transport = nodemailer.createTransport({
  host: config.mail.host,
  port: config.mail.port,
  secure: config.mail.secure,
  requireTLS: !config.mail.secure && config.mail.requireTLS,
  auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
});

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function enviarRecuperacion({ para, nombre, enlace, minutos }) {
  const html = `<!doctype html>
<html lang="es"><body style="margin:0;padding:24px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <div style="max-width:520px;margin:0 auto">
    <h1 style="color:#0f766e;font-size:24px;margin:0 0 16px">SentinelData</h1>
    <p style="font-size:15px">Hola <strong>${esc(nombre)}</strong>:</p>
    <p style="font-size:15px;line-height:1.4">Recibimos una solicitud para restablecer tu contraseña. El enlace es válido por ${minutos} minutos y solo puede usarse una vez.</p>
    <p style="text-align:center;margin:24px 0">
      <a href="${esc(enlace)}" style="background:#0f766e;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-size:15px;display:inline-block">Restablecer contraseña</a>
    </p>
    <p style="font-size:12px;color:#64748b">Si no solicitaste este cambio, ignora este mensaje y avisa al equipo de seguridad.</p>
  </div>
</body></html>`;
  const text =
    `Hola ${nombre}:\n\nRecibimos una solicitud para restablecer tu contraseña. ` +
    `El enlace es válido por ${minutos} minutos y solo puede usarse una vez:\n\n${enlace}\n\n` +
    `Si no solicitaste este cambio, ignora este mensaje y avisa al equipo de seguridad.`;

  await transport.sendMail({
    from: config.mail.from,
    to: para,
    subject: 'SentinelData - Recuperación de contraseña',
    text,
    html,
  });
}

module.exports = { enviarRecuperacion };
