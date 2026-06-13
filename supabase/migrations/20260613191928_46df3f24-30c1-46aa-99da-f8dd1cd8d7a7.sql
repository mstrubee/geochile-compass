
-- comercial_carpetas
CREATE TABLE IF NOT EXISTS public.comercial_carpetas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  parent_id uuid NULL REFERENCES public.comercial_carpetas(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comercial_carpetas_user_parent_order
  ON public.comercial_carpetas(user_id, parent_id, sort_order);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.comercial_carpetas TO authenticated;
GRANT ALL ON public.comercial_carpetas TO service_role;

ALTER TABLE public.comercial_carpetas ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='comercial_carpetas' AND policyname='comercial_carpetas_own'
  ) THEN
    CREATE POLICY "comercial_carpetas_own" ON public.comercial_carpetas
      FOR ALL TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- updated_at trigger (reusa si ya existe)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS update_comercial_carpetas_updated_at ON public.comercial_carpetas;
CREATE TRIGGER update_comercial_carpetas_updated_at
  BEFORE UPDATE ON public.comercial_carpetas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- comercial_cat_overrides
CREATE TABLE IF NOT EXISTS public.comercial_cat_overrides (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cat text NOT NULL,
  parent_id text NULL,
  sort_order integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, cat)
);

CREATE INDEX IF NOT EXISTS idx_comercial_cat_overrides_user_parent_order
  ON public.comercial_cat_overrides(user_id, parent_id, sort_order);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.comercial_cat_overrides TO authenticated;
GRANT ALL ON public.comercial_cat_overrides TO service_role;

ALTER TABLE public.comercial_cat_overrides ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='comercial_cat_overrides' AND policyname='comercial_cat_overrides_own'
  ) THEN
    CREATE POLICY "comercial_cat_overrides_own" ON public.comercial_cat_overrides
      FOR ALL TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- comercial_marca_overrides: agregar sort_order
ALTER TABLE public.comercial_marca_overrides
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_comercial_marca_overrides_user_parent_order
  ON public.comercial_marca_overrides(user_id, parent_id, sort_order);
