-- Posiciones personalizadas de globos de comunas (arrastradas por el usuario)
-- Persiste server-side para que cualquier sesión/dispositivo vea las mismas posiciones.

CREATE TABLE IF NOT EXISTS public.commune_coord_overrides (
  name        text PRIMARY KEY,            -- nombre de la comuna (clave de COMMUNES)
  lat         numeric(10,6) NOT NULL,
  lng         numeric(10,6) NOT NULL,
  updated_at  timestamptz DEFAULT now(),
  updated_by  uuid REFERENCES auth.users(id)
);

-- RLS: todos los autenticados pueden leer; solo admin/moderator pueden escribir
ALTER TABLE public.commune_coord_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read commune overrides"
  ON public.commune_coord_overrides FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "admin write commune overrides"
  ON public.commune_coord_overrides FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role IN ('admin', 'moderator')
    )
  );

COMMENT ON TABLE public.commune_coord_overrides IS
  'Posiciones personalizadas de los globos de demografía comunal en el mapa';
