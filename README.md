# SentinelData

Plataforma web para la gestión de incidentes de ciberseguridad y el análisis de eventos de acceso basado en datos, para **TransLogix Ltda.** (empresa ficticia). Proyecto de Título. Los informes y enunciados están en [documentacion/](documentacion/).

**Entrega 3** (Actividad Sumativa Semana 7): bloqueo atómico de cuentas, revalidación y cierre de sesiones, índice cubriente para el panel, tiempos de respuesta de incidentes, despliegue de producción con HTTPS y pruebas de seguridad, reglas y volumen. La **Entrega 2** incorporó la API REST con JWT, los eventos en tiempo real con Socket.IO, la tabla de agregación, el archivado y el particionado.

| Documentación | Contenido |
|---|---|
| [Backend](documentacion/backend.md) | Capas, servicios, API REST, seguridad y tiempo real |
| [Frontend](documentacion/frontend.md) | Vistas, estilos, JavaScript, responsividad y accesibilidad |
| [Base de datos](documentacion/base-de-datos.md) | Modelo, índices, respaldo y mantención |
| [Despliegue](documentacion/despliegue.md) | Publicación en un servidor con HTTPS y SMTP real |

## Stack

| Capa | Tecnología |
|---|---|
| Servidor | Node.js 22 + Express 4 |
| Vistas | Plantillas EJS 3, HTML5 semántico, CSS3 propio (sin frameworks), JavaScript sin dependencias |
| Base de datos | MySQL 8.4 LTS (16 tablas: 14 de dominio en 3FN, 1 de agregación y 1 de sesiones) |
| Seguridad | bcryptjs (costo 12), helmet (CSP, HSTS, X-Frame-Options), express-rate-limit, express-validator, token anti-CSRF propio |
| Sesiones | express-session guardadas en MySQL (tabla `sessions`) |
| Correo | Nodemailer + Mailpit (desarrollo) / SMTP real (producción) |
| Gráficos | Chart.js 4 |
| API REST | Express + JSON, JWT (jsonwebtoken, HS256), OpenAPI 3, errores RFC 7807 |
| Tiempo real | Socket.IO 4 (WebSocket con respaldo de long-polling) |
| Contenedores | Docker + Docker Compose |

## Ejecutar con Docker (recomendado)

Requisito: Docker Desktop.

```bash
docker compose up -d --build
```

| Servicio | URL |
|---|---|
| Aplicación | http://localhost:3000 |
| Mailpit (correos de prueba) | http://localhost:8025 |
| MySQL | localhost:3306 (`sentinel` / `sentinel_dev`) |

Si un puerto está ocupado se puede cambiar con `APP_PUERTO`, `DB_PUERTO`, `MAILPIT_PUERTO` o `SMTP_PUERTO`, por ejemplo `DB_PUERTO=3307 docker compose up -d --build`.

Al primer inicio la aplicación crea las tablas y carga los datos de demostración: 121 usuarios, 31 activos, 72 incidentes y unos 53.000 eventos de acceso de los últimos 60 días, con ataques simulados. La cantidad exacta varía un poco según la hora de la carga. El primer arranque tarda unos segundos mientras MySQL se inicializa.

### Cuentas de prueba

| Perfil | Correo | Contraseña |
|---|---|---|
| Administrador de seguridad | admin@translogix.cl | Admin#2026 |
| Administrador de seguridad | camila.rojas@translogix.cl | Demo#2026 |
| Colaborador | colaborador@translogix.cl | Demo#2026 |

Los demás usuarios generados también usan `Demo#2026`.

## Ejecutar sin Docker

Requisitos: Node.js 20 o superior, MySQL 8.4 y, opcionalmente, Mailpit.

```bash
cp .env.example .env      # ajustar DB_* y SMTP_*
npm install
npm start                 # crea el esquema y los datos si la base está vacía
```

La base de datos indicada en `DB_NAME` debe existir y el usuario necesita permisos sobre ella (no de administrador del servidor).

## Scripts

| Comando | Descripción |
|---|---|
| `npm start` | Inicia la aplicación |
| `npm run dev` | Inicia con recarga automática |
| `npm run db:reset` | Borra las tablas y vuelve a cargar los datos de demostración (solo desarrollo) |
| `npm run test:e2e` | Pruebas de extremo a extremo del Anexo A (CP-01 a CP-17) contra la app en ejecución |
| `npm run test:api` | Pruebas de la API REST y de Socket.IO (CP-21 a CP-32) |
| `npm run test:seguridad` | Bloqueo concurrente, enumeración de cuentas, sesiones, cabeceras y XSS (CP-33 a CP-39) |
| `npm run test:reglas` | Las cuatro reglas de detección y el resumen agregado (CP-40 a CP-44); usa las variables `DB_*` |
| `npm run test:volumen -- 250000 1000000` | Rendimiento del panel con más eventos, sobre una base aparte terminada en `_vol` |
| `npm run resumen:reconstruir` | Recalcula la tabla agregada `resumen_eventos_hora` |
| `npm run eventos:archivar` | Exporta a `archivo/*.jsonl.gz` y elimina los eventos de más de 12 meses (`--meses N`, `--dias N`, `--simular`) |

