DROP POLICY IF EXISTS "Admins delete territorial sources" ON storage.objects;
DROP POLICY IF EXISTS "Admins read territorial sources" ON storage.objects;
DROP POLICY IF EXISTS "Admins update territorial sources" ON storage.objects;
DROP POLICY IF EXISTS "Admins upload territorial sources" ON storage.objects;

GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, app_role) TO authenticated;

CREATE POLICY "Admins read territorial sources" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'territorial-sources' AND private.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins upload territorial sources" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'territorial-sources' AND private.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins update territorial sources" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'territorial-sources' AND private.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins delete territorial sources" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'territorial-sources' AND private.has_role(auth.uid(), 'admin'::app_role));