-- =============================================================================
-- Fase 5: retirar territorial_layer_groups y custom_layers
-- =============================================================================
-- Todo en una transacción e idempotente:
--   1. Auditoría previa: aborta si algo no calza (ver los `raise exception 'Guardrail: ...'`).
--   2. Backups versionados de lo que se va a borrar (RLS activa, sin acceso por la API).
--   3. Copia el `slug` de cada grupo al estilo de su carpeta raíz (si faltaba), para no perder ese dato.
--   4. Reapunta las 3 FK que miraban a territorial_layer_groups hacia layer_nodes (mismo uuid) y agrega un
--      trigger que sigue exigiendo que ese group_id sea una carpeta RAÍZ (la FK antigua lo garantizaba sola;
--      una FK a layer_nodes aceptaría cualquier nodo).
--   5. Reescribe trg_layer_nodes_to_legacy sin la parte que espejaba carpetas raíz a grupos.
--   6. Borra la tabla de grupos y todo lo que existía solo para ella (SIN CASCADE: si algo
--      inesperado depende de ella, el DROP falla y se deshace todo).
--   7. Borra custom_layers (vacía; sus datos, si los hubo, ya pasaron al árbol en la Fase 1).
--   8. Auditoría final y registro en _migration_log.
--
-- NO toca: territorial_layers, territorial_features, layer_nodes (salvo el paso 3, que solo agrega
-- la clave `slug` donde faltaba), folder_layer_roles ni territorial_source_files (solo cambia a
-- dónde apunta su FK). Los triggers legacy de territorial_layers (trg_legacy_layer_*) siguen.
--
-- ORDEN DE APLICACIÓN: aplicarla DESPUÉS de desplegar el código de la Fase 5. Antes de ese despliegue
-- el sitio publicado todavía lee territorial_layer_groups_active (mapa, análisis y reglas de rol).
-- Desde la Fase 5 los "grupos" salen de las carpetas raíz de layer_nodes (src/utils/territorialGroups.ts)
-- y nada usa custom_layers.
--
-- Probada con rollback sobre producción junto con supabase/tests/legacy_retired.sql (35 aserciones),
-- ejecutándola dos veces seguidas. Rollback: supabase/rollbacks/20261015000000_retire_legacy_layer_tables_down.sql
-- =============================================================================

select pg_advisory_xact_lock(hashtext('layer_nodes_v1'));
set local statement_timeout = '5min';

insert into public._migration_log (sprint, notes) values ('retire_legacy_layer_tables_v1', 'start');

