
-- Restrict brand_catalog writes to admins
DROP POLICY IF EXISTS "brand_catalog_write_auth" ON public.brand_catalog;
CREATE POLICY "brand_catalog_write_admin" ON public.brand_catalog
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Restrict comercial_categorias writes to admins
DROP POLICY IF EXISTS "cat_write_auth" ON public.comercial_categorias;
CREATE POLICY "cat_write_admin" ON public.comercial_categorias
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Restrict brand-logos bucket write/delete to admins; drop the permissive SELECT policy
-- (the bucket remains public so getPublicUrl still works via the CDN, but the policy that
-- enabled API-level listing of every object is removed).
DROP POLICY IF EXISTS "brand-logos_select_public" ON storage.objects;
DROP POLICY IF EXISTS "brand-logos_insert_auth" ON storage.objects;
DROP POLICY IF EXISTS "brand-logos_delete_auth" ON storage.objects;
CREATE POLICY "brand-logos_insert_admin" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'brand-logos' AND public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "brand-logos_update_admin" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'brand-logos' AND public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "brand-logos_delete_admin" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'brand-logos' AND public.has_role(auth.uid(), 'admin'::app_role));

-- Add fixed search_path to user-defined functions flagged by the linter
ALTER FUNCTION public.fn_marcas_categoria(text) SET search_path = public;
ALTER FUNCTION public.fn_participacion_marcas(text) SET search_path = public;
