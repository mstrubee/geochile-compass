CREATE TABLE public.poi_import_identity_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id uuid NOT NULL,
  key_type text NOT NULL,
  key_value text NOT NULL,
  poi_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (folder_id, key_type, key_value)
);

ALTER TABLE public.poi_import_identity_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authed read identity memory" ON public.poi_import_identity_memory
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins ins identity memory" ON public.poi_import_identity_memory
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins upd identity memory" ON public.poi_import_identity_memory
  FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins del identity memory" ON public.poi_import_identity_memory
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_identity_memory_folder ON public.poi_import_identity_memory(folder_id);