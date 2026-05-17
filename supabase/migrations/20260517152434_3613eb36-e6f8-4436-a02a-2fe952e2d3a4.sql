CREATE TABLE _poi_metrics_synthetic_backup_20260517 AS
SELECT * FROM poi_metrics
WHERE period >= '2026-05-01'
  AND metric_key = 'ventas';

ALTER TABLE _poi_metrics_synthetic_backup_20260517 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins all _poi_metrics_synthetic_backup_20260517"
ON _poi_metrics_synthetic_backup_20260517
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DELETE FROM poi_metrics
WHERE period >= '2026-05-01'
  AND metric_key = 'ventas';

INSERT INTO _migration_log (sprint, notes)
VALUES ('cleanup_synthetic_ventas_20260517',
        'Deleted 64 synthetic ventas rows (period >= 2026-05-01, loaded 2026-05-09, decimal values). Backup in _poi_metrics_synthetic_backup_20260517.');