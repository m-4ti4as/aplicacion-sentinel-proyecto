# Backend

Node.js 22 + Express 4. Código en `src/`.

## Capas

| Capa | Archivos | Responsabilidad |
|---|---|---|
| Arranque | `server.js`, `app.js`, `config.js` | Espera a MySQL, crea el esquema, arma Express, sesiones y Socket.IO |
| Entrada web | `routes/`, `views/` | Formularios HTML (auth, panel, incidentes, activos, perfil, admin) |
| Entrada API | `api/` | API REST v1 en JSON, OpenAPI, errores RFC 7807 |
| Seguridad | `middleware/`, `validators.js`, `utils/validacion.js` | CSRF, perfil, validación |
| Servicios | `services/` | Lógica de negocio compartida por web y API |
| Datos | `db/` | Pool, esquema, datos de demostración, archivado |

## Servicios

| Servicio | Qué hace |
|---|---|
| `autenticacion` | Verifica la clave (bcrypt) y registra el intento en una transacción con `SELECT … FOR UPDATE`: evento, contador y bloqueo se confirman juntos |
| `sesiones` | Relee el usuario en cada solicitud y cierra sesiones y sockets al cambiar la clave, el perfil o el estado |
| `eventos` | `insertar` (dentro de la transacción) y `publicar` (resumen agregado y aviso en vivo, ya confirmado) |
| `deteccion` | Reglas FUERZA_BRUTA, IP_SOSPECHOSA, IP_NUEVA y FUERA_HORARIO |
| `incidentes`, `activos`, `monitoreo` | Reglas de negocio y autorización por registro |
| `metricas`, `resumen` | Indicadores del panel y tabla agregada |
| `tokens` | JWT HS256 de 15 min con emisor, audiencia y algoritmo fijos |
| `tiempoReal` | Socket.IO: salas por perfil y por usuario |
| `mailer` | SMTP con STARTTLS obligatorio en producción |

La gestión de usuarios (RF-17) vive en `routes/admin.js` y solo existe en la interfaz web.

## API REST

Documentación navegable en `/api/docs` y especificación en `/api/openapi.json`. Autenticación con `Authorization: Bearer <JWT>` o con la sesión del navegador más `X-CSRF-Token`.

## Configuración

Todas las variables están en [.env.example](../.env.example). En producción son obligatorias `SESSION_SECRET` y `JWT_SECRET`.
