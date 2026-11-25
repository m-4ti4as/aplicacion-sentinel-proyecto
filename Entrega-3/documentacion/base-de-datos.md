# Base de datos

MySQL 8.4 LTS. Esquema en [db/schema.sql](../db/schema.sql) (idempotente; la aplicación lo ejecuta al iniciar).

## Tablas (16)

| Grupo | Tablas |
|---|---|
| Dominio en 3FN (14) | `roles`, `areas`, `usuarios`, `tokens_recuperacion`, `tipos_activo`, `activos`, `categorias_incidente`, `severidades`, `estados_incidente`, `incidentes`, `seguimientos_incidente`, `tipos_evento`, `eventos_acceso`, `alertas` |
| Agregación (1) | `resumen_eventos_hora` (dato derivado, reconstruible) |
| Técnica (1) | `sessions` (la crea express-mysql-session) |

## Índices de `eventos_acceso`

| Índice | Uso |
|---|---|
| `(tipo_evento_id, creado_en, ip, email_intentado)` | Ranking de IP y fallos de 24 h sin leer las filas (cubriente) |
| `(usuario_id, creado_en)` | Regla IP_NUEVA y últimos accesos |
| `(ip, creado_en)` | Regla IP_SOSPECHOSA y filtro por IP |
| `(email_intentado, creado_en)` | Intentos sobre correos sin cuenta |
| `(creado_en)` | Rango de fechas y archivado |

Las bases creadas con la versión anterior se ajustan solas al iniciar (`src/db/init.js`).

## Cargar la base

- **Automático**: `docker compose up -d --build` crea las tablas y los datos.
- **Desde el respaldo** (estructura + datos de demostración):

```bash
gunzip -c db/datos_demo.sql.gz | docker compose exec -T db mysql -usentinel -psentinel_dev sentinel
```

## Mantención

| Comando | Efecto |
|---|---|
| `npm run db:reset` | Vuelve a los datos de demostración (solo desarrollo) |
| `npm run resumen:reconstruir` | Recalcula el agregado |
| `npm run eventos:archivar` | Exporta y elimina eventos de más de 12 meses |
| `db/particionado.sql` | Particionado mensual para alto volumen (manual) |
