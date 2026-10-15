-- =============================================================================
-- Pruebas de la Fase 4 (importador). NO es una migración.
-- =============================================================================
-- NOTA (Fase 5): esta suite comprueba el espejo hacia `territorial_layer_groups` y se corre ANTES de
-- 20261015000000_retire_legacy_layer_tables.sql. Después del retiro, la que vale es legacy_retired.sql.
-- Se corre DESPUÉS de las migraciones de las Fases 1, 3 y 4, en la MISMA transacción
-- y terminando en error para que nada quede aplicado:
--
--   <20261014190000_layer_import.sql>      (aplicarla dos veces prueba la idempotencia)
--   <este archivo>
--   do $$ begin raise exception 'DRYRUN_OK %', (select jsonb_agg(name order by seq) from _tr); end $$;
--
-- Todo lo que crea son capas de prueba de <= 20 puntos: no reescribe tablas grandes.
-- =============================================================================

create temp table _tr (seq serial primary key, name text not null, detail text);
grant all on _tr to public;
grant all on sequence _tr_seq_seq to public;

create or replace function pg_temp.assert_that(p_name text, p_cond boolean, p_detail text default null)
returns void language plpgsql as $$
begin
  if p_cond is not true then
    raise exception 'FAIL [%]: %', p_name, coalesce(p_detail, 'condición falsa');
  end if;
  insert into _tr (name, detail) values (p_name, p_detail);
end $$;

create or replace function pg_temp.try_sql(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate;
end $$;

create or replace function pg_temp.set_user(p_uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create or replace function pg_temp.reset_user()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Capa heredada con puntos explícitos: rows = [{ext, name, lat, lng, props}]
create or replace function pg_temp.mk_layer(p_group uuid, p_name text, p_rows jsonb default '[]')
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into public.territorial_layers (id, group_id, name, feature_count) values (v, p_group, p_name, jsonb_array_length(p_rows));
  insert into public.territorial_features (layer_id, external_id, name, lat, lng, geometry, properties)
  select v, r ->> 'ext', r ->> 'name', (r ->> 'lat')::float8, (r ->> 'lng')::float8,
         jsonb_build_object('type', 'Point', 'coordinates', jsonb_build_array((r ->> 'lng')::float8, (r ->> 'lat')::float8)),
         coalesce(r -> 'props', '{}'::jsonb)
    from jsonb_array_elements(p_rows) r;
  return v;
end $$;

-- Sube puntos a un lote (como lo haría el cliente) para una capa del archivo.
create or replace function pg_temp.stage(p_import uuid, p_key text, p_rows jsonb)
returns void language plpgsql as $$
begin
  insert into public.territorial_import_staging (import_id, layer_key, seq, external_id, name, lat, lng, geometry, properties)
  select p_import, p_key, (t.ord - 1)::int, t.r ->> 'ext', t.r ->> 'name', (t.r ->> 'lat')::float8, (t.r ->> 'lng')::float8,
         jsonb_build_object('type', 'Point', 'coordinates', jsonb_build_array((t.r ->> 'lng')::float8, (t.r ->> 'lat')::float8)),
         coalesce(t.r -> 'props', '{}'::jsonb)
    from jsonb_array_elements(p_rows) with ordinality as t(r, ord);
end $$;

-- n puntos "P1..Pn" cerca de Santiago, con external_id opcional ("<prefix>1"...).
create or replace function pg_temp.pts(n int, prefix text default null, lat0 float8 default -33.4)
returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('ext', case when prefix is not null then prefix || i end,
         'name', 'P' || i, 'lat', round((lat0 - i * 0.01)::numeric, 2), 'lng', round((-70.6 - i * 0.01)::numeric, 2)) order by i), '[]'::jsonb)
    from generate_series(1, n) i;
$$;

-- Estado de una capa como texto comparable (sin ids de lote).
create or replace function pg_temp.layer_fingerprint(p_layer uuid)
returns text language sql as $$
  select coalesce(md5(string_agg(concat_ws('|', id::text, coalesce(external_id, '∅'), coalesce(name, '∅'), lat::text, lng::text, geometry::text, properties::text), E'\n' order by id)), 'vacía')
    from public.territorial_features where layer_id = p_layer;
$$;

