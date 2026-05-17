-- Prevent duplicate sibling folder names (case-insensitive) per user.
-- Uses NULLS NOT DISTINCT so two root folders ("Mis carpetas" parent_id IS NULL)
-- with the same name are still rejected.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_iso_folder_sibling_name
  ON public.isochrone_folders (user_id, parent_id, lower(name))
  NULLS NOT DISTINCT
  WHERE deleted_at IS NULL;