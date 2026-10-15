-- =============================================================================
-- Pruebas de 20261015130000_api_quota.sql. NO es una migración.
-- Se corre DESPUÉS de la migración, en la MISMA transacción y terminando en error:
--   <20261015130000_api_quota.sql>   (dos veces: idempotencia)
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

create or replace function pg_temp.set_user(p_uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create or replace function pg_temp.reset_user()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function pg_temp.try_sql(p_sql text)
returns text language plpgsql as $$
begin execute p_sql; return 'OK'; exception when others then return sqlstate; end $$;

-- Estructura
select pg_temp.assert_that('4 APIs sembradas', (select count(*) from public.api_quota_config) = 4);
select pg_temp.assert_that('RLS activo en las 4 tablas',
  (select count(*) from pg_class where relname in ('api_quota_config','api_quota_usage','api_quota_extensions','api_quota_admin')
     and relnamespace = 'public'::regnamespace and relrowsecurity) = 4);

-- Límite chico para probar el bloqueo
update public.api_quota_config set free_limit = 3 where api = 'geocoding';

-- Consumo: anon puede consumir; al llegar al límite bloquea
set local role anon;
select pg_temp.assert_that('consumo 1 permitido', (public.consume_api_quota('geocoding')->>'allowed')::boolean);
select pg_temp.assert_that('consumo 2 permitido', (public.consume_api_quota('geocoding')->>'allowed')::boolean);
select pg_temp.assert_that('consumo 3 permitido (llega justo al límite)', (public.consume_api_quota('geocoding')->>'allowed')::boolean);
select pg_temp.assert_that('consumo 4 BLOQUEADO', (public.consume_api_quota('geocoding')->>'allowed')::boolean = false);
select pg_temp.assert_that('bloqueado no incrementa', (public.consume_api_quota('geocoding')->>'used')::int = 3);
select pg_temp.assert_that('p_n=100 dentro del límite se permite y suma 100',
  (public.consume_api_quota('places', 100)->>'used')::int = 100);
select pg_temp.assert_that('API desconocida falla', pg_temp.try_sql($$select public.consume_api_quota('otra')$$) <> 'OK');
select pg_temp.assert_that('p_n=0 falla', pg_temp.try_sql($$select public.consume_api_quota('geocoding', 0)$$) <> 'OK');
select pg_temp.assert_that('anon NO puede ampliar', pg_temp.try_sql($$select public.extend_api_quota('geocoding','x')$$) <> 'OK');
select pg_temp.assert_that('anon NO lee la tabla de contraseña',
  pg_temp.try_sql($$select * from public.api_quota_admin$$) <> 'OK');
select pg_temp.assert_that('anon lee el estado',
  jsonb_array_length(public.get_api_quota_status()->'apis') = 4);
reset role;

-- Usuario normal (no admin)
select pg_temp.set_user('00000000-0000-0000-0000-0000000000aa');
select pg_temp.assert_that('no admin NO puede definir contraseña', pg_temp.try_sql($$select public.set_api_quota_password('abcdefgh')$$) = '42501');
select pg_temp.assert_that('no admin NO puede ampliar', pg_temp.try_sql($$select public.extend_api_quota('geocoding','x')$$) = '42501');
select pg_temp.assert_that('no admin NO puede cambiar límite', pg_temp.try_sql($$select public.set_api_quota_limit('geocoding', 1)$$) = '42501');
select pg_temp.reset_user();

-- Admin real
select pg_temp.set_user('235fc5ab-acee-4c74-a424-6a87d0e10b21');
select pg_temp.assert_that('admin: aún sin contraseña', public.has_api_quota_password() = false);
select pg_temp.assert_that('ampliar sin contraseña definida falla con no_password',
  public.extend_api_quota('geocoding','x')->>'error' = 'no_password');
select pg_temp.assert_that('contraseña débil rechazada', public.set_api_quota_password('corta')->>'error' = 'weak_password');
select pg_temp.assert_that('define contraseña', (public.set_api_quota_password('clave-segura-1')->>'ok')::boolean);
select pg_temp.assert_that('ahora hay contraseña', public.has_api_quota_password());
select pg_temp.assert_that('el admin tampoco lee la tabla de contraseña directo',
  pg_temp.try_sql($$select * from public.api_quota_admin$$) <> 'OK');
select pg_temp.assert_that('cambiar contraseña exige la actual',
  public.set_api_quota_password('otra-clave-123','mala')->>'error' = 'bad_password');

-- Ampliación
select pg_temp.assert_that('clave incorrecta no amplía', public.extend_api_quota('geocoding','mala')->>'error' = 'bad_password');
select pg_temp.assert_that('clave correcta amplía +1000',
  (public.extend_api_quota('geocoding','clave-segura-1')->>'extra_authorized')::int = 1000);
select pg_temp.assert_that('segunda ampliación = 2000',
  (public.extend_api_quota('geocoding','clave-segura-1')->>'extra_authorized')::int = 2000);
select pg_temp.assert_that('límite efectivo = 3 + 2000',
  (select (a->>'limit')::int from jsonb_array_elements(public.get_api_quota_status()->'apis') a where a->>'api'='geocoding') = 2003);
select pg_temp.assert_that('bitácora registra 2 ampliaciones', jsonb_array_length(public.list_api_quota_extensions()) = 2);
select pg_temp.reset_user();
select pg_temp.assert_that('hash no es texto plano',
  (select password_hash from public.api_quota_admin) <> 'clave-segura-1');

set local role anon;
select pg_temp.assert_that('tras ampliar vuelve a permitir', (public.consume_api_quota('geocoding')->>'allowed')::boolean);
reset role;

-- Subir el límite base exige contraseña; bajarlo no
select pg_temp.set_user('235fc5ab-acee-4c74-a424-6a87d0e10b21');
select pg_temp.assert_that('subir límite sin clave falla', public.set_api_quota_limit('places', 99999)->>'error' = 'bad_password');
select pg_temp.assert_that('subir límite con clave ok', (public.set_api_quota_limit('places', 6000, 'clave-segura-1')->>'ok')::boolean);
select pg_temp.assert_that('bajar límite sin clave ok', (public.set_api_quota_limit('places', 100)->>'ok')::boolean);

-- Bloqueo tras 5 fallos (el contador debe PERSISTIR: por eso no se lanza excepción)
select public.extend_api_quota('autocomplete','x');
select public.extend_api_quota('autocomplete','x');
select public.extend_api_quota('autocomplete','x');
select public.extend_api_quota('autocomplete','x');
select pg_temp.assert_that('5º fallo bloquea', public.extend_api_quota('autocomplete','x')->>'message' like '%bloquearon%');
select pg_temp.assert_that('bloqueado rechaza incluso la clave buena',
  public.extend_api_quota('autocomplete','clave-segura-1')->>'error' = 'locked');
select pg_temp.reset_user();