-- -----------------------------------------------------------------------------
-- 1. Auditoría previa
-- -----------------------------------------------------------------------------
do $$
declare v_n int;
begin
  if to_regclass('public.territorial_layer_groups') is not null then
    -- (a) Cada grupo tiene su carpeta raíz con el mismo id: es lo que permite reapuntar las FK.
    select count(*) into v_n from public.territorial_layer_groups g
     where not exists (select 1 from public.layer_nodes n where n.id = g.id and n.kind = 'folder' and n.parent_id is null);
    if v_n > 0 then
      raise exception 'Guardrail: % grupos no tienen una carpeta raíz equivalente en layer_nodes', v_n;
    end if;

    -- (b) El group_id de cada capa es la raíz real de su nodo (lo mantiene el espejo; si no, se ven grupos fantasma).
    select count(*) into v_n from public.territorial_layers t
     where t.group_id is distinct from public._layer_nodes_root_of(t.id);
    if v_n > 0 then
      raise exception 'Guardrail: % capas tienen un group_id distinto de la carpeta raíz de su nodo', v_n;
    end if;

    -- (c) Lo que referencia a un grupo debe existir como carpeta raíz: de lo contrario la nueva FK no se puede crear.
    select count(*) into v_n from public.folder_layer_roles r
     where r.group_id is not null
       and not exists (select 1 from public.layer_nodes n where n.id = r.group_id and n.kind = 'folder' and n.parent_id is null);
    if v_n > 0 then
      raise exception 'Guardrail: % reglas de folder_layer_roles apuntan a un grupo sin carpeta raíz', v_n;
    end if;

    select count(*) into v_n from public.territorial_source_files s
     where s.group_id is not null and not exists (select 1 from public.layer_nodes n where n.id = s.group_id);
    if v_n > 0 then
      raise exception 'Guardrail: % archivos de territorial_source_files apuntan a un grupo sin nodo', v_n;
    end if;
  end if;

  -- (d) custom_layers: solo se borra si todo lo que tuvo pasó a ser una capa del árbol (mismo uuid).
  if to_regclass('public.custom_layers') is not null then
    select count(*) into v_n from public.custom_layers c
     where not exists (select 1 from public.territorial_layers t where t.id = c.id);
    if v_n > 0 then
      raise exception 'Guardrail: % filas de custom_layers no existen como capas del árbol; no se borra la tabla', v_n;
    end if;
  end if;

  -- Cifras de partida, para comparar al final (solo la primera vez: en una re-ejecución ya no habría tablas que contar).
  if not exists (select 1 from public._migration_log where sprint = 'retire_legacy_layer_tables_v1_pre') then
    insert into public._migration_log (sprint, notes)
    select 'retire_legacy_layer_tables_v1_pre', jsonb_build_object(
      'groups',   case when to_regclass('public.territorial_layer_groups') is not null
                       then (select count(*) from public.territorial_layer_groups) end,
      'custom',   case when to_regclass('public.custom_layers') is not null
                       then (select count(*) from public.custom_layers) end,
      'layers',   (select count(*) from public.territorial_layers),
      'features', (select count(*) from public.territorial_features),
      'roles',    (select count(*) from public.folder_layer_roles),
      'sources',  (select count(*) from public.territorial_source_files),
      'nodes',    (select count(*) from public.layer_nodes)
    )::text;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Backups versionados (nunca se truncan; si ya existen no se pisan)
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.territorial_layer_groups') is not null then
    execute 'create table if not exists public._backup_territorial_layer_groups_retire_20261015 as select * from public.territorial_layer_groups';
  end if;
  if to_regclass('public.custom_layers') is not null then
    execute 'create table if not exists public._backup_custom_layers_retire_20261015 as select * from public.custom_layers';
  end if;
  -- Estas dos no se borran, pero su FK cambia de destino: queda a mano qué apuntaba a qué.
  execute 'create table if not exists public._backup_folder_layer_roles_retire_20261015 as select * from public.folder_layer_roles';
  execute 'create table if not exists public._backup_territorial_source_files_retire_20261015 as select id, group_id from public.territorial_source_files';
  execute 'create table if not exists public._backup_territorial_layers_group_retire_20261015 as select id, group_id from public.territorial_layers';
end $$;

-- Sin RLS y con los privilegios por defecto de Supabase quedarían legibles por anon.
alter table if exists public._backup_territorial_layer_groups_retire_20261015 enable row level security;
alter table if exists public._backup_custom_layers_retire_20261015 enable row level security;
alter table public._backup_folder_layer_roles_retire_20261015 enable row level security;
alter table public._backup_territorial_source_files_retire_20261015 enable row level security;
alter table public._backup_territorial_layers_group_retire_20261015 enable row level security;
revoke all on public._backup_folder_layer_roles_retire_20261015 from anon, authenticated;
revoke all on public._backup_territorial_source_files_retire_20261015 from anon, authenticated;
revoke all on public._backup_territorial_layers_group_retire_20261015 from anon, authenticated;
do $$
begin
  if to_regclass('public._backup_territorial_layer_groups_retire_20261015') is not null then
    execute 'revoke all on public._backup_territorial_layer_groups_retire_20261015 from anon, authenticated';
  end if;
  if to_regclass('public._backup_custom_layers_retire_20261015') is not null then
    execute 'revoke all on public._backup_custom_layers_retire_20261015 from anon, authenticated';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 3. El slug del grupo pasa al estilo de su carpeta raíz (la app lo lee de ahí)
-- -----------------------------------------------------------------------------
-- Hoy las 13 raíces ya lo traen (Fase 1) y esto no cambia nada. Cubre las carpetas raíz que se
-- hayan creado desde el árbol: su slug solo existía en la fila del grupo.
do $$
declare v_n int;
begin
  if to_regclass('public.territorial_layer_groups') is null then return; end if;
  perform set_config('layer_nodes.syncing', 'on', true);          -- que el espejo no reescriba nada
  update public.layer_nodes n
     set style = n.style || jsonb_build_object('slug', g.slug)
    from public.territorial_layer_groups g
   where n.id = g.id and n.kind = 'folder' and n.parent_id is null
     and coalesce(n.style ->> 'slug', '') = '';
  get diagnostics v_n = row_count;
  perform set_config('layer_nodes.syncing', 'off', true);
  raise notice 'slug copiado al estilo de % carpetas raíz', v_n;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Las FK que miraban a territorial_layer_groups miran a layer_nodes (mismo uuid)
