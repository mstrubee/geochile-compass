-- ─────────────────────────────────────────────────────────────────────────────
-- Marcas reubicadas en carpetas personalizadas de la Red Comercial Nacional
-- Permite cortar/pegar una marca (p.ej. "Lider") dentro de una carpeta del usuario.
-- Idempotente: se puede re-ejecutar sin errores.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.comercial_marca_overrides (
  user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cat       TEXT NOT NULL,
  marca     TEXT NOT NULL,
  parent_id TEXT DEFAULT NULL,   -- NULL = raíz; UUID de carpeta o nombre de categoría
  PRIMARY KEY (user_id, cat, marca)
);

CREATE INDEX IF NOT EXISTS comercial_marca_overrides_user_idx ON public.comercial_marca_overrides (user_id);

ALTER TABLE public.comercial_marca_overrides ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'comercial_marca_overrides'
    AND policyname = 'comercial_marca_overrides_own'
  ) THEN
    CREATE POLICY "comercial_marca_overrides_own"
      ON public.comercial_marca_overrides
      USING  (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

GRANT ALL ON public.comercial_marca_overrides TO authenticated;
