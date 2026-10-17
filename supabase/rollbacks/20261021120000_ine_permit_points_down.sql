-- ROLLBACK de 20261021120000_ine_permit_points.sql. Revertir antes 20261021120100, 20261021120200 y 20261021120300
-- (comparten geo_rejected_rows y los umbrales). Se pierden los puntos cargados; el archivo original sigue en Storage.
-- La fuente ine_pe_nacional solo se borra si no tiene snapshots (si los tiene, queda su registro de procedencia).
do $$
begin
  if to_regclass('public.ine_crf_polygons') is not null or to_regclass('public.building_projects') is not null then
    raise exception 'Revertir antes 20261021120100 (CRF) y 20261021120200 (SEIA): dependen de geo_rejected_rows';
  end if;
end $$;
drop function if exists public.get_ine_pe_vs_minvu_by_year();
drop function if exists public.get_ine_pe_comuna_series(char);
drop function if exists public.get_ine_pe_coverage();
drop function if exists public.get_ine_permit_points(double precision, double precision, double precision, double precision, integer, smallint[], smallint[], smallint, integer);
drop function if exists public._ine_pe_current_snapshot();
drop function if exists public.publish_ine_pe_snapshot(uuid);
drop function if exists public._ine_pe_make_partition(integer);
drop table if exists public.ine_pe_stage;
drop table if exists public.ine_pe_points;               -- arrastra sus particiones
drop table if exists public.ine_pe_glosas;
drop table if exists public.geo_rejected_rows;
delete from public.pipeline_settings where key in ('retention.keep_point_snapshots', 'ine_points.near_border_m', 'ine_points.max_outside_ratio');
delete from public.data_sources d where d.source_key = 'ine_pe_nacional'
   and not exists (select 1 from public.source_snapshots s where s.source_id = d.id);
