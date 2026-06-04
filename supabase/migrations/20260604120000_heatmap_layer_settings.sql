-- Configuración de capas heatmap ajustable por admin
-- Permite que el admin ajuste minZoom, radius, blur, opacity en tiempo real
-- y persista para todos los usuarios

CREATE TABLE IF NOT EXISTS public.heatmap_layer_settings (
  layer_key   text PRIMARY KEY,           -- 'commercial' | 'crime'
  min_zoom    numeric NOT NULL DEFAULT 12,
  radius      numeric NOT NULL DEFAULT 20, -- radio base (a zoom=13)
  blur        numeric NOT NULL DEFAULT 15, -- blur base
  opacity     numeric NOT NULL DEFAULT 0.7,
  updated_at  timestamptz DEFAULT now(),
  updated_by  uuid REFERENCES auth.users(id)
);

-- Valores iniciales
INSERT INTO public.heatmap_layer_settings (layer_key, min_zoom, radius, blur, opacity)
VALUES
  ('commercial', 12, 20, 15, 0.70),
  ('crime',      8,  35, 28, 0.65)
ON CONFLICT (layer_key) DO NOTHING;

-- RLS: todos pueden leer, solo admins pueden escribir
ALTER TABLE public.heatmap_layer_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read heatmap settings"
  ON public.heatmap_layer_settings FOR SELECT USING (true);

CREATE POLICY "admin write heatmap settings"
  ON public.heatmap_layer_settings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role IN ('admin', 'moderator')
    )
  );

COMMENT ON TABLE public.heatmap_layer_settings IS
  'Configuración visual de capas heatmap (radius, blur, zoom) ajustable por admins';

-- Agregar configuración por defecto para gasto endógeno
INSERT INTO public.heatmap_layer_settings (layer_key, min_zoom, radius, blur, opacity)
VALUES ('gasto_endogeno', 11, 25, 20, 0.75)
ON CONFLICT (layer_key) DO NOTHING;
