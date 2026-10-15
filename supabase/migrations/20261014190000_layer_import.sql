-- =============================================================================
-- Árbol de capas — Fase 4: importador único (staging + commit atómico + deshacer)
-- =============================================================================
-- Flujo:
--   1. create_layer_import(...)         crea un lote con la estructura del archivo (carpetas/capas)
--   2. INSERT en territorial_import_staging   el cliente sube los puntos, de a ~500 (sin índices pesados)
--   3. finish_layer_import_staging(id)  comprueba que llegaron todos
--   4. preview_layer_import(...)        qué pasaría (cuántas capas nuevas, o el diff: agregadas/eliminadas/modificadas)
--   5. commit_layer_import(...)         aplica TODO en una sola transacción
--   6. revert_layer_import(id)          vuelve atrás la última importación de una capa
--
-- Modos:
--   new      crea las carpetas y capas del archivo (en el orden del archivo) bajo una carpeta
--   replace  deja la capa destino con exactamente lo que trae el archivo (borra lo que ya no está)
--   append   suma lo nuevo y actualiza lo que cambió; nunca borra
--
-- Qué cuenta como "el mismo punto" al actualizar: el external_id (id del Placemark) si
-- ambos lo traen; si no, la misma ubicación (a 6 decimales) y el mismo nombre.
--
-- LÍMITE DE TAMAÑO: el rol `authenticated` corta toda consulta de la API a los 8 s y
-- escribir un punto cuesta ~0,4 ms (medido: 8.114 puntos en 3,5 s). Por eso el costo de
-- una confirmación debe caber en el timeout: al actualizar solo se escribe lo que
-- cambió (el resto de la capa no se toca), pero una capa NUEVA se escribe entera. El tope
-- se calcula del `statement_timeout` vigente (ver _import_row_cap): si ese timeout se
-- sube, el tope sube solo.
--
-- "Versión previa": no se copia la capa. Se guarda un registro de cambios con el estado
-- anterior de lo que se tocó (territorial_import_changes), proporcional al diff.
-- =============================================================================

select pg_advisory_xact_lock(hashtext('layer_nodes_v1'));
set local statement_timeout = '5min';

insert into public._migration_log (sprint, notes) values ('layer_import_v1', 'start');

-- -----------------------------------------------------------------------------
-- 1. Tablas
-- -----------------------------------------------------------------------------
create table if not exists public.territorial_import_batches (
  id             uuid primary key default gen_random_uuid(),
  created_by     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at     timestamptz not null default now(),
  filename       text not null check (length(btrim(filename)) between 1 and 300),
  format         text not null check (format in ('kmz', 'kml', 'geojson', 'csv')),
  -- árbol del archivo sin los puntos: {key, kind, name, color, icon, children | count}
  structure      jsonb not null,
  feature_total  integer not null check (feature_total >= 0),
  staged_total   integer not null default 0,
  status         text not null default 'staging' check (status in ('staging', 'committed', 'reverted')),
  mode           text check (mode in ('new', 'replace', 'append')),
  target_node_id uuid,
  committed_at   timestamptz,
  result         jsonb
);
create index if not exists territorial_import_batches_created_idx on public.territorial_import_batches (created_at);
create index if not exists territorial_import_batches_target_idx
  on public.territorial_import_batches (target_node_id, committed_at) where status = 'committed';

create table if not exists public.territorial_import_staging (
  id          bigint generated always as identity primary key,
  import_id   uuid not null references public.territorial_import_batches(id) on delete cascade,
  layer_key   text not null,
  seq         integer not null,
  external_id text,
  name        text,
  lat         double precision,
  lng         double precision,
  geometry    jsonb not null,
  properties  jsonb not null default '{}'::jsonb
);
create index if not exists territorial_import_staging_layer_idx on public.territorial_import_staging (import_id, layer_key, seq);

create table if not exists public.territorial_import_changes (
  id         bigint generated always as identity primary key,
  import_id  uuid not null references public.territorial_import_batches(id) on delete cascade,
  layer_id   uuid not null,          -- sin FK: la capa puede borrarse después
  change     text not null check (change in ('added', 'removed', 'modified')),
  feature_id uuid not null,
  old_row    jsonb                   -- estado anterior (removed / modified)
);
create index if not exists territorial_import_changes_import_idx on public.territorial_import_changes (import_id);

alter table public.territorial_import_batches enable row level security;
alter table public.territorial_import_staging enable row level security;
alter table public.territorial_import_changes enable row level security;

drop policy if exists import_batches_admin on public.territorial_import_batches;
create policy import_batches_admin on public.territorial_import_batches
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin') and created_by = auth.uid())
  with check (public.has_role(auth.uid(), 'admin') and created_by = auth.uid());

-- Subir puntos: solo a un lote propio que siga en staging.
drop policy if exists import_staging_admin on public.territorial_import_staging;
create policy import_staging_admin on public.territorial_import_staging
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin') and exists (
    select 1 from public.territorial_import_batches b where b.id = import_id and b.created_by = auth.uid()))
  with check (public.has_role(auth.uid(), 'admin') and exists (
    select 1 from public.territorial_import_batches b
     where b.id = import_id and b.created_by = auth.uid() and b.status = 'staging'));

drop policy if exists import_changes_admin_read on public.territorial_import_changes;
create policy import_changes_admin_read on public.territorial_import_changes
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin') and exists (
    select 1 from public.territorial_import_batches b where b.id = import_id and b.created_by = auth.uid()));

revoke all on public.territorial_import_batches, public.territorial_import_staging, public.territorial_import_changes from anon;
grant select, insert, update, delete on public.territorial_import_batches, public.territorial_import_staging to authenticated;
grant select on public.territorial_import_changes to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Auxiliares
-- -----------------------------------------------------------------------------
-- Cuántos puntos se pueden escribir en una confirmación: ~700 por segundo del timeout vigente
-- (la medición real fue ~2.300/s; el margen cubre el diff, el registro de cambios y las
-- instantáneas). Mínimo 50 (permite probar con poco) y máximo 100.000.
create or replace function public._import_row_cap()
returns int language plpgsql stable set search_path = public as $$
declare v_secs numeric;
begin
  begin
    v_secs := extract(epoch from current_setting('statement_timeout')::interval);
  exception when others then
    v_secs := 8;
  end;
  if v_secs is null or v_secs <= 0 then return 100000; end if;
  return least(100000, greatest(50, floor(v_secs * 700)::int));
end $$;

create or replace function public._import_assert_admin()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then return; end if;
  if auth.uid() is null or not public.has_role(auth.uid(), 'admin') then
    raise exception 'importador: solo administradores' using errcode = 'insufficient_privilege';
  end if;
end $$;

-- Capas del archivo que NO están excluidas (en orden de archivo). Excluir una clave excluye
-- todo lo que cuelga de ella ("0.2" excluye "0.2.1" pero no "0.20").
create or replace function public._import_layers(p_node jsonb, p_excluded text[], p_path text[] default '{}')
returns table (layer_key text, layer_name text, color text, icon text, path text[], cnt int)
language plpgsql immutable set search_path = public as $$
declare c jsonb; v_key text := p_node ->> 'key';
begin
  if v_key = any (p_excluded) or exists (select 1 from unnest(p_excluded) e where v_key like e || '.%') then
    return;
  end if;
  if p_node ->> 'kind' = 'layer' then
    return query select v_key, p_node ->> 'name', p_node ->> 'color', p_node ->> 'icon', p_path, coalesce((p_node ->> 'count')::int, 0);
    return;
  end if;
  for c in select value from jsonb_array_elements(coalesce(p_node -> 'children', '[]'::jsonb)) loop
    return query select * from public._import_layers(c, p_excluded, p_path || (p_node ->> 'name'));
  end loop;
end $$;

-- Rechaza una estructura mal formada (el cliente es de confianza solo a medias).
create or replace function public._import_validate_structure(p_node jsonb, p_depth int default 0)
returns int language plpgsql immutable set search_path = public as $$
declare c jsonb; v_total int := 0; v_kind text := p_node ->> 'kind';
begin
  if p_depth > 30 then raise exception 'importador: estructura demasiado profunda' using errcode = 'invalid_parameter_value'; end if;
  if jsonb_typeof(p_node) <> 'object' or coalesce(p_node ->> 'key', '') = '' or coalesce(btrim(p_node ->> 'name'), '') = ''
     or v_kind not in ('folder', 'layer') then
    raise exception 'importador: nodo de estructura inválido' using errcode = 'invalid_parameter_value';
  end if;
  if v_kind = 'layer' then
    return coalesce((p_node ->> 'count')::int, 0);
  end if;
  for c in select value from jsonb_array_elements(coalesce(p_node -> 'children', '[]'::jsonb)) loop
    v_total := v_total + public._import_validate_structure(c, p_depth + 1);
  end loop;
  return v_total;
end $$;

create or replace function public._import_safe_icon(p_icon text)
returns text language sql immutable as $$
  select case when p_icon ~* '^(https?:|data:)' and length(p_icon) <= 6000 then p_icon end;
$$;

create or replace function public._import_safe_color(p_color text)
returns text language sql immutable as $$
  select case when p_color ~ '^#[0-9a-fA-F]{6}$' then lower(p_color) end;
$$;

