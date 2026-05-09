ALTER TABLE public.poi_import_jobs
  ADD COLUMN IF NOT EXISTS source_file_path text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('poi-imports', 'poi-imports', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Admins read poi-imports"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'poi-imports' AND has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins write poi-imports"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'poi-imports' AND has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins update poi-imports"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'poi-imports' AND has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins delete poi-imports"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'poi-imports' AND has_role(auth.uid(), 'admin'::app_role));