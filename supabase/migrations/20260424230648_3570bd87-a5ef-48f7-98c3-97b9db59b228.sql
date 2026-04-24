-- 1) Soft delete columns
ALTER TABLE public.pois ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.poi_folders ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_pois_deleted_at ON public.pois (deleted_at);
CREATE INDEX IF NOT EXISTS idx_poi_folders_deleted_at ON public.poi_folders (deleted_at);

-- 2) Purge function: hard-delete anything soft-deleted >30 days ago
CREATE OR REPLACE FUNCTION public.purge_deleted_pois()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.pois
   WHERE deleted_at IS NOT NULL
     AND deleted_at < (now() - interval '30 days');

  DELETE FROM public.poi_folders
   WHERE deleted_at IS NOT NULL
     AND deleted_at < (now() - interval '30 days');
END;
$$;

-- 3) Schedule daily purge via pg_cron
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  PERFORM cron.unschedule('purge-deleted-pois-daily');
EXCEPTION WHEN OTHERS THEN
  NULL;
END
$$;

SELECT cron.schedule(
  'purge-deleted-pois-daily',
  '17 3 * * *',
  $$ SELECT public.purge_deleted_pois(); $$
);