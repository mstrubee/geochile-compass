-- ============================================================================
-- Sprint 3 · 01-migration-schema.sql
-- ============================================================================

-- 1.1 Subgrupo opcional (parent_layer_id)
ALTER TABLE territorial_layers
  ADD COLUMN IF NOT EXISTS parent_layer_id UUID
    REFERENCES territorial_layers(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_territorial_layers_parent
  ON territorial_layers(parent_layer_id);

-- 1.2 Modo de render
ALTER TABLE territorial_layers
  ADD COLUMN IF NOT EXISTS render_mode TEXT NOT NULL DEFAULT 'icons'
    CHECK (render_mode IN ('icons', 'heatmap', 'both'));

-- 1.3 URL del heatmap pre-agregado
ALTER TABLE territorial_layers
  ADD COLUMN IF NOT EXISTS heatmap_aggregate_url TEXT;

-- 1.4 Estilo de ícono
ALTER TABLE territorial_layers
  ADD COLUMN IF NOT EXISTS icon_render TEXT DEFAULT 'default';

-- 1.5 Última estrategia de dedup usada
ALTER TABLE territorial_layers
  ADD COLUMN IF NOT EXISTS last_dedup_strategy TEXT
    CHECK (last_dedup_strategy IN ('replace_layer', 'merge_external_id', 'merge_coords_name'));

-- 1.6 heatmap_enabled
ALTER TABLE territorial_layers
  ADD COLUMN IF NOT EXISTS heatmap_enabled BOOLEAN NOT NULL DEFAULT false;

-- 2.1 Trigger: máximo 1 nivel de anidamiento
CREATE OR REPLACE FUNCTION public.check_territorial_layer_depth()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.parent_layer_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM territorial_layers
      WHERE id = NEW.parent_layer_id AND parent_layer_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'No se permite anidar más de un nivel (subgrupo de subgrupo).';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_layer_depth ON territorial_layers;
CREATE TRIGGER trg_check_layer_depth
  BEFORE INSERT OR UPDATE ON territorial_layers
  FOR EACH ROW EXECUTE FUNCTION public.check_territorial_layer_depth();

-- 3. Tabla folder_layer_roles
CREATE TABLE IF NOT EXISTS public.folder_layer_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id UUID NOT NULL REFERENCES poi_folders(id) ON DELETE CASCADE,
  layer_id UUID NOT NULL REFERENCES territorial_layers(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN (
    'competition_external',
    'complement_strong',
    'complement_medium',
    'complement_low',
    'anchor',
    'irrelevant'
  )),
  weight_override NUMERIC(4,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  UNIQUE(folder_id, layer_id)
);

CREATE INDEX IF NOT EXISTS idx_folder_layer_roles_folder ON folder_layer_roles(folder_id);
CREATE INDEX IF NOT EXISTS idx_folder_layer_roles_layer ON folder_layer_roles(layer_id);
CREATE INDEX IF NOT EXISTS idx_folder_layer_roles_role ON folder_layer_roles(role);

ALTER TABLE public.folder_layer_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authed read folder_layer_roles" ON folder_layer_roles;
CREATE POLICY "Authed read folder_layer_roles" ON folder_layer_roles
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins ins folder_layer_roles" ON folder_layer_roles;
CREATE POLICY "Admins ins folder_layer_roles" ON folder_layer_roles
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins upd folder_layer_roles" ON folder_layer_roles;
CREATE POLICY "Admins upd folder_layer_roles" ON folder_layer_roles
  FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins del folder_layer_roles" ON folder_layer_roles;
CREATE POLICY "Admins del folder_layer_roles" ON folder_layer_roles
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

DROP TRIGGER IF EXISTS trg_folder_layer_roles_upd ON folder_layer_roles;
CREATE TRIGGER trg_folder_layer_roles_upd
  BEFORE UPDATE ON folder_layer_roles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Peso default por rol
CREATE OR REPLACE FUNCTION public.territorial_role_default_weight(role_name TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
BEGIN
  CASE role_name
    WHEN 'competition_external' THEN RETURN -1.0;
    WHEN 'complement_strong'    THEN RETURN  1.0;
    WHEN 'complement_medium'    THEN RETURN  0.5;
    WHEN 'complement_low'       THEN RETURN  0.2;
    WHEN 'anchor'               THEN RETURN  1.5;
    WHEN 'irrelevant'           THEN RETURN  0.0;
    ELSE                             RETURN  0.0;
  END CASE;
END;
$$;

-- 5. Bucket storage para heatmaps pre-agregados
INSERT INTO storage.buckets (id, name, public)
VALUES ('territorial-aggregates', 'territorial-aggregates', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read territorial aggregates" ON storage.objects;
CREATE POLICY "Public read territorial aggregates"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'territorial-aggregates');

DROP POLICY IF EXISTS "Admins write territorial aggregates" ON storage.objects;
CREATE POLICY "Admins write territorial aggregates"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'territorial-aggregates' AND has_role(auth.uid(), 'admin'::app_role));

-- 6. Backups vacíos
CREATE TABLE IF NOT EXISTS public._pois_pre_migration_backup AS
  SELECT * FROM pois WITH NO DATA;
CREATE TABLE IF NOT EXISTS public._poi_folders_pre_migration_backup AS
  SELECT * FROM poi_folders WITH NO DATA;
CREATE TABLE IF NOT EXISTS public._poi_features_cache_pre_migration_backup AS
  SELECT * FROM poi_features_cache WITH NO DATA;

CREATE TABLE IF NOT EXISTS public._migration_log (
  id SERIAL PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sprint TEXT,
  notes TEXT
);