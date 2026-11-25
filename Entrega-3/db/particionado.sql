-- =====================================================================
-- SentinelData - particionado de eventos_acceso (escenario de alto volumen)
--
-- NO se aplica automáticamente. Es el paso de escalamiento previsto en el
-- RNF-11 cuando la tabla de eventos alcance decenas de millones de filas.
--
-- MySQL no admite claves foráneas en tablas particionadas, y exige que la
-- columna de partición forme parte de la clave primaria. Por eso:
--   1. Se eliminan las FK de eventos_acceso; la integridad la garantiza la
--      aplicación (los tipos vienen del catálogo en memoria y el usuario
--      de la sesión o del token ya fue validado).
--   2. La clave primaria pasa a ser (id, creado_en).
--   3. Se particiona por mes con PARTITION BY RANGE.
-- Ventaja: archivar un mes completo es un ALTER TABLE ... DROP PARTITION
-- instantáneo, y las consultas por rango de fechas solo leen las
-- particiones necesarias (partition pruning).
-- =====================================================================

ALTER TABLE eventos_acceso
  DROP FOREIGN KEY fk_eventos_tipo,
  DROP FOREIGN KEY fk_eventos_usuario;

ALTER TABLE eventos_acceso
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (id, creado_en);

ALTER TABLE eventos_acceso
  PARTITION BY RANGE (TO_DAYS(creado_en)) (
    PARTITION p2026_09 VALUES LESS THAN (TO_DAYS('2026-10-01')),
    PARTITION p2026_10 VALUES LESS THAN (TO_DAYS('2026-11-01')),
    PARTITION p2026_11 VALUES LESS THAN (TO_DAYS('2026-12-01')),
    PARTITION p2026_12 VALUES LESS THAN (TO_DAYS('2027-01-01')),
    PARTITION p_futuro VALUES LESS THAN MAXVALUE
  );

-- Mantención mensual (tarea programada):
--   Crear la partición del mes siguiente separando p_futuro:
--     ALTER TABLE eventos_acceso REORGANIZE PARTITION p_futuro INTO (
--       PARTITION p2027_01 VALUES LESS THAN (TO_DAYS('2027-02-01')),
--       PARTITION p_futuro VALUES LESS THAN MAXVALUE);
--   Archivar el mes más antiguo (después de exportarlo con npm run eventos:archivar):
--     ALTER TABLE eventos_acceso DROP PARTITION p2026_09;
--
-- Verificar el uso de particiones en una consulta:
--   EXPLAIN SELECT COUNT(*) FROM eventos_acceso
--    WHERE creado_en >= '2026-11-01' AND creado_en < '2026-12-01';
--   (la columna "partitions" muestra p2026_11; MySQL agrega siempre la primera
--    partición en TO_DAYS(), porque ahí quedarían las fechas no válidas)
