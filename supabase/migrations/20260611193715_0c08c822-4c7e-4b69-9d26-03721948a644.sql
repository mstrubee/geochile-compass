CREATE TABLE public.comercial_categorias (
  id         serial PRIMARY KEY,
  key        text UNIQUE NOT NULL,
  label_es   text NOT NULL,
  icon_emoji text NOT NULL DEFAULT '📍',
  color_hex  text NOT NULL DEFAULT '#6B7280',
  osm_tags   jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  activo     boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

GRANT SELECT ON public.comercial_categorias TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.comercial_categorias TO authenticated;
GRANT ALL ON public.comercial_categorias TO service_role;

ALTER TABLE public.comercial_categorias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cat_read_public"
  ON public.comercial_categorias FOR SELECT
  TO anon, authenticated USING (true);

CREATE POLICY "cat_write_auth"
  ON public.comercial_categorias FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

INSERT INTO comercial_categorias (key, label_es, icon_emoji, color_hex, sort_order) VALUES
  ('supermercado',         'Supermercados',         '🛒', '#0046AD', 1),
  ('farmacia',             'Farmacias',             '💊', '#16A34A', 2),
  ('combustible',          'Combustible',           '⛽', '#EA580C', 3),
  ('banco',                'Bancos / ATM',          '🏦', '#7C3AED', 4),
  ('retail_departamental', 'Retail departamental',  '🛍️', '#DB2777', 5),
  ('mejoramiento_hogar',   'Mejoramiento hogar',    '🔨', '#B45309', 6),
  ('restaurante',          'Restaurantes',          '🍽️', '#DC2626', 7),
  ('conveniencia',         'Conveniencia',          '🏪', '#0891B2', 8),
  ('centro_comercial',     'Centros comerciales',   '🏬', '#059669', 9);

ALTER TABLE public.brand_catalog ADD COLUMN IF NOT EXISTS logo_url text;