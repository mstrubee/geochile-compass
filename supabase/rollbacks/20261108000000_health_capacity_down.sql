-- ROLLBACK de 20261108000000_health_capacity.sql. Se pierde la capacidad cargada (se recarga con etl/salud_capacidad.py; los archivos originales quedan en Storage con su hash).
-- Las fuentes se borran SOLO si no tienen capturas (si las tienen, se conservan por la FK y se avisa); la clave retention.keep_capacidad_snapshots se borra.
-- ANTES DE VOLVER A CARGAR: las filas de source_snapshots quedan como 'loaded'; marcarlas 'rejected' o el ETL contestará already_loaded con las tablas vacías (docs/salud/RUNBOOK_CAPACIDAD.md, sección de reversa).
drop function if exists public.get_health_capacity(text);
drop function if exists public._health_capacity_current_snapshot(text);
drop function if exists public.publish_health_dotacion_snapshot(uuid);
drop function if exists public.publish_health_rem20_snapshot(uuid);
drop table if exists public.health_beds_dotacion_stage;
drop table if exists public.health_rem20_month_stage;
drop table if exists public.health_beds_dotacion;
drop table if exists public.health_rem20_month;
drop table if exists public.health_capacity_fields;
drop table if exists public.health_areas_funcionales;
delete from public.pipeline_settings where key = 'retention.keep_capacidad_snapshots';
delete from public.data_sources d where d.source_key in ('deis_rem20_hospitalizacion', 'deis_dotacion_camas') and not exists (select 1 from public.source_snapshots s where s.source_id = d.id);
do $$
begin
  if exists (select 1 from public.data_sources where source_key in ('deis_rem20_hospitalizacion', 'deis_dotacion_camas')) then
    raise notice 'una o ambas fuentes de capacidad conservan capturas en source_snapshots: la fuente NO se borró';
  end if;
end $$;