Para las pruebas e2e se recomienda partir de una base recién inicializada:

```bash
docker compose exec app node src/db/reset.js
npm install
npm run test:e2e
npm run test:api
npm run test:seguridad
DB_PASSWORD=sentinel_dev npm run test:reglas
```

Las pruebas hacen varias decenas de inicios de sesión; si se repiten muchas veces en 15 minutos actúa el límite de solicitudes (reiniciar la app lo restablece).

## API REST

Documentación navegable en **http://localhost:3000/api/docs** y especificación OpenAPI 3 en `/api/openapi.json` (importable en Postman).

```bash
# 1. Obtener un token (vigencia 15 min)
curl -X POST http://localhost:3000/api/v1/auth/token \n  -H "Content-Type: application/json" \n  -d '{"email":"admin@translogix.cl","password":"Admin#2026"}'

# 2. Usarlo
curl http://localhost:3000/api/v1/incidentes?estado=1 -H "Authorization: Bearer <access_token>"
```

| Método | Ruta | Perfil |
|---|---|---|
| POST | `/api/v1/auth/token` | Público (con límite de solicitudes) |
| GET | `/api/v1/me`, `/api/v1/catalogos` | Ambos |
| GET, POST | `/api/v1/incidentes` | Ambos (el colaborador solo ve los suyos) |
| GET | `/api/v1/incidentes/{id}` | Ambos (autorización por registro) |
| POST | `/api/v1/incidentes/{id}/seguimientos` | Ambos (solo el administrador cambia estado) |
| GET | `/api/v1/activos` | Ambos |
| POST, PUT | `/api/v1/activos`, `/api/v1/activos/{id}` | Administrador |
| GET, PATCH | `/api/v1/alertas`, `/api/v1/alertas/{id}` | Administrador |
| GET | `/api/v1/eventos` (paginación por cursor) | Administrador |
| GET | `/api/v1/metricas/panel` | Administrador |

## Tiempo real

Socket.IO comparte la sesión del navegador (o recibe un JWT en `auth.token`). Los administradores ven aparecer al instante las alertas nuevas, los eventos de acceso (en `/admin/eventos`) y los incidentes reportados, con los indicadores del panel actualizados. El colaborador recibe un aviso cuando cambia el estado de su incidente. La lista de eventos está en `/api/docs`.

## Estructura

```
├── db/schema.sql              Modelo relacional (14 tablas + resumen agregado) y catálogos
├── db/datos_demo.sql.gz       Respaldo completo (estructura y datos de demostración)
├── db/particionado.sql        Particionado mensual de eventos (escenario de alto volumen, opcional)
├── docker-compose.yml         Desarrollo: app + MySQL 8.4 + Mailpit
├── docker-compose.prod.yml    Producción: app + MySQL 8.4 + Caddy (HTTPS automático)
├── Caddyfile                  Proxy HTTPS
├── Dockerfile
├── documentacion/             Informe del proyecto y plantillas
├── public/
│   ├── css/styles.css         Estilos propios (mobile-first, 3 puntos de quiebre)
│   └── js/                    Validación, fortaleza de contraseña, menú móvil, gráficos
├── src/
│   ├── server.js              Arranque: espera a MySQL, crea el esquema, carga datos
│   ├── app.js                 Express, cabeceras de seguridad, sesiones, rutas
│   ├── api/                   API REST v1, OpenAPI, autenticación JWT, errores RFC 7807
│   ├── validators.js          Reglas de validación compartidas por web y API
│   ├── config.js              Configuración desde variables de entorno
│   ├── db/                    Pool, inicialización, datos de demostración, reset, archivado
│   ├── middleware/            Autenticación por perfil, CSRF, mensajes flash
│   ├── routes/                auth, panel, incidentes, activos, perfil, admin
│   ├── services/              Lógica de negocio (incidentes, activos, métricas, monitoreo),
│   │                          autenticación, tokens, detección, tiempo real, resumen, correo
│   ├── utils/                 Validación y formato
│   └── views/                 Plantillas EJS
└── tests/                     e2e (web), api (REST y Socket.IO), seguridad, reglas y volumen
```

