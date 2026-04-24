-- Folders table with 2-level hierarchy (parent must be a root folder)
CREATE TABLE public.poi_folders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  parent_id UUID REFERENCES public.poi_folders(id) ON DELETE CASCADE,
  color TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_poi_folders_user ON public.poi_folders(user_id);
CREATE INDEX idx_poi_folders_parent ON public.poi_folders(parent_id);

ALTER TABLE public.poi_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own folders"
  ON public.poi_folders FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own folders"
  ON public.poi_folders FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own folders"
  ON public.poi_folders FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own folders"
  ON public.poi_folders FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_poi_folders_updated_at
  BEFORE UPDATE ON public.poi_folders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enforce max 2 levels: a folder with parent_id must point to a root folder
CREATE OR REPLACE FUNCTION public.enforce_folder_max_depth()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  parent_parent UUID;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    IF NEW.parent_id = NEW.id THEN
      RAISE EXCEPTION 'A folder cannot be its own parent';
    END IF;
    SELECT parent_id INTO parent_parent FROM public.poi_folders WHERE id = NEW.parent_id;
    IF parent_parent IS NOT NULL THEN
      RAISE EXCEPTION 'Maximum folder depth is 2 levels';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_poi_folders_max_depth
  BEFORE INSERT OR UPDATE ON public.poi_folders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_folder_max_depth();

-- Add folder reference to pois
ALTER TABLE public.pois
  ADD COLUMN folder_id UUID REFERENCES public.poi_folders(id) ON DELETE SET NULL;

CREATE INDEX idx_pois_folder ON public.pois(folder_id);