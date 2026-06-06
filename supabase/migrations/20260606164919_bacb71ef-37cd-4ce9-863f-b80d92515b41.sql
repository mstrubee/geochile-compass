REVOKE EXECUTE ON FUNCTION public.admin_list_users() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.poi_counts_by_folder() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.user_section_permissions(uuid) FROM anon, public;

DROP POLICY IF EXISTS "Admins select gemini keys" ON public.gemini_api_keys;
DROP POLICY IF EXISTS "Admins insert gemini keys" ON public.gemini_api_keys;
DROP POLICY IF EXISTS "Admins update gemini keys" ON public.gemini_api_keys;
DROP POLICY IF EXISTS "Admins delete gemini keys" ON public.gemini_api_keys;

CREATE POLICY "Admins select gemini keys" ON public.gemini_api_keys FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins insert gemini keys" ON public.gemini_api_keys FOR INSERT TO authenticated WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins update gemini keys" ON public.gemini_api_keys FOR UPDATE TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins delete gemini keys" ON public.gemini_api_keys FOR DELETE TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins write geodata" ON storage.objects;
DROP POLICY IF EXISTS "Admins update geodata" ON storage.objects;
DROP POLICY IF EXISTS "Admins delete geodata" ON storage.objects;

CREATE POLICY "Admins write geodata" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'geodata' AND private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins update geodata" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'geodata' AND private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins delete geodata" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'geodata' AND private.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins update territorial aggregates" ON storage.objects;
DROP POLICY IF EXISTS "Admins delete territorial aggregates" ON storage.objects;

CREATE POLICY "Admins update territorial aggregates" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'territorial-aggregates' AND private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins delete territorial aggregates" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'territorial-aggregates' AND private.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Public read territorial aggregates" ON storage.objects;