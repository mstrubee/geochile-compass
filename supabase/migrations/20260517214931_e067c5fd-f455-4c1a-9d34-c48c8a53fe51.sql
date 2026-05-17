CREATE TABLE IF NOT EXISTS public._territorial_features_reasignacion_backup_20260517 AS
SELECT tf.*
FROM public.territorial_features tf
JOIN public.territorial_layers tl ON tl.id = tf.layer_id
JOIN public.territorial_layer_groups tlg ON tlg.id = tl.group_id
WHERE tlg.slug = 'sin-clasificar';

ALTER TABLE public._territorial_features_reasignacion_backup_20260517 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins all _territorial_features_reasignacion_backup_20260517"
  ON public._territorial_features_reasignacion_backup_20260517
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));