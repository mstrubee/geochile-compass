-- ROLLBACK de 20261021120100_ine_crf_polygons.sql. Revertir antes 20261021120300.
-- Se pierden los polígonos cargados; el archivo original sigue en Storage y se puede volver a procesar.
-- La fuente ine_crf_nacional solo se borra si no tiene snapshots (si los tiene, queda su registro de procedencia).
drop function if exists public.get_ine_crf_coverage();
drop function if exists public.get_ine_crf_by_comuna(smallint[]);
drop function if exists public.get_ine_crf_polygons(double precision, double precision, double precision, double precision, smallint[], integer);
drop function if exists public._ine_crf_current_snapshot();
drop function if exists public.publish_ine_crf_snapshot(uuid);
drop function if exists public._repair_polygon(geometry, numeric);
drop function if exists public._safe_area_m2(geometry);
drop function if exists public._ine_crf_make_partition(integer);
drop table if exists public.ine_crf_stage;
drop table if exists public.ine_crf_geom_repairs;
drop table if exists public.ine_crf_polygons;           -- arrastra sus particiones
delete from public.pipeline_settings where key in ('crf.geom_repair_max_area_diff_pct', 'crf.max_invalid_ratio');
delete from public.data_sources d where d.source_key = 'ine_crf_nacional'
   and not exists (select 1 from public.source_snapshots s where s.source_id = d.id);
