-- Cierra un hueco en la reversibilidad: la importación no solo escribe
-- métricas, también sobrescribe los atributos estáticos del local (Gerente
-- Zonal, Zona, etc.) y el NOMBRE del POI. La primera versión solo respaldaba
-- métricas, así que una corrida automática con un archivo malo podía dejar
-- atributos equivocados sin forma de volver atrás.
--
-- Se detectó probando el flujo completo: una planilla de prueba sobrescribió
-- "Gerente Zonal"/"Zona" de 3 locales reales y no había nada que restaurar.

create table if not exists public.poi_attributes_snapshots (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.poi_import_jobs(id) on delete cascade,
  poi_id uuid not null references public.pois(id) on delete cascade,
  attr_key text not null,
  old_value text,
  existed_before boolean not null,
  created_at timestamptz not null default now(),
  unique (job_id, poi_id, attr_key)
);

create index if not exists poi_attributes_snapshots_job_idx
  on public.poi_attributes_snapshots (job_id);

comment on table public.poi_attributes_snapshots is
  'Respaldo de atributos estáticos previo a una corrida automática. existed_before=false marca atributos que la corrida creó (revertir = borrar).';

-- Respaldo del nombre del POI, que la importación también sobrescribe con el
-- de la columna "Nombre Local" del Excel.
create table if not exists public.poi_name_snapshots (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.poi_import_jobs(id) on delete cascade,
  poi_id uuid not null references public.pois(id) on delete cascade,
  old_name text not null,
  created_at timestamptz not null default now(),
  unique (job_id, poi_id)
);

comment on table public.poi_name_snapshots is
  'Respaldo del nombre del POI previo a una corrida automática (la importación lo sobrescribe con el de la planilla).';

alter table public.poi_attributes_snapshots enable row level security;
alter table public.poi_name_snapshots enable row level security;

drop policy if exists "poi_attributes_snapshots_admin_all" on public.poi_attributes_snapshots;
create policy "poi_attributes_snapshots_admin_all" on public.poi_attributes_snapshots
  for all to authenticated
  using (has_role(auth.uid(), 'admin'::app_role))
  with check (has_role(auth.uid(), 'admin'::app_role));

drop policy if exists "poi_name_snapshots_admin_all" on public.poi_name_snapshots;
create policy "poi_name_snapshots_admin_all" on public.poi_name_snapshots
  for all to authenticated
  using (has_role(auth.uid(), 'admin'::app_role))
  with check (has_role(auth.uid(), 'admin'::app_role));

grant select, insert, update, delete on public.poi_attributes_snapshots to authenticated;
grant select, insert, update, delete on public.poi_name_snapshots to authenticated;
grant all on public.poi_attributes_snapshots to service_role;
grant all on public.poi_name_snapshots to service_role;

-- ── Revertir ahora cubre métricas, atributos y nombres ──────────────────────
drop function if exists public.restore_import_snapshot(uuid);
create function public.restore_import_snapshot(p_job_id uuid)
returns table (
  metricas_restauradas integer,
  metricas_borradas integer,
  atributos_restaurados integer,
  atributos_borrados integer,
  nombres_restaurados integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m_rest integer := 0;
  v_m_del  integer := 0;
  v_a_rest integer := 0;
  v_a_del  integer := 0;
  v_n_rest integer := 0;
  v_privileged boolean;
begin
  v_privileged := current_user in ('postgres', 'service_role', 'supabase_admin');
  if not (v_privileged or has_role(auth.uid(), 'admin'::app_role)) then
    raise exception 'solo un admin puede revertir una importación';
  end if;

  -- Métricas sobrescritas → valor anterior.
  with upd as (
    update poi_metrics m set value = s.old_value, updated_at = now()
      from poi_metrics_snapshots s
     where s.job_id = p_job_id and s.existed_before
       and m.poi_id = s.poi_id and m.metric_key = s.metric_key and m.period = s.period
    returning 1
  ) select count(*) into v_m_rest from upd;

  -- Métricas creadas por la corrida → borrar.
  with del as (
    delete from poi_metrics m using poi_metrics_snapshots s
     where s.job_id = p_job_id and not s.existed_before
       and m.poi_id = s.poi_id and m.metric_key = s.metric_key and m.period = s.period
    returning 1
  ) select count(*) into v_m_del from del;

  -- Atributos sobrescritos → valor anterior.
  with upd as (
    update poi_attributes a set attr_value = s.old_value, updated_at = now()
      from poi_attributes_snapshots s
     where s.job_id = p_job_id and s.existed_before
       and a.poi_id = s.poi_id and a.attr_key = s.attr_key
    returning 1
  ) select count(*) into v_a_rest from upd;

  -- Atributos creados por la corrida → borrar.
  with del as (
    delete from poi_attributes a using poi_attributes_snapshots s
     where s.job_id = p_job_id and not s.existed_before
       and a.poi_id = s.poi_id and a.attr_key = s.attr_key
    returning 1
  ) select count(*) into v_a_del from del;

  -- Nombres → valor anterior.
  with upd as (
    update pois p set name = s.old_name, updated_at = now()
      from poi_name_snapshots s
     where s.job_id = p_job_id and p.id = s.poi_id
    returning 1
  ) select count(*) into v_n_rest from upd;

  update poi_import_jobs
     set status = 'reverted', error = coalesce(error, '') || ' [revertido]'
   where id = p_job_id;

  return query select v_m_rest, v_m_del, v_a_rest, v_a_del, v_n_rest;
end;
$$;

comment on function public.restore_import_snapshot(uuid) is
  'Revierte una importación completa: métricas, atributos estáticos y nombres de POI. Admin desde la app, o conexión privilegiada (editor SQL / service_role).';
