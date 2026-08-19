-- Sincronización automática del Excel de ventas desde Google Drive.
--
-- La importación manual (PoiImportDialog) sigue funcionando igual; esto agrega
-- un camino automático que corre sin navegador (GitHub Actions, a diario) y
-- reutiliza exactamente la misma lógica de matching y commit.
--
-- Tres piezas:
--   1) drive_sync_state    — qué archivo de Drive vigilar por carpeta y cuál
--                            fue la última versión ya procesada.
--   2) poi_metrics_snapshots — respaldo de los valores que una corrida
--                            automática sobrescribió, para poder revertirla.
--   3) poi_import_pending_rows — filas que el proceso automático no pudo
--                            asignar a un local. NUNCA se descartan: quedan
--                            acá con sus métricas intactas para revisión.

-- ── 1) Estado de sincronización por carpeta ─────────────────────────────────
create table if not exists public.drive_sync_state (
  folder_id uuid primary key references public.poi_folders(id) on delete cascade,
  drive_file_id text not null,
  enabled boolean not null default true,
  -- modifiedTime que Drive reportaba en la última corrida que SÍ procesó el
  -- archivo. Si Drive devuelve el mismo valor, no hay nada nuevo que hacer.
  last_modified_time timestamptz,
  last_synced_at timestamptz,
  last_job_id uuid references public.poi_import_jobs(id) on delete set null,
  last_status text,  -- 'ok' | 'skipped' | 'error'
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.drive_sync_state is
  'Un archivo de Drive vigilado por carpeta de POIs. last_modified_time es el detector de cambios: si Drive reporta el mismo timestamp, la corrida no hace nada.';

-- ── 2) Respaldo para poder revertir una corrida automática ──────────────────
create table if not exists public.poi_metrics_snapshots (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.poi_import_jobs(id) on delete cascade,
  poi_id uuid not null references public.pois(id) on delete cascade,
  metric_key text not null,
  period date not null,
  -- Valor que había ANTES de esta corrida. Null + existed_before=false
  -- significa que la fila no existía: revertir = borrarla.
  old_value numeric,
  existed_before boolean not null,
  created_at timestamptz not null default now(),
  unique (job_id, poi_id, metric_key, period)
);

create index if not exists poi_metrics_snapshots_job_idx on public.poi_metrics_snapshots (job_id);

comment on table public.poi_metrics_snapshots is
  'Respaldo previo a cada corrida automática. existed_before=false marca métricas que la corrida creó (revertir = borrar); true marca las que sobrescribió (revertir = restaurar old_value).';

-- ── 3) Filas que el proceso automático no pudo asignar ─────────────────────
create table if not exists public.poi_import_pending_rows (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.poi_import_jobs(id) on delete cascade,
  folder_id uuid not null references public.poi_folders(id) on delete cascade,
  row_index integer not null,
  raw_name text,
  raw_address text,
  comuna text,
  -- Se guarda la fila COMPLETA (identidad + métricas ya parseadas) para que,
  -- una vez que un humano asigne el local, se pueda comprometer sin volver a
  -- subir el archivo.
  identity jsonb not null default '{}'::jsonb,
  metrics jsonb not null default '[]'::jsonb,
  static_attrs jsonb not null default '{}'::jsonb,
  reason text,
  resolved_at timestamptz,
  resolved_poi_id uuid references public.pois(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists poi_import_pending_rows_folder_idx
  on public.poi_import_pending_rows (folder_id) where resolved_at is null;

comment on table public.poi_import_pending_rows is
  'Filas que la corrida automática no pudo asignar a un local. Conservan sus métricas parseadas para poder comprometerlas después de la asignación manual, sin volver a subir el archivo.';

-- ── Revertir una corrida completa ───────────────────────────────────────────
create or replace function public.restore_import_snapshot(p_job_id uuid)
returns table (restored integer, deleted integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restored integer := 0;
  v_deleted integer := 0;
begin
  if not has_role(auth.uid(), 'admin'::app_role) then
    raise exception 'solo un admin puede revertir una importación';
  end if;

  -- Métricas que existían antes: volver al valor anterior.
  with upd as (
    update poi_metrics m
       set value = s.old_value, updated_at = now()
      from poi_metrics_snapshots s
     where s.job_id = p_job_id
       and s.existed_before
       and m.poi_id = s.poi_id
       and m.metric_key = s.metric_key
       and m.period = s.period
    returning 1
  ) select count(*) into v_restored from upd;

  -- Métricas que esta corrida creó: borrarlas.
  with del as (
    delete from poi_metrics m
     using poi_metrics_snapshots s
     where s.job_id = p_job_id
       and not s.existed_before
       and m.poi_id = s.poi_id
       and m.metric_key = s.metric_key
       and m.period = s.period
    returning 1
  ) select count(*) into v_deleted from del;

  update poi_import_jobs
     set status = 'reverted', error = coalesce(error, '') || ' [revertido]'
   where id = p_job_id;

  return query select v_restored, v_deleted;
end;
$$;

comment on function public.restore_import_snapshot(uuid) is
  'Revierte una importación: restaura los valores sobrescritos y borra las métricas que esa corrida creó. Solo admin.';

-- ── RLS: todo admin-only, igual que el resto del módulo de importación ──────
alter table public.drive_sync_state enable row level security;
alter table public.poi_metrics_snapshots enable row level security;
alter table public.poi_import_pending_rows enable row level security;

drop policy if exists "drive_sync_state_admin_all" on public.drive_sync_state;
create policy "drive_sync_state_admin_all" on public.drive_sync_state
  for all to authenticated
  using (has_role(auth.uid(), 'admin'::app_role))
  with check (has_role(auth.uid(), 'admin'::app_role));

drop policy if exists "poi_metrics_snapshots_admin_all" on public.poi_metrics_snapshots;
create policy "poi_metrics_snapshots_admin_all" on public.poi_metrics_snapshots
  for all to authenticated
  using (has_role(auth.uid(), 'admin'::app_role))
  with check (has_role(auth.uid(), 'admin'::app_role));

drop policy if exists "poi_import_pending_rows_admin_all" on public.poi_import_pending_rows;
create policy "poi_import_pending_rows_admin_all" on public.poi_import_pending_rows
  for all to authenticated
  using (has_role(auth.uid(), 'admin'::app_role))
  with check (has_role(auth.uid(), 'admin'::app_role));

grant select, insert, update, delete on public.drive_sync_state to authenticated;
grant select, insert, update, delete on public.poi_metrics_snapshots to authenticated;
grant select, insert, update, delete on public.poi_import_pending_rows to authenticated;
grant all on public.drive_sync_state to service_role;
grant all on public.poi_metrics_snapshots to service_role;
grant all on public.poi_import_pending_rows to service_role;

drop trigger if exists update_drive_sync_state_updated_at on public.drive_sync_state;
create trigger update_drive_sync_state_updated_at before update on public.drive_sync_state
  for each row execute function public.update_updated_at_column();
