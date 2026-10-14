-- =============================================================================
-- ROLLBACK de la Fase 3 del árbol de capas (20261014180000_layer_nodes_edit.sql)
-- =============================================================================
-- Deja la base como estaba al terminar la Fase 1: quita el puente nodo -> heredado,
-- las RPC de edición y la vista nueva, y vuelve a las versiones originales de la
-- guarda, restore_node y los triggers heredado -> nodo (copiadas literalmente de
-- las migraciones 20261014120000 y 20261014120100).
--
-- NO deshace lo que se hizo mientras la Fase 3 estuvo activa: carpetas creadas,
-- capas movidas o duplicadas, estilos editados. Lo creado en el árbol (nodos que
-- no existen en territorial_*) queda como está; sus grupos/capas heredados, si
-- se crearon, también.
-- =============================================================================

select pg_advisory_xact_lock(hashtext('layer_nodes_v1'));
set local statement_timeout = '5min';

insert into public._migration_log (sprint, notes) values ('layer_nodes_v2_edit_down', 'start');

-- Puente nodo -> heredado y vista nueva
drop trigger if exists trg_layer_nodes_to_legacy on public.layer_nodes;
drop view if exists public.territorial_layer_groups_active;

drop function if exists public.trg_layer_nodes_to_legacy();
drop function if exists public.create_folder(uuid, text);
drop function if exists public.update_node_style(uuid, jsonb);
drop function if exists public.duplicate_node(uuid);
drop function if exists public.get_node_bounds(uuid);
drop function if exists public._layer_nodes_copy_subtree(public.layer_nodes, uuid, text, text);
drop function if exists public._layer_nodes_resync_layer_groups(uuid);
drop function if exists public._layer_nodes_ensure_legacy_group(public.layer_nodes);
drop function if exists public._layer_nodes_unique_layer_name(uuid, text);
drop function if exists public._legacy_slug(text);
drop function if exists public._layer_nodes_root_of(uuid);

-- Versiones originales (Fase 1)
create or replace function public.layer_nodes_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_parent public.layer_nodes;
begin
  new.name := btrim(new.name);

  if tg_op = 'UPDATE' then
    if new.kind is distinct from old.kind
       or new.scope is distinct from old.scope
       or new.owner_id is distinct from old.owner_id then
      raise exception 'layer_nodes: kind, scope y owner_id no se pueden cambiar' using errcode = 'check_violation';
    end if;
  end if;

  if new.parent_id is not null then
    select * into v_parent from public.layer_nodes where id = new.parent_id;
    if not found then
      raise exception 'layer_nodes: el padre % no existe', new.parent_id using errcode = 'foreign_key_violation';
    end if;
    if v_parent.kind <> 'folder' then
      raise exception 'layer_nodes: solo una carpeta puede tener hijos (el padre % es una capa)', new.parent_id
        using errcode = 'check_violation';
    end if;
    if v_parent.scope <> new.scope or v_parent.owner_id is distinct from new.owner_id then
      raise exception 'layer_nodes: un nodo % no puede colgar de uno %', new.scope, v_parent.scope
        using errcode = 'check_violation';
    end if;
    if tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id then
      if v_parent.archived_at is not null and new.archived_at is null then
        raise exception 'layer_nodes: el padre % está en la papelera', new.parent_id using errcode = 'check_violation';
      end if;
    end if;
    if tg_op = 'UPDATE' and new.parent_id is distinct from old.parent_id then
      -- ciclo: el nuevo padre no puede ser el propio nodo ni uno de sus descendientes
      if exists (
        with recursive up as (
          select id, parent_id from public.layer_nodes where id = new.parent_id
          union all
          select n.id, n.parent_id from public.layer_nodes n join up on n.id = up.parent_id
        )
        select 1 from up where id = new.id
      ) then
        raise exception 'layer_nodes: mover % bajo % crearía un ciclo', new.id, new.parent_id
          using errcode = 'check_violation';
      end if;
    end if;
  end if;
  return new;
end $$;

create or replace function public.restore_node(p_node_id uuid)
returns public.layer_nodes
language plpgsql security definer set search_path = public as $$
declare v_node public.layer_nodes; v_ts timestamptz; v_row public.layer_nodes;
begin
  select * into v_node from public.layer_nodes where id = p_node_id for update;
  if not found then
    raise exception 'restore_node: el nodo % no existe', p_node_id using errcode = 'no_data_found';
  end if;
  if not public._layer_nodes_can_edit(v_node.scope, v_node.owner_id) then
    raise exception 'restore_node: sin permiso para restaurar este nodo' using errcode = 'insufficient_privilege';
  end if;
  if v_node.archived_at is null then
    raise exception 'restore_node: el nodo no está en la papelera' using errcode = 'check_violation';
  end if;
  v_ts := v_node.archived_at;

  if v_node.parent_id is not null and exists (
    select 1 from public.layer_nodes where id = v_node.parent_id and archived_at is not null
  ) then
    update public.layer_nodes
       set parent_id = null, position = public._layer_nodes_next_position(null)
     where id = p_node_id;
  end if;

  update public.layer_nodes set archived_at = null
   where id in (
     with recursive d as (
       select id from public.layer_nodes where id = p_node_id
       union all
       select c.id from public.layer_nodes c join d on c.parent_id = d.id where c.archived_at = v_ts
     )
     select id from d
   );

  select * into v_row from public.layer_nodes where id = p_node_id;
  return v_row;
end $$;

create or replace function public.trg_legacy_group_to_node()
returns trigger language plpgsql security definer set search_path = public as $$
begin
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

create or replace function public.trg_legacy_layer_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.layer_nodes (id, parent_id, kind, name, position, style, scope, created_at, updated_at)
  values (new.id, new.group_id, 'layer', new.name, public._layer_nodes_next_position(new.group_id),
          public._legacy_layer_style(new), 'shared', new.created_at, new.updated_at)
  on conflict (id) do nothing;
  return new;
end $$;

create or replace function public.trg_legacy_layer_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    update public.layer_nodes
       set name  = new.name,
           style = (style - 'color' - 'icon') || public._legacy_layer_style(new)
     where id = new.id
       and (name is distinct from new.name
            or style is distinct from ((style - 'color' - 'icon') || public._legacy_layer_style(new)));
    if new.group_id is distinct from old.group_id then
      update public.layer_nodes
         set parent_id = new.group_id, position = public._layer_nodes_next_position(new.group_id)
       where id = new.id;
    end if;
    return new;
  else
    delete from public.layer_nodes where id = old.id and kind = 'layer';
    return old;
  end if;
end $$;

insert into public._migration_log (sprint, notes) values ('layer_nodes_v2_edit_down', 'done');
