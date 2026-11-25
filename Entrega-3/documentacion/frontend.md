# Frontend

Plantillas EJS generadas en el servidor, CSS propio y JavaScript sin dependencias (salvo Chart.js y el cliente de Socket.IO, servidos por la propia aplicación). Sin Bootstrap ni plantillas.

| Archivo | Contenido |
|---|---|
| `src/views/partials/` | Cabecera, menú por perfil, errores de campo, paginación e íconos |
| `src/views/{auth,panel,incidentes,activos,admin,perfil,api,errors}/` | Páginas |
| `public/css/styles.css` | Variables, base, componentes, estructura y puntos de quiebre (600 y 960 px, mobile-first) |
| `public/js/app.js` | Validación por campo, fortaleza de contraseña, contador, menú móvil |
| `public/js/panel.js` | Gráficos (Chart.js) a partir de un bloque JSON |
| `public/js/tiempo-real.js` | Avisos y actualización en vivo (Socket.IO); siempre `textContent` |

## Decisiones

- **CSP estricta**: no hay scripts ni estilos en línea.
- **Responsivo**: bajo 600 px las tablas pasan a tarjetas (`data-label`) y bajo 960 px el menú es desplegable. Verificado sin desplazamiento horizontal a 360, 390, 768 y 1280 px.
- **Accesible**: etiquetas en cada campo, `aria-invalid`, `aria-live` en los avisos, foco visible y `prefers-reduced-motion`.
- **Zona horaria**: las fechas siguen la hora del servidor (Chile) aunque el equipo esté en otra zona.
- **Envío de formularios**: al pulsar un botón no se valida el campo que pierde el foco, para que el mensaje no desplace el botón y se pierda el clic.
