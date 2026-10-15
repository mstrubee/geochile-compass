-- =============================================================================
-- Árbol de capas — Fase 3: edición (DnD, carpetas nuevas, propiedades, duplicar)
-- =============================================================================
-- Desde acá el ÁRBOL es la fuente de verdad de la estructura. Las tablas
-- heredadas (territorial_layer_groups / territorial_layers) se mantienen como
-- espejo para el código que todavía las lee (análisis de isócronas, informes,
-- roles por carpeta):
--
--   nodo -> heredado  (nuevo, trigger trg_layer_nodes_to_legacy)
--     - nombre, color e ícono de carpetas raíz y capas
--     - territorial_layers.group_id = carpeta RAÍZ que contiene a la capa
--       (una carpeta raíz nueva crea su fila en territorial_layer_groups)
--     - al purgar una carpeta raíz se borra su grupo heredado
--   heredado -> nodo  (ya existía; ahora respeta un candado por transacción
--                      `layer_nodes.syncing` para no rebotar en bucle)
--
-- Orden y anidación NO se copian a lo heredado (order_index queda como estaba);
-- los consumidores heredados siguen ordenando por order_index hasta la Fase 5.
--
-- Invariante nueva: una capa siempre vive dentro de una carpeta (lo heredado
-- exige un group_id). El resto de las reglas de la Fase 1 no cambia.
-- =============================================================================

select pg_advisory_xact_lock(hashtext('layer_nodes_v1'));
set local statement_timeout = '5min';

insert into public._migration_log (sprint, notes) values ('layer_nodes_v2_edit', 'start');

-- -----------------------------------------------------------------------------
-- 0. Auditoría previa
-- -----------------------------------------------------------------------------
do $$
declare v_root_layers int;
begin
  select count(*) into v_root_layers from public.layer_nodes where kind = 'layer' and parent_id is null;
  if v_root_layers > 0 then
    raise exception 'Guardrail: % capas están en la raíz del árbol; hay que meterlas en una carpeta antes de aplicar', v_root_layers;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 1. Guarda: una capa no puede estar en la raíz
--    (misma función de la Fase 1 + una comprobación)
-- -----------------------------------------------------------------------------
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

  if new.kind = 'layer' and new.parent_id is null then
    raise exception 'layer_nodes: una capa debe estar dentro de una carpeta' using errcode = 'check_violation';
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

