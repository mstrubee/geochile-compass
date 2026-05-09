ALTER TABLE public.territorial_layers
  ADD COLUMN IF NOT EXISTS source_name TEXT;

-- Backfill: para capas existentes el source_name es el nombre actual.
UPDATE public.territorial_layers
   SET source_name = name
 WHERE source_name IS NULL;

-- Índice único: una capa por (grupo, nombre original).
CREATE UNIQUE INDEX IF NOT EXISTS territorial_layers_group_source_name_uidx
  ON public.territorial_layers (group_id, source_name)
  WHERE source_name IS NOT NULL;