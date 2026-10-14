-- =============================================================================
-- Árbol de capas — Fase 1, parte 2/3: copia de datos y puente con lo heredado
-- =============================================================================
-- Copia territorial_layer_groups -> carpetas y territorial_layers -> capas
-- REUTILIZANDO los mismos uuid, de modo que territorial_features,
-- folder_layer_roles y todo lo que apunta a esas tablas sigue funcionando sin
-- tocarse. territorial_layers queda como tabla de DETALLE de la capa
-- (source_name, render_mode, heatmap_*, bbox, feature_count…).
--
-- Hasta la Fase 3 (edición en el árbol) las tablas viejas siguen siendo la
-- fuente de verdad de la estructura: el código actual las escribe. Por eso
-- se instala un puente VIEJO -> NUEVO (triggers) que mantiene el árbol al día.
-- Se retira en la Fase 5.
--
-- Guardrails: no borra nada; backup versionado de lo que lee; auditoría
-- antes y después; todo idempotente (se puede re-aplicar).
-- =============================================================================

select pg_advisory_xact_lock(hashtext('layer_nodes_v1'));
set local statement_timeout = '5min';

insert into public._migration_log (sprint, notes) values ('layer_nodes_v1_backfill', 'start');

-- -----------------------------------------------------------------------------
-- 1. Backup versionado (nunca se trunca; ver guardrails §3)
-- -----------------------------------------------------------------------------
create table if not exists public._backup_territorial_layer_groups_v1_20261014 as
  select * from public.territorial_layer_groups;
create table if not exists public._backup_territorial_layers_v1_20261014 as
  select * from public.territorial_layers;

-- Estas copias no son para la API: sin RLS y con los privilegios por defecto de
-- Supabase quedarían legibles por anon.
alter table public._backup_territorial_layer_groups_v1_20261014 enable row level security;
alter table public._backup_territorial_layers_v1_20261014 enable row level security;
revoke all on public._backup_territorial_layer_groups_v1_20261014 from anon, authenticated;
revoke all on public._backup_territorial_layers_v1_20261014 from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Auditoría previa: abortar si el supuesto de la migración no se cumple
-- -----------------------------------------------------------------------------
do $$
declare v_n int;
begin
  select count(*) into v_n from public.territorial_layers where parent_layer_id is not null;
  if v_n > 0 then
    raise exception 'Guardrail: % capas usan parent_layer_id (anidación heredada, sin uso al 2026-10-14); esta migración asume 0', v_n;
  end if;

  select count(*) into v_n
    from public.territorial_layer_groups g join public.territorial_layers l on l.id = g.id;
  if v_n > 0 then
    raise exception 'Guardrail: % uuid se repiten entre grupos y capas; reutilizarlos como id de nodo chocaría', v_n;
  end if;

  -- (Que un custom_layer comparta uuid con una capa ya migrada es el caso de
  -- re-ejecución: se detecta y se omite en el paso 7. Con un grupo, no.)
  select count(*) into v_n
    from public.custom_layers c join public.territorial_layer_groups g on g.id = c.id;
  if v_n > 0 then
    raise exception 'Guardrail: % custom_layers comparten uuid con un grupo', v_n;
  end if;

  -- Cifras de partida, para comparar al final.
  insert into public._migration_log (sprint, notes)
  select 'layer_nodes_v1_backfill_pre', jsonb_build_object(
    'groups',   (select count(*) from public.territorial_layer_groups),
    'layers',   (select count(*) from public.territorial_layers),
    'features', (select count(*) from public.territorial_features),
    'roles',    (select count(*) from public.folder_layer_roles),
    'custom',   (select count(*) from public.custom_layers)
  )::text;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Estilo heredado -> jsonb del nodo
-- -----------------------------------------------------------------------------
create or replace function public._legacy_group_style(g public.territorial_layer_groups)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'color', g.color, 'icon', g.icon, 'slug', g.slug, 'visible_default', g.visible_default));
$$;

create or replace function public._legacy_layer_style(l public.territorial_layers)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_strip_nulls(jsonb_build_object('color', l.color, 'icon', l.icon));
$$;

