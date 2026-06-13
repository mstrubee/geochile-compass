CREATE TABLE IF NOT EXISTS public.comercial_marca_overrides (
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    cat text NOT NULL,
    marca text NOT NULL,
    parent_id text,
    PRIMARY KEY (user_id, cat, marca)
);

CREATE INDEX IF NOT EXISTS idx_comercial_marca_overrides_user_id 
ON public.comercial_marca_overrides(user_id);

GRANT ALL ON public.comercial_marca_overrides TO authenticated;
GRANT ALL ON public.comercial_marca_overrides TO service_role;

ALTER TABLE public.comercial_marca_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "comercial_marca_overrides_own" ON public.comercial_marca_overrides;

CREATE POLICY "comercial_marca_overrides_own"
ON public.comercial_marca_overrides
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);