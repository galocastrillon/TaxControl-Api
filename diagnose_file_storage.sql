-- =============================================================================
-- 📊 DIAGNÓSTICO DE ALMACENAMIENTO DE ARCHIVOS  —  EJECUTAR ANTES DE REDESPLEGAR
-- =============================================================================
-- Script de SOLO LECTURA (únicamente SELECT). No modifica ningún dato.
-- Es seguro ejecutarlo en producción.
--
-- Objetivo: clasificar TODOS los archivos referenciados en la base de datos para
-- saber, antes de migrar al almacenamiento en BD, cuántos:
--   1) Ya están a salvo  → base64 incrustado dentro de la BD (file_url = 'data:...')
--   2) Están EN RIESGO   → apuntan a disco (/api/files/...). Pudieron perderse en
--                          redespliegues previos; hay que verificarlos / recargarlos.
--   3) No tienen archivo  → file_url vacío o NULL
--
-- ⚠️ SQL no puede comprobar si el archivo existe físicamente en disco. Los "EN
-- RIESGO" son los que conviene revisar tras el redespliegue: los logs de la API
-- (📦 [storage-check]) mostrarán cuáles faltan realmente.
--
-- Nota: si tu base de datos no se llama así, ajusta o quita la siguiente línea.
-- =============================================================================

-- USE tax_control;


-- -----------------------------------------------------------------------------
-- 1️⃣ DOCUMENTOS PRINCIPALES — resumen por categoría
-- -----------------------------------------------------------------------------
SELECT
  'documents (archivo principal)' AS tabla,
  CASE
    WHEN file_url IS NULL OR file_url = '' THEN '3) sin archivo'
    WHEN file_url LIKE 'data:%'            THEN '1) base64 en BD (a salvo)'
    ELSE                                       '2) referencia a disco (EN RIESGO)'
  END AS categoria,
  COUNT(*) AS cantidad
FROM documents
GROUP BY categoria
ORDER BY categoria;


-- -----------------------------------------------------------------------------
-- 2️⃣ ADJUNTOS DE CONTESTACIONES — resumen por categoría
--    (si la tabla no existe aún, omite esta consulta)
-- -----------------------------------------------------------------------------
SELECT
  'contestation_files (adjuntos)' AS tabla,
  CASE
    WHEN file_url IS NULL OR file_url = '' THEN '3) sin archivo'
    WHEN file_url LIKE 'data:%'            THEN '1) base64 en BD (a salvo)'
    ELSE                                       '2) referencia a disco (EN RIESGO)'
  END AS categoria,
  COUNT(*) AS cantidad
FROM contestation_files
GROUP BY categoria
ORDER BY categoria;


-- -----------------------------------------------------------------------------
-- 3️⃣ ADJUNTOS DE ACTIVIDADES — resumen por categoría
--    (si la tabla no existe aún, omite esta consulta)
-- -----------------------------------------------------------------------------
SELECT
  'activity_files (adjuntos)' AS tabla,
  CASE
    WHEN file_url IS NULL OR file_url = '' THEN '3) sin archivo'
    WHEN file_url LIKE 'data:%'            THEN '1) base64 en BD (a salvo)'
    ELSE                                       '2) referencia a disco (EN RIESGO)'
  END AS categoria,
  COUNT(*) AS cantidad
FROM activity_files
GROUP BY categoria
ORDER BY categoria;


-- -----------------------------------------------------------------------------
-- 4️⃣ TOTAL EN RIESGO (referencias a disco) — el número clave a vigilar
-- -----------------------------------------------------------------------------
SELECT
  (SELECT COUNT(*) FROM documents
     WHERE file_url IS NOT NULL AND file_url <> '' AND file_url NOT LIKE 'data:%')
       AS docs_en_riesgo,
  (SELECT COUNT(*) FROM contestation_files
     WHERE file_url IS NOT NULL AND file_url <> '' AND file_url NOT LIKE 'data:%')
       AS contestaciones_en_riesgo,
  (SELECT COUNT(*) FROM activity_files
     WHERE file_url IS NOT NULL AND file_url <> '' AND file_url NOT LIKE 'data:%')
       AS actividades_en_riesgo;


-- -----------------------------------------------------------------------------
-- 5️⃣ LISTADO DETALLADO de documentos EN RIESGO (para saber cuáles recargar)
-- -----------------------------------------------------------------------------
SELECT
  id,
  title,
  document_number,
  trarnite_number,
  file_name,
  file_url,
  created_at
FROM documents
WHERE file_url IS NOT NULL AND file_url <> '' AND file_url NOT LIKE 'data:%'
ORDER BY created_at DESC;


-- -----------------------------------------------------------------------------
-- 6️⃣ (Opcional) Peso del base64 incrustado hoy en la tabla documents
--    Útil para ver cuánto pesa la tabla por los PDFs guardados en base64.
-- -----------------------------------------------------------------------------
SELECT
  COUNT(*)                                      AS docs_con_base64,
  ROUND(SUM(LENGTH(file_url)) / 1024 / 1024, 2) AS total_mb_base64
FROM documents
WHERE file_url LIKE 'data:%';


-- =============================================================================
-- ✅ VERIFICACIÓN POST-REDESPLIEGUE
-- =============================================================================
-- Ejecuta estas dos consultas DESPUÉS de redesplegar (ya existirá document_files).
-- -----------------------------------------------------------------------------

-- 7️⃣ Cuántos archivos quedaron guardados en la BD nueva y cuánto pesan:
SELECT
  COUNT(*)                          AS archivos_en_document_files,
  ROUND(SUM(size) / 1024 / 1024, 2) AS total_mb
FROM document_files;

-- 8️⃣ Documentos cuyo archivo de disco NO llegó a la BD nueva (posible pérdida real).
--    Si devuelve filas, esos documentos quedaron sin archivo y hay que recargarlos.
SELECT
  d.id,
  d.title,
  d.document_number,
  d.file_name,
  d.file_url
FROM documents d
WHERE d.file_url IS NOT NULL
  AND d.file_url <> ''
  AND d.file_url NOT LIKE 'data:%'
  AND NOT EXISTS (
    SELECT 1
    FROM document_files f
    WHERE f.id = SUBSTRING_INDEX(d.file_url, '/', -1)
  )
ORDER BY d.created_at DESC;
