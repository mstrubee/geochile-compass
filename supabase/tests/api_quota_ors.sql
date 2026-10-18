-- =============================================================================
-- Pruebas de 20261101000000_api_quota_ors.sql. NO es una migración.
-- Se corre DESPUÉS de las dos migraciones, en la MISMA transacción y terminando en error:
--   <20261015130000_api_quota.sql>
--   <20261101000000_api_quota_ors.sql>   (dos veces: idempotencia)
--   <este archivo>
--   do $$ begin raise exception 'DRYRUN_OK %', (select count(*) from _tr); end $$;
-- Requiere de la plataforma: roles anon/authenticated/service_role, auth.uid() y auth.role() (leen
-- request.jwt.claims), public.has_role y el esquema `extensions` con pgcrypto (los pide api_quota).
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

create or replace function pg_temp.as_role(p_role text)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', p_role)::text, true);
  execute format('set local role %I', p_role);
end $$;

create or replace function pg_temp.reset_role()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function pg_temp.try_sql(p_sql text)
returns text language plpgsql as $$
begin execute p_sql; return 'OK'; exception when others then return sqlstate; end $$;

-- Estructura -----------------------------------------------------------------------------------
select pg_temp.assert_that('ORS sembrada con el límite provisional',
  (select free_limit from public.api_quota_config where api = 'ors') = 10000);
select pg_temp.assert_that('ahora hay 5 APIs configuradas', (select count(*) from public.api_quota_config) = 5);
select pg_temp.assert_that('el CHECK de api es UNO solo (idempotente) y admite ors',
  (select count(*) from pg_constraint where conrelid = 'public.api_quota_config'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%maps_js%' and pg_get_constraintdef(oid) like '%ors%') = 1
  and (select count(*) from pg_constraint where conrelid = 'public.api_quota_config'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%maps_js%') = 1);
select pg_temp.assert_that('el CHECK sigue rechazando APIs desconocidas',
  pg_temp.try_sql($$insert into public.api_quota_config (api, label, free_limit) values ('otra', 'x', 1)$$) = '23514');
select pg_temp.assert_that('consume_api_quota conserva sus GRANT a anon y authenticated',
  has_function_privilege('anon', 'public.consume_api_quota(text,integer)', 'execute')
  and has_function_privilege('authenticated', 'public.consume_api_quota(text,integer)', 'execute'));

-- Límite chico para probar el bloqueo
update public.api_quota_config set free_limit = 3 where api = 'ors';

-- anon y authenticated NO pueden consumir ORS (solo el servidor) ---------------------------------
select pg_temp.as_role('anon');
select pg_temp.assert_that('anon NO puede consumir ORS (42501)',
  pg_temp.try_sql($$select public.consume_api_quota('ors')$$) = '42501');
select pg_temp.reset_role();
select pg_temp.as_role('authenticated');
select pg_temp.assert_that('un usuario autenticado NO puede consumir ORS directo (42501)',
  pg_temp.try_sql($$select public.consume_api_quota('ors')$$) = '42501');
select pg_temp.reset_role();
select pg_temp.assert_that('los intentos rechazados no consumieron nada',
  coalesce((select used from public.api_quota_usage where api = 'ors'), 0) = 0);

-- service_role sí, y bloquea al llegar al límite ------------------------------------------------
select pg_temp.as_role('service_role');
select pg_temp.assert_that('ORS 1 permitido', (public.consume_api_quota('ors')->>'allowed')::boolean);
select pg_temp.assert_that('ORS 2 permitido', (public.consume_api_quota('ors')->>'allowed')::boolean);
select pg_temp.assert_that('ORS 3 permitido (llega justo al límite)', (public.consume_api_quota('ors')->>'allowed')::boolean);
select pg_temp.assert_that('ORS 4 BLOQUEADO', (public.consume_api_quota('ors')->>'allowed')::boolean = false);
select pg_temp.assert_that('el bloqueo no incrementa', (public.consume_api_quota('ors')->>'used')::int = 3);
select pg_temp.assert_that('el resultado informa el límite', (public.consume_api_quota('ors')->>'limit')::int = 3);
select pg_temp.reset_role();

-- Las APIs de Google no cambiaron -----------------------------------------------------------------
select pg_temp.as_role('anon');
select pg_temp.assert_that('anon sigue pudiendo consumir geocoding',
  (public.consume_api_quota('geocoding')->>'allowed')::boolean);
select pg_temp.assert_that('anon ve el estado público SIN ors y con las 4 de Google',
  jsonb_array_length(public.get_api_quota_status()->'apis') = 4
  and not (public.get_api_quota_status()->'apis') @> '[{"api":"ors"}]'::jsonb);
select pg_temp.assert_that('anon NO lee la tabla de uso (sin GRANT)', pg_temp.try_sql($$select * from public.api_quota_usage$$) = '42501');
select pg_temp.reset_role();
