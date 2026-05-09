-- Persist KPI card order per folder schema (shared across all POIs of a classification)
ALTER TABLE public.poi_folder_schemas
  ADD COLUMN IF NOT EXISTS kpi_order jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Allow any authenticated user to set the KPI order without granting full update on the schema
CREATE OR REPLACE FUNCTION public.set_poi_folder_kpi_order(_folder_id uuid, _order jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF jsonb_typeof(_order) <> 'array' THEN
    RAISE EXCEPTION 'order must be a json array';
  END IF;

  INSERT INTO public.poi_folder_schemas (folder_id, kpi_order)
  VALUES (_folder_id, _order)
  ON CONFLICT (folder_id) DO UPDATE
    SET kpi_order = EXCLUDED.kpi_order,
        updated_at = now();
END;
$$;