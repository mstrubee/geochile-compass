
CREATE TABLE IF NOT EXISTS public.evaluation_dimensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  weight numeric NOT NULL DEFAULT 1.0 CHECK (weight >= 0),
  display_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);
CREATE INDEX IF NOT EXISTS idx_evaluation_dimensions_active ON public.evaluation_dimensions(is_active, display_order);

CREATE TABLE IF NOT EXISTS public.poi_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poi_id uuid NOT NULL REFERENCES public.pois(id) ON DELETE CASCADE,
  dimension_id uuid NOT NULL REFERENCES public.evaluation_dimensions(id) ON DELETE CASCADE,
  score numeric NOT NULL CHECK (score >= -5 AND score <= 10),
  evaluator_id uuid REFERENCES auth.users(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(poi_id, dimension_id, evaluator_id)
);
CREATE INDEX IF NOT EXISTS idx_poi_evaluations_poi ON public.poi_evaluations(poi_id);
CREATE INDEX IF NOT EXISTS idx_poi_evaluations_dim ON public.poi_evaluations(dimension_id);
CREATE INDEX IF NOT EXISTS idx_poi_evaluations_evaluator ON public.poi_evaluations(evaluator_id);

CREATE OR REPLACE VIEW public.poi_evaluation_summary AS
SELECT
  pe.poi_id,
  ROUND(
    (SUM(pe.score * ed.weight) / NULLIF(SUM(ed.weight), 0))::numeric, 2
  ) AS weighted_score,
  COUNT(DISTINCT pe.dimension_id) AS dimensions_evaluated,
  (SELECT COUNT(*) FROM public.evaluation_dimensions WHERE is_active) AS dimensions_total_active,
  MAX(pe.updated_at) AS last_evaluated_at,
  (
    SELECT pe2.evaluator_id FROM public.poi_evaluations pe2
    WHERE pe2.poi_id = pe.poi_id
    ORDER BY pe2.updated_at DESC LIMIT 1
  ) AS last_evaluator_id,
  jsonb_object_agg(
    ed.title,
    jsonb_build_object('score', pe.score, 'weight', ed.weight)
    ORDER BY ed.display_order
  ) FILTER (WHERE ed.is_active) AS breakdown
FROM public.poi_evaluations pe
JOIN public.evaluation_dimensions ed ON ed.id = pe.dimension_id
WHERE ed.is_active = true
GROUP BY pe.poi_id;

ALTER TABLE public.poi_performance_analysis
  ADD COLUMN IF NOT EXISTS predicted_monthly_uf_model_a numeric,
  ADD COLUMN IF NOT EXISTS residual_uf_model_a numeric,
  ADD COLUMN IF NOT EXISTS residual_pct_model_a numeric,
  ADD COLUMN IF NOT EXISTS predicted_monthly_uf_model_b numeric,
  ADD COLUMN IF NOT EXISTS residual_uf_model_b numeric,
  ADD COLUMN IF NOT EXISTS residual_pct_model_b numeric,
  ADD COLUMN IF NOT EXISTS model_a_r2 numeric,
  ADD COLUMN IF NOT EXISTS model_b_r2 numeric,
  ADD COLUMN IF NOT EXISTS model_a_features_used jsonb,
  ADD COLUMN IF NOT EXISTS model_b_features_used jsonb,
  ADD COLUMN IF NOT EXISTS model_b_n_evaluated int,
  ADD COLUMN IF NOT EXISTS interpretation text;

ALTER TABLE public.evaluation_dimensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poi_evaluations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ev_dim_select ON public.evaluation_dimensions;
CREATE POLICY ev_dim_select ON public.evaluation_dimensions FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS ev_dim_insert ON public.evaluation_dimensions;
CREATE POLICY ev_dim_insert ON public.evaluation_dimensions FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS ev_dim_update ON public.evaluation_dimensions;
CREATE POLICY ev_dim_update ON public.evaluation_dimensions FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS ev_dim_delete ON public.evaluation_dimensions;
CREATE POLICY ev_dim_delete ON public.evaluation_dimensions FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS poi_eval_select ON public.poi_evaluations;
CREATE POLICY poi_eval_select ON public.poi_evaluations FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS poi_eval_insert ON public.poi_evaluations;
CREATE POLICY poi_eval_insert ON public.poi_evaluations FOR INSERT TO authenticated WITH CHECK (evaluator_id = auth.uid());
DROP POLICY IF EXISTS poi_eval_update ON public.poi_evaluations;
CREATE POLICY poi_eval_update ON public.poi_evaluations FOR UPDATE TO authenticated USING (evaluator_id = auth.uid());
DROP POLICY IF EXISTS poi_eval_delete ON public.poi_evaluations;
CREATE POLICY poi_eval_delete ON public.poi_evaluations FOR DELETE TO authenticated USING (evaluator_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.set_updated_at_evaluations()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_evaluation_dimensions_updated ON public.evaluation_dimensions;
CREATE TRIGGER trg_evaluation_dimensions_updated BEFORE UPDATE ON public.evaluation_dimensions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_evaluations();

DROP TRIGGER IF EXISTS trg_poi_evaluations_updated ON public.poi_evaluations;
CREATE TRIGGER trg_poi_evaluations_updated BEFORE UPDATE ON public.poi_evaluations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_evaluations();