-- -----------------------------------------------------------------------------
-- 4. Sincronización VIEJO -> NUEVO (idempotente; la usa el backfill y se puede
--    volver a llamar). Mientras lo heredado sea la fuente de verdad:
--      - siempre: crea los nodos que falten y refresca nombre/estilo desde lo viejo.
--      - p_reorder = true: además alinea padre y orden con territorial_*.order_index.
--    NO usar con p_reorder desde la Fase 3: ahí la fuente de verdad pasa al árbol.
-- -----------------------------------------------------------------------------
create or replace function public.sync_layer_nodes_from_legacy(p_reorder boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
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
end $$;

-- -----------------------------------------------------------------------------
-- 5. Puente VIEJO -> NUEVO: lo que escribe el código actual aparece en el árbol
-- -----------------------------------------------------------------------------
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

drop trigger if exists trg_legacy_group_to_node on public.territorial_layer_groups;
create trigger trg_legacy_group_to_node
  after insert or update of name, color, icon, slug, visible_default or delete
  on public.territorial_layer_groups
  for each row execute function public.trg_legacy_group_to_node();

-- BEFORE INSERT: el nodo tiene que existir cuando se revisa la FK territorial_layers.id -> layer_nodes.id
create or replace function public.trg_legacy_layer_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.layer_nodes (id, parent_id, kind, name, position, style, scope, created_at, updated_at)
  values (new.id, new.group_id, 'layer', new.name, public._layer_nodes_next_position(new.group_id),
          public._legacy_layer_style(new), 'shared', new.created_at, new.updated_at)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists trg_legacy_layer_before_insert on public.territorial_layers;
create trigger trg_legacy_layer_before_insert
  before insert on public.territorial_layers
  for each row execute function public.trg_legacy_layer_before_insert();

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

drop trigger if exists trg_legacy_layer_after on public.territorial_layers;
create trigger trg_legacy_layer_after
  after update of name, color, icon, group_id or delete
  on public.territorial_layers
  for each row execute function public.trg_legacy_layer_after();

-- -----------------------------------------------------------------------------
-- 6. Copia inicial (usa la misma función que se puede volver a llamar)
-- -----------------------------------------------------------------------------
select public.sync_layer_nodes_from_legacy(true);

-- -----------------------------------------------------------------------------
-- 7. custom_layers -> capas compartidas
-- -----------------------------------------------------------------------------
-- Vacía al 2026-10-14 y sin columna de dueño (escritura solo admin), así que
-- todo lo que hubiera es "compartido". Cada una pasa a ser una capa de verdad
-- (territorial_layers + territorial_features) dentro del grupo "Capas
-- personalizadas". `activo` se ignora: no existe equivalente global, la
-- visibilidad pasa a ser por usuario. La tabla original NO se toca.
do $$
declare
  c record; v_group uuid; v_cnt int; v_layers int := 0; v_feats int := 0;
begin
  for c in select * from public.custom_layers order by created_at, id loop
    if exists (select 1 from public.territorial_layers where id = c.id) then continue; end if;

    if v_group is null then
      select id into v_group from public.territorial_layer_groups where slug = 'capas_personalizadas';
      if v_group is null then
        insert into public.territorial_layer_groups (name, slug, color, order_index, visible_default)
        values ('Capas personalizadas', 'capas_personalizadas', '#3B82F6',
                coalesce((select max(order_index) + 1 from public.territorial_layer_groups), 0), false)
        returning id into v_group;
      end if;
    end if;

    insert into public.territorial_layers (id, group_id, name, color, icon, order_index, feature_count)
    values (c.id, v_group, c.name, c.color_hex, c.icon_emoji,
            coalesce((select max(order_index) + 1 from public.territorial_layers where group_id = v_group), 0), 0);

    insert into public.territorial_features (layer_id, name, lat, lng, geometry, properties)
    select c.id,
           nullif(btrim(f -> 'properties' ->> 'name'), ''),
           case when f -> 'geometry' ->> 'type' = 'Point' then (f -> 'geometry' -> 'coordinates' ->> 1)::double precision end,
           case when f -> 'geometry' ->> 'type' = 'Point' then (f -> 'geometry' -> 'coordinates' ->> 0)::double precision end,
           f -> 'geometry',
           coalesce(f -> 'properties', '{}'::jsonb)
      from jsonb_array_elements(
             case when jsonb_typeof(c.geojson -> 'features') = 'array' then c.geojson -> 'features' else '[]'::jsonb end
           ) f
     where jsonb_typeof(f -> 'geometry') = 'object';
    get diagnostics v_cnt = row_count;

    update public.territorial_layers set feature_count = v_cnt where id = c.id;
    v_layers := v_layers + 1;
    v_feats  := v_feats + v_cnt;
  end loop;

  insert into public._migration_log (sprint, notes)
  values ('layer_nodes_v1_backfill_custom', jsonb_build_object('layers', v_layers, 'features', v_feats)::text);
end $$;

-- -----------------------------------------------------------------------------
-- 8. FK capa-detalle -> nodo, y vista de capas activas
-- -----------------------------------------------------------------------------
-- NOT VALID + VALIDATE: la validación solo toma un lock liviano.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'territorial_layers_node_fk') then
    alter table public.territorial_layers
      add constraint territorial_layers_node_fk
      foreign key (id) references public.layer_nodes(id) on delete cascade not valid;
  end if;
