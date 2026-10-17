-- ROLLBACK de 20261020120000_permits_provenance.sql. Solo borra objetos que esa migración creó.
-- Falla (sin CASCADE) si las partes 2-4 siguen aplicadas: revertirlas primero, en orden inverso.
-- Se pierden: fuentes sembradas, snapshots, revisiones, alertas, la tabla de comunas con sus geometrías
-- reparadas y el registro de reparaciones (todo reproducible: etl/permisos/seed.py). El bucket se borra
-- solo si está vacío: los archivos originales NUNCA se borran con este rollback.
select cron.unschedule('check-source-freshness') where exists (select 1 from cron.job where jobname = 'check-source-freshness');
drop view if exists public.source_freshness_v;
drop view if exists public.comunas_geom_review_v;
drop function if exists public.raise_freshness_alerts();
drop function if exists public.set_comuna_geometry(char, geometry, text);
drop table if exists public.comuna_name_aliases;
drop table if exists public.comuna_geom_repairs;
drop table if exists public.source_alerts;
drop table if exists public.source_checks;
drop table if exists public.source_snapshots;
drop table if exists public.comunas;
drop table if exists public.data_sources;
drop function if exists public.pipeline_setting(text);
drop table if exists public.pipeline_settings;
drop policy if exists "Admins read source snapshots" on storage.objects;
drop policy if exists "Admins upload source snapshots" on storage.objects;
delete from storage.buckets b where b.id = 'source-snapshots'
  and not exists (select 1 from storage.objects o where o.bucket_id = 'source-snapshots');