-- -----------------------------------------------------------------------------
do $$
begin
  -- Reglas de rol por carpeta de POIs (grupo = categoría de capas)
  if exists (select 1 from pg_constraint where conname = 'folder_layer_roles_group_id_fkey'
                and confrelid = to_regclass('public.territorial_layer_groups')) then
    alter table public.folder_layer_roles drop constraint folder_layer_roles_group_id_fkey;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'folder_layer_roles_group_id_fkey'
                  and conrelid = 'public.folder_layer_roles'::regclass) then
    alter table public.folder_layer_roles
      add constraint folder_layer_roles_group_id_fkey
      foreign key (group_id) references public.layer_nodes(id) on delete cascade;
  end if;

  -- Historial de archivos
  if exists (select 1 from pg_constraint where conname = 'territorial_source_files_group_id_fkey'
                and confrelid = to_regclass('public.territorial_layer_groups')) then
    alter table public.territorial_source_files drop constraint territorial_source_files_group_id_fkey;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'territorial_source_files_group_id_fkey'
                  and conrelid = 'public.territorial_source_files'::regclass) then
    alter table public.territorial_source_files
      add constraint territorial_source_files_group_id_fkey
      foreign key (group_id) references public.layer_nodes(id) on delete set null;
  end if;

  -- Capas (group_id = carpeta raíz del nodo, lo mantiene el espejo)
  if exists (select 1 from pg_constraint where conname = 'territorial_layers_group_id_fkey'
                and confrelid = to_regclass('public.territorial_layer_groups')) then
    alter table public.territorial_layers drop constraint territorial_layers_group_id_fkey;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'territorial_layers_group_id_fkey'
                  and conrelid = 'public.territorial_layers'::regclass) then
    alter table public.territorial_layers
      add constraint territorial_layers_group_id_fkey
      foreign key (group_id) references public.layer_nodes(id) on delete cascade;
  end if;
end $$;

-- group_id debe seguir siendo una carpeta raíz: antes lo garantizaba la FK a la tabla de grupos.
create or replace function public._assert_group_is_root()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.group_id is not null
     and not exists (select 1 from public.layer_nodes n where n.id = new.group_id and n.kind = 'folder' and n.parent_id is null) then
    raise exception '%.group_id debe ser una carpeta raíz del árbol de capas (recibido %)', tg_table_name, new.group_id
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_group_is_root on public.territorial_layers;
create trigger trg_group_is_root before insert or update of group_id on public.territorial_layers
  for each row execute function public._assert_group_is_root();
drop trigger if exists trg_group_is_root on public.folder_layer_roles;
create trigger trg_group_is_root before insert or update of group_id on public.folder_layer_roles
  for each row execute function public._assert_group_is_root();
drop trigger if exists trg_group_is_root on public.territorial_source_files;
create trigger trg_group_is_root before insert or update of group_id on public.territorial_source_files
  for each row execute function public._assert_group_is_root();

-- -----------------------------------------------------------------------------
-- 5. El espejo nodos → tablas antiguas ya no espeja carpetas raíz (no hay tabla de grupos)
-- -----------------------------------------------------------------------------
-- Igual que antes para las capas: nombre/color/ícono hacia territorial_layers y recálculo de
-- group_id al mover. Las capas de un nodo borrado caen por las FK (territorial_layers.id y .group_id).
create or replace function public.trg_layer_nodes_to_legacy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.layer_nodes;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  -- Lo viejo y lo nuevo solo se espejan para lo compartido.
  if current_setting('layer_nodes.syncing', true) = 'on' or v_row.scope <> 'shared' then
    return v_row;
  end if;
  if tg_op = 'DELETE' then
    return v_row;
  end if;

  perform set_config('layer_nodes.syncing', 'on', true);

  if new.kind = 'folder' then
    if tg_op = 'UPDATE' and new.parent_id is distinct from old.parent_id then
      perform public._layer_nodes_resync_layer_groups(new.id);
    end if;
  elsif tg_op = 'UPDATE' then  -- capa
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
-- 6. Se borra la tabla de grupos y lo que existía solo para ella (sin CASCADE)
-- -----------------------------------------------------------------------------
drop function if exists public.sync_layer_nodes_from_legacy(boolean);
drop function if exists public._layer_nodes_ensure_legacy_group(public.layer_nodes);

