-- SOLO LECTURA. Mide el tamaño de lo cargado (tablas publicadas y esquema restringido, POR SEPARADO; regla 7: no se estima, se mide).
-- Local:   psql -h 127.0.0.1 -p 5433 -U postgres -d <base_test_cargada> -f docs/salud/planb/medir_tamano.sql
-- Cambia 'salud_restringido' por el nombre real del esquema restringido cuando exista (Fase 1a/2).
select n.nspname as esquema, c.relname as objeto, c.relkind as tipo,
       pg_size_pretty(pg_total_relation_size(c.oid)) as total_con_indices,
       pg_size_pretty(pg_relation_size(c.oid))       as solo_tabla,
       c.reltuples::bigint                           as filas_estimadas
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r','p','m') and n.nspname not in ('pg_catalog','information_schema','pg_toast')
order by pg_total_relation_size(c.oid) desc
limit 40;

select case when n.nspname = 'salud_restringido' then 'restringido' else 'publicado' end as grupo,
       pg_size_pretty(sum(pg_total_relation_size(c.oid))) as total
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r','p','m') and n.nspname not in ('pg_catalog','information_schema','pg_toast')
group by 1;

select pg_size_pretty(pg_database_size(current_database())) as base_completa;
