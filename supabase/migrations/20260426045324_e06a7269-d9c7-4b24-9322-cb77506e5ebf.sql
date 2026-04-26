-- Índices compuestos parciales para acelerar la carga de POIs.
-- Resuelve timeouts (code 57014) cuando hay >2000 POIs por usuario:
-- la consulta paginada hace ORDER BY created_at DESC con filtros user_id +
-- deleted_at IS NULL, y sin estos índices el planner hace un sort completo
-- del set del usuario en cada página.

CREATE INDEX IF NOT EXISTS idx_pois_user_active_created
  ON public.pois (user_id, created_at DESC, id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pois_user_trashed_deleted
  ON public.pois (user_id, deleted_at DESC, id)
  WHERE deleted_at IS NOT NULL;