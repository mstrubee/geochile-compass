-- ROLLBACK de 20261103000100_casen_prevision.sql. Se pierden las estimaciones cargadas (se recalculan con el ETL desde la base CASEN, que no se guarda en el repo).
-- La fuente se borra SOLO si no tiene capturas; las claves casen.* de pipeline_settings se borran.
drop function if exists public.get_casen_prevision_region();
drop function if exists public._casen_current_snapshot();
drop function if exists public.publish_casen_snapshot(uuid);
drop table if exists public.casen_prevision_stage;
drop table if exists public.casen_prevision_region;
delete from public.pipeline_settings where key in ('casen.min_cases', 'casen.min_df', 'casen.max_diff_official');
delete from public.data_sources d where d.source_key = 'mds_casen_2024_nacional' and not exists (select 1 from public.source_snapshots s where s.source_id = d.id);
do $$
begin
  if exists (select 1 from public.data_sources where source_key = 'mds_casen_2024_nacional') then
    raise notice 'mds_casen_2024_nacional conserva capturas en source_snapshots: la fuente NO se borró';
  end if;
end $$;
