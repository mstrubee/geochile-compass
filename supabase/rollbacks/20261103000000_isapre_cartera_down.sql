-- ROLLBACK de 20261103000000_isapre_cartera.sql. Revertir ANTES 20261103000200 (capas del árbol) si ya se aplicó.
-- Se pierden TODOS los conteos cargados, los publicados Y el esquema restringido salud_restringido (con los conteos completos): los originales XLSX
-- siguen en Storage con su hash y se pueden volver a cargar con el ETL. Se borra la fuente SOLO si no tiene capturas (si las tiene, se conserva por la FK y se avisa).
-- Las claves de pipeline_settings de la fase (salud.*, retention.keep_isapre_snapshots) se borran.
drop function if exists public.get_isapre_resumen_sin_alta(text, integer);
drop function if exists public.get_isapre_resumen();
drop function if exists public.get_isapre_region();
drop function if exists public.get_isapre_celdas(text);
drop function if exists public.get_isapre_comuna(text, integer, text);
drop function if exists public._isapre_comuna_rango(integer, text, integer);
drop function if exists public._health_comunas_sin_alta(text);
drop function if exists public._isapre_current_snapshot();
drop function if exists public.publish_isapre_snapshot(uuid);
drop table if exists public.isapre_cartera_region;
drop table if exists public.isapre_cartera_grupo;
drop table if exists public.isapre_cartera_celda;
drop table if exists public.isapre_cartera_unidad;
drop schema if exists salud_restringido cascade;
delete from public.pipeline_settings where key in ('salud.suppress_below', 'salud.min_aggregate_comunas', 'retention.keep_isapre_snapshots');
delete from public.data_sources d
 where d.source_key = 'superdesalud_isapre_cartera_comunal'
   and not exists (select 1 from public.source_snapshots s where s.source_id = d.id);
do $$
begin
  if exists (select 1 from public.data_sources where source_key = 'superdesalud_isapre_cartera_comunal') then
    raise notice 'superdesalud_isapre_cartera_comunal conserva capturas en source_snapshots: la fuente NO se borró';
  end if;
end $$;
