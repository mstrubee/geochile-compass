-- =============================================================================
-- Cuota de OpenRouteService (ORS) en api_quota.
-- =============================================================================
-- Contexto: la edge function `isochrone` gasta cuota de ORS (clave del proyecto) y hasta ahora NO tenía
-- ningún contador: api_quota solo cubría Google Maps Platform. Esta migración deja a `ors` en el mismo
-- mecanismo (conteo y bloqueo en el servidor, ciclo mensual en hora del Pacífico).
--
--   1. api_quota_config.api admite 'ors' (se reemplaza el CHECK).
--   2. Fila 'ors' con un límite MENSUAL inicial PROVISIONAL (10.000): NO está verificado contra el plan
--      real de ORS (ORS además limita por día y por minuto por su cuenta). Un admin lo ajusta con
--      set_api_quota_limit('ors', n, <contraseña>). `on conflict do nothing`: no pisa un valor ya editado.
--   3. consume_api_quota('ors', n) solo la puede llamar service_role (la edge function, tras validar al
--      usuario). Para las APIs de Google no cambia nada.
--   4. get_api_quota_status() no lista 'ors' (es público y alimenta el panel de Google Maps).
--
-- Solo agrega una fila y reemplaza: (a) el CHECK de api_quota_config.api, (b) dos funciones con
-- `create or replace` (conservan sus GRANT). No toca datos existentes. Idempotente.
-- Se aplica con `psql -1` DESPUÉS de 20261015130000_api_quota.sql y ANTES de desplegar la edge function
-- `isochrone` de esta rama (si no, la función falla cerrado: responde 503). Rollback: supabase/rollbacks/.
-- =============================================================================

-- 1. CHECK ampliado (el original es anónimo: se busca por su definición en vez de asumir su nombre)
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
  check (api in ('maps_js', 'places', 'autocomplete', 'geocoding', 'ors'));

-- 2. Fila inicial (límite provisional, ver arriba)
insert into public.api_quota_config (api, label, free_limit) values
  ('ors', 'OpenRouteService (isócronas, vía edge function)', 10000)
on conflict (api) do nothing;

-- 3. Consumo: ORS solo desde el servidor
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
  -- ORS cuesta dinero y se bloquea para todos si se agota: solo lo consume el SERVIDOR (la edge
  -- function, con service_role, DESPUÉS de validar al usuario). Con la clave pública (anon) cualquiera
  -- podría vaciar la cuota llamando a este RPC directo. Las APIs de Google no cambian.
  if p_api = 'ors' and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'La cuota de ORS solo la consume el servidor' using errcode = '42501';
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

-- 4. Estado público sin 'ors'
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
  left join public.api_quota_usage u on u.api = c.api and u.period = public._api_quota_period()
  -- 'ors' no se lista aquí: este RPC es público y alimenta el panel de Google Maps.
  where c.api <> 'ors';
$fn$;
