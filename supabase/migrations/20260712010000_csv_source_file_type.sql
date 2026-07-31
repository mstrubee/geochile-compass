-- Permite subir archivos CSV como fuente de capas territoriales (se suman
-- a html/geojson/kml/kmz). El check constraint original es sin nombre fijo,
-- así que se busca dinámicamente antes de reemplazarlo.
DO $$
DECLARE
  con_name text;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'public.territorial_source_files'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%file_type%';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.territorial_source_files DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE public.territorial_source_files
  ADD CONSTRAINT territorial_source_files_file_type_check
  CHECK (file_type IN ('html','geojson','kml','kmz','csv'));
