-- =============================================================================
-- Pruebas del ROLLBACK 20261101000000_api_quota_ors_down.sql. NO es una migración.
-- Receta (misma transacción, terminando en error):
--   <20261015130000_api_quota.sql>
--   <20261101000000_api_quota_ors.sql>
--   <supabase/rollbacks/20261101000000_api_quota_ors_down.sql>   (dos veces: idempotencia)
--   <este archivo>
--   do $$ begin raise exception 'DRYRUN_OK %', (select count(*) from _tr); end $$;
-- =============================================================================
create temp table _tr (seq serial primary key, name text not null);
grant all on _tr to public;
grant all on sequence _tr_seq_seq to public;
create or replace function pg_temp.assert_that(p_name text, p_cond boolean, p_detail text default null)
returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FAIL [%]: %', p_name, coalesce(p_detail, 'condición falsa'); end if;
  insert into _tr (name) values (p_name);
end $$;
create or replace function pg_temp.try_sql(p_sql text)
returns text language plpgsql as $$
begin execute p_sql; return 'OK'; exception when others then return sqlstate; end $$;

select pg_temp.assert_that('no queda la fila ors', (select count(*) from public.api_quota_config where api = 'ors') = 0);
select pg_temp.assert_that('quedan las 4 APIs de Google', (select count(*) from public.api_quota_config) = 4);
select pg_temp.assert_that('el CHECK volvió a rechazar ors',
  pg_temp.try_sql($$insert into public.api_quota_config (api, label, free_limit) values ('ors', 'x', 1)$$) = '23514');
select pg_temp.assert_that('un solo CHECK de api', (select count(*) from pg_constraint where conrelid = 'public.api_quota_config'::regclass
  and contype = 'c' and pg_get_constraintdef(oid) like '%maps_js%') = 1);
select pg_temp.assert_that('consume_api_quota volvió al original (sin guarda de ors)',
  pg_get_functiondef('public.consume_api_quota(text,integer)'::regprocedure) not like '%ors%');
select pg_temp.assert_that('el estado público vuelve a listar las 4 APIs', jsonb_array_length(public.get_api_quota_status()->'apis') = 4);
select pg_temp.assert_that('consume sigue permitido para Google', (public.consume_api_quota('geocoding')->>'allowed')::boolean);
