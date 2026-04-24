-- Tabla principal de POIs
CREATE TABLE public.pois (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  color TEXT,
  icon TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_layer TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_pois_user_id ON public.pois(user_id);
CREATE INDEX idx_pois_source_layer ON public.pois(source_layer);

-- Habilitar RLS
ALTER TABLE public.pois ENABLE ROW LEVEL SECURITY;

-- Políticas: cada usuario solo ve / gestiona los suyos
CREATE POLICY "Users can view their own pois"
  ON public.pois FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own pois"
  ON public.pois FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own pois"
  ON public.pois FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own pois"
  ON public.pois FOR DELETE
  USING (auth.uid() = user_id);

-- Función + trigger updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_pois_updated_at
  BEFORE UPDATE ON public.pois
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();