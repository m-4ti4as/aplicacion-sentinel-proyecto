'use strict';

const http = require('http');
const config = require('./config');
const { initDatabase } = require('./db/init');
const catalogos = require('./services/catalogos');
const tiempoReal = require('./services/tiempoReal');

async function main() {
  await initDatabase();
  await catalogos.cargar();

  const app = require('./app');
  const server = http.createServer(app);
  // Eventos web dinámicos (Socket.IO) sobre el mismo servidor HTTP y puerto.
  tiempoReal.iniciar(server, app.locals.sessionMiddleware);

  server.listen(config.port, () => {
    console.log(`[app] SentinelData escuchando en ${config.appUrl} (puerto ${config.port}, ${config.env})`);
  });

  const cerrar = () => {
    console.log('[app] cerrando...');
    tiempoReal.cerrar();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', cerrar);
  process.on('SIGINT', cerrar);
}

main().catch((err) => {
  console.error('[app] no se pudo iniciar:', err);
  process.exit(1);
});