select set_config('app.admin_uid', (select user_id::text from public.user_roles where role = 'admin' limit 1), true);
select set_config('app.user_b', gen_random_uuid()::text, true);
insert into auth.users (id, instance_id, aud, role, email)
values (current_setting('app.user_b')::uuid, '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'layer-import-' || current_setting('app.user_b') || '@example.invalid');

select set_config('app.n_groups', (select count(*) from public.territorial_layer_groups)::text, true);
select set_config('app.n_layers', (select count(*) from public.territorial_layers)::text, true);
select set_config('app.n_feats',  (select count(*) from public.territorial_features)::text, true);

-- Carpeta raíz de pruebas (la crea un admin: arma su grupo heredado)
do $$
declare v public.layer_nodes;
begin
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  select * into v from public.create_folder(null, 'IMPORT TEST');
  perform pg_temp.reset_user();
  perform set_config('app.root', v.id::text, true);
end $$;

-- -----------------------------------------------------------------------------
-- I1. Permisos y validación del lote
-- -----------------------------------------------------------------------------
do $$
declare v_state text; v_id uuid; v_struct jsonb := '{"key":"0","kind":"layer","name":"A","count":2}'::jsonb;
begin
  perform pg_temp.set_user(current_setting('app.user_b')::uuid);
  v_state := pg_temp.try_sql(format('select public.create_layer_import(%L, %L, %L::jsonb, 2)', 'a.csv', 'csv', v_struct));
  perform pg_temp.assert_that('I1 un usuario sin rol no crea lotes', v_state = '42501', v_state);
  perform pg_temp.reset_user();
  v_state := pg_temp.try_sql(format('select public.create_layer_import(%L, %L, %L::jsonb, 2)', 'a.csv', 'csv', v_struct));
  perform pg_temp.assert_that('I1 sin sesión tampoco', v_state = '42501', v_state);

  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  v_state := pg_temp.try_sql(format('select public.create_layer_import(%L, %L, %L::jsonb, 5)', 'a.csv', 'csv', v_struct));
  perform pg_temp.assert_that('I1 el total declarado debe cuadrar con la estructura', v_state = '22023', v_state);
  v_state := pg_temp.try_sql(format('select public.create_layer_import(%L, %L, %L::jsonb, 0)', 'a.csv', 'csv', '{"key":"0","kind":"carpeta","name":"x"}'));
  perform pg_temp.assert_that('I1 una estructura mal formada se rechaza', v_state = '22023', v_state);
  v_state := pg_temp.try_sql(format('select public.create_layer_import(%L, %L, %L::jsonb, 2)', 'a.shp', 'shp', v_struct));
  perform pg_temp.assert_that('I1 un formato desconocido se rechaza', v_state = '23514', v_state);
  v_id := public.create_layer_import('a.csv', 'csv', v_struct, 2);
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('I1 un admin crea el lote en preparación',
    (select status from public.territorial_import_batches where id = v_id) = 'staging');

  -- el lote es del admin: otro usuario no lo ve ni lo toca
  perform pg_temp.set_user(current_setting('app.user_b')::uuid);
  perform pg_temp.assert_that('I1 otro usuario no ve el lote (RLS)', (select count(*) from public.territorial_import_batches) = 0);
  v_state := pg_temp.try_sql(format('select public.commit_layer_import(%L, %L, null)', v_id, 'new'));
  perform pg_temp.assert_that('I1 ni lo confirma', v_state = '42501', v_state);
  perform pg_temp.reset_user();
end $$;

-- -----------------------------------------------------------------------------
-- I2. Límite de tamaño según el timeout vigente
-- -----------------------------------------------------------------------------
do $$
declare v int;
begin
  set local statement_timeout = '8s';
  perform pg_temp.assert_that('I2 con 8 s caben 5.600 puntos', (public.layer_import_limits() ->> 'max_rows')::int = 5600);
  set local statement_timeout = '30s';
  perform pg_temp.assert_that('I2 con 30 s sube solo a 21.000', (public.layer_import_limits() ->> 'max_rows')::int = 21000);
  set local statement_timeout = '100ms';
  perform pg_temp.assert_that('I2 con un timeout mínimo hay un piso de 50', (public.layer_import_limits() ->> 'max_rows')::int = 70);
  set local statement_timeout = 0;
  perform pg_temp.assert_that('I2 sin timeout, el tope es 100.000', (public.layer_import_limits() ->> 'max_rows')::int = 100000);
  set local statement_timeout = '5min';
end $$;

-- -----------------------------------------------------------------------------
-- I3. Subida (staging) y cierre
-- -----------------------------------------------------------------------------
do $$
declare v_id uuid; v_state text;
begin
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  v_id := public.create_layer_import('a.csv', 'csv', '{"key":"0","kind":"layer","name":"A","count":3}'::jsonb, 3);
  -- el cliente sube con INSERT directo (RLS)
  insert into public.territorial_import_staging (import_id, layer_key, seq, external_id, name, lat, lng, geometry)
  select v_id, '0', i, null, 'P' || i, -33.4, -70.6, '{"type":"Point","coordinates":[-70.6,-33.4]}'::jsonb from generate_series(0, 1) i;
  v_state := pg_temp.try_sql(format('select public.finish_layer_import_staging(%L)', v_id));
  perform pg_temp.assert_that('I3 cerrar con puntos de menos falla', v_state = '23514', v_state);
  insert into public.territorial_import_staging (import_id, layer_key, seq, name, lat, lng, geometry)
  values (v_id, '0', 2, 'P2', -33.4, -70.6, '{"type":"Point","coordinates":[-70.6,-33.4]}'::jsonb);
  perform pg_temp.assert_that('I3 con todos los puntos cierra y devuelve cuántos', public.finish_layer_import_staging(v_id) = 3);
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('I3 queda registrado', (select staged_total from public.territorial_import_batches where id = v_id) = 3);

  -- otro usuario no puede subir puntos a un lote ajeno
  perform pg_temp.set_user(current_setting('app.user_b')::uuid);
  v_state := pg_temp.try_sql(format('insert into public.territorial_import_staging (import_id, layer_key, seq, name, lat, lng, geometry) values (%L, %L, 9, %L, 0, 0, %L::jsonb)',
    v_id, '0', 'x', '{"type":"Point","coordinates":[0,0]}'));
  perform pg_temp.assert_that('I3 no se sube a un lote ajeno', v_state = '42501', v_state);
  perform pg_temp.reset_user();

  -- discard borra el lote y sus puntos
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  perform public.discard_layer_import(v_id);
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('I3 descartar borra lote y puntos',
    not exists (select 1 from public.territorial_import_batches where id = v_id)
    and not exists (select 1 from public.territorial_import_staging where import_id = v_id));
end $$;

-- -----------------------------------------------------------------------------
-- I4. Modo "nueva capa": carpetas y capas en el orden del archivo
-- -----------------------------------------------------------------------------
do $$
declare
  v_root uuid := current_setting('app.root')::uuid; v_id uuid; v_res jsonb; v_prev jsonb; v_top uuid; v_a uuid; v_sub uuid; v_b uuid; v_n int;
  v_existing uuid;
  v_struct jsonb := $j$ {"key":"0","kind":"folder","name":"Archivo","children":[
      {"key":"0.0","kind":"layer","name":"A","color":"#10B981","icon":"https://x.test/i.png","count":3},
      {"key":"0.1","kind":"folder","name":"Sub","children":[
          {"key":"0.1.0","kind":"layer","name":"B","color":"verde","icon":"data:image/png;base64,AAAA","count":2},
          {"key":"0.1.1","kind":"layer","name":"C","count":1}]},
      {"key":"0.2","kind":"layer","name":"D","count":4}]} $j$;
begin
  -- ya existe una capa "A" en el mismo grupo: la nueva debe desambiguarse
  v_existing := pg_temp.mk_layer(v_root, 'A', pg_temp.pts(1));
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  v_id := public.create_layer_import('archivo.kmz', 'kmz', v_struct, 10);
  perform pg_temp.reset_user();
  perform pg_temp.stage(v_id, '0.0', pg_temp.pts(3, 'a'));
  perform pg_temp.stage(v_id, '0.1.0', pg_temp.pts(2, 'b'));
  perform pg_temp.stage(v_id, '0.1.1', pg_temp.pts(1, 'c'));
  perform pg_temp.stage(v_id, '0.2', pg_temp.pts(4, 'd'));
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  perform public.finish_layer_import_staging(v_id);

  v_prev := public.preview_layer_import(v_id, 'new', v_root);
  perform pg_temp.assert_that('I4 la vista previa cuenta carpetas, capas y puntos',
    (v_prev -> 'new' ->> 'folders')::int = 2 and (v_prev -> 'new' ->> 'layers')::int = 4 and (v_prev -> 'new' ->> 'features')::int = 10
    and (v_prev ->> 'fits')::boolean, v_prev::text);

  v_res := public.commit_layer_import(v_id, 'new', v_root);
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('I4 devuelve lo creado', (v_res ->> 'folders')::int = 2 and (v_res ->> 'layers')::int = 4 and (v_res ->> 'features')::int = 10, v_res::text);

  select id into v_top from public.layer_nodes where parent_id = v_root and name = 'Archivo';
  perform pg_temp.assert_that('I4 la carpeta del archivo cuelga del destino', v_top is not null and v_res -> 'root_node_ids' = jsonb_build_array(v_top::text));
  perform pg_temp.assert_that('I4 respeta el orden del archivo (A, Sub, D)',
    (select array_agg(name order by position collate "C") from public.layer_nodes where parent_id = v_top) = array['A (copia)', 'Sub', 'D']);
  select id into v_sub from public.layer_nodes where parent_id = v_top and name = 'Sub';
  perform pg_temp.assert_that('I4 y dentro de la subcarpeta (B, C)',
    (select array_agg(name order by position collate "C") from public.layer_nodes where parent_id = v_sub) = array['B', 'C']);
  select id into v_a from public.layer_nodes where parent_id = v_top and name = 'A (copia)';
  select id into v_b from public.layer_nodes where parent_id = v_sub and name = 'B';

  perform pg_temp.assert_that('I4 una capa con el mismo nombre en el grupo se renombra', exists (select 1 from public.territorial_layers where id = v_a and name = 'A (copia)' and source_name = 'A'));
  perform pg_temp.assert_that('I4 las capas heredadas cuelgan del grupo raíz de pruebas',
    (select count(*) from public.territorial_layers where group_id = v_root and id in (select id from public.layer_nodes where kind = 'layer')) >= 5);
  perform pg_temp.assert_that('I4 puntos y conteos', (select feature_count from public.territorial_layers where id = v_a) = 3
    and (select count(*) from public.territorial_features where layer_id = v_a and geom is not null) = 3);
  perform pg_temp.assert_that('I4 color e ícono válidos se guardan',
    (select style ->> 'color' from public.layer_nodes where id = v_a) = '#10b981' and (select style ->> 'icon' from public.layer_nodes where id = v_a) = 'https://x.test/i.png');
  perform pg_temp.assert_that('I4 un color inválido se descarta y un ícono data: chico se conserva',
    not ((select style from public.layer_nodes where id = v_b) ? 'color') and (select style ->> 'icon' from public.layer_nodes where id = v_b) = 'data:image/png;base64,AAAA');
  perform pg_temp.assert_that('I4 el lote queda confirmado', (select status || '/' || mode from public.territorial_import_batches where id = v_id) = 'committed/new');

  select count(*) into v_n from public.territorial_import_changes where import_id = v_id;
  perform pg_temp.assert_that('I4 el modo nuevo no necesita registro de cambios', v_n = 0);

  -- no se puede confirmar dos veces
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  perform pg_temp.assert_that('I4 confirmar de nuevo falla', pg_temp.try_sql(format('select public.commit_layer_import(%L, %L, %L)', v_id, 'new', v_root)) = '23514');
  perform pg_temp.reset_user();
  perform set_config('app.i4_batch', v_id::text, true);
  perform set_config('app.i4_top', v_top::text, true);
end $$;

-- -----------------------------------------------------------------------------
-- I5. Exclusiones, sin destino y archivo de una sola capa
-- -----------------------------------------------------------------------------
do $$
declare
  v_root uuid := current_setting('app.root')::uuid; v_id uuid; v_res jsonb; v_top uuid;
  v_struct jsonb := $j$ {"key":"0","kind":"folder","name":"Con exclusiones","children":[
      {"key":"0.0","kind":"layer","name":"Queda","count":2},
      {"key":"0.1","kind":"folder","name":"Se va","children":[{"key":"0.1.0","kind":"layer","name":"Fuera","count":3}]},
      {"key":"0.10","kind":"layer","name":"Diez","count":1}]} $j$;
begin
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  v_id := public.create_layer_import('x.kml', 'kml', v_struct, 6);
  perform pg_temp.reset_user();
  perform pg_temp.stage(v_id, '0.0', pg_temp.pts(2));
  perform pg_temp.stage(v_id, '0.1.0', pg_temp.pts(3));
  perform pg_temp.stage(v_id, '0.10', pg_temp.pts(1));
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  perform public.finish_layer_import_staging(v_id);
  -- excluir "0.1" no excluye "0.10"
  v_res := public.commit_layer_import(v_id, 'new', null, array['0.1']);
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('I5 sin destino crea una carpeta raíz con el nombre del archivo',
    exists (select 1 from public.layer_nodes where parent_id is null and name = 'Con exclusiones'));
  select id into v_top from public.layer_nodes where parent_id is null and name = 'Con exclusiones';
  perform pg_temp.assert_that('I5 lo excluido no se crea (ni su carpeta) pero "0.10" sí',
    (select array_agg(name order by position collate "C") from public.layer_nodes where parent_id = v_top) = array['Queda', 'Diez']
    and (v_res ->> 'features')::int = 3 and (v_res ->> 'folders')::int = 1);
  perform pg_temp.assert_that('I5 la raíz nueva tiene su grupo heredado', exists (select 1 from public.territorial_layer_groups where id = v_top));

  -- archivo de una sola capa sin destino: se crea una carpeta con el nombre del archivo
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  v_id := public.create_layer_import('Bencineras.csv', 'csv', '{"key":"0","kind":"layer","name":"Puntos","count":2}'::jsonb, 2);
  perform pg_temp.reset_user();
  perform pg_temp.stage(v_id, '0', pg_temp.pts(2));
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  perform public.finish_layer_import_staging(v_id);
  v_res := public.commit_layer_import(v_id, 'new');
  perform pg_temp.reset_user();
  select id into v_top from public.layer_nodes where parent_id is null and name = 'Bencineras';
  perform pg_temp.assert_that('I5 una capa suelta sin destino queda dentro de una carpeta con el nombre del archivo',
    v_top is not null and exists (select 1 from public.layer_nodes where parent_id = v_top and name = 'Puntos' and kind = 'layer')
    and v_res -> 'root_node_ids' = jsonb_build_array(v_top::text));

  -- y con destino va directo adentro
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  v_id := public.create_layer_import('otra.csv', 'csv', '{"key":"0","kind":"layer","name":"Directa","count":1}'::jsonb, 1);
  perform pg_temp.reset_user();
  perform pg_temp.stage(v_id, '0', pg_temp.pts(1));
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  perform public.finish_layer_import_staging(v_id);
  v_res := public.commit_layer_import(v_id, 'new', v_root);
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('I5 una capa suelta con destino va directo a esa carpeta',
    exists (select 1 from public.layer_nodes where parent_id = v_root and name = 'Directa' and kind = 'layer')
    and jsonb_array_length(v_res -> 'root_node_ids') = 1);

  -- nada incluido
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  v_id := public.create_layer_import('vacio.csv', 'csv', '{"key":"0","kind":"layer","name":"V","count":1}'::jsonb, 1);
  perform pg_temp.reset_user();
  perform pg_temp.stage(v_id, '0', pg_temp.pts(1));
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  perform public.finish_layer_import_staging(v_id);
  perform pg_temp.assert_that('I5 excluirlo todo falla con un mensaje', pg_temp.try_sql(format('select public.commit_layer_import(%L, %L, %L, array[%L])', v_id, 'new', v_root, '0')) = '23514');
  perform pg_temp.assert_that('I5 la vista previa lo marca vacío', (public.preview_layer_import(v_id, 'new', v_root, array['0']) ->> 'empty')::boolean);
  perform pg_temp.reset_user();
end $$;

-- -----------------------------------------------------------------------------
-- I6. Tope de tamaño: un cambio demasiado grande no deja nada a medias
-- -----------------------------------------------------------------------------
do $$
declare v_root uuid := current_setting('app.root')::uuid; v_id uuid; v_state text; v_before int; v_ctx text;
begin
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  v_id := public.create_layer_import('grande.csv', 'csv', '{"key":"0","kind":"layer","name":"Grande","count":80}'::jsonb, 80);
  perform pg_temp.reset_user();
  perform pg_temp.stage(v_id, '0', pg_temp.pts(80));
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  perform public.finish_layer_import_staging(v_id);
  perform pg_temp.reset_user();
  select count(*) into v_before from public.layer_nodes;

  set local statement_timeout = '100ms';   -- tope 70
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  perform pg_temp.assert_that('I6 la vista previa avisa que no cabe', not (public.preview_layer_import(v_id, 'new', v_root) ->> 'fits')::boolean);
  v_state := pg_temp.try_sql(format('select public.commit_layer_import(%L, %L, %L)', v_id, 'new', v_root));
  perform pg_temp.reset_user();
  set local statement_timeout = '5min';
  perform pg_temp.assert_that('I6 confirmar más del tope falla', v_state = '23514', v_state);
  perform pg_temp.assert_that('I6 y no se creó nada', (select count(*) from public.layer_nodes) = v_before
    and (select status from public.territorial_import_batches where id = v_id) = 'staging');
end $$;

-- -----------------------------------------------------------------------------
-- I7. Reemplazar: diff por external_id, por ubicación+nombre, y solo se escribe lo que cambia
-- -----------------------------------------------------------------------------
do $$
declare
  v_root uuid := current_setting('app.root')::uuid; v_layer uuid; v_id uuid; v_prev jsonb; v_res jsonb;
  v_ids_before jsonb; v_fp_before text; v_rows jsonb;
begin
  -- capa existente: 8 puntos con id, 2 sin id
  v_rows := pg_temp.pts(8, 'e') || jsonb_build_array(
      jsonb_build_object('name', 'Sin id 1', 'lat', -40.0, 'lng', -71.0),
      jsonb_build_object('name', 'Sin id 2', 'lat', -41.0, 'lng', -72.0));
  v_layer := pg_temp.mk_layer(v_root, 'Capa a reemplazar', v_rows);
  select jsonb_object_agg(external_id, id) into v_ids_before from public.territorial_features where layer_id = v_layer and external_id is not null;
  v_fp_before := pg_temp.layer_fingerprint(v_layer);

  -- archivo: e1 igual · e2 cambia el nombre · e3 cambia la ubicación · e4 cambia atributos · e5..e8 desaparecen
  --          "Sin id 1" igual (misma ubicación y nombre) · "Sin id 2" desaparece · 2 puntos nuevos (n1, y uno sin id)
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  v_id := public.create_layer_import('act.kml', 'kml', '{"key":"0","kind":"layer","name":"X","count":8}'::jsonb, 8);
  perform pg_temp.reset_user();
  perform pg_temp.stage(v_id, '0', jsonb_build_array(
    (pg_temp.pts(8, 'e') -> 0),                                                                    -- e1 igual
    (pg_temp.pts(8, 'e') -> 1) || '{"name":"Nombre nuevo"}',                                       -- e2 nombre
    (pg_temp.pts(8, 'e') -> 2) || '{"lat":-30.0,"lng":-60.0}',                                     -- e3 ubicación
    (pg_temp.pts(8, 'e') -> 3) || '{"props":{"nuevo":"dato"}}',                                    -- e4 atributos
    jsonb_build_object('name', 'Sin id 1', 'lat', -40.0, 'lng', -71.0),                            -- igual por ubicación+nombre
    jsonb_build_object('ext', 'n1', 'name', 'Nuevo 1', 'lat', -35.0, 'lng', -71.5),                -- agregado
    jsonb_build_object('name', 'Nuevo sin id', 'lat', -36.0, 'lng', -71.6),                        -- agregado
    jsonb_build_object('ext', 'n1', 'name', 'Repetido', 'lat', -37.0, 'lng', -71.7)));             -- mismo id dentro del archivo
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  perform public.finish_layer_import_staging(v_id);

  v_prev := public.preview_layer_import(v_id, 'replace', v_layer);
  perform pg_temp.assert_that('I7 el diff cuenta agregadas, eliminadas, modificadas y sin cambio',
    (v_prev -> 'diff' ->> 'added')::int = 3 and (v_prev -> 'diff' ->> 'removed')::int = 5
    and (v_prev -> 'diff' ->> 'modified')::int = 3 and (v_prev -> 'diff' ->> 'unchanged')::int = 2, (v_prev -> 'diff')::text);
  perform pg_temp.assert_that('I7 distingue cómo se emparejó cada uno',
    (v_prev -> 'diff' ->> 'matched_by_external_id')::int = 4 and (v_prev -> 'diff' ->> 'matched_by_coords')::int = 1, (v_prev -> 'diff')::text);
  perform pg_temp.assert_that('I7 solo se escribe lo que cambia (3+3+5 = 11 de 10 existentes + 8 del archivo)',
    (v_prev -> 'diff' ->> 'rows_to_write')::int = 11, (v_prev -> 'diff')::text);
  perform pg_temp.assert_that('I7 las muestras traen nombres y qué cambió',
    v_prev -> 'diff' -> 'samples' -> 'modified' @> '[{"name":"Nombre nuevo","changed":["name"]}]'::jsonb
    and v_prev -> 'diff' -> 'samples' -> 'modified' @> '[{"changed":["location"]}]'::jsonb
    and v_prev -> 'diff' -> 'samples' -> 'modified' @> '[{"changed":["attributes"]}]'::jsonb, (v_prev -> 'diff' -> 'samples')::text);
  perform pg_temp.assert_that('I7 la vista previa no escribe nada', pg_temp.layer_fingerprint(v_layer) = v_fp_before);

  v_res := public.commit_layer_import(v_id, 'replace', v_layer);
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('I7 el resultado informa el diff', (v_res ->> 'added')::int = 3 and (v_res ->> 'removed')::int = 5 and (v_res ->> 'modified')::int = 3, v_res::text);
  perform pg_temp.assert_that('I7 la capa queda con lo del archivo (8 puntos)',
    (select count(*) from public.territorial_features where layer_id = v_layer) = 8 and (select feature_count from public.territorial_layers where id = v_layer) = 8);
  perform pg_temp.assert_that('I7 los puntos emparejados conservan su id (se actualizan, no se recrean)',
    (select id from public.territorial_features where layer_id = v_layer and external_id = 'e2')::text = v_ids_before ->> 'e2'
    and (select id from public.territorial_features where layer_id = v_layer and external_id = 'e1')::text = v_ids_before ->> 'e1');
  perform pg_temp.assert_that('I7 lo modificado quedó como el archivo',
    (select name from public.territorial_features where layer_id = v_layer and external_id = 'e2') = 'Nombre nuevo'
    and (select lat from public.territorial_features where layer_id = v_layer and external_id = 'e3') = -30.0
    and (select properties ->> 'nuevo' from public.territorial_features where layer_id = v_layer and external_id = 'e4') = 'dato'
    and (select geom is not null from public.territorial_features where layer_id = v_layer and external_id = 'e3'));
  perform pg_temp.assert_that('I7 lo que ya no está se eliminó y lo nuevo se agregó',
    not exists (select 1 from public.territorial_features where layer_id = v_layer and external_id in ('e5', 'e6', 'e7', 'e8'))
    and not exists (select 1 from public.territorial_features where layer_id = v_layer and name = 'Sin id 2')
    and exists (select 1 from public.territorial_features where layer_id = v_layer and external_id = 'n1' and name = 'Nuevo 1')
    and exists (select 1 from public.territorial_features where layer_id = v_layer and name = 'Nuevo sin id'));
  perform pg_temp.assert_that('I7 un id repetido en el archivo se conserva solo en el primero (sin romper el único)',
    exists (select 1 from public.territorial_features where layer_id = v_layer and name = 'Repetido' and external_id is null));
  perform pg_temp.assert_that('I7 el registro de cambios guarda el estado anterior de lo tocado',
    (select count(*) from public.territorial_import_changes where import_id = v_id and change = 'added') = 3
    and (select count(*) from public.territorial_import_changes where import_id = v_id and change = 'removed') = 5
    and (select count(*) from public.territorial_import_changes where import_id = v_id and change = 'modified') = 3
    and (select old_row ->> 'name' from public.territorial_import_changes where import_id = v_id and change = 'modified' and old_row ->> 'external_id' = 'e2') = 'P2');

  perform set_config('app.i7_batch', v_id::text, true);
  perform set_config('app.i7_layer', v_layer::text, true);
  perform set_config('app.i7_fp', v_fp_before, true);
end $$;

-- -----------------------------------------------------------------------------
-- I8. Volver atrás una importación
-- -----------------------------------------------------------------------------
do $$
declare v_id uuid := current_setting('app.i7_batch')::uuid; v_layer uuid := current_setting('app.i7_layer')::uuid; v_res jsonb; v_id2 uuid;
begin
  -- una importación posterior sobre la misma capa impide revertir la anterior
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  v_id2 := public.create_layer_import('otra.kml', 'kml', '{"key":"0","kind":"layer","name":"X","count":1}'::jsonb, 1);
  perform pg_temp.reset_user();
  perform pg_temp.stage(v_id2, '0', jsonb_build_array(jsonb_build_object('ext', 'zz', 'name', 'Z', 'lat', -33.0, 'lng', -70.0)));
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  perform public.finish_layer_import_staging(v_id2);
  perform public.commit_layer_import(v_id2, 'append', v_layer);
  perform pg_temp.assert_that('I8 no se revierte una importación si hay otra posterior sobre la capa',
    pg_temp.try_sql(format('select public.revert_layer_import(%L)', v_id)) = '23514');
  v_res := public.revert_layer_import(v_id2);
  perform pg_temp.assert_that('I8 la última sí: quita lo agregado', (v_res ->> 'removed_added')::int = 1 and not exists (select 1 from public.territorial_features where layer_id = v_layer and external_id = 'zz'));
  v_res := public.revert_layer_import(v_id);
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('I8 revertir devuelve la capa EXACTAMENTE como estaba (mismos ids y datos)',
    pg_temp.layer_fingerprint(v_layer) = current_setting('app.i7_fp'), v_res::text);
  perform pg_temp.assert_that('I8 y el conteo vuelve a 10', (select feature_count from public.territorial_layers where id = v_layer) = 10);
  perform pg_temp.assert_that('I8 el lote queda revertido y no se revierte dos veces',
    (select status from public.territorial_import_batches where id = v_id) = 'reverted'
    and pg_temp.try_sql(format('select public.revert_layer_import(%L)', v_id)) in ('23514', '42501'));
end $$;

-- -----------------------------------------------------------------------------
-- I9. Agregar: suma y actualiza, nunca borra
-- -----------------------------------------------------------------------------
do $$
declare v_root uuid := current_setting('app.root')::uuid; v_layer uuid; v_id uuid; v_prev jsonb; v_res jsonb;
begin
  v_layer := pg_temp.mk_layer(v_root, 'Capa a la que agregar', pg_temp.pts(5, 'a'));
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  v_id := public.create_layer_import('mas.csv', 'csv', '{"key":"0","kind":"layer","name":"X","count":3}'::jsonb, 3);
  perform pg_temp.reset_user();
  perform pg_temp.stage(v_id, '0', jsonb_build_array(
    (pg_temp.pts(5, 'a') -> 0) || '{"name":"Cambiado"}',
    jsonb_build_object('ext', 'nuevo', 'name', 'Nuevo', 'lat', -34.0, 'lng', -71.0),
    (pg_temp.pts(5, 'a') -> 1)));
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  perform public.finish_layer_import_staging(v_id);
  v_prev := public.preview_layer_import(v_id, 'append', v_layer);
  perform pg_temp.assert_that('I9 en agregar, lo que falta en el archivo se "conserva" y no se escribe',
    (v_prev -> 'diff' ->> 'added')::int = 1 and (v_prev -> 'diff' ->> 'modified')::int = 1 and (v_prev -> 'diff' ->> 'unchanged')::int = 1
    and (v_prev -> 'diff' ->> 'kept')::int = 3 and (v_prev -> 'diff' ->> 'rows_to_write')::int = 2, (v_prev -> 'diff')::text);
  v_res := public.commit_layer_import(v_id, 'append', v_layer);
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('I9 no borró nada', (v_res ->> 'removed')::int = 0 and (select count(*) from public.territorial_features where layer_id = v_layer) = 6);
  perform pg_temp.assert_that('I9 actualizó y agregó',
    (select name from public.territorial_features where layer_id = v_layer and external_id = 'a1') = 'Cambiado'
    and exists (select 1 from public.territorial_features where layer_id = v_layer and external_id = 'nuevo'));

  -- emparejar por ubicación+nombre es 1 a 1: duplicados idénticos no se pierden ni se cruzan
  v_layer := pg_temp.mk_layer(v_root, 'Capa con duplicados', jsonb_build_array(
    jsonb_build_object('name', 'Igual', 'lat', -33.1, 'lng', -70.1), jsonb_build_object('name', 'Igual', 'lat', -33.1, 'lng', -70.1)));
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  v_id := public.create_layer_import('dup.csv', 'csv', '{"key":"0","kind":"layer","name":"X","count":3}'::jsonb, 3);
  perform pg_temp.reset_user();
  perform pg_temp.stage(v_id, '0', jsonb_build_array(
    jsonb_build_object('name', 'Igual', 'lat', -33.1, 'lng', -70.1), jsonb_build_object('name', 'Igual', 'lat', -33.1, 'lng', -70.1),
    jsonb_build_object('name', 'Igual', 'lat', -33.1, 'lng', -70.1)));
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  perform public.finish_layer_import_staging(v_id);
  v_prev := public.preview_layer_import(v_id, 'replace', v_layer);
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('I9 dos iguales + uno extra: 2 sin cambio y 1 agregado',
    (v_prev -> 'diff' ->> 'unchanged')::int = 2 and (v_prev -> 'diff' ->> 'added')::int = 1 and (v_prev -> 'diff' ->> 'removed')::int = 0, (v_prev -> 'diff')::text);
end $$;

-- -----------------------------------------------------------------------------
-- I10. Revertir una importación nueva manda lo creado a la papelera
-- -----------------------------------------------------------------------------
do $$
declare v_id uuid := current_setting('app.i4_batch')::uuid; v_top uuid := current_setting('app.i4_top')::uuid; v_res jsonb;
begin
  perform pg_temp.assert_that('I10 antes de revertir lo creado se ve', exists (select 1 from public.territorial_layers_active where name = 'B'));
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  v_res := public.revert_layer_import(v_id);
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('I10 la carpeta importada y todo lo que contiene van a la papelera',
    (select archived_at is not null from public.layer_nodes where id = v_top)
    and not exists (select 1 from public.layer_nodes where archived_at is null and parent_id = v_top)
    and not exists (select 1 from public.territorial_layers_active where name in ('B', 'C', 'D', 'A (copia)')), v_res::text);
  perform pg_temp.assert_that('I10 y se puede restaurar (no se borró nada)',
    (select count(*) from public.territorial_features f join public.layer_nodes n on n.id = f.layer_id where n.archived_at is not null and n.name = 'D') = 4);
end $$;

-- -----------------------------------------------------------------------------
-- I11. Destinos inválidos y permisos de confirmación
-- -----------------------------------------------------------------------------
do $$
declare v_root uuid := current_setting('app.root')::uuid; v_id uuid; v_layer uuid; v_state text;
begin
  v_layer := pg_temp.mk_layer(v_root, 'Destino', pg_temp.pts(2));
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  v_id := public.create_layer_import('x.csv', 'csv', '{"key":"0","kind":"layer","name":"X","count":1}'::jsonb, 1);
  perform pg_temp.reset_user();
  perform pg_temp.stage(v_id, '0', pg_temp.pts(1));
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  perform public.finish_layer_import_staging(v_id);
  v_state := pg_temp.try_sql(format('select public.commit_layer_import(%L, %L, %L)', v_id, 'replace', v_root));
  perform pg_temp.assert_that('I11 reemplazar necesita una capa, no una carpeta', v_state = '23514', v_state);
  v_state := pg_temp.try_sql(format('select public.commit_layer_import(%L, %L, %L)', v_id, 'new', v_layer));
  perform pg_temp.assert_that('I11 una capa nueva necesita una carpeta de destino', v_state = '23514', v_state);
  v_state := pg_temp.try_sql(format('select public.commit_layer_import(%L, %L, null)', v_id, 'borrar'));
  perform pg_temp.assert_that('I11 un modo desconocido falla', v_state = '22023', v_state);
  perform public.archive_node(v_layer);
  v_state := pg_temp.try_sql(format('select public.commit_layer_import(%L, %L, %L)', v_id, 'replace', v_layer));
  perform pg_temp.assert_that('I11 una capa en la papelera no es destino', v_state = '23514', v_state);
  perform pg_temp.reset_user();

  -- sin cerrar la subida no se confirma
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  v_id := public.create_layer_import('y.csv', 'csv', '{"key":"0","kind":"layer","name":"Y","count":1}'::jsonb, 1);
  perform pg_temp.reset_user();
  perform pg_temp.stage(v_id, '0', pg_temp.pts(1));
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  v_state := pg_temp.try_sql(format('select public.commit_layer_import(%L, %L, %L)', v_id, 'new', v_root));
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('I11 sin cerrar la subida no se confirma', v_state = '23514', v_state);
end $$;

-- -----------------------------------------------------------------------------
-- I12. Limpieza
-- -----------------------------------------------------------------------------
do $$
declare v_id uuid; v_res jsonb; v_old uuid; v_open uuid;
begin
  v_id := current_setting('app.i4_batch')::uuid;                         -- confirmado y revertido (I10)
  update public.territorial_import_batches set created_at = now() - interval '2 hours' where id = v_id;
  perform pg_temp.assert_that('I12 hay puntos subidos de un lote ya cerrado', exists (select 1 from public.territorial_import_staging where import_id = v_id));
  v_res := public.purge_layer_import_data();
  perform pg_temp.assert_that('I12 la limpieza borra los puntos subidos de lotes cerrados (> 1 h)',
    not exists (select 1 from public.territorial_import_staging where import_id = v_id) and (v_res ->> 'staging_rows')::int >= 1, v_res::text);
  perform pg_temp.assert_that('I12 pero conserva el registro para poder deshacer', exists (select 1 from public.territorial_import_batches where id = v_id));

  insert into public.territorial_import_batches (created_by, filename, format, structure, feature_total, created_at)
  values (current_setting('app.admin_uid')::uuid, 'abandonado.csv', 'csv', '{"key":"0","kind":"layer","name":"A","count":0}', 0, now() - interval '25 hours') returning id into v_open;
  insert into public.territorial_import_batches (created_by, filename, format, structure, feature_total, status, created_at)
  values (current_setting('app.admin_uid')::uuid, 'viejo.csv', 'csv', '{"key":"0","kind":"layer","name":"A","count":0}', 0, 'committed', now() - interval '31 days') returning id into v_old;
  v_res := public.purge_layer_import_data();
  perform pg_temp.assert_that('I12 se descartan los lotes abandonados (> 24 h) y los registros viejos (> 30 días)',
    not exists (select 1 from public.territorial_import_batches where id in (v_open, v_old)), v_res::text);
  perform pg_temp.assert_that('I12 hay un job de limpieza cada hora',
    exists (select 1 from cron.job where jobname = 'purge-layer-import-data' and schedule = '17 * * * *'));
end $$;

-- -----------------------------------------------------------------------------
-- I13. Privilegios
-- -----------------------------------------------------------------------------
do $$
begin
  perform pg_temp.assert_that('I13 anon no ejecuta ninguna RPC del importador',
    not has_function_privilege('anon', 'public.create_layer_import(text,text,jsonb,int)', 'execute')
    and not has_function_privilege('anon', 'public.commit_layer_import(uuid,text,uuid,text[])', 'execute')
    and not has_function_privilege('anon', 'public.preview_layer_import(uuid,text,uuid,text[])', 'execute')
    and not has_function_privilege('anon', 'public.revert_layer_import(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.layer_import_limits()', 'execute'));
  perform pg_temp.assert_that('I13 authenticated ejecuta las públicas',
    has_function_privilege('authenticated', 'public.create_layer_import(text,text,jsonb,int)', 'execute')
    and has_function_privilege('authenticated', 'public.commit_layer_import(uuid,text,uuid,text[])', 'execute')
    and has_function_privilege('authenticated', 'public.revert_layer_import(uuid)', 'execute'));
  perform pg_temp.assert_that('I13 los auxiliares y la limpieza no son invocables por la API',
    not has_function_privilege('authenticated', 'public._import_build_diff(uuid,uuid,text[])', 'execute')
    and not has_function_privilege('authenticated', 'public._import_create_nodes(uuid,jsonb,uuid,text[],boolean)', 'execute')
    and not has_function_privilege('authenticated', 'public.purge_layer_import_data()', 'execute')
    and has_function_privilege('service_role', 'public.purge_layer_import_data()', 'execute'));
  perform pg_temp.assert_that('I13 las tablas no son legibles por anon',
    not has_table_privilege('anon', 'public.territorial_import_staging', 'select')
    and not has_table_privilege('anon', 'public.territorial_import_batches', 'select')
    and not has_table_privilege('anon', 'public.territorial_import_changes', 'select'));
end $$;

-- -----------------------------------------------------------------------------
-- I14. Lo real no se tocó
-- -----------------------------------------------------------------------------
do $$
declare v_g int; v_l int; v_f int;
begin
  select count(*) into v_g from public.territorial_layer_groups g where g.created_at < now() - interval '1 hour';
  select count(*) into v_l from public.territorial_layers l where l.created_at < now() - interval '1 hour';
  select count(*) into v_f from public.territorial_features f where f.created_at < now() - interval '1 hour';
  perform pg_temp.assert_that('I14 los grupos reales siguen todos', v_g = current_setting('app.n_groups')::int, v_g || ' vs ' || current_setting('app.n_groups'));
  perform pg_temp.assert_that('I14 las capas reales siguen todas', v_l = current_setting('app.n_layers')::int, v_l || ' vs ' || current_setting('app.n_layers'));
  perform pg_temp.assert_that('I14 los puntos reales siguen todos', v_f = current_setting('app.n_feats')::int, v_f || ' vs ' || current_setting('app.n_feats'));
end $$;
