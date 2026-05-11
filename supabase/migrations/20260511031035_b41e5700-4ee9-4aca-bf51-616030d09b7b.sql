
DROP TRIGGER IF EXISTS pois_set_updated_at ON public.pois;
CREATE TRIGGER pois_set_updated_at
BEFORE UPDATE ON public.pois
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS poi_folders_set_updated_at ON public.poi_folders;
CREATE TRIGGER poi_folders_set_updated_at
BEFORE UPDATE ON public.poi_folders
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_pois_user_updated_at
  ON public.pois (user_id, updated_at DESC);
