-- Eliminar política anterior genérica
DROP POLICY IF EXISTS read_brand_catalog ON public.brand_catalog;

-- Crear políticas nuevas
CREATE POLICY "brand_catalog_read_public"
  ON public.brand_catalog FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "brand_catalog_write_auth"
  ON public.brand_catalog FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);

-- Asegurar que anon tenga permiso de SELECT (requerido para que PostgREST funcione con la política)
GRANT SELECT ON public.brand_catalog TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_catalog TO authenticated;
