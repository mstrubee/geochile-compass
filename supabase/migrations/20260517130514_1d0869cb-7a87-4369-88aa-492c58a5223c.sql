
CREATE TABLE public.gemini_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alias text NOT NULL,
  api_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100,
  last_used_at timestamptz,
  last_error_at timestamptz,
  last_error_message text,
  last_error_reason text,
  success_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.gemini_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins select gemini keys" ON public.gemini_api_keys
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins insert gemini keys" ON public.gemini_api_keys
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins update gemini keys" ON public.gemini_api_keys
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins delete gemini keys" ON public.gemini_api_keys
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER gemini_api_keys_set_updated_at
  BEFORE UPDATE ON public.gemini_api_keys
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_gemini_api_keys_enabled_priority
  ON public.gemini_api_keys (enabled, priority, last_error_at NULLS FIRST);

CREATE TABLE public.gemini_key_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  url text NOT NULL,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.gemini_key_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins select gemini links" ON public.gemini_key_links
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins insert gemini links" ON public.gemini_key_links
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins update gemini links" ON public.gemini_key_links
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins delete gemini links" ON public.gemini_key_links
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER gemini_key_links_set_updated_at
  BEFORE UPDATE ON public.gemini_key_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.gemini_key_links (label, url, order_index) VALUES
  ('Google AI Studio · Crear API Key', 'https://aistudio.google.com/apikey', 0),
  ('Google Cloud Console · Credenciales', 'https://console.cloud.google.com/apis/credentials', 10);
