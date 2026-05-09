CREATE TABLE IF NOT EXISTS public.user_ui_prefs (
  user_id uuid PRIMARY KEY,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_ui_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own ui prefs"
  ON public.user_ui_prefs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own ui prefs"
  ON public.user_ui_prefs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own ui prefs"
  ON public.user_ui_prefs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own ui prefs"
  ON public.user_ui_prefs FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER user_ui_prefs_updated_at
  BEFORE UPDATE ON public.user_ui_prefs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();