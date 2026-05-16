ALTER TABLE public._pois_pre_migration_backup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._poi_folders_pre_migration_backup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._poi_features_cache_pre_migration_backup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._migration_log ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['_pois_pre_migration_backup','_poi_folders_pre_migration_backup','_poi_features_cache_pre_migration_backup','_migration_log']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Admins all %1$s" ON public.%1$I', t);
    EXECUTE format('CREATE POLICY "Admins all %1$s" ON public.%1$I FOR ALL TO authenticated USING (has_role(auth.uid(), ''admin''::app_role)) WITH CHECK (has_role(auth.uid(), ''admin''::app_role))', t);
  END LOOP;
END $$;