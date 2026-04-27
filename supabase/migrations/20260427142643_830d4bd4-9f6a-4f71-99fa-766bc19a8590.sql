-- Índice parcial: lista activa de POIs por usuario, ordenada por fecha
CREATE INDEX IF NOT EXISTS idx_pois_user_active_created
  ON public.pois (user_id, created_at DESC, id)
  WHERE deleted_at IS NULL;

-- Índice parcial: papelera de POIs por usuario
CREATE INDEX IF NOT EXISTS idx_pois_user_trashed_deleted
  ON public.pois (user_id, deleted_at DESC, id)
  WHERE deleted_at IS NOT NULL;

-- Índice por carpeta (para mover/contar/listar por folder)
CREATE INDEX IF NOT EXISTS idx_pois_user_folder
  ON public.pois (user_id, folder_id)
  WHERE deleted_at IS NULL;

-- Índice para árbol de carpetas
CREATE INDEX IF NOT EXISTS idx_poi_folders_user_parent
  ON public.poi_folders (user_id, parent_id)
  WHERE deleted_at IS NULL;
