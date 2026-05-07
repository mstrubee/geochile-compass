
-- ============ ROLES ============
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE POLICY "Users can view their own roles" ON public.user_roles
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all roles" ON public.user_roles
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage roles ins" ON public.user_roles
  FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage roles upd" ON public.user_roles
  FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage roles del" ON public.user_roles
  FOR DELETE USING (public.has_role(auth.uid(), 'admin'));

-- ============ GROUPS ============
CREATE TABLE IF NOT EXISTS public.territorial_layer_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  color TEXT,
  icon TEXT,
  order_index INT NOT NULL DEFAULT 0,
  visible_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.territorial_layer_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authed read groups" ON public.territorial_layer_groups
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins ins groups" ON public.territorial_layer_groups
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins upd groups" ON public.territorial_layer_groups
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins del groups" ON public.territorial_layer_groups
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ LAYERS ============
CREATE TABLE IF NOT EXISTS public.territorial_layers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.territorial_layer_groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  icon TEXT,
  order_index INT NOT NULL DEFAULT 0,
  source_file_id UUID,
  feature_count INT NOT NULL DEFAULT 0,
  bbox JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(group_id, name)
);

ALTER TABLE public.territorial_layers ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_territorial_layers_group ON public.territorial_layers(group_id);

CREATE POLICY "Authed read layers" ON public.territorial_layers
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins ins layers" ON public.territorial_layers
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins upd layers" ON public.territorial_layers
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins del layers" ON public.territorial_layers
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ FEATURES ============
CREATE TABLE IF NOT EXISTS public.territorial_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  layer_id UUID NOT NULL REFERENCES public.territorial_layers(id) ON DELETE CASCADE,
  external_id TEXT,
  name TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  geometry JSONB NOT NULL,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.territorial_features ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_territorial_features_layer ON public.territorial_features(layer_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_territorial_features_layer_extid
  ON public.territorial_features(layer_id, external_id) WHERE external_id IS NOT NULL;

CREATE POLICY "Authed read features" ON public.territorial_features
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins ins features" ON public.territorial_features
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins upd features" ON public.territorial_features
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins del features" ON public.territorial_features
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ SOURCE FILES ============
CREATE TABLE IF NOT EXISTS public.territorial_source_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_filename TEXT NOT NULL,
  size_bytes BIGINT,
  storage_path TEXT NOT NULL,
  gdrive_file_id TEXT,
  uploaded_by UUID,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  excluded_layers JSONB NOT NULL DEFAULT '[]'::jsonb,
  dedup_strategy TEXT NOT NULL DEFAULT 'replace_layer',
  layers_summary JSONB,
  group_id UUID REFERENCES public.territorial_layer_groups(id) ON DELETE SET NULL
);

ALTER TABLE public.territorial_source_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authed read source files" ON public.territorial_source_files
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins ins source files" ON public.territorial_source_files
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins upd source files" ON public.territorial_source_files
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins del source files" ON public.territorial_source_files
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ TRIGGERS ============
CREATE TRIGGER trg_tlg_updated BEFORE UPDATE ON public.territorial_layer_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_tl_updated BEFORE UPDATE ON public.territorial_layers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ STORAGE BUCKET ============
INSERT INTO storage.buckets (id, name, public)
VALUES ('territorial-sources', 'territorial-sources', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Admins read territorial sources" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'territorial-sources' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins upload territorial sources" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'territorial-sources' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update territorial sources" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'territorial-sources' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete territorial sources" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'territorial-sources' AND public.has_role(auth.uid(), 'admin'));

-- ============ SEED ============
INSERT INTO public.territorial_layer_groups (name, slug, color, icon, order_index, visible_default)
VALUES ('Talleres', 'talleres', '#F59E0B', 'wrench', 100, false)
ON CONFLICT (slug) DO NOTHING;
