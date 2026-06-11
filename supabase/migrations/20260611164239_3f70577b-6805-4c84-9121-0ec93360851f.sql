
-- 1) analysis_settings: scope SELECT to owner of folder
DROP POLICY IF EXISTS "Authed read analysis settings" ON public.analysis_settings;
CREATE POLICY "Owners or admins read analysis settings"
ON public.analysis_settings FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.poi_folders f
    WHERE f.id = analysis_settings.folder_id
      AND f.user_id = auth.uid()
  )
  OR public.has_role(auth.uid(), 'admin')
);

-- 2) poi_folder_schemas
DROP POLICY IF EXISTS "Authed read folder schemas" ON public.poi_folder_schemas;
CREATE POLICY "Owners or admins read folder schemas"
ON public.poi_folder_schemas FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.poi_folders f
    WHERE f.id = poi_folder_schemas.folder_id
      AND f.user_id = auth.uid()
  )
  OR public.has_role(auth.uid(), 'admin')
);

-- 3) poi_import_identity_memory
DROP POLICY IF EXISTS "Authed read identity memory" ON public.poi_import_identity_memory;
CREATE POLICY "Owners or admins read identity memory"
ON public.poi_import_identity_memory FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.poi_folders f
    WHERE f.id = poi_import_identity_memory.folder_id
      AND f.user_id = auth.uid()
  )
  OR public.has_role(auth.uid(), 'admin')
);

-- 4) poi_import_skip_memory
DROP POLICY IF EXISTS "Authed read skip memory" ON public.poi_import_skip_memory;
CREATE POLICY "Owners or admins read skip memory"
ON public.poi_import_skip_memory FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.poi_folders f
    WHERE f.id = poi_import_skip_memory.folder_id
      AND f.user_id = auth.uid()
  )
  OR public.has_role(auth.uid(), 'admin')
);

-- 5) poi_address_aliases
DROP POLICY IF EXISTS "Authed read aliases" ON public.poi_address_aliases;
CREATE POLICY "Owners or admins read aliases"
ON public.poi_address_aliases FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.pois p
    WHERE p.id = poi_address_aliases.poi_id
      AND p.user_id = auth.uid()
  )
  OR public.has_role(auth.uid(), 'admin')
);

-- 6) comercio_poi_sync_log: remove public read
DROP POLICY IF EXISTS "read_sync_log" ON public.comercio_poi_sync_log;
CREATE POLICY "Authed read sync log"
ON public.comercio_poi_sync_log FOR SELECT TO authenticated
USING (true);
