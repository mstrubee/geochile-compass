-- ---------- 1) UF histórica -------------------------------
CREATE TABLE IF NOT EXISTS public.uf_values (
  period DATE PRIMARY KEY,
  value NUMERIC(12, 2) NOT NULL,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.uf_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authed read uf" ON public.uf_values FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins ins uf" ON public.uf_values FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Admins upd uf" ON public.uf_values FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Admins del uf" ON public.uf_values FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE TRIGGER trg_uf_values_upd BEFORE UPDATE ON public.uf_values FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- 2) Analysis settings por carpeta --------------
CREATE TABLE IF NOT EXISTS public.analysis_settings (
  folder_id UUID PRIMARY KEY REFERENCES public.poi_folders(id) ON DELETE CASCADE,
  iso_minutes_rm INT NOT NULL DEFAULT 5,
  iso_minutes_regions INT NOT NULL DEFAULT 7,
  external_competition_folder_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  external_competition_layer_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  use_fine_cannibalization BOOLEAN NOT NULL DEFAULT true,
  config_version INT NOT NULL DEFAULT 1,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.analysis_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authed read analysis settings" ON public.analysis_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins ins analysis settings" ON public.analysis_settings FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Admins upd analysis settings" ON public.analysis_settings FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Admins del analysis settings" ON public.analysis_settings FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE TRIGGER trg_analysis_settings_upd BEFORE UPDATE ON public.analysis_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- 3) Complement weight rules --------------------
CREATE TABLE IF NOT EXISTS public.complement_weight_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id UUID REFERENCES public.poi_folders(id) ON DELETE CASCADE,
  pattern TEXT NOT NULL,
  weight NUMERIC(4, 2) NOT NULL CHECK (weight >= 0 AND weight <= 1),
  label TEXT,
  priority INT NOT NULL DEFAULT 100,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.complement_weight_rules ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_complement_rules_folder ON public.complement_weight_rules(folder_id);
CREATE INDEX IF NOT EXISTS idx_complement_rules_priority ON public.complement_weight_rules(priority);
CREATE POLICY "Authed read complement rules" ON public.complement_weight_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins ins complement rules" ON public.complement_weight_rules FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Admins upd complement rules" ON public.complement_weight_rules FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Admins del complement rules" ON public.complement_weight_rules FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE TRIGGER trg_complement_rules_upd BEFORE UPDATE ON public.complement_weight_rules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- 4) Features cache -----------------------------
CREATE TABLE IF NOT EXISTS public.poi_features_cache (
  poi_id UUID PRIMARY KEY REFERENCES public.pois(id) ON DELETE CASCADE,
  folder_id UUID NOT NULL REFERENCES public.poi_folders(id) ON DELETE CASCADE,
  iso_minutes INT NOT NULL,
  is_rm BOOLEAN NOT NULL,
  features JSONB NOT NULL,
  config_version INT NOT NULL,
  iso_geom_hash TEXT,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.poi_features_cache ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_features_cache_folder ON public.poi_features_cache(folder_id);
CREATE POLICY "Authed read features cache" ON public.poi_features_cache FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins ins features cache" ON public.poi_features_cache FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Admins upd features cache" ON public.poi_features_cache FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Admins del features cache" ON public.poi_features_cache FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ---------- 5) Performance analysis cache -----------------
CREATE TABLE IF NOT EXISTS public.poi_performance_analysis (
  poi_id UUID PRIMARY KEY REFERENCES public.pois(id) ON DELETE CASCADE,
  folder_id UUID NOT NULL REFERENCES public.poi_folders(id) ON DELETE CASCADE,
  target_year INT NOT NULL,
  actual_monthly_clp NUMERIC,
  actual_monthly_uf NUMERIC,
  predicted_monthly_clp NUMERIC,
  predicted_monthly_uf NUMERIC,
  residual_clp NUMERIC,
  residual_pct NUMERIC,
  top_drivers JSONB NOT NULL DEFAULT '[]'::jsonb,
  peer_poi_ids UUID[] NOT NULL DEFAULT '{}',
  temporal_state TEXT,
  temporal_decomposition JSONB NOT NULL DEFAULT '{}'::jsonb,
  config_version INT NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.poi_performance_analysis ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_perf_folder ON public.poi_performance_analysis(folder_id);
CREATE POLICY "Authed read perf" ON public.poi_performance_analysis FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins ins perf" ON public.poi_performance_analysis FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Admins upd perf" ON public.poi_performance_analysis FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Admins del perf" ON public.poi_performance_analysis FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ---------- 6) Seed reglas globales -----------------------
INSERT INTO public.complement_weight_rules (folder_id, pattern, weight, label, priority, enabled) VALUES
  (NULL, '(?i)hiper.*l[ií]der', 1.00, 'Ancla', 10, true),
  (NULL, '(?i)\bjumbo\b', 1.00, 'Ancla', 10, true),
  (NULL, '(?i)\btottus\b', 1.00, 'Ancla', 10, true),
  (NULL, '(?i)\bunimarc\b', 0.90, 'Ancla', 15, true),
  (NULL, '(?i)\bmall\b', 1.00, 'Ancla', 10, true),
  (NULL, '(?i)costanera\s*center', 1.00, 'Ancla', 10, true),
  (NULL, '(?i)plaza\s*(vespucio|norte|oeste|alameda|egaña|tobalaba)', 1.00, 'Ancla', 10, true),
  (NULL, '(?i)l[ií]der\s*express', 0.60, 'Medio', 30, true),
  (NULL, '(?i)\beasy\b', 0.65, 'Medio', 30, true),
  (NULL, '(?i)\bsodimac\b', 0.65, 'Medio', 30, true),
  (NULL, '(?i)\bconstrumart\b', 0.55, 'Medio', 30, true),
  (NULL, '(?i)\bfalabella\b', 0.70, 'Medio', 25, true),
  (NULL, '(?i)\bripley\b', 0.65, 'Medio', 30, true),
  (NULL, '(?i)\bparis\b', 0.65, 'Medio', 30, true),
  (NULL, '(?i)supermercado', 0.55, 'Medio', 35, true),
  (NULL, '(?i)farmacia', 0.40, 'Bajo', 50, true),
  (NULL, '(?i)\b(salcobrand|cruz\s*verde|ahumada)\b', 0.45, 'Bajo', 45, true),
  (NULL, '(?i)gimnasio|smart\s*fit|sportlife', 0.40, 'Bajo', 50, true),
  (NULL, '(?i)\bbanco\b|\bbci\b|\bbancoestado\b', 0.35, 'Bajo', 50, true),
  (NULL, '(?i)bencinera|copec|shell|petrobras|enex', 0.45, 'Bajo', 45, true),
  (NULL, '(?i)restaurant|restobar|caf[eé]\b|panader[ií]a|pasteler[ií]a', 0.20, 'Mínimo', 70, true),
  (NULL, '(?i)botiller[ií]a|kiosko', 0.15, 'Mínimo', 75, true)
ON CONFLICT DO NOTHING;