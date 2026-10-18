-- ROLLBACK de 20261101000000_api_quota_ors.sql. Borra la fila y el consumo de 'ors', devuelve el CHECK a
-- las 4 APIs de Google y restaura las dos funciones tal como las dejó 20261015130000_api_quota.sql.
-- Se pierde el consumo de ORS registrado (los meses ya cerrados y el actual).
delete from public.api_quota_extensions where api = 'ors';
delete from public.api_quota_usage      where api = 'ors';
delete from public.api_quota_config     where api = 'ors';

do $do$
declare c text;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.api_quota_config'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%maps_js%'
  loop
    execute format('alter table public.api_quota_config drop constraint %I', c);
  end loop;
end
$do$;
alter table public.api_quota_config
  add constraint api_quota_config_api_check
  check (api in ('maps_js', 'places', 'autocomplete', 'geocoding'));

create or replace function public.consume_api_quota(p_api text, p_n integer default 1)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_period date := public._api_quota_period();
  v_limit  integer;
  v_used   integer;
  v_extra  integer;
begin
  if p_n is null or p_n < 1 or p_n > 100 then
    raise exception 'p_n debe estar entre 1 y 100';
  end if;
  select free_limit into v_limit from public.api_quota_config where api = p_api;
  if not found then
    raise exception 'API desconocida: %', p_api;
  end if;

  insert into public.api_quota_usage (api, period) values (p_api, v_period)
  on conflict (api, period) do nothing;

  -- Atómico: incrementa solo si no se supera el límite efectivo (gratis + extras autorizados).
  update public.api_quota_usage u
     set used = u.used + p_n, updated_at = now()
   where u.api = p_api and u.period = v_period
     and u.used + p_n <= v_limit + u.extra_authorized
  returning u.used, u.extra_authorized into v_used, v_extra;

  if found then
    return jsonb_build_object('allowed', true, 'used', v_used, 'limit', v_limit + v_extra);
  end if;

  select used, extra_authorized into v_used, v_extra
    from public.api_quota_usage where api = p_api and period = v_period;
  return jsonb_build_object('allowed', false, 'used', v_used, 'limit', v_limit + v_extra);
end;
$fn$;

create or replace function public.get_api_quota_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select jsonb_build_object(
    'period', public._api_quota_period(),
    'period_end', (public._api_quota_period() + interval '1 month')::date,
    'apis', coalesce(jsonb_agg(jsonb_build_object(
      'api', c.api,
      'label', c.label,
      'free_limit', c.free_limit,
      'extra_authorized', coalesce(u.extra_authorized, 0),
      'limit', c.free_limit + coalesce(u.extra_authorized, 0),
      'used', coalesce(u.used, 0)
    ) order by array_position(array['maps_js','places','autocomplete','geocoding'], c.api)), '[]'::jsonb)
  )
  from public.api_quota_config c
  left join public.api_quota_usage u on u.api = c.api and u.period = public._api_quota_period();
$fn$;