-- Lote del usuario actual, bloqueado para escribir sobre él.
create or replace function public._import_lock_batch(p_import_id uuid)
returns public.territorial_import_batches language plpgsql security definer set search_path = public as $$
declare v public.territorial_import_batches;
begin
  select * into v from public.territorial_import_batches where id = p_import_id for update;
  if not found then
    raise exception 'importador: el lote % no existe', p_import_id using errcode = 'no_data_found';
  end if;
  if coalesce(auth.role(), '') <> 'service_role' and v.created_by is distinct from auth.uid() then
    raise exception 'importador: ese lote es de otro usuario' using errcode = 'insufficient_privilege';
  end if;
  return v;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Diff contra una capa existente (lo usan preview y commit)
-- -----------------------------------------------------------------------------
-- Deja en la tabla temporal _imp_diff una fila por cada punto involucrado:
--   action  : added | removed | modified | unchanged
--   sid     : id en staging (null si solo existe en la capa)
--   fid     : id del punto existente (null si es nuevo)
--   how     : external_id | coords_name (cómo se emparejó)
--   changed : qué cambió en los modificados (name, location, attributes, external_id)
create or replace function public._import_build_diff(p_import_id uuid, p_target_layer uuid, p_layer_keys text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  drop table if exists _imp_diff;
  create temp table _imp_diff on commit drop as
  with s as (
    select st.id as sid, st.external_id, st.name, st.lat, st.lng, st.geometry, st.properties, st.seq,
           round(st.lat::numeric, 6) as rlat, round(st.lng::numeric, 6) as rlng
      from public.territorial_import_staging st
     where st.import_id = p_import_id and st.layer_key = any (p_layer_keys)
  ),
  s_u as (   -- un external_id repetido en el archivo solo se empareja una vez (el primero)
    select s.*, row_number() over (partition by s.external_id order by s.seq, s.sid) as ext_rn from s
  ),
  e as (
    select f.id as fid, f.external_id, f.name, f.lat, f.lng, f.geometry, f.properties,
           round(f.lat::numeric, 6) as rlat, round(f.lng::numeric, 6) as rlng
      from public.territorial_features f where f.layer_id = p_target_layer
  ),
  m1 as (
    select s_u.sid, e.fid, 'external_id'::text as how
      from s_u join e on s_u.external_id is not null and s_u.ext_rn = 1 and e.external_id = s_u.external_id
  ),
  s2 as (select s.* from s where not exists (select 1 from m1 where m1.sid = s.sid)),
  e2 as (select e.* from e where not exists (select 1 from m1 where m1.fid = e.fid)),
  sk as (
    select s2.*, row_number() over (partition by s2.rlat, s2.rlng, coalesce(s2.name, '') order by s2.seq, s2.sid) as rn from s2
  ),
  ek as (
    select e2.*, row_number() over (partition by e2.rlat, e2.rlng, coalesce(e2.name, '') order by e2.fid) as rn from e2
  ),
  m2 as (
    select sk.sid, ek.fid, 'coords_name'::text as how
      from sk join ek on sk.rn = ek.rn and sk.rlat is not distinct from ek.rlat and sk.rlng is not distinct from ek.rlng
                     and coalesce(sk.name, '') = coalesce(ek.name, '')
  ),
  m as (select * from m1 union all select * from m2),
  classified as (
    select case when
             s.name is distinct from e.name or s.lat is distinct from e.lat or s.lng is distinct from e.lng
             or s.geometry is distinct from e.geometry or s.properties is distinct from e.properties
             or s.external_id is distinct from e.external_id
           then 'modified' else 'unchanged' end as action,
           m.sid, m.fid, m.how,
           array_remove(array[
             case when s.name is distinct from e.name then 'name' end,
             case when s.lat is distinct from e.lat or s.lng is distinct from e.lng or s.geometry is distinct from e.geometry then 'location' end,
             case when s.properties is distinct from e.properties then 'attributes' end,
             case when s.external_id is distinct from e.external_id then 'external_id' end], null) as changed
      from m join s on s.sid = m.sid join e on e.fid = m.fid
    union all
    select 'added', s.sid, null::uuid, null::text, '{}'::text[] from s where not exists (select 1 from m where m.sid = s.sid)
    union all
    select 'removed', null::bigint, e.fid, null::text, '{}'::text[] from e where not exists (select 1 from m where m.fid = e.fid)
  )
  select * from classified;
  create index on _imp_diff (action);
end $$;

-- -----------------------------------------------------------------------------
-- 4. RPC: crear lote, cerrar la subida, límites
-- -----------------------------------------------------------------------------
create or replace function public.layer_import_limits()
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('max_rows', public._import_row_cap(), 'statement_timeout', current_setting('statement_timeout'));
$$;

create or replace function public.create_layer_import(p_filename text, p_format text, p_structure jsonb, p_feature_total int)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_sum int;
begin
  perform public._import_assert_admin();
  if p_feature_total is null or p_feature_total < 0 or p_feature_total > 200000 then
    raise exception 'importador: cantidad de puntos fuera de rango' using errcode = 'invalid_parameter_value';
  end if;
  v_sum := public._import_validate_structure(p_structure);
  if v_sum <> p_feature_total then
    raise exception 'importador: la estructura suma % puntos y se declararon %', v_sum, p_feature_total using errcode = 'invalid_parameter_value';
  end if;
  insert into public.territorial_import_batches (created_by, filename, format, structure, feature_total)
  values (auth.uid(), btrim(p_filename), p_format, p_structure, p_feature_total)
  returning id into v_id;
  return v_id;
end $$;

-- Comprueba que llegaron todos los puntos y cierra la subida.
create or replace function public.finish_layer_import_staging(p_import_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare b public.territorial_import_batches; v_n int;
begin
  perform public._import_assert_admin();
  b := public._import_lock_batch(p_import_id);
  if b.status <> 'staging' then
    raise exception 'importador: el lote ya no está en preparación' using errcode = 'check_violation';
  end if;
  select count(*) into v_n from public.territorial_import_staging where import_id = p_import_id;
  if v_n <> b.feature_total then
    raise exception 'importador: llegaron % de % puntos; vuelve a subir el archivo', v_n, b.feature_total using errcode = 'check_violation';
  end if;
  update public.territorial_import_batches set staged_total = v_n where id = p_import_id;
  return v_n;
end $$;

-- Descarta un lote que no se confirmó (borra sus puntos subidos).
create or replace function public.discard_layer_import(p_import_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare b public.territorial_import_batches;
begin
  perform public._import_assert_admin();
  b := public._import_lock_batch(p_import_id);
  if b.status = 'committed' then
    raise exception 'importador: un lote confirmado no se descarta; usa revert_layer_import' using errcode = 'check_violation';
  end if;
  delete from public.territorial_import_batches where id = p_import_id;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Vista previa
-- -----------------------------------------------------------------------------
create or replace function public.preview_layer_import(
  p_import_id uuid, p_mode text, p_target_node_id uuid default null, p_excluded_keys text[] default '{}'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b public.territorial_import_batches; v_target public.layer_nodes; v_cap int := public._import_row_cap();
  v_keys text[]; v_layers int; v_feats int; v_folders int;
  v_added int; v_removed int; v_modified int; v_unchanged int; v_by_ext int; v_by_coords int; v_write int; v_samples jsonb;
begin
  perform public._import_assert_admin();
  b := public._import_lock_batch(p_import_id);
  if p_mode not in ('new', 'replace', 'append') then
    raise exception 'importador: modo inválido "%"', p_mode using errcode = 'invalid_parameter_value';
  end if;

  select array_agg(layer_key), count(*), coalesce(sum(cnt), 0)::int
    into v_keys, v_layers, v_feats
    from public._import_layers(b.structure, coalesce(p_excluded_keys, '{}'));
  if coalesce(v_layers, 0) = 0 then
    return jsonb_build_object('mode', p_mode, 'max_rows', v_cap, 'included', jsonb_build_object('layers', 0, 'features', 0), 'fits', true, 'empty', true);
  end if;

  if p_mode = 'new' then
    -- carpetas que se crearían: las ancestras de las capas incluidas, más la raíz del archivo
    with recursive walk as (
      select b.structure as node
      union all
      select c.value from walk w, jsonb_array_elements(coalesce(w.node -> 'children', '[]'::jsonb)) c where w.node ->> 'kind' = 'folder'
    )
    select count(*) into v_folders from walk w
     where w.node ->> 'kind' = 'folder'
       and exists (select 1 from public._import_layers(w.node, coalesce(p_excluded_keys, '{}')));
    return jsonb_build_object(
      'mode', 'new', 'max_rows', v_cap, 'fits', v_feats <= v_cap,
      'included', jsonb_build_object('layers', v_layers, 'features', v_feats),
      'new', jsonb_build_object('folders', v_folders, 'layers', v_layers, 'features', v_feats, 'rows_to_write', v_feats));
  end if;

  -- replace / append: el destino es una capa existente
  select * into v_target from public.layer_nodes where id = p_target_node_id;
  if not found or v_target.kind <> 'layer' then
    raise exception 'importador: el destino debe ser una capa existente' using errcode = 'check_violation';
  end if;
  perform public._import_build_diff(p_import_id, p_target_node_id, v_keys);
  select count(*) filter (where action = 'added'), count(*) filter (where action = 'removed'),
         count(*) filter (where action = 'modified'), count(*) filter (where action = 'unchanged'),
         count(*) filter (where how = 'external_id'), count(*) filter (where how = 'coords_name')
    into v_added, v_removed, v_modified, v_unchanged, v_by_ext, v_by_coords from _imp_diff;
  v_write := v_added + v_modified + case when p_mode = 'replace' then v_removed else 0 end;

  select jsonb_build_object(
    'added', coalesce((select jsonb_agg(x.name) from (select st.name from _imp_diff d join public.territorial_import_staging st on st.id = d.sid where d.action = 'added' order by st.seq limit 20) x), '[]'::jsonb),
    'removed', coalesce((select jsonb_agg(x.name) from (select f.name from _imp_diff d join public.territorial_features f on f.id = d.fid where d.action = 'removed' order by f.name limit 20) x), '[]'::jsonb),
    'modified', coalesce((select jsonb_agg(jsonb_build_object('name', x.name, 'changed', x.changed)) from (select st.name, d.changed from _imp_diff d join public.territorial_import_staging st on st.id = d.sid where d.action = 'modified' order by st.seq limit 20) x), '[]'::jsonb))
    into v_samples;

  return jsonb_build_object(
    'mode', p_mode, 'max_rows', v_cap, 'fits', v_write <= v_cap,
    'included', jsonb_build_object('layers', v_layers, 'features', v_feats),
    'target', jsonb_build_object('id', v_target.id, 'name', v_target.name,
                                 'feature_count', (select feature_count from public.territorial_layers where id = v_target.id)),
    'diff', jsonb_build_object(
      'added', v_added, 'removed', v_removed, 'modified', v_modified, 'unchanged', v_unchanged,
      'kept', case when p_mode = 'append' then v_removed else 0 end,
      'matched_by_external_id', v_by_ext, 'matched_by_coords', v_by_coords,
      'rows_to_write', v_write, 'samples', v_samples));
end $$;

-- -----------------------------------------------------------------------------
-- 6. Confirmar
-- -----------------------------------------------------------------------------
-- Crea (recursivo) las carpetas y capas de un nodo del archivo bajo p_parent.
create or replace function public._import_create_nodes(
  p_import_id uuid, p_node jsonb, p_parent uuid, p_excluded text[], p_top boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_key text := p_node ->> 'key'; v_name text := btrim(p_node ->> 'name'); v_new uuid := gen_random_uuid();
  v_style jsonb; v_group uuid; v_layer_name text; v_n int; c jsonb; v_child uuid;
begin
  if not exists (select 1 from public._import_layers(p_node, p_excluded)) then
    return null;   -- nada incluido adentro: no se crea ni la carpeta
  end if;
  v_style := jsonb_strip_nulls(jsonb_build_object(
    'color', public._import_safe_color(p_node ->> 'color'), 'icon', public._import_safe_icon(p_node ->> 'icon')));

  if p_node ->> 'kind' = 'folder' then
    insert into public.layer_nodes (id, parent_id, kind, name, position, style, scope)
    values (v_new, p_parent, 'folder', v_name, public._layer_nodes_next_position(p_parent), '{}'::jsonb, 'shared');
    insert into _imp_created (node_id, kind, top) values (v_new, 'folder', p_top);
    for c in select value from jsonb_array_elements(coalesce(p_node -> 'children', '[]'::jsonb)) loop
      v_child := public._import_create_nodes(p_import_id, c, v_new, p_excluded, false);
    end loop;
    return v_new;
  end if;

  v_group := public._layer_nodes_root_of(p_parent);
  v_layer_name := public._layer_nodes_unique_layer_name(v_group, v_name);
  insert into public.layer_nodes (id, parent_id, kind, name, position, style, scope)
  values (v_new, p_parent, 'layer', v_layer_name, public._layer_nodes_next_position(p_parent), v_style, 'shared');
  insert into public.territorial_layers (id, group_id, name, color, icon, source_name, feature_count)
  values (v_new, v_group, v_layer_name, v_style ->> 'color', v_style ->> 'icon', v_name, 0);

  insert into public.territorial_features (layer_id, external_id, name, lat, lng, geometry, properties)
  select v_new, case when q.rn = 1 then q.external_id end, q.name, q.lat, q.lng, q.geometry, q.properties
    from (select st.*, row_number() over (partition by st.external_id order by st.seq) as rn
            from public.territorial_import_staging st where st.import_id = p_import_id and st.layer_key = v_key) q
   order by q.seq;
  get diagnostics v_n = row_count;
  update public.territorial_layers set feature_count = v_n where id = v_new;
  insert into _imp_created (node_id, kind, top, features) values (v_new, 'layer', p_top, v_n);
  return v_new;
end $$;

create or replace function public.commit_layer_import(
  p_import_id uuid, p_mode text, p_target_node_id uuid default null, p_excluded_keys text[] default '{}'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b public.territorial_import_batches; v_target public.layer_nodes; v_cap int := public._import_row_cap();
  v_excluded text[] := coalesce(p_excluded_keys, '{}'); v_keys text[]; v_layers int; v_feats int;
  v_parent uuid; v_root uuid; v_name text; v_result jsonb; v_layer public.territorial_layers;
  v_added int := 0; v_removed int := 0; v_modified int := 0; v_unchanged int := 0; v_write int; v_count int;
begin
  perform public._import_assert_admin();
  b := public._import_lock_batch(p_import_id);
  if b.status <> 'staging' then
    raise exception 'importador: este lote ya se confirmó o se revirtió' using errcode = 'check_violation';
  end if;
  if b.staged_total <> b.feature_total then
    raise exception 'importador: la subida de puntos no se cerró (llama a finish_layer_import_staging)' using errcode = 'check_violation';
  end if;
  if p_mode not in ('new', 'replace', 'append') then
    raise exception 'importador: modo inválido "%"', p_mode using errcode = 'invalid_parameter_value';
  end if;

  select array_agg(layer_key), count(*), coalesce(sum(cnt), 0)::int into v_keys, v_layers, v_feats
    from public._import_layers(b.structure, v_excluded);
  if coalesce(v_layers, 0) = 0 then
    raise exception 'importador: no quedó ninguna capa incluida' using errcode = 'check_violation';
  end if;

  -- ── Nueva capa / carpetas ───────────────────────────────────────────────────
  if p_mode = 'new' then
    if v_feats > v_cap then
      raise exception 'importador: son % puntos y el máximo por confirmación es % (el rol authenticated corta a los %). Excluye partes del archivo o importa por separado.',
        v_feats, v_cap, current_setting('statement_timeout') using errcode = 'check_violation';
    end if;
    if p_target_node_id is not null then
      select * into v_target from public.layer_nodes where id = p_target_node_id for update;
      if not found or v_target.kind <> 'folder' or v_target.archived_at is not null then
        raise exception 'importador: el destino debe ser una carpeta existente' using errcode = 'check_violation';
      end if;
      if not public._layer_nodes_can_edit(v_target.scope, v_target.owner_id) then
        raise exception 'importador: sin permiso para escribir en esa carpeta' using errcode = 'insufficient_privilege';
      end if;
      v_parent := p_target_node_id;
    end if;

    drop table if exists _imp_created;
    create temp table _imp_created (node_id uuid, kind text, top boolean, features int) on commit drop;
    if b.structure ->> 'kind' = 'folder' then
      -- La carpeta raíz del archivo se crea bajo el destino (o en la raíz si no se eligió destino).
      perform public._import_create_nodes(p_import_id, b.structure, v_parent, v_excluded, true);
    else
      -- Archivo de una sola capa: necesita carpeta; sin destino, se crea una con el nombre del archivo.
      if v_parent is null then
        v_name := coalesce(nullif(btrim(regexp_replace(b.filename, '\.[^.]+$', '')), ''), 'Importación');
        insert into public.layer_nodes (parent_id, kind, name, position, style, scope)
        values (null, 'folder', v_name, public._layer_nodes_next_position(null), '{}'::jsonb, 'shared')
        returning id into v_parent;
        insert into _imp_created (node_id, kind, top) values (v_parent, 'folder', true);
      end if;
      -- Si no hubo destino, la carpeta envoltorio es lo "de arriba" y la capa va adentro.
      perform public._import_create_nodes(p_import_id, b.structure, v_parent, v_excluded, p_target_node_id is not null);
    end if;

    select jsonb_build_object(
      'mode', 'new',
      'folders', count(*) filter (where kind = 'folder'),
      'layers', count(*) filter (where kind = 'layer'),
      'features', coalesce(sum(features), 0),
      'root_node_ids', coalesce(jsonb_agg(node_id) filter (where top), '[]'::jsonb),
      'created_node_ids', coalesce(jsonb_agg(node_id), '[]'::jsonb))
      into v_result from _imp_created;

  -- ── Reemplazar / agregar a una capa ─────────────────────────────────────────
  else
    select * into v_target from public.layer_nodes where id = p_target_node_id for update;
    if not found or v_target.kind <> 'layer' or v_target.archived_at is not null then
      raise exception 'importador: el destino debe ser una capa existente' using errcode = 'check_violation';
    end if;
    if not public._layer_nodes_can_edit(v_target.scope, v_target.owner_id) then
      raise exception 'importador: sin permiso para modificar esa capa' using errcode = 'insufficient_privilege';
    end if;
    select * into v_layer from public.territorial_layers where id = p_target_node_id for update;
    if not found then
      raise exception 'importador: la capa destino no tiene datos asociados' using errcode = 'no_data_found';
    end if;

    perform public._import_build_diff(p_import_id, p_target_node_id, v_keys);
    select count(*) filter (where action = 'added'), count(*) filter (where action = 'removed'),
           count(*) filter (where action = 'modified'), count(*) filter (where action = 'unchanged')
      into v_added, v_removed, v_modified, v_unchanged from _imp_diff;
    v_write := v_added + v_modified + case when p_mode = 'replace' then v_removed else 0 end;
    if v_write > v_cap then
      raise exception 'importador: este cambio escribe % puntos y el máximo por confirmación es % (el rol authenticated corta a los %).',
        v_write, v_cap, current_setting('statement_timeout') using errcode = 'check_violation';
    end if;

    -- 1) registro de cambios con el estado anterior (para poder volver atrás)
    insert into public.territorial_import_changes (import_id, layer_id, change, feature_id, old_row)
    select p_import_id, p_target_node_id, d.action, d.fid,
           jsonb_build_object('id', f.id, 'layer_id', f.layer_id, 'external_id', f.external_id, 'name', f.name,
                              'lat', f.lat, 'lng', f.lng, 'geometry', f.geometry, 'properties', f.properties,
                              'created_at', f.created_at)
      from _imp_diff d join public.territorial_features f on f.id = d.fid
     where d.action = 'modified' or (d.action = 'removed' and p_mode = 'replace');

    -- 2) eliminar lo que ya no está (solo reemplazar)
    if p_mode = 'replace' then
      delete from public.territorial_features f using _imp_diff d where d.action = 'removed' and f.id = d.fid;
    else
      v_removed := 0;   -- agregar nunca borra
    end if;

    -- 3) modificar
    update public.territorial_features f
       set external_id = s.external_id, name = s.name, lat = s.lat, lng = s.lng, geometry = s.geometry, properties = s.properties
      from _imp_diff d join public.territorial_import_staging s on s.id = d.sid
     where d.action = 'modified' and f.id = d.fid;

    -- 4) agregar (un external_id repetido en el archivo solo se conserva en el primero)
    with ins as (
      insert into public.territorial_features (layer_id, external_id, name, lat, lng, geometry, properties)
      select p_target_node_id,
             case when row_number() over (partition by s.external_id order by s.seq) = 1
                   and not exists (select 1 from public.territorial_features x where x.layer_id = p_target_node_id and x.external_id = s.external_id)
                  then s.external_id end,
             s.name, s.lat, s.lng, s.geometry, s.properties
        from _imp_diff d join public.territorial_import_staging s on s.id = d.sid
       where d.action = 'added'
       order by s.seq
      returning id
    )
    insert into public.territorial_import_changes (import_id, layer_id, change, feature_id)
    select p_import_id, p_target_node_id, 'added', id from ins;

    select count(*) into v_count from public.territorial_features where layer_id = p_target_node_id;
    update public.territorial_layers set feature_count = v_count where id = p_target_node_id;

    v_result := jsonb_build_object(
      'mode', p_mode, 'target_node_id', p_target_node_id, 'features', v_count,
      'added', v_added, 'removed', v_removed, 'modified', v_modified, 'unchanged', v_unchanged);
  end if;

  update public.territorial_import_batches
     set status = 'committed', mode = p_mode, target_node_id = p_target_node_id, committed_at = clock_timestamp(), result = v_result
   where id = p_import_id;
  return v_result;
end $$;

-- -----------------------------------------------------------------------------
-- 7. Volver atrás
-- -----------------------------------------------------------------------------
create or replace function public.revert_layer_import(p_import_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b public.territorial_import_batches; v_cap int := public._import_row_cap(); v_n int; v_id uuid; v_count int;
  v_added int; v_restored int; v_reverted int;
begin
  perform public._import_assert_admin();
  b := public._import_lock_batch(p_import_id);
  if b.status <> 'committed' then
    raise exception 'importador: solo se puede revertir un lote confirmado' using errcode = 'check_violation';
  end if;

  if b.mode = 'new' then
    -- Lo creado va a la papelera (se puede restaurar 30 días): no se borra nada.
    for v_id in select (value #>> '{}')::uuid from jsonb_array_elements(coalesce(b.result -> 'root_node_ids', '[]'::jsonb)) loop
      if exists (select 1 from public.layer_nodes where id = v_id and archived_at is null) then
        perform public.archive_node(v_id);
      end if;
    end loop;
    update public.territorial_import_batches set status = 'reverted' where id = p_import_id;
    return jsonb_build_object('mode', 'new', 'archived_roots', jsonb_array_length(coalesce(b.result -> 'root_node_ids', '[]'::jsonb)));
  end if;

  -- Una capa solo se revierte si esta fue su última importación.
  if exists (
    select 1 from public.territorial_import_batches x
     where x.id <> b.id and x.status = 'committed' and x.target_node_id = b.target_node_id and x.committed_at > b.committed_at
  ) then
    raise exception 'importador: esa capa tiene una importación posterior; revierte primero la más reciente' using errcode = 'check_violation';
  end if;

  select count(*) into v_n from public.territorial_import_changes where import_id = p_import_id;
  if v_n > v_cap then
    raise exception 'importador: revertir toca % puntos y el máximo por confirmación es %', v_n, v_cap using errcode = 'check_violation';
  end if;

  -- lo agregado se quita
  delete from public.territorial_features f using public.territorial_import_changes c
   where c.import_id = p_import_id and c.change = 'added' and f.id = c.feature_id;
  get diagnostics v_added = row_count;

  -- lo eliminado vuelve (con el mismo id)
  insert into public.territorial_features (id, layer_id, external_id, name, lat, lng, geometry, properties, created_at)
  select (c.old_row ->> 'id')::uuid, (c.old_row ->> 'layer_id')::uuid, c.old_row ->> 'external_id', c.old_row ->> 'name',
         (c.old_row ->> 'lat')::float8, (c.old_row ->> 'lng')::float8, c.old_row -> 'geometry', coalesce(c.old_row -> 'properties', '{}'::jsonb),
         coalesce((c.old_row ->> 'created_at')::timestamptz, now())
    from public.territorial_import_changes c
   where c.import_id = p_import_id and c.change = 'removed'
  on conflict (id) do nothing;
  get diagnostics v_restored = row_count;

  -- lo modificado recupera su estado anterior
  update public.territorial_features f
     set external_id = c.old_row ->> 'external_id', name = c.old_row ->> 'name', lat = (c.old_row ->> 'lat')::float8,
         lng = (c.old_row ->> 'lng')::float8, geometry = c.old_row -> 'geometry', properties = coalesce(c.old_row -> 'properties', '{}'::jsonb)
    from public.territorial_import_changes c
   where c.import_id = p_import_id and c.change = 'modified' and f.id = c.feature_id;
  get diagnostics v_reverted = row_count;

  select count(*) into v_count from public.territorial_features where layer_id = b.target_node_id;
  update public.territorial_layers set feature_count = v_count where id = b.target_node_id;
  update public.territorial_import_batches set status = 'reverted' where id = p_import_id;
  return jsonb_build_object('mode', b.mode, 'removed_added', v_added, 'restored', v_restored, 'reverted_modified', v_reverted, 'features', v_count);
end $$;

-- -----------------------------------------------------------------------------
-- 8. Limpieza (pg_cron, cada hora)
-- -----------------------------------------------------------------------------
--  - los puntos subidos de un lote ya confirmado o revertido sobran a la hora;
--  - un lote que nunca se confirmó se descarta a las 24 h;
--  - el registro de un lote (con su deshacer) vive 30 días.
create or replace function public.purge_layer_import_data()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_stage int; v_open int; v_old int;
begin
  delete from public.territorial_import_staging s using public.territorial_import_batches b
   where b.id = s.import_id and b.status in ('committed', 'reverted') and b.created_at < now() - interval '1 hour';
  get diagnostics v_stage = row_count;
  delete from public.territorial_import_batches where status = 'staging' and created_at < now() - interval '24 hours';
  get diagnostics v_open = row_count;
  delete from public.territorial_import_batches where status in ('committed', 'reverted') and created_at < now() - interval '30 days';
  get diagnostics v_old = row_count;
  return jsonb_build_object('staging_rows', v_stage, 'abandoned_batches', v_open, 'old_batches', v_old);
end $$;

select cron.schedule('purge-layer-import-data', '17 * * * *', $$ select public.purge_layer_import_data(); $$);

-- -----------------------------------------------------------------------------
-- 9. Permisos de ejecución
-- -----------------------------------------------------------------------------
revoke all on function
  public._import_row_cap(), public._import_assert_admin(), public._import_layers(jsonb, text[], text[]),
  public._import_validate_structure(jsonb, int), public._import_safe_icon(text), public._import_safe_color(text),
  public._import_lock_batch(uuid), public._import_build_diff(uuid, uuid, text[]),
  public._import_create_nodes(uuid, jsonb, uuid, text[], boolean), public.purge_layer_import_data()
  from public, anon, authenticated;
grant execute on function public.purge_layer_import_data() to service_role;

revoke all on function
  public.layer_import_limits(), public.create_layer_import(text, text, jsonb, int), public.finish_layer_import_staging(uuid),
  public.discard_layer_import(uuid), public.preview_layer_import(uuid, text, uuid, text[]),
  public.commit_layer_import(uuid, text, uuid, text[]), public.revert_layer_import(uuid)
  from public, anon;
grant execute on function
  public.layer_import_limits(), public.create_layer_import(text, text, jsonb, int), public.finish_layer_import_staging(uuid),
  public.discard_layer_import(uuid), public.preview_layer_import(uuid, text, uuid, text[]),
  public.commit_layer_import(uuid, text, uuid, text[]), public.revert_layer_import(uuid)
  to authenticated, service_role;

insert into public._migration_log (sprint, notes) values ('layer_import_v1', 'done');