do $$
begin
  if to_regclass('public.territorial_layer_groups') is not null then
    execute 'drop trigger if exists trg_legacy_group_to_node on public.territorial_layer_groups';
    execute 'drop view if exists public.territorial_layer_groups_active';
    -- La función recibe la fila del grupo como argumento: hay que quitarla antes que la tabla.
    execute 'drop function if exists public._legacy_group_style(public.territorial_layer_groups)';
    execute 'drop table public.territorial_layer_groups';
  end if;
end $$;

drop function if exists public.trg_legacy_group_to_node();
drop function if exists public._legacy_slug(text);

-- -----------------------------------------------------------------------------
-- 7. custom_layers
-- -----------------------------------------------------------------------------
drop table if exists public.custom_layers;

-- -----------------------------------------------------------------------------
-- 8. Auditoría final
-- -----------------------------------------------------------------------------
do $$
declare v_pre jsonb; v_n bigint; v_bad int;
begin
  -- Re-ejecución de algo ya aplicado: los conteos de hoy pueden diferir de los de aquel día por uso normal.
  if exists (select 1 from public._migration_log where sprint = 'retire_legacy_layer_tables_v1' and notes = 'done') then
    raise notice 'ya estaba aplicada: se omite la comparación de conteos';
    return;
  end if;

  select notes::jsonb into v_pre from public._migration_log
   where sprint = 'retire_legacy_layer_tables_v1_pre' order by id desc limit 1;

  if to_regclass('public.territorial_layer_groups') is not null then
    raise exception 'Guardrail: territorial_layer_groups sigue existiendo';
  end if;
  if to_regclass('public.custom_layers') is not null then
    raise exception 'Guardrail: custom_layers sigue existiendo';
  end if;

  if (select count(*) from public.territorial_layers)       <> (v_pre ->> 'layers')::bigint   then raise exception 'Guardrail: cambió el número de capas'; end if;
  if (select count(*) from public.territorial_features)     <> (v_pre ->> 'features')::bigint then raise exception 'Guardrail: cambió el número de puntos'; end if;
  if (select count(*) from public.folder_layer_roles)       <> (v_pre ->> 'roles')::bigint    then raise exception 'Guardrail: cambió el número de reglas de rol'; end if;
  if (select count(*) from public.territorial_source_files) <> (v_pre ->> 'sources')::bigint  then raise exception 'Guardrail: cambió el número de archivos'; end if;
  if (select count(*) from public.layer_nodes)              <> (v_pre ->> 'nodes')::bigint    then raise exception 'Guardrail: cambió el número de nodos'; end if;

  -- Los backups tienen lo que había.
  if v_pre ->> 'groups' is not null then
    select count(*) into v_n from public._backup_territorial_layer_groups_retire_20261015;
    if v_n <> (v_pre ->> 'groups')::bigint then raise exception 'Guardrail: el backup de grupos tiene % filas y había %', v_n, v_pre ->> 'groups'; end if;
  end if;
  if v_pre ->> 'custom' is not null then
    select count(*) into v_n from public._backup_custom_layers_retire_20261015;
    if v_n <> (v_pre ->> 'custom')::bigint then raise exception 'Guardrail: el backup de custom_layers tiene % filas y había %', v_n, v_pre ->> 'custom'; end if;
  end if;

  -- Ninguna FK quedó apuntando a algo que ya no existe, y las tres nuevas miran a layer_nodes.
  select count(*) into v_bad from pg_constraint
   where conname in ('folder_layer_roles_group_id_fkey', 'territorial_source_files_group_id_fkey', 'territorial_layers_group_id_fkey')
     and confrelid = 'public.layer_nodes'::regclass;
  if v_bad <> 3 then raise exception 'Guardrail: esperaba 3 FK hacia layer_nodes y hay %', v_bad; end if;

  select count(*) into v_bad from pg_trigger where tgname = 'trg_group_is_root' and not tgisinternal;
  if v_bad <> 3 then raise exception 'Guardrail: esperaba 3 triggers trg_group_is_root y hay %', v_bad; end if;

  -- Las vistas que usa la app siguen leyéndose.
  perform count(*) from public.territorial_layers_active;
end $$;

insert into public._migration_log (sprint, notes) values ('retire_legacy_layer_tables_v1', 'done');

notify pgrst, 'reload schema';
