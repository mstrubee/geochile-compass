-- ─────────────────────────────────────────────────────────────────────────────
-- Árbol de carpetas personalizables para Red Comercial Nacional
-- Cada usuario puede reorganizar las categorías comerciales en carpetas anidadas
-- ─────────────────────────────────────────────────────────────────────────────

-- Carpetas personalizadas (anidamiento ilimitado)
CREATE TABLE IF NOT EXISTS public.comercial_carpetas (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre      TEXT        NOT NULL,
  parent_id   TEXT        DEFAULT NULL,  -- NULL = raíz; UUID de carpeta padre o ComercialCategoria
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Posición de categorías movidas de la raíz a alguna carpeta
CREATE TABLE IF NOT EXISTS public.comercial_cat_overrides (
  user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cat       TEXT NOT NULL,
  parent_id TEXT DEFAULT NULL,
  PRIMARY KEY (user_id, cat)
);

-- Índices
CREATE INDEX IF NOT EXISTS comercial_carpetas_user_idx    ON public.comercial_carpetas (user_id);
CREATE INDEX IF NOT EXISTS comercial_carpetas_parent_idx  ON public.comercial_carpetas (parent_id);
CREATE INDEX IF NOT EXISTS comercial_cat_overrides_user_idx ON public.comercial_cat_overrides (user_id);

-- RLS: cada usuario solo accede a sus propias carpetas
ALTER TABLE public.comercial_carpetas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comercial_cat_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comercial_carpetas_own"
  ON public.comercial_carpetas
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "comercial_cat_overrides_own"
  ON public.comercial_cat_overrides
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT ALL ON public.comercial_carpetas      TO authenticated;
GRANT ALL ON public.comercial_cat_overrides TO authenticated;
