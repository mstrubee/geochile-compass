-- ─────────────────────────────────────────────────────────────────────────────
-- Árbol de carpetas personalizables para Red Comercial Nacional
-- Idempotente: se puede re-ejecutar sin errores
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.comercial_carpetas (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre      TEXT        NOT NULL,
  parent_id   TEXT        DEFAULT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.comercial_cat_overrides (
  user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cat       TEXT NOT NULL,
  parent_id TEXT DEFAULT NULL,
  PRIMARY KEY (user_id, cat)
);

CREATE INDEX IF NOT EXISTS comercial_carpetas_user_idx      ON public.comercial_carpetas (user_id);
CREATE INDEX IF NOT EXISTS comercial_carpetas_parent_idx    ON public.comercial_carpetas (parent_id);
CREATE INDEX IF NOT EXISTS comercial_cat_overrides_user_idx ON public.comercial_cat_overrides (user_id);

ALTER TABLE public.comercial_carpetas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comercial_cat_overrides ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'comercial_carpetas'
    AND policyname = 'comercial_carpetas_own'
  ) THEN
    CREATE POLICY "comercial_carpetas_own"
      ON public.comercial_carpetas
      USING  (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'comercial_cat_overrides'
    AND policyname = 'comercial_cat_overrides_own'
  ) THEN
    CREATE POLICY "comercial_cat_overrides_own"
      ON public.comercial_cat_overrides
      USING  (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

GRANT ALL ON public.comercial_carpetas      TO authenticated;
GRANT ALL ON public.comercial_cat_overrides TO authenticated;