## Trazabilidad con el informe

### Requerimientos funcionales

| Req. | Implementación |
|---|---|
| RF-01 Inicio de sesión | [src/routes/auth.js](src/routes/auth.js) `POST /login` |
| RF-02 Registro | `POST /registro`, perfil Colaborador, política de uso |
| RF-03 Recuperación | `POST /recuperar`, token de 256 bits guardado como SHA-256, 30 min, un solo uso |
| RF-04 Bloqueo | 5 intentos fallidos → 15 min, en una transacción con bloqueo de fila ([src/services/autenticacion.js](src/services/autenticacion.js)); desbloqueo por administrador o por recuperación |
| RF-05 Perfil | [src/routes/perfil.js](src/routes/perfil.js) |
| RF-06 Reporte de incidente (formulario 1) | [src/routes/incidentes.js](src/routes/incidentes.js) `POST /incidentes`, código `INC-AAAA-NNNNN` |
| RF-07 Listado con filtros | `GET /incidentes`; el colaborador solo ve los suyos |
| RF-08 Detalle y línea de tiempo | `GET /incidentes/:id` con SLA según severidad |
| RF-09 Seguimiento (formulario 3) | `POST /incidentes/:id/seguimientos` |
| RF-10/11 Activos (formulario 2) | [src/routes/activos.js](src/routes/activos.js) |
| RF-12 Registro de eventos | [src/services/eventos.js](src/services/eventos.js) |
| RF-13 Reglas de detección | [src/services/deteccion.js](src/services/deteccion.js): FUERZA_BRUTA, IP_SOSPECHOSA (≥10 fallos contra ≥3 cuentas en 15 min), IP_NUEVA (90 días), FUERA_HORARIO |
| RF-14 Alertas | `GET /admin/alertas`, marcar como revisada |
| RF-15 Eventos con filtros | `GET /admin/eventos` (tipo, correo, IP, fechas, paginación) |
| RF-16 Panel analítico | [src/services/metricas.js](src/services/metricas.js) (lee `resumen_eventos_hora`) + [public/js/panel.js](public/js/panel.js) |
| RF-17 Usuarios | [src/routes/admin.js](src/routes/admin.js) |
| RF-18 Panel del colaborador | Incidentes propios y últimos accesos |

### Requerimientos no funcionales de seguridad

| Req. | Implementación |
|---|---|
| RNF-01 | `bcryptjs`, costo 12 (`BCRYPT_COST`) |
| RNF-02 | Sentencias preparadas del servidor (`execute`) con parámetros `?` ([src/db/pool.js](src/db/pool.js)) |
| RNF-03 | Token anti-CSRF por sesión ([src/middleware/csrf.js](src/middleware/csrf.js)); cookie `HttpOnly`, `SameSite=Lax`, `Secure` en producción; expiración a los 30 min de inactividad; sesión regenerada al iniciar sesión, revalidada en cada solicitud y cerrada al cambiar la contraseña, el perfil o el estado de la cuenta ([src/services/sesiones.js](src/services/sesiones.js)) |
| RNF-04 | Validación en cliente ([public/js/app.js](public/js/app.js)) y servidor (express-validator); EJS escapa las salidas; CSP sin scripts en línea; rate limit en `/login`, `/registro` y `/recuperar` |
| RNF-05 | Mensajes genéricos en login y recuperación; comparación bcrypt y mismo aviso de bloqueo también cuando el correo no existe; correo de recuperación enviado en segundo plano |
| RNF-06 | Índices compuestos y cubriente, tabla agregada `resumen_eventos_hora` y paginación por cursor en la API |
| RNF-07 | CSS propio mobile-first; menú desplegable y tablas como tarjetas bajo 600 px |
| RNF-08 | Verificado en Edge, Firefox y WebKit (motor de Safari) |
| RNF-09 | `restart: unless-stopped`, `HEALTHCHECK` y `/health` |
| RNF-10 | Capas (rutas web y API → servicios → acceso a datos), configuración por variables de entorno, Docker |
| RNF-11 | Archivado a JSON Lines comprimido ([src/db/archivar.js](src/db/archivar.js)) y particionado mensual ([db/particionado.sql](db/particionado.sql)) |
| RNF-12 | Aceptación de la política de uso y del tratamiento de datos de acceso en el registro (`acepta`) |

## Despliegue en producción (OE6)

En un servidor con Docker, con HTTPS automático y SMTP real:

```bash
cp .env.prod.example .env.prod     # dominio, secretos y SMTP
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

El paso a paso está en [documentacion/despliegue.md](documentacion/despliegue.md).
