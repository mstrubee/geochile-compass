-- =============================================================================
-- PROPUESTA — NO EJECUTADA. ROLLBACK de 20261015000000_retire_legacy_layer_tables.sql
-- =============================================================================
-- Recrea territorial_layer_groups y custom_layers desde los backups
-- (_backup_*_retire_20261015), reapunta las 3 FK a la tabla de grupos y restaura las
-- funciones y triggers que existían (definiciones copiadas de producción el 2026-10-15).
--
-- Solo sirve si los backups siguen ahí. Lo que se haya creado en layer_nodes DESPUÉS de la
-- migración (carpetas raíz nuevas) no tiene fila de grupo en los backups: el paso 5 las crea.
-- =============================================================================
select pg_advisory_xact_lock(hashtext('layer_nodes_v1'));
set local statement_timeout = '5min';

do $$
begin
  if to_regclass('public._backup_territorial_layer_groups_retire_20261015') is null then
    raise exception 'Guardrail: no existe _backup_territorial_layer_groups_retire_20261015; no hay de dónde restaurar los grupos';
  end if;
end $$;

insert into public._migration_log (sprint, notes) values ('retire_legacy_layer_tables_v1_down', 'start');

-- -----------------------------------------------------------------------------
-- 1. territorial_layer_groups
-- -----------------------------------------------------------------------------
create table if not exists public.territorial_layer_groups (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  slug            text not null unique,
  color           text,
  icon            text,
  order_index     int  not null default 0,
  visible_default boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.territorial_layer_groups enable row level security;

drop policy if exists "Authed read groups" on public.territorial_layer_groups;
drop policy if exists "Admins ins groups" on public.territorial_layer_groups;
drop policy if exists "Admins upd groups" on public.territorial_layer_groups;
drop policy if exists "Admins del groups" on public.territorial_layer_groups;
create policy "Authed read groups" on public.territorial_layer_groups for select to authenticated using (true);
create policy "Admins ins groups" on public.territorial_layer_groups for insert to authenticated
  with check (private.has_role(auth.uid(), 'admin'::app_role));
create policy "Admins upd groups" on public.territorial_layer_groups for update to authenticated
  using (private.has_role(auth.uid(), 'admin'::app_role));
create policy "Admins del groups" on public.territorial_layer_groups for delete to authenticated
  using (private.has_role(auth.uid(), 'admin'::app_role));

-- Los datos entran con el espejo apagado: los nodos ya existen.
select set_config('layer_nodes.syncing', 'on', true);
insert into public.territorial_layer_groups (id, name, slug, color, icon, order_index, visible_default, created_at, updated_at)
select id, name, slug, color, icon, order_index, visible_default, created_at, updated_at
  from public._backup_territorial_layer_groups_retire_20261015
on conflict (id) do nothing;
select set_config('layer_nodes.syncing', 'off', true);

drop trigger if exists trg_tlg_updated on public.territorial_layer_groups;
create trigger trg_tlg_updated before update on public.territorial_layer_groups
  for each row execute function public.update_updated_at_column();

-- -----------------------------------------------------------------------------
-- 2. Funciones que existían solo para la tabla de grupos
-- -----------------------------------------------------------------------------
create or replace function public._legacy_slug(p_name text)
returns text language plpgsql stable set search_path = public as $$
declare v_base text; v_slug text; v_i int := 1;
begin
  v_base := btrim(regexp_replace(
    lower(translate(coalesce(p_name, ''), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun')), '[^a-z0-9]+', '-', 'g'), '-');
  if v_base = '' then v_base := 'carpeta'; end if;
  v_slug := v_base;
  while exists (select 1 from public.territorial_layer_groups where slug = v_slug) loop
    v_i := v_i + 1;
    v_slug := v_base || '-' || v_i;
  end loop;
  return v_slug;
end $$;

create or replace function public._legacy_group_style(g public.territorial_layer_groups)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'color', g.color, 'icon', g.icon, 'slug', g.slug, 'visible_default', g.visible_default));
$$;

create or replace function public._layer_nodes_ensure_legacy_group(n public.layer_nodes)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.territorial_layer_groups where id = n.id) then
    update public.territorial_layer_groups g
       set name = n.name, color = n.style ->> 'color', icon = n.style ->> 'icon'
     where g.id = n.id
       and (g.name is distinct from n.name
            or g.color is distinct from (n.style ->> 'color')
            or g.icon  is distinct from (n.style ->> 'icon'));
  else
    insert into public.territorial_layer_groups (id, name, slug, color, icon, order_index, visible_default)
    values (n.id, n.name, public._legacy_slug(coalesce(nullif(n.style ->> 'slug', ''), n.name)),
            n.style ->> 'color', n.style ->> 'icon',
            coalesce((select max(order_index) + 1 from public.territorial_layer_groups), 0),
            coalesce((n.style ->> 'visible_default')::boolean, false));
  end if;
end $$;

create or replace function public.trg_legacy_group_to_node()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('layer_nodes.syncing', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    insert into public.layer_nodes (id, parent_id, kind, name, position, style, scope, created_at, updated_at)
    values (new.id, null, 'folder', new.name, public._layer_nodes_next_position(null),
            public._legacy_group_style(new), 'shared', new.created_at, new.updated_at)
    on conflict (id) do nothing;
    return new;
  elsif tg_op = 'UPDATE' then
    update public.layer_nodes
       set name  = new.name,
           style = (style - 'color' - 'icon' - 'slug' - 'visible_default') || public._legacy_group_style(new)
     where id = new.id
       and (name is distinct from new.name
            or style is distinct from ((style - 'color' - 'icon' - 'slug' - 'visible_default') || public._legacy_group_style(new)));
    return new;
  else
    delete from public.layer_nodes where id = old.id and kind = 'folder';
    return old;
  end if;
end $$;

drop trigger if exists trg_legacy_group_to_node on public.territorial_layer_groups;
create trigger trg_legacy_group_to_node
  after insert or delete or update of name, color, icon, slug, visible_default on public.territorial_layer_groups
  for each row execute function public.trg_legacy_group_to_node();

-- Espejo nodos → tablas antiguas, con la parte de carpetas raíz (versión anterior a la propuesta).
create or replace function public.trg_layer_nodes_to_legacy()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_row public.layer_nodes;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  if current_setting('layer_nodes.syncing', true) = 'on' or v_row.scope <> 'shared' then
    return v_row;
  end if;

  perform set_config('layer_nodes.syncing', 'on', true);

  if tg_op = 'DELETE' then
    if old.kind = 'folder' then
      delete from public.territorial_layer_groups where id = old.id;
    end if;
  elsif new.kind = 'folder' then
    if new.parent_id is null then
      perform public._layer_nodes_ensure_legacy_group(new);
    end if;
    if tg_op = 'UPDATE' and new.parent_id is distinct from old.parent_id then
      perform public._layer_nodes_resync_layer_groups(new.id);
    end if;
  elsif tg_op = 'UPDATE' then
    update public.territorial_layers t
       set name = new.name, color = new.style ->> 'color', icon = new.style ->> 'icon'
     where t.id = new.id
       and (t.name is distinct from new.name
            or t.color is distinct from (new.style ->> 'color')
            or t.icon  is distinct from (new.style ->> 'icon'));
    if new.parent_id is distinct from old.parent_id then
      update public.territorial_layers t
         set group_id = public._layer_nodes_root_of(new.id)
       where t.id = new.id and t.group_id is distinct from public._layer_nodes_root_of(new.id);
    end if;
  end if;

  perform set_config('layer_nodes.syncing', 'off', true);
  return v_row;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Carpetas raíz creadas después de la migración (no están en el backup): se les crea su grupo
-- -----------------------------------------------------------------------------
select set_config('layer_nodes.syncing', 'on', true);
do $$
declare n public.layer_nodes;
begin
  for n in
    select * from public.layer_nodes x
     where x.kind = 'folder' and x.parent_id is null and x.scope = 'shared'
       and not exists (select 1 from public.territorial_layer_groups g where g.id = x.id)
     order by x.created_at, x.id
  loop
    perform public._layer_nodes_ensure_legacy_group(n);
  end loop;
end $$;
select set_config('layer_nodes.syncing', 'off', true);

-- -----------------------------------------------------------------------------
-- 4. Las 3 FK vuelven a apuntar a la tabla de grupos
-- -----------------------------------------------------------------------------
alter table public.folder_layer_roles drop constraint if exists folder_layer_roles_group_id_fkey;
alter table public.folder_layer_roles
  add constraint folder_layer_roles_group_id_fkey
  foreign key (group_id) references public.territorial_layer_groups(id) on delete cascade;

alter table public.territorial_source_files drop constraint if exists territorial_source_files_group_id_fkey;
alter table public.territorial_source_files
  add constraint territorial_source_files_group_id_fkey
  foreign key (group_id) references public.territorial_layer_groups(id) on delete set null;

alter table public.territorial_layers drop constraint if exists territorial_layers_group_id_fkey;
alter table public.territorial_layers
  add constraint territorial_layers_group_id_fkey
  foreign key (group_id) references public.territorial_layer_groups(id) on delete cascade;

-- -----------------------------------------------------------------------------
-- 5. Vista de grupos activos y sync_layer_nodes_from_legacy
-- -----------------------------------------------------------------------------
create or replace view public.territorial_layer_groups_active as
  select g.id, g.name, g.slug, g.color, g.icon, g.order_index, g.visible_default, g.created_at, g.updated_at
    from public.territorial_layer_groups g
    join public.layer_nodes n on n.id = g.id and n.archived_at is null and n.parent_id is null;

-- sync_layer_nodes_from_legacy(boolean): definición vigente en producción al 2026-10-15.
CREATE OR REPLACE FUNCTION public.sync_layer_nodes_from_legacy(p_reorder boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record; l record; v_prev text; v_n int;
  g_row public.territorial_layer_groups;
  t_row public.territorial_layers;
  v_new_folders int := 0; v_new_layers int := 0; v_updated int := 0;
  v_moved int := 0; v_reordered int := 0; v_skipped int := 0;
begin
  if auth.uid() is not null and not public.has_role(auth.uid(), 'admin') then
    raise exception 'sync_layer_nodes_from_legacy: solo admin' using errcode = 'insufficient_privilege';
  end if;
  perform pg_advisory_xact_lock(hashtext('layer_nodes_sync'));

  -- Carpetas que faltan
  for g_row in
    select g.* from public.territorial_layer_groups g
     where not exists (select 1 from public.layer_nodes n where n.id = g.id)
     order by g.order_index, g.created_at, g.id
  loop
    insert into public.layer_nodes (id, parent_id, kind, name, position, style, scope, created_at, updated_at)
    values (g_row.id, null, 'folder', g_row.name, public._layer_nodes_next_position(null),
            public._legacy_group_style(g_row), 'shared', g_row.created_at, g_row.updated_at);
    v_new_folders := v_new_folders + 1;
  end loop;

  -- Capas que faltan
  for t_row in
    select t.* from public.territorial_layers t
     where not exists (select 1 from public.layer_nodes n where n.id = t.id)
     order by t.group_id, t.order_index, t.created_at, t.id
  loop
    insert into public.layer_nodes (id, parent_id, kind, name, position, style, scope, created_at, updated_at)
    values (t_row.id, t_row.group_id, 'layer', t_row.name, public._layer_nodes_next_position(t_row.group_id),
            public._legacy_layer_style(t_row), 'shared', t_row.created_at, t_row.updated_at);
    v_new_layers := v_new_layers + 1;
  end loop;

  -- Nombre y estilo
  update public.layer_nodes n
     set name  = g.name,
         style = (n.style - 'color' - 'icon' - 'slug' - 'visible_default') || public._legacy_group_style(g)
    from public.territorial_layer_groups g
   where n.id = g.id
     and (n.name is distinct from g.name
          or n.style is distinct from ((n.style - 'color' - 'icon' - 'slug' - 'visible_default') || public._legacy_group_style(g)));
  get diagnostics v_n = row_count;  v_updated := v_updated + v_n;

  update public.layer_nodes n
     set name  = t.name,
         style = (n.style - 'color' - 'icon') || public._legacy_layer_style(t)
    from public.territorial_layers t
   where n.id = t.id
     and (n.name is distinct from t.name
          or n.style is distinct from ((n.style - 'color' - 'icon') || public._legacy_layer_style(t)));
  get diagnostics v_n = row_count;  v_updated := v_updated + v_n;

  if p_reorder then
    -- Capas movidas de grupo en lo viejo
    for r in
      select t.id, t.group_id from public.territorial_layers t
        join public.layer_nodes n on n.id = t.id
       where n.archived_at is null and n.parent_id is distinct from t.group_id
    loop
      update public.layer_nodes
         set parent_id = r.group_id, position = public._layer_nodes_next_position(r.group_id)
       where id = r.id;
      v_moved := v_moved + 1;
    end loop;

    -- Orden de las carpetas raíz heredadas (si hay raíces del árbol nuevo mezcladas, no se toca)
    if exists (
      select 1 from public.layer_nodes n
       where n.parent_id is null and n.archived_at is null and n.scope = 'shared'
         and not exists (select 1 from public.territorial_layer_groups g where g.id = n.id)
    ) then
      v_skipped := v_skipped + 1;
    else
      v_prev := null;
      for r in
        select g.id from public.territorial_layer_groups g
          join public.layer_nodes n on n.id = g.id and n.archived_at is null
         order by g.order_index, g.created_at, g.id
      loop
        v_prev := public.generate_key_between(v_prev, null);
        update public.layer_nodes set position = v_prev where id = r.id and position is distinct from v_prev;
        get diagnostics v_n = row_count;  v_reordered := v_reordered + v_n;
      end loop;
    end if;

    -- Orden de las capas dentro de cada carpeta heredada
    for r in select g.id from public.territorial_layer_groups g order by g.order_index, g.created_at, g.id loop
      if exists (
        select 1 from public.layer_nodes c
         where c.parent_id = r.id and c.archived_at is null
           and not exists (select 1 from public.territorial_layers t where t.id = c.id)
      ) then
        v_skipped := v_skipped + 1;   -- hay nodos del árbol nuevo entre los hijos: no se reordena
        continue;
      end if;
      v_prev := null;
      for l in
        select t.id from public.territorial_layers t
          join public.layer_nodes n on n.id = t.id and n.archived_at is null and n.parent_id = r.id
         order by t.order_index, t.created_at, t.id
      loop
        v_prev := public.generate_key_between(v_prev, null);
        update public.layer_nodes set position = v_prev where id = l.id and position is distinct from v_prev;
        get diagnostics v_n = row_count;  v_reordered := v_reordered + v_n;
      end loop;
    end loop;
  end if;

  return jsonb_build_object(
    'new_folders', v_new_folders, 'new_layers', v_new_layers, 'updated', v_updated,
    'moved', v_moved, 'reordered', v_reordered, 'skipped_parents', v_skipped);
end $function$;

-- -----------------------------------------------------------------------------
-- 6. custom_layers
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public._backup_custom_layers_retire_20261015') is not null then
    create table if not exists public.custom_layers (
      id            uuid primary key default gen_random_uuid(),
      name          text not null,
      geojson       jsonb not null,
      color_hex     text not null default '#3b82f6',
      icon_emoji    text,
      activo        boolean default true,
      feature_count int default 0,
      created_at    timestamptz default now()
    );
    alter table public.custom_layers enable row level security;
    drop policy if exists "custom_layers_read" on public.custom_layers;
    drop policy if exists "Admins can insert custom layers" on public.custom_layers;
    drop policy if exists "Admins can update custom layers" on public.custom_layers;
    drop policy if exists "Admins can delete custom layers" on public.custom_layers;
    create policy "custom_layers_read" on public.custom_layers for select to anon, authenticated using (true);
    create policy "Admins can insert custom layers" on public.custom_layers for insert to authenticated
      with check (has_role(auth.uid(), 'admin'::app_role));
    create policy "Admins can update custom layers" on public.custom_layers for update to authenticated
      using (has_role(auth.uid(), 'admin'::app_role)) with check (has_role(auth.uid(), 'admin'::app_role));
    create policy "Admins can delete custom layers" on public.custom_layers for delete to authenticated
      using (has_role(auth.uid(), 'admin'::app_role));
    insert into public.custom_layers select * from public._backup_custom_layers_retire_20261015 on conflict (id) do nothing;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 7. Auditoría
-- -----------------------------------------------------------------------------
do $$
declare v_n bigint; v_b bigint;
begin
  select count(*) into v_n from public.territorial_layer_groups;
  select count(*) into v_b from public._backup_territorial_layer_groups_retire_20261015;
  if v_n < v_b then raise exception 'Guardrail: se restauraron % grupos y el backup tiene %', v_n, v_b; end if;
  perform count(*) from public.territorial_layer_groups_active;
end $$;

insert into public._migration_log (sprint, notes) values ('retire_legacy_layer_tables_v1_down', 'done');
notify pgrst, 'reload schema';
