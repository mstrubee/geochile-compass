-- ROLLBACK de 20261102000000_health_establishments.sql. Revertir ANTES 20261102000100 (capas del árbol).
-- Se pierden los establecimientos cargados y la tabla health_tipo_clasificacion (con sus ediciones). Los archivos originales siguen en Storage.
-- Se borra la fuente deis_establecimientos SOLO si no tiene capturas (si las tiene, se conserva por la FK y la nota lo dice).
-- Las claves health.* de pipeline_settings se borran.
drop function if exists public.get_health_tipo_clasificacion();
drop function if exists public.get_health_summary();
drop function if exists public.get_health_comuna_tipos(char);
drop function if exists public.get_health_comuna_counts(boolean, text[], text[], text[], text, text[], text[]);
drop function if exists public.get_health_establishments(double precision, double precision, double precision, double precision, boolean, text[], text[], text[], text, integer, text[], text[]);
drop function if exists public._health_current_snapshot();
drop function if exists public.publish_health_establishments(uuid);
drop table if exists public.health_establishments_stage;
drop table if exists public.health_establishments;
drop table if exists public.health_tipo_clasificacion;
delete from public.pipeline_settings where key in ('health.near_border_m', 'health.coast_buffer_m');
delete from public.data_sources d
 where d.source_key = 'deis_establecimientos'
   and not exists (select 1 from public.source_snapshots s where s.source_id = d.id);
do $$
begin
  if exists (select 1 from public.data_sources where source_key = 'deis_establecimientos') then
    raise notice 'deis_establecimientos conserva capturas en source_snapshots: la fuente NO se borró';
  end if;
end $$;
