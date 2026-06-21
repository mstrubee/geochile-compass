
-- Fix custom_layers: restrict writes to admins
DROP POLICY IF EXISTS auth_write ON public.custom_layers;

CREATE POLICY "Admins can insert custom layers"
  ON public.custom_layers FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update custom layers"
  ON public.custom_layers FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete custom layers"
  ON public.custom_layers FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Add explicit SELECT policies on storage.objects for public buckets
-- so the storage API does not allow listing/enumeration. Files are still
-- accessible via direct public URL (bucket is public), but listing via
-- storage API is restricted to admins.
DROP POLICY IF EXISTS "Admins can list geodata objects" ON storage.objects;
CREATE POLICY "Admins can list geodata objects"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'geodata' AND public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can list territorial-aggregates objects" ON storage.objects;
CREATE POLICY "Admins can list territorial-aggregates objects"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'territorial-aggregates' AND public.has_role(auth.uid(), 'admin'::app_role));
