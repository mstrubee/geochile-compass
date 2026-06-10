
-- commune_coord_overrides: replace permissive ALL-auth policy with admin-only writes
DROP POLICY IF EXISTS "Authenticated users can manage commune overrides" ON public.commune_coord_overrides;
CREATE POLICY "Admins manage commune overrides"
  ON public.commune_coord_overrides
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- poi_attributes: restrict SELECT to owner of the POI
DROP POLICY IF EXISTS "Authed read poi attrs" ON public.poi_attributes;
CREATE POLICY "Owner or admin read poi attrs"
  ON public.poi_attributes
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR poi_id IN (SELECT id FROM public.pois WHERE user_id = auth.uid())
  );

-- poi_evaluations: restrict SELECT to evaluator, POI owner, or admin
DROP POLICY IF EXISTS "poi_eval_select" ON public.poi_evaluations;
CREATE POLICY "poi_eval_select"
  ON public.poi_evaluations
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR evaluator_id = auth.uid()
    OR poi_id IN (SELECT id FROM public.pois WHERE user_id = auth.uid())
  );

-- poi_features_cache: restrict SELECT to folder owner (or admin)
DROP POLICY IF EXISTS "Authed read features cache" ON public.poi_features_cache;
CREATE POLICY "Owner or admin read features cache"
  ON public.poi_features_cache
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR folder_id IN (SELECT id FROM public.poi_folders WHERE user_id = auth.uid())
  );

-- poi_import_jobs: restrict SELECT to folder owner (or admin)
DROP POLICY IF EXISTS "Authed read import jobs" ON public.poi_import_jobs;
CREATE POLICY "Owner or admin read import jobs"
  ON public.poi_import_jobs
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR folder_id IN (SELECT id FROM public.poi_folders WHERE user_id = auth.uid())
  );

-- poi_metrics: restrict SELECT to POI owner (or admin)
DROP POLICY IF EXISTS "Authed read metrics" ON public.poi_metrics;
CREATE POLICY "Owner or admin read metrics"
  ON public.poi_metrics
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR poi_id IN (SELECT id FROM public.pois WHERE user_id = auth.uid())
  );

-- poi_performance_analysis: restrict SELECT to folder owner (or admin)
DROP POLICY IF EXISTS "Authed read perf" ON public.poi_performance_analysis;
CREATE POLICY "Owner or admin read perf"
  ON public.poi_performance_analysis
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR folder_id IN (SELECT id FROM public.poi_folders WHERE user_id = auth.uid())
  );

-- territorial_source_files: admin-only SELECT
DROP POLICY IF EXISTS "Authed read source files" ON public.territorial_source_files;
CREATE POLICY "Admins read source files"
  ON public.territorial_source_files
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
