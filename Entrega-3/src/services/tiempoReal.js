'use strict';

// Eventos web dinámicos con Socket.IO (WebSocket con respaldo de long-polling).
//
// Salas:
//   rol:Administrador  -> alertas nuevas, eventos de acceso en vivo, incidentes nuevos
//   usuario:<id>       -> cambios de estado de los incidentes que reportó
//
// Autenticación del socket: la misma sesión del navegador (cookie HttpOnly)
// o, para clientes de la API, un JWT en handshake.auth.token.

const { Server } = require('socket.io');
const tokens = require('./tokens');

let io = null;
const SALA_ADMIN = 'rol:Administrador';

function iniciar(httpServer, sessionMiddleware) {
  io = new Server(httpServer, {
    serveClient: true,
    // Mismo origen: el navegador solo puede conectarse desde la propia aplicación.
    cors: { origin: false },
    maxHttpBufferSize: 1e4, // los clientes no envían datos, solo escuchan
  });

  // Comparte express-session con Socket.IO (lee la cookie firmada `sid`).
  io.engine.use(sessionMiddleware);

  io.use(async (socket, next) => {
    try {
      const sesion = socket.request.session;
      if (sesion && sesion.user) {
        socket.data.user = sesion.user;
        return next();
      }
      const token = socket.handshake.auth && socket.handshake.auth.token;
      if (token) {
        const user = await tokens.usuarioDesdeToken(token);
        if (user) {
          socket.data.user = user;
          return next();
        }
      }
      next(new Error('no autenticado'));
    } catch (err) {
      next(new Error('no autenticado'));
    }
  });

  io.on('connection', (socket) => {
    const u = socket.data.user;
    socket.join(`usuario:${u.id}`);
    if (socket.request.sessionID) socket.data.sid = socket.request.sessionID;
    if (u.rol === 'Administrador') socket.join(SALA_ADMIN);
    socket.emit('conectado', { rol: u.rol });
  });

  return io;
}

/** Envía un evento a todos los administradores conectados. */
function aAdmins(evento, datos) {
  if (io) io.to(SALA_ADMIN).emit(evento, datos);
}

/** Envía un evento a las pestañas abiertas de un usuario. */
function aUsuario(usuarioId, evento, datos) {
  if (io && usuarioId) io.to(`usuario:${usuarioId}`).emit(evento, datos);
}

/**
 * Corta las conexiones en vivo de un usuario (cuenta desactivada, cambio de
 * perfil o de contraseña), salvo las de la sesión indicada.
 */
function desconectarUsuario(usuarioId, exceptoSid = null) {
  if (!io) return;
  for (const s of io.sockets.sockets.values()) {
    if (s.data.user.id === usuarioId && (!exceptoSid || s.data.sid !== exceptoSid)) s.disconnect(true);
  }
}

/** Corta las conexiones en vivo de una sesión que se cerró. */
function desconectarSesion(sid) {
  if (!io || !sid) return;
  for (const s of io.sockets.sockets.values()) if (s.data.sid === sid) s.disconnect(true);
}

function cerrar() {
  if (io) io.close();
}

module.exports = { iniciar, aAdmins, aUsuario, desconectarUsuario, desconectarSesion, cerrar };