end $$;
alter table public.territorial_layers validate constraint territorial_layers_node_fk;

-- Capas que NO están en la papelera. Las capas archivadas no deben contar en
-- los análisis; en la Fase 3 los hooks de análisis pasan a leer esta vista.
create or replace view public.territorial_layers_active
  with (security_invoker = true) as
  select l.*
    from public.territorial_layers l
    join public.layer_nodes n on n.id = l.id
   where n.archived_at is null;
revoke all on public.territorial_layers_active from anon;

revoke all on function public.sync_layer_nodes_from_legacy(boolean) from public, anon;
grant execute on function public.sync_layer_nodes_from_legacy(boolean) to authenticated, service_role;
revoke all on function
  public._legacy_group_style(public.territorial_layer_groups),
  public._legacy_layer_style(public.territorial_layers)
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 9. Auditoría posterior: si algo no calza, la migración entera se revierte
-- -----------------------------------------------------------------------------
do $$
declare
  v_pre jsonb; v_custom jsonb; v_n int;
begin
  select notes::jsonb into v_pre from public._migration_log
   where sprint = 'layer_nodes_v1_backfill_pre' order by id desc limit 1;
  select notes::jsonb into v_custom from public._migration_log
   where sprint = 'layer_nodes_v1_backfill_custom' order by id desc limit 1;

  -- Todo grupo tiene su carpeta raíz y toda capa su nodo bajo su grupo.
  select count(*) into v_n from public.territorial_layer_groups g
   where not exists (select 1 from public.layer_nodes n
                      where n.id = g.id and n.kind = 'folder' and n.parent_id is null);
  if v_n > 0 then raise exception 'Guardrail: % grupos sin carpeta raíz', v_n; end if;

  select count(*) into v_n from public.territorial_layers l
   where not exists (select 1 from public.layer_nodes n
                      where n.id = l.id and n.kind = 'layer' and n.parent_id = l.group_id);
  if v_n > 0 then raise exception 'Guardrail: % capas sin nodo bajo su grupo', v_n; end if;

  -- Nada se perdió ni se duplicó en lo que no debía tocarse.
  if (select count(*) from public.folder_layer_roles) <> (v_pre ->> 'roles')::int then
    raise exception 'Guardrail: folder_layer_roles cambió (% -> %)', v_pre ->> 'roles', (select count(*) from public.folder_layer_roles);
  end if;
  if (select count(*) from public.custom_layers) <> (v_pre ->> 'custom')::int then
    raise exception 'Guardrail: custom_layers cambió';
  end if;
  if (select count(*) from public.territorial_features)
     <> (v_pre ->> 'features')::bigint + coalesce((v_custom ->> 'features')::bigint, 0) then
    raise exception 'Guardrail: territorial_features no calza (antes %, custom %, ahora %)',
      v_pre ->> 'features', v_custom ->> 'features', (select count(*) from public.territorial_features);
  end if;
  if (select count(*) from public.territorial_layers)
     <> (v_pre ->> 'layers')::int + coalesce((v_custom ->> 'layers')::int, 0) then
    raise exception 'Guardrail: territorial_layers no calza';
  end if;

  -- Mismo orden que lo heredado, solo si no hay nodos del árbol nuevo mezclados.
  if not exists (
    select 1 from public.layer_nodes n
     where n.archived_at is null and n.scope = 'shared'
       and not exists (select 1 from public.territorial_layer_groups g where g.id = n.id)
       and not exists (select 1 from public.territorial_layers t where t.id = n.id)
  ) then
    select count(*) into v_n from (
      select n.id,
             row_number() over (order by n.position, n.id) rn,
             row_number() over (order by g.order_index, g.created_at, g.id) rl
        from public.layer_nodes n join public.territorial_layer_groups g on g.id = n.id
       where n.parent_id is null and n.archived_at is null
    ) x where rn <> rl;
    if v_n > 0 then raise exception 'Guardrail: el orden de las carpetas no calza con order_index (% distintas)', v_n; end if;

    select count(*) into v_n from (
      select n.id,
             row_number() over (partition by n.parent_id order by n.position, n.id) rn,
             row_number() over (partition by t.group_id order by t.order_index, t.created_at, t.id) rl
        from public.layer_nodes n join public.territorial_layers t on t.id = n.id
       where n.archived_at is null
    ) x where rn <> rl;
    if v_n > 0 then raise exception 'Guardrail: el orden de las capas no calza con order_index (% distintas)', v_n; end if;
  end if;
end $$;

insert into public._migration_log (sprint, notes) values ('layer_nodes_v1_backfill', 'done');
