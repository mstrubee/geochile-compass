CREATE TABLE IF NOT EXISTS public.commune_coord_overrides (
  name TEXT PRIMARY KEY,
  lat NUMERIC NOT NULL,
  lng NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.commune_coord_overrides TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.commune_coord_overrides TO authenticated;
GRANT ALL ON public.commune_coord_overrides TO service_role;

ALTER TABLE public.commune_coord_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read commune overrides"
  ON public.commune_coord_overrides FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can manage commune overrides"
  ON public.commune_coord_overrides FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER set_commune_coord_overrides_updated_at
  BEFORE UPDATE ON public.commune_coord_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();