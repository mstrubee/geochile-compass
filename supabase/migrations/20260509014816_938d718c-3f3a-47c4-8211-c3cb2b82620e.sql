-- ============================================================
-- POI Metrics & Configurable Attributes — Sales import system
-- ============================================================

-- 1) Folder-level schema config
CREATE TABLE IF NOT EXISTS public.poi_folder_schemas (
  folder_id UUID PRIMARY KEY REFERENCES public.poi_folders(id) ON DELETE CASCADE,
  schema_type TEXT NOT NULL DEFAULT 'autoplanet',
  identity_columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  metric_definitions JSONB NOT NULL DEFAULT '[]'::jsonb,
  static_columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  import_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.poi_folder_schemas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authed read folder schemas" ON public.poi_folder_schemas
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins ins folder schemas" ON public.poi_folder_schemas
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins upd folder schemas" ON public.poi_folder_schemas
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins del folder schemas" ON public.poi_folder_schemas
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_poi_folder_schemas_upd BEFORE UPDATE ON public.poi_folder_schemas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Time-series metrics
CREATE TABLE IF NOT EXISTS public.poi_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poi_id UUID NOT NULL REFERENCES public.pois(id) ON DELETE CASCADE,
  metric_key TEXT NOT NULL,
  period DATE NOT NULL,
  value NUMERIC NOT NULL,
  source_import_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(poi_id, metric_key, period)
);

ALTER TABLE public.poi_metrics ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_poi_metrics_poi ON public.poi_metrics(poi_id);
CREATE INDEX IF NOT EXISTS idx_poi_metrics_period ON public.poi_metrics(period);
CREATE INDEX IF NOT EXISTS idx_poi_metrics_key_period ON public.poi_metrics(metric_key, period);

CREATE POLICY "Authed read metrics" ON public.poi_metrics
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins ins metrics" ON public.poi_metrics
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins upd metrics" ON public.poi_metrics
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins del metrics" ON public.poi_metrics
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_poi_metrics_upd BEFORE UPDATE ON public.poi_metrics
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) Static attributes
CREATE TABLE IF NOT EXISTS public.poi_attributes (
  poi_id UUID NOT NULL REFERENCES public.pois(id) ON DELETE CASCADE,
  attr_key TEXT NOT NULL,
  attr_value TEXT,
  source_import_id UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (poi_id, attr_key)
);

ALTER TABLE public.poi_attributes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authed read poi attrs" ON public.poi_attributes
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins ins poi attrs" ON public.poi_attributes
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins upd poi attrs" ON public.poi_attributes
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins del poi attrs" ON public.poi_attributes
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 4) Address aliases
CREATE TABLE IF NOT EXISTS public.poi_address_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poi_id UUID NOT NULL REFERENCES public.pois(id) ON DELETE CASCADE,
  normalized_address TEXT NOT NULL,
  raw_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.poi_address_aliases ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_aliases_normalized ON public.poi_address_aliases(normalized_address);
CREATE UNIQUE INDEX IF NOT EXISTS idx_aliases_poi_norm
  ON public.poi_address_aliases(poi_id, normalized_address);

CREATE POLICY "Authed read aliases" ON public.poi_address_aliases
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins ins aliases" ON public.poi_address_aliases
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins upd aliases" ON public.poi_address_aliases
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins del aliases" ON public.poi_address_aliases
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 5) Import jobs
CREATE TABLE IF NOT EXISTS public.poi_import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id UUID NOT NULL REFERENCES public.poi_folders(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  rows_total INT NOT NULL DEFAULT 0,
  rows_matched_auto INT NOT NULL DEFAULT 0,
  rows_matched_manual INT NOT NULL DEFAULT 0,
  rows_unmatched INT NOT NULL DEFAULT 0,
  metric_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  period_min DATE,
  period_max DATE,
  error TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE public.poi_import_jobs ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_import_jobs_folder ON public.poi_import_jobs(folder_id);

CREATE POLICY "Authed read import jobs" ON public.poi_import_jobs
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins ins import jobs" ON public.poi_import_jobs
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins upd import jobs" ON public.poi_import_jobs
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins del import jobs" ON public.poi_import_jobs
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 6) AutoPlanet seed
DO $$
DECLARE
  ap_folder UUID;
BEGIN
  SELECT id INTO ap_folder
  FROM public.poi_folders
  WHERE lower(name) = 'autoplanet'
    AND deleted_at IS NULL
  LIMIT 1;

  IF ap_folder IS NOT NULL THEN
    INSERT INTO public.poi_folder_schemas (
      folder_id, schema_type, identity_columns, metric_definitions, static_columns, import_enabled
    ) VALUES (
      ap_folder, 'autoplanet',
      '["Centro Sap","Local","Nombre Local","Dirección","Comuna"]'::jsonb,
      '[{"key":"ventas","label":"Ventas","kind":"timeseries","format":"clp","aggregation":"sum"}]'::jsonb,
      '["Centro Sap","Local","Nombre Local","Gerente Zonal","Zona"]'::jsonb,
      true
    )
    ON CONFLICT (folder_id) DO NOTHING;
  END IF;
END $$;

-- 7) Latest-period view
CREATE OR REPLACE VIEW public.poi_metrics_latest AS
SELECT DISTINCT ON (poi_id, metric_key)
  poi_id, metric_key, period, value
FROM public.poi_metrics
ORDER BY poi_id, metric_key, period DESC;

GRANT SELECT ON public.poi_metrics_latest TO authenticated;