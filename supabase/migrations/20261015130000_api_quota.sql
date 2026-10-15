-- =============================================================================
-- Cuota de uso de las APIs de Google Maps Platform (límite gratuito protegido).
-- =============================================================================
-- Objetivo: Geoplanet NO debe sobrepasar el uso gratuito de cada API de Google sin una
-- autorización expresa. El conteo y el bloqueo viven en el SERVIDOR (no en localStorage),
-- así que valen para todos los usuarios a la vez.
--
--   * api_quota_config      límite gratuito mensual por API (editable en el panel admin).
--   * api_quota_usage       consumo del mes + llamadas extra autorizadas ese mes.
--   * api_quota_extensions  bitácora de cada ampliación (+1000) autorizada.
--   * api_quota_admin       hash de la contraseña que protege las ampliaciones (singleton).
--
-- Todo el acceso pasa por funciones SECURITY DEFINER; las tablas no se escriben directo.
-- El ciclo es mensual en hora del Pacífico (America/Los_Angeles), igual que la facturación
-- de Google. Los extras autorizados se acaban con el mes (la fila de uso es por mes).
--
-- Solo agrega objetos nuevos: no toca ninguna tabla ni dato existente. Idempotente.
-- =============================================================================

create table if not exists public.api_quota_config (
  api         text primary key check (api in ('maps_js', 'places', 'autocomplete', 'geocoding')),
  label       text not null,
  free_limit  integer not null check (free_limit >= 0),
  updated_at  timestamptz not null default now()
);

create table if not exists public.api_quota_usage (
  api              text not null references public.api_quota_config(api) on delete cascade,
  period           date not null,
  used             integer not null default 0 check (used >= 0),
  extra_authorized integer not null default 0 check (extra_authorized >= 0),
  updated_at       timestamptz not null default now(),
  primary key (api, period)
);

create table if not exists public.api_quota_extensions (
  id          bigserial primary key,
  api         text not null references public.api_quota_config(api) on delete cascade,
  period      date not null,
  amount      integer not null check (amount > 0),
  created_by  uuid,
  created_at  timestamptz not null default now()
);

create table if not exists public.api_quota_admin (
  id              boolean primary key default true check (id),
  password_hash   text not null,
  failed_attempts integer not null default 0,
  locked_until    timestamptz,
  updated_at      timestamptz not null default now(),
  updated_by      uuid
);

alter table public.api_quota_config     enable row level security;
alter table public.api_quota_usage      enable row level security;
alter table public.api_quota_extensions enable row level security;
alter table public.api_quota_admin      enable row level security;

-- Lectura directa solo para admin; escritura SOLO vía funciones. api_quota_admin: sin acceso.
drop policy if exists "api_quota_config_admin_read" on public.api_quota_config;
create policy "api_quota_config_admin_read" on public.api_quota_config
  for select to authenticated using (public.has_role(auth.uid(), 'admin'::app_role));
drop policy if exists "api_quota_usage_admin_read" on public.api_quota_usage;
create policy "api_quota_usage_admin_read" on public.api_quota_usage
  for select to authenticated using (public.has_role(auth.uid(), 'admin'::app_role));
drop policy if exists "api_quota_extensions_admin_read" on public.api_quota_extensions;
create policy "api_quota_extensions_admin_read" on public.api_quota_extensions
  for select to authenticated using (public.has_role(auth.uid(), 'admin'::app_role));

revoke all on public.api_quota_config, public.api_quota_usage,
              public.api_quota_extensions, public.api_quota_admin from anon, authenticated;
grant select on public.api_quota_config, public.api_quota_usage, public.api_quota_extensions to authenticated;
grant all on public.api_quota_config, public.api_quota_usage, public.api_quota_extensions,
             public.api_quota_admin to service_role;

-- Límites iniciales = cupo gratuito mensual de Google (Essentials/Pro, vigente desde marzo 2025).
-- Se ajustan desde el panel admin; verificar contra la tabla de precios de Google al activarlas.
insert into public.api_quota_config (api, label, free_limit) values
  ('maps_js',      'Google Maps JavaScript API (cargas de mapa)',   10000),
  ('places',       'Places API (detalle y búsqueda de lugares)',     5000),
  ('autocomplete', 'Autocomplete (sugerencias del buscador)',       10000),
  ('geocoding',    'Geocoding API (dirección → coordenadas)',       10000)
on conflict (api) do nothing;

-- ── Helpers ────────────────────────────────────────────────────────────────────

create or replace function public._api_quota_period()
returns date
language sql
stable
set search_path = public
as $fn$
  select date_trunc('month', now() at time zone 'America/Los_Angeles')::date;
$fn$;

create or replace function public._api_quota_require_admin()
returns void
language plpgsql
stable
set search_path = public
as $fn$
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'admin'::app_role) then
    raise exception 'Solo los administradores pueden hacer esto' using errcode = '42501';
  end if;
end;
$fn$;

-- Verifica la contraseña con bloqueo por intentos fallidos. Devuelve NULL si es correcta o un
-- jsonb {ok:false, error, ...} listo para devolver al cliente. Persiste los fallos (por eso las
-- funciones que la usan NO lanzan excepción ante una clave errónea: haría rollback del contador).
create or replace function public._api_quota_check_password(p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v public.api_quota_admin%rowtype;
begin
  select * into v from public.api_quota_admin where id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_password',
      'message', 'Aún no hay una contraseña de ampliaciones. Defínela primero en este panel.');
  end if;
  if v.locked_until is not null and v.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'locked', 'locked_until', v.locked_until,
      'message', 'Demasiados intentos fallidos. Intenta de nuevo más tarde.');
  end if;
  if p_password is not null and v.password_hash = extensions.crypt(p_password, v.password_hash) then
    update public.api_quota_admin set failed_attempts = 0, locked_until = null where id;
    return null;
  end if;
  update public.api_quota_admin
     set failed_attempts = case when failed_attempts + 1 >= 5 then 0 else failed_attempts + 1 end,
         locked_until    = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else null end
   where id
  returning * into v;
  return jsonb_build_object('ok', false, 'error', 'bad_password',
    'message', case when v.locked_until is not null
                    then 'Contraseña incorrecta. Se bloquearon los intentos por 15 minutos.'
                    else 'Contraseña incorrecta.' end);
end;
$fn$;

-- ── Consumo (lo llama la app antes de cada llamada a Google) ───────────────────

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

-- ── Estado (conteo visual) ─────────────────────────────────────────────────────

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

-- ── Administración (solo ADMIN) ────────────────────────────────────────────────

create or replace function public.has_api_quota_password()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  perform public._api_quota_require_admin();
  return exists (select 1 from public.api_quota_admin);
end;
$fn$;

create or replace function public.set_api_quota_password(p_new text, p_current text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_fail jsonb;
begin
  perform public._api_quota_require_admin();
  if p_new is null or length(p_new) < 8 then
    return jsonb_build_object('ok', false, 'error', 'weak_password',
      'message', 'La contraseña debe tener al menos 8 caracteres.');
  end if;
  if exists (select 1 from public.api_quota_admin) then
    v_fail := public._api_quota_check_password(p_current);
    if v_fail is not null then return v_fail; end if;
  end if;
  insert into public.api_quota_admin (id, password_hash, updated_by)
  values (true, extensions.crypt(p_new, extensions.gen_salt('bf')), auth.uid())
  on conflict (id) do update
    set password_hash = excluded.password_hash, failed_attempts = 0, locked_until = null,
        updated_at = now(), updated_by = excluded.updated_by;
  return jsonb_build_object('ok', true);
end;
$fn$;

-- Cambia el límite gratuito de una API. Bajarlo es libre; SUBIRLO exige la contraseña
-- (si no, el límite base sería un portón sin llave).
create or replace function public.set_api_quota_limit(p_api text, p_limit integer, p_password text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_cur  integer;
  v_fail jsonb;
begin
  perform public._api_quota_require_admin();
  if p_limit is null or p_limit < 0 then
    return jsonb_build_object('ok', false, 'error', 'bad_limit', 'message', 'Límite inválido.');
  end if;
  select free_limit into v_cur from public.api_quota_config where api = p_api for update;
  if not found then
    raise exception 'API desconocida: %', p_api;
  end if;
  if p_limit > v_cur then
    v_fail := public._api_quota_check_password(p_password);
    if v_fail is not null then return v_fail; end if;
  end if;
  update public.api_quota_config set free_limit = p_limit, updated_at = now() where api = p_api;
  return jsonb_build_object('ok', true);
end;
$fn$;

-- Autoriza +1000 llamadas para una API en el mes en curso (un clic = 1000, caso a caso).
create or replace function public.extend_api_quota(p_api text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_period date := public._api_quota_period();
  v_fail   jsonb;
  v_extra  integer;
begin
  perform public._api_quota_require_admin();
  if not exists (select 1 from public.api_quota_config where api = p_api) then
    raise exception 'API desconocida: %', p_api;
  end if;
  v_fail := public._api_quota_check_password(p_password);
  if v_fail is not null then return v_fail; end if;

  insert into public.api_quota_usage (api, period) values (p_api, v_period)
  on conflict (api, period) do nothing;
  update public.api_quota_usage
     set extra_authorized = extra_authorized + 1000, updated_at = now()
   where api = p_api and period = v_period
  returning extra_authorized into v_extra;
  insert into public.api_quota_extensions (api, period, amount, created_by)
  values (p_api, v_period, 1000, auth.uid());
  return jsonb_build_object('ok', true, 'extra_authorized', v_extra);
end;
$fn$;

-- Bitácora de ampliaciones (últimas 50), solo admin.
create or replace function public.list_api_quota_extensions()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  perform public._api_quota_require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('api', api, 'period', period, 'amount', amount,
                                        'created_at', created_at) order by id desc)
    from (select * from public.api_quota_extensions order by id desc limit 50) e
  ), '[]'::jsonb);
end;
$fn$;

-- ── Permisos de ejecución ──────────────────────────────────────────────────────
revoke all on function public._api_quota_period()               from public, anon, authenticated;
revoke all on function public._api_quota_require_admin()        from public, anon, authenticated;
revoke all on function public._api_quota_check_password(text)   from public, anon, authenticated;
revoke all on function public.consume_api_quota(text, integer)  from public, anon, authenticated;
revoke all on function public.get_api_quota_status()            from public, anon, authenticated;
revoke all on function public.has_api_quota_password()          from public, anon, authenticated;
revoke all on function public.set_api_quota_password(text, text) from public, anon, authenticated;
revoke all on function public.set_api_quota_limit(text, integer, text) from public, anon, authenticated;
revoke all on function public.extend_api_quota(text, text)      from public, anon, authenticated;
revoke all on function public.list_api_quota_extensions()       from public, anon, authenticated;

-- El mapa lo usa también quien no inició sesión; consumir cuota solo puede BLOQUEAR Google.
grant execute on function public.consume_api_quota(text, integer) to anon, authenticated;
grant execute on function public.get_api_quota_status()           to anon, authenticated;
grant execute on function public.has_api_quota_password()         to authenticated;
grant execute on function public.set_api_quota_password(text, text) to authenticated;
grant execute on function public.set_api_quota_limit(text, integer, text) to authenticated;
grant execute on function public.extend_api_quota(text, text)     to authenticated;
grant execute on function public.list_api_quota_extensions()      to authenticated;
