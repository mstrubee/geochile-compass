-- ROLLBACK de 20261104000000_censo_poblacion.sql. Se pierde la población cargada (se recarga con etl/censo_poblacion.py desde el XLSX original, que queda en Storage con su hash).
-- La fuente se borra SOLO si no tiene capturas (si las tiene, se conserva por la FK y se avisa); la clave retention.keep_censo_snapshots se borra.
-- ANTES DE VOLVER A CARGAR: las filas de source_snapshots quedan como 'loaded'; marcarlas 'rejected' o el ETL contestará already_loaded con las tablas vacías (docs/poblacion/RUNBOOK_CENSO2024.md §6).
drop function if exists public.get_poblacion_comunal_edad(text);
drop function if exists public.get_poblacion_comunal();
drop function if exists public._poblacion_current_snapshot();
drop function if exists public.publish_poblacion_snapshot(uuid);
drop table if exists public.poblacion_comunal_edad_stage;
drop table if exists public.poblacion_comunal_stage;
drop table if exists public.poblacion_comunal_edad;
drop table if exists public.poblacion_comunal;
delete from public.pipeline_settings where key = 'retention.keep_censo_snapshots';
delete from public.data_sources d where d.source_key = 'ine_censo2024_poblacion_comunal' and not exists (select 1 from public.source_snapshots s where s.source_id = d.id);
do $$
begin
  if exists (select 1 from public.data_sources where source_key = 'ine_censo2024_poblacion_comunal') then
    raise notice 'ine_censo2024_poblacion_comunal conserva capturas en source_snapshots: la fuente NO se borró';
  end if;
end $$;
