CREATE POLICY "brand-logos_select_public"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'brand-logos');

CREATE POLICY "brand-logos_insert_auth"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'brand-logos');

CREATE POLICY "brand-logos_delete_auth"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'brand-logos');