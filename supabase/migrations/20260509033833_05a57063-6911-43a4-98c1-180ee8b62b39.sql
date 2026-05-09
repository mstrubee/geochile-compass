CREATE TABLE public.poi_import_skip_memory (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  folder_id UUID NOT NULL,
  normalized_key TEXT NOT NULL,
  raw_address TEXT,
  raw_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (folder_id, normalized_key)
);

CREATE INDEX idx_poi_import_skip_memory_folder ON public.poi_import_skip_memory(folder_id);

ALTER TABLE public.poi_import_skip_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authed read skip memory"
ON public.poi_import_skip_memory FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Admins ins skip memory"
ON public.poi_import_skip_memory FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins upd skip memory"
ON public.poi_import_skip_memory FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins del skip memory"
ON public.poi_import_skip_memory FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));