CREATE INDEX IF NOT EXISTS idx_pois_user_active_created
  ON public.pois (user_id, created_at DESC, id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pois_user_trashed_deleted
  ON public.pois (user_id, deleted_at DESC, id)
  WHERE deleted_at IS NOT NULL;

ANALYZE public.pois;