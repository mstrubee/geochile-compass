
-- Tabla de carpetas para isócronas guardadas
CREATE TABLE public.isochrone_folders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  parent_id UUID REFERENCES public.isochrone_folders(id) ON DELETE CASCADE,
  color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

ALTER TABLE public.isochrone_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own iso folders" ON public.isochrone_folders FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own iso folders" ON public.isochrone_folders FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own iso folders" ON public.isochrone_folders FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own iso folders" ON public.isochrone_folders FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_iso_folders_updated_at
BEFORE UPDATE ON public.isochrone_folders
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger anti-ciclo (mismo patrón que poi_folders)
CREATE OR REPLACE FUNCTION public.enforce_iso_folder_max_depth()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE cur UUID; hops INT := 0;
BEGIN
  IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.parent_id = NEW.id THEN RAISE EXCEPTION 'A folder cannot be its own parent'; END IF;
  cur := NEW.parent_id;
  WHILE cur IS NOT NULL LOOP
    IF cur = NEW.id THEN RAISE EXCEPTION 'Folder hierarchy cannot contain cycles'; END IF;
    hops := hops + 1;
    IF hops > 1000 THEN RAISE EXCEPTION 'Folder hierarchy too deep'; END IF;
    SELECT parent_id INTO cur FROM public.isochrone_folders WHERE id = cur;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_iso_folder_depth
BEFORE INSERT OR UPDATE ON public.isochrone_folders
FOR EACH ROW EXECUTE FUNCTION public.enforce_iso_folder_max_depth();

CREATE INDEX idx_iso_folders_user ON public.isochrone_folders(user_id);
CREATE INDEX idx_iso_folders_parent ON public.isochrone_folders(parent_id);

-- Tabla de isócronas guardadas
CREATE TABLE public.saved_isochrones (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  folder_id UUID REFERENCES public.isochrone_folders(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  mode TEXT NOT NULL,
  minutes INT[] NOT NULL DEFAULT '{}',
  center_lat DOUBLE PRECISION NOT NULL,
  center_lng DOUBLE PRECISION NOT NULL,
  color TEXT,
  features JSONB NOT NULL,
  source_poi_id UUID,
  source_lat DOUBLE PRECISION,
  source_lng DOUBLE PRECISION,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

ALTER TABLE public.saved_isochrones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own isos" ON public.saved_isochrones FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own isos" ON public.saved_isochrones FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own isos" ON public.saved_isochrones FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own isos" ON public.saved_isochrones FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_saved_isochrones_updated_at
BEFORE UPDATE ON public.saved_isochrones
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_saved_isos_user ON public.saved_isochrones(user_id);
CREATE INDEX idx_saved_isos_folder ON public.saved_isochrones(folder_id);