-- -----------------------------------------------------------------------------
-- 2. Auxiliares
-- -----------------------------------------------------------------------------
-- Carpeta RAÍZ que contiene al nodo (él mismo si ya es raíz). NULL si no existe.
create or replace function public._layer_nodes_root_of(p_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  with recursive up as (
    select id, parent_id from public.layer_nodes where id = p_id
    union all
    select n.id, n.parent_id from public.layer_nodes n join up on n.id = up.parent_id
  )
  select id from up where parent_id is null limit 1;
$$;

-- "Estaciones de Servicio" -> "estaciones-de-servicio", único en territorial_layer_groups.
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

-- Nombre de capa libre dentro del grupo heredado (UNIQUE (group_id, name)).
-- "X" -> "X" si está libre; si no "X (copia)", "X (copia 2)", ...
create or replace function public._layer_nodes_unique_layer_name(p_group uuid, p_name text)
returns text language plpgsql stable set search_path = public as $$
declare v_try text := p_name; v_i int := 1;
begin
  while exists (select 1 from public.territorial_layers where group_id = p_group and name = v_try) loop
    v_i := v_i + 1;
    v_try := p_name || case when v_i = 2 then ' (copia)' else ' (copia ' || (v_i - 1) || ')' end;
  end loop;
  return v_try;
end $$;

-- Asegura que una carpeta raíz tenga su fila en territorial_layer_groups.
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

-- Reasigna group_id de las capas de un subárbol a su carpeta raíz actual.
create or replace function public._layer_nodes_resync_layer_groups(p_node uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.territorial_layers t
     set group_id = public._layer_nodes_root_of(t.id)
   where t.id in (
     with recursive d as (
       select id, kind from public.layer_nodes where id = p_node
       union all
       select c.id, c.kind from public.layer_nodes c join d on c.parent_id = d.id
     )
     select id from d where kind = 'layer'
   )
   and t.group_id is distinct from public._layer_nodes_root_of(t.id);
end $$;

-- -----------------------------------------------------------------------------
-- 3. Heredado -> nodo: respeta el candado y no reposiciona sin necesidad
-- -----------------------------------------------------------------------------
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

create or replace function public.trg_legacy_layer_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('layer_nodes.syncing', true) = 'on' then return new; end if;
  insert into public.layer_nodes (id, parent_id, kind, name, position, style, scope, created_at, updated_at)
  values (new.id, new.group_id, 'layer', new.name, public._layer_nodes_next_position(new.group_id),
          public._legacy_layer_style(new), 'shared', new.created_at, new.updated_at)
  on conflict (id) do nothing;
  return new;
end $$;

create or replace function public.trg_legacy_layer_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('layer_nodes.syncing', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE' then
    update public.layer_nodes
       set name  = new.name,
           style = (style - 'color' - 'icon') || public._legacy_layer_style(new)
     where id = new.id
       and (name is distinct from new.name
            or style is distinct from ((style - 'color' - 'icon') || public._legacy_layer_style(new)));
    -- Solo se mueve el nodo si su carpeta raíz ya no es el grupo nuevo: una capa
    -- anidada cuyo group_id coincide con su raíz está donde corresponde.
    if new.group_id is distinct from old.group_id
       and public._layer_nodes_root_of(new.id) is distinct from new.group_id then
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

-- -----------------------------------------------------------------------------
-- 4. Nodo -> heredado
-- -----------------------------------------------------------------------------
create or replace function public.trg_layer_nodes_to_legacy()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_row public.layer_nodes;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  -- Lo viejo y lo nuevo solo se espejan para lo compartido.
  if current_setting('layer_nodes.syncing', true) = 'on' or v_row.scope <> 'shared' then
    return v_row;
  end if;

  perform set_config('layer_nodes.syncing', 'on', true);

  if tg_op = 'DELETE' then
    -- Las capas caen por la FK territorial_layers.id -> layer_nodes.id (cascade).
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

drop trigger if exists trg_layer_nodes_to_legacy on public.layer_nodes;
create trigger trg_layer_nodes_to_legacy
  after insert or update of name, style, parent_id or delete
  on public.layer_nodes
  for each row execute function public.trg_layer_nodes_to_legacy();

-- -----------------------------------------------------------------------------
-- 5. restore_node: una capa no puede volver a la raíz
--    (misma función de la Fase 1 + una comprobación)
-- -----------------------------------------------------------------------------
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
    if v_node.kind = 'layer' then
      raise exception 'restore_node: la carpeta de esta capa sigue en la papelera; restaura primero la carpeta'
        using errcode = 'check_violation';
    end if;
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

-- -----------------------------------------------------------------------------
-- 6. RPC nuevas
-- -----------------------------------------------------------------------------
-- Carpeta nueva al final de su padre (o de la raíz). Solo compartida: la crea un
-- admin; una carpeta dentro de una personal hereda esa dueña.
create or replace function public.create_folder(p_parent_id uuid, p_name text)
returns public.layer_nodes
language plpgsql security definer set search_path = public as $$
declare v_parent public.layer_nodes; v_scope text := 'shared'; v_owner uuid := null;
        v_name text := btrim(coalesce(p_name, '')); v_row public.layer_nodes;
begin
  if v_name = '' then
    raise exception 'create_folder: el nombre no puede estar vacío' using errcode = 'check_violation';
  end if;
  if p_parent_id is not null then
    select * into v_parent from public.layer_nodes where id = p_parent_id;
    if not found then
      raise exception 'create_folder: la carpeta % no existe', p_parent_id using errcode = 'no_data_found';
    end if;
    if v_parent.kind <> 'folder' then
      raise exception 'create_folder: el destino no es una carpeta' using errcode = 'check_violation';
    end if;
    if v_parent.archived_at is not null then
      raise exception 'create_folder: la carpeta destino está en la papelera' using errcode = 'check_violation';
    end if;
    v_scope := v_parent.scope;
    v_owner := v_parent.owner_id;
  end if;
  if not public._layer_nodes_can_edit(v_scope, v_owner) then
    raise exception 'create_folder: sin permiso para crear carpetas aquí' using errcode = 'insufficient_privilege';
  end if;

  insert into public.layer_nodes (parent_id, kind, name, position, style, scope, owner_id)
  values (p_parent_id, 'folder', v_name, public._layer_nodes_next_position(p_parent_id), '{}'::jsonb, v_scope, v_owner)
  returning * into v_row;
  return v_row;
end $$;

-- Propiedades visuales de un nodo. `p_style` solo puede traer color (#RRGGBB),
-- icon (emoji o URL) y opacity (0 a 1); una clave en null la borra. El resto del
-- estilo del nodo (slug, visible_default…) no se toca.
create or replace function public.update_node_style(p_node_id uuid, p_style jsonb)
returns public.layer_nodes
language plpgsql security definer set search_path = public as $$
declare v_node public.layer_nodes; v_new jsonb; v_key text; v_val jsonb; v_row public.layer_nodes;
begin
  if p_style is null or jsonb_typeof(p_style) <> 'object' then
    raise exception 'update_node_style: p_style debe ser un objeto' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_node from public.layer_nodes where id = p_node_id for update;
  if not found then
    raise exception 'update_node_style: el nodo % no existe', p_node_id using errcode = 'no_data_found';
  end if;
  if not public._layer_nodes_can_edit(v_node.scope, v_node.owner_id) then
    raise exception 'update_node_style: sin permiso para editar este nodo' using errcode = 'insufficient_privilege';
  end if;

  v_new := v_node.style;
  for v_key, v_val in select * from jsonb_each(p_style) loop
    if v_key not in ('color', 'icon', 'opacity') then
      raise exception 'update_node_style: propiedad no permitida "%"', v_key using errcode = 'invalid_parameter_value';
    end if;
    if jsonb_typeof(v_val) = 'null' then
      v_new := v_new - v_key;
      continue;
    end if;
    if v_key = 'color' and not (jsonb_typeof(v_val) = 'string' and (v_val #>> '{}') ~ '^#[0-9a-fA-F]{6}$') then
      raise exception 'update_node_style: color inválido (se espera #RRGGBB)' using errcode = 'invalid_parameter_value';
    end if;
    if v_key = 'icon' and not (jsonb_typeof(v_val) = 'string' and length(v_val #>> '{}') between 1 and 2048) then
      raise exception 'update_node_style: ícono inválido' using errcode = 'invalid_parameter_value';
    end if;
    if v_key = 'opacity' and not (jsonb_typeof(v_val) = 'number' and (v_val #>> '{}')::numeric between 0 and 1) then
      raise exception 'update_node_style: la opacidad debe estar entre 0 y 1' using errcode = 'invalid_parameter_value';
    end if;
    v_new := jsonb_set(v_new, array[v_key], v_val);
  end loop;

  update public.layer_nodes set style = v_new where id = p_node_id returning * into v_row;
  return v_row;
end $$;

-- Rectángulo (en grados) que contiene todos los puntos de las capas activas de
-- un nodo. Se calcula con PostGIS: el `bbox` guardado en territorial_layers no es
-- fiable (algunas capas lo traen [oeste,sur,este,norte] y otras [sur,oeste,norte,este]).
create or replace function public.get_node_bounds(p_node_id uuid)
returns jsonb
language sql stable set search_path = public as $$
  with recursive d as (
    select id, kind from public.layer_nodes where id = p_node_id and archived_at is null
    union all
    select c.id, c.kind from public.layer_nodes c join d on c.parent_id = d.id where c.archived_at is null
  ),
  e as (
    select ST_Extent(f.geom) as ext
      from public.territorial_features f
      join d on d.kind = 'layer' and d.id = f.layer_id
  )
  select case when ext is null then null else jsonb_build_object(
    'west', ST_XMin(ext), 'south', ST_YMin(ext), 'east', ST_XMax(ext), 'north', ST_YMax(ext)) end
  from e;
$$;

-- Copia de un subárbol (carpetas, capas y sus puntos).
create or replace function public._layer_nodes_copy_subtree(
  p_src public.layer_nodes, p_parent uuid, p_name text, p_position text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_new uuid := gen_random_uuid(); v_child public.layer_nodes; v_t public.territorial_layers;
        v_group uuid; v_name text; v_n int;
begin
  if p_src.kind = 'folder' then
    insert into public.layer_nodes (id, parent_id, kind, name, position, style, scope, owner_id)
    values (v_new, p_parent, 'folder', p_name, p_position, p_src.style - 'slug', p_src.scope, p_src.owner_id);
    for v_child in
      select * from public.layer_nodes where parent_id = p_src.id and archived_at is null order by position, id
    loop
      perform public._layer_nodes_copy_subtree(v_child, v_new, v_child.name, v_child.position);
    end loop;
  else
    v_group := public._layer_nodes_root_of(p_parent);
    v_name  := public._layer_nodes_unique_layer_name(v_group, p_name);
    insert into public.layer_nodes (id, parent_id, kind, name, position, style, scope, owner_id)
    values (v_new, p_parent, 'layer', v_name, p_position, p_src.style, p_src.scope, p_src.owner_id);

    select * into v_t from public.territorial_layers where id = p_src.id;
    if found then
      insert into public.territorial_layers
        (id, group_id, name, color, icon, order_index, source_file_id, feature_count, bbox, source_name,
         render_mode, heatmap_aggregate_url, icon_render, last_dedup_strategy, heatmap_enabled)
      values
        (v_new, v_group, v_name, v_t.color, v_t.icon, v_t.order_index, null, 0, v_t.bbox, v_t.source_name,
         v_t.render_mode, v_t.heatmap_aggregate_url, v_t.icon_render, v_t.last_dedup_strategy, v_t.heatmap_enabled);
      insert into public.territorial_features (layer_id, external_id, name, lat, lng, geometry, properties)
      select v_new, f.external_id, f.name, f.lat, f.lng, f.geometry, f.properties
        from public.territorial_features f where f.layer_id = p_src.id;
      get diagnostics v_n = row_count;
      update public.territorial_layers set feature_count = v_n where id = v_new;
    end if;
  end if;
  return v_new;
end $$;

-- Duplica un nodo (y todo lo que contiene) justo después del original.
-- Tope: el rol `authenticated` corta cualquier consulta a los 8 s, así que se
-- rechaza copiar más de 10.000 puntos de una vez.
create or replace function public.duplicate_node(p_node_id uuid)
returns public.layer_nodes
language plpgsql security definer set search_path = public as $$
declare v_node public.layer_nodes; v_next text; v_feat bigint; v_new uuid; v_row public.layer_nodes;
        c_max constant int := 10000;
begin
  select * into v_node from public.layer_nodes where id = p_node_id for update;
  if not found then
    raise exception 'duplicate_node: el nodo % no existe', p_node_id using errcode = 'no_data_found';
  end if;
  if not public._layer_nodes_can_edit(v_node.scope, v_node.owner_id) then
    raise exception 'duplicate_node: sin permiso para duplicar este nodo' using errcode = 'insufficient_privilege';
  end if;
  if v_node.archived_at is not null then
    raise exception 'duplicate_node: el nodo está en la papelera' using errcode = 'check_violation';
  end if;

  select count(*) into v_feat
    from public.territorial_features f
   where f.layer_id in (
     with recursive d as (
       select id, kind from public.layer_nodes where id = p_node_id
       union all
       select c.id, c.kind from public.layer_nodes c join d on c.parent_id = d.id where c.archived_at is null
     )
     select id from d where kind = 'layer'
   );
  if v_feat > c_max then
    raise exception 'duplicate_node: contiene % puntos y el máximo para duplicar es %', v_feat, c_max
      using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtext('layer_nodes:' || coalesce(v_node.parent_id::text, 'root')));
  select position into v_next from public.layer_nodes
   where parent_id is not distinct from v_node.parent_id and archived_at is null
     and (position, id) > (v_node.position, v_node.id)
   order by position, id limit 1;

  v_new := public._layer_nodes_copy_subtree(
    v_node, v_node.parent_id,
    case when v_node.kind = 'folder' then v_node.name || ' (copia)' else v_node.name end,
    public.generate_key_between(v_node.position, v_next));

  select * into v_row from public.layer_nodes where id = v_new;
  return v_row;
end $$;

-- -----------------------------------------------------------------------------
-- 7. Vista para el código heredado: grupos que siguen siendo carpetas raíz activas
--    (territorial_layers_active ya existe desde la Fase 1)
-- -----------------------------------------------------------------------------
create or replace view public.territorial_layer_groups_active with (security_invoker = true) as
  select g.*
    from public.territorial_layer_groups g
    join public.layer_nodes n
      on n.id = g.id and n.archived_at is null and n.parent_id is null;

-- -----------------------------------------------------------------------------
-- 8. Permisos
-- -----------------------------------------------------------------------------
revoke all on function
  public._layer_nodes_root_of(uuid), public._legacy_slug(text), public._layer_nodes_unique_layer_name(uuid, text),
  public._layer_nodes_ensure_legacy_group(public.layer_nodes), public._layer_nodes_resync_layer_groups(uuid),
  public._layer_nodes_copy_subtree(public.layer_nodes, uuid, text, text), public.trg_layer_nodes_to_legacy()
  from public, anon, authenticated;

revoke all on function
  public.create_folder(uuid, text), public.update_node_style(uuid, jsonb),
  public.duplicate_node(uuid), public.get_node_bounds(uuid)
  from public, anon;
grant execute on function
  public.create_folder(uuid, text), public.update_node_style(uuid, jsonb),
  public.duplicate_node(uuid), public.get_node_bounds(uuid)
  to authenticated, service_role;

grant select on public.territorial_layer_groups_active to authenticated, service_role;
revoke all on public.territorial_layer_groups_active from anon;

insert into public._migration_log (sprint, notes) values ('layer_nodes_v2_edit', 'done');
