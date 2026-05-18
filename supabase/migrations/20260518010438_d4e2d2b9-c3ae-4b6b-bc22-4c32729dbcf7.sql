CREATE TABLE IF NOT EXISTS public._r2_baseline_pre_tarea3 AS
SELECT
  pp.folder_id,
  pf.name AS folder_name,
  pp.poi_id,
  pp.model_a_r2,
  pp.model_b_r2,
  pp.config_version,
  pp.computed_at,
  'pre-tarea3-20260518'::text AS snapshot_label,
  now() AS snapshot_at
FROM public.poi_performance_analysis pp
JOIN public.poi_folders pf ON pf.id = pp.folder_id
WHERE pf.name IN ('Autoplanet','Agroplanet');

ALTER TABLE public._r2_baseline_pre_tarea3 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins all _r2_baseline_pre_tarea3"
  ON public._r2_baseline_pre_tarea3 FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public._poi_features_cache_pre_tarea3 AS
SELECT *, now() AS snapshot_at
FROM public.poi_features_cache
WHERE folder_id = 'd5f2c961-041d-469c-b0a8-e3d2e8261404';

ALTER TABLE public._poi_features_cache_pre_tarea3 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins all _poi_features_cache_pre_tarea3"
  ON public._poi_features_cache_pre_tarea3 FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));