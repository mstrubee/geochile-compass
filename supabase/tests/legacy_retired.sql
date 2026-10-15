-- =============================================================================
-- Pruebas posteriores al retiro de territorial_layer_groups y custom_layers. NO es una migración.
-- =============================================================================
-- Se corre DESPUÉS de 20261015000000_retire_legacy_layer_tables.sql, en la MISMA transacción y
-- terminando en error para que nada quede aplicado:
--
--   <20261015000000_retire_legacy_layer_tables.sql>   (dos veces: prueba la idempotencia)
--   <este archivo>
--   do $$ begin raise exception 'DRYRUN_OK %', (select jsonb_agg(name order by seq) from _tr); end $$;
--
-- Reemplaza, para el mundo sin grupos, lo que antes comprobaban layer_nodes*.sql sobre el espejo
-- de carpetas raíz (esas suites se corren ANTES del retiro). Todo lo que crea es chico (<= 5 puntos).
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

-- Capa escrita "a la antigua" (directo en territorial_layers): el puente le arma el nodo.
create or replace function pg_temp.mk_layer(p_group uuid, p_name text, p_n int default 0)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into public.territorial_layers (id, group_id, name, feature_count) values (v, p_group, p_name, p_n);
  insert into public.territorial_features (layer_id, name, lat, lng, geometry)
  select v, 'P' || i, round((-33.0 - i * 0.01)::numeric, 2)::float8, round((-70.0 - i * 0.01)::numeric, 2)::float8,
         jsonb_build_object('type', 'Point', 'coordinates', jsonb_build_array(
           round((-70.0 - i * 0.01)::numeric, 2)::float8, round((-33.0 - i * 0.01)::numeric, 2)::float8))
    from generate_series(1, p_n) i;
  return v;
end $$;

create or replace function pg_temp.stage(p_import uuid, p_key text, p_n int)
returns void language plpgsql as $$
begin
  insert into public.territorial_import_staging (import_id, layer_key, seq, external_id, name, lat, lng, geometry, properties)
  select p_import, p_key, i - 1, null, 'P' || i, round((-33.4 - i * 0.01)::numeric, 2)::float8, round((-70.6 - i * 0.01)::numeric, 2)::float8,
         jsonb_build_object('type', 'Point', 'coordinates', jsonb_build_array(
           round((-70.6 - i * 0.01)::numeric, 2)::float8, round((-33.4 - i * 0.01)::numeric, 2)::float8)), '{}'::jsonb
    from generate_series(1, p_n) i;
end $$;

select set_config('app.admin_uid', (select user_id::text from public.user_roles where role = 'admin' limit 1), true);

-- -----------------------------------------------------------------------------
-- R1. Lo retirado no existe; lo que debía quedar, queda
-- -----------------------------------------------------------------------------
do $$
declare v_fk int;
begin
  perform pg_temp.assert_that('R1 territorial_layer_groups ya no existe', to_regclass('public.territorial_layer_groups') is null);
  perform pg_temp.assert_that('R1 su vista _active ya no existe', to_regclass('public.territorial_layer_groups_active') is null);
  perform pg_temp.assert_that('R1 custom_layers ya no existe', to_regclass('public.custom_layers') is null);
  perform pg_temp.assert_that('R1 las funciones solo de grupos ya no existen',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public'
                   and p.proname in ('sync_layer_nodes_from_legacy', '_layer_nodes_ensure_legacy_group', '_legacy_slug',
                                     '_legacy_group_style', 'trg_legacy_group_to_node')));
  perform pg_temp.assert_that('R1 siguen las de capas y el espejo',
    to_regclass('public.territorial_layers_active') is not null
    and exists (select 1 from pg_proc where proname = 'trg_layer_nodes_to_legacy')
    and exists (select 1 from pg_proc where proname = '_legacy_layer_style')
    and exists (select 1 from pg_trigger where tgname = 'trg_legacy_layer_before_insert'));
  perform pg_temp.assert_that('R1 los backups existen y están cerrados a la API',
    to_regclass('public._backup_territorial_layer_groups_retire_20261015') is not null
    and (select count(*) from public._backup_territorial_layer_groups_retire_20261015) = 13
    and not has_table_privilege('anon', 'public._backup_territorial_layer_groups_retire_20261015', 'select')
    and not has_table_privilege('authenticated', 'public._backup_territorial_layer_groups_retire_20261015', 'select')
    and not has_table_privilege('authenticated', 'public._backup_folder_layer_roles_retire_20261015', 'select'));
  select count(*) into v_fk from pg_constraint
   where conname in ('folder_layer_roles_group_id_fkey', 'territorial_source_files_group_id_fkey', 'territorial_layers_group_id_fkey')
     and confrelid = 'public.layer_nodes'::regclass;
  perform pg_temp.assert_that('R1 las 3 FK miran a layer_nodes', v_fk = 3, v_fk::text);
  perform pg_temp.assert_that('R1 el estado queda registrado',
    exists (select 1 from public._migration_log where sprint = 'retire_legacy_layer_tables_v1' and notes = 'done'));
end $$;

-- -----------------------------------------------------------------------------
-- R2. Carpeta raíz nueva y capas "a la antigua" cuelgan de ella
-- -----------------------------------------------------------------------------
do $$
declare v_a public.layer_nodes; v_b public.layer_nodes; v_sub public.layer_nodes; v_l1 uuid; v_l2 uuid; v_state text;
begin
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  select * into v_a from public.create_folder(null, 'R Raíz A');
  select * into v_b from public.create_folder(null, 'R Raíz B');
  select * into v_sub from public.create_folder(v_a.id, 'R Sub');
  perform pg_temp.reset_user();
  perform set_config('app.r_a', v_a.id::text, true);
  perform set_config('app.r_b', v_b.id::text, true);
  perform set_config('app.r_sub', v_sub.id::text, true);

  v_l1 := pg_temp.mk_layer(v_a.id, 'R capa 1', 2);
  perform pg_temp.assert_that('R2 una capa escrita a la antigua obtiene su nodo bajo la raíz',
    (select parent_id from public.layer_nodes where id = v_l1) = v_a.id
    and (select kind from public.layer_nodes where id = v_l1) = 'layer');
  perform pg_temp.assert_that('R2 group_id es la raíz del nodo', (select group_id from public.territorial_layers where id = v_l1) = v_a.id
    and public._layer_nodes_root_of(v_l1) = v_a.id);

  v_state := pg_temp.try_sql(format('insert into public.territorial_layers (id, group_id, name) values (gen_random_uuid(), %L, %L)', gen_random_uuid(), 'R huérfana'));
  perform pg_temp.assert_that('R2 una capa con un group_id que no existe se rechaza (FK a layer_nodes)', v_state = '23503', v_state);

  -- La FK nueva acepta cualquier nodo; el trigger exige que sea una carpeta raíz (como antes la FK a grupos).
  v_state := pg_temp.try_sql(format('insert into public.territorial_layers (id, group_id, name) values (gen_random_uuid(), %L, %L)', v_sub.id, 'R en subcarpeta'));
  perform pg_temp.assert_that('R2 group_id no puede ser una subcarpeta', v_state = '23503', v_state);
  v_state := pg_temp.try_sql(format('insert into public.territorial_layers (id, group_id, name) values (gen_random_uuid(), %L, %L)', v_l1, 'R bajo una capa'));
  perform pg_temp.assert_that('R2 group_id no puede ser una capa', v_state = '23503', v_state);
  v_state := pg_temp.try_sql(format('update public.territorial_layers set group_id = %L where id = %L', v_sub.id, v_l1));
  perform pg_temp.assert_that('R2 tampoco al actualizar', v_state = '23503', v_state);

  perform set_config('app.r_l1', v_l1::text, true);
end $$;

-- -----------------------------------------------------------------------------
-- R3. Mover capas y carpetas entre raíces recalcula group_id
-- -----------------------------------------------------------------------------
do $$
declare v_a uuid := current_setting('app.r_a')::uuid; v_b uuid := current_setting('app.r_b')::uuid;
        v_sub uuid := current_setting('app.r_sub')::uuid; v_l1 uuid := current_setting('app.r_l1')::uuid; v_l2 uuid;
begin
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  perform public.move_node(v_l1, v_b);
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('R3 mover una capa a otra raíz recalcula su group_id',
    (select group_id from public.territorial_layers where id = v_l1) = v_b);

  v_l2 := pg_temp.mk_layer(v_a, 'R capa 2', 1);
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  perform public.move_node(v_l2, v_sub);   -- a una subcarpeta de la raíz A
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('R3 una capa en una subcarpeta tiene por group_id la raíz',
    (select group_id from public.territorial_layers where id = v_l2) = v_a and (select parent_id from public.layer_nodes where id = v_l2) = v_sub);
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  perform public.move_node(v_sub, v_b);   -- la subcarpeta (con su capa) pasa a colgar de la otra raíz
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('R3 mover una carpeta recalcula el group_id de todas sus capas',
    (select group_id from public.territorial_layers where id = v_l2) = v_b);
  perform set_config('app.r_l2', v_l2::text, true);
end $$;

-- -----------------------------------------------------------------------------
-- R4. Nombre y estilo siguen espejándose hacia la capa antigua; renombrar una raíz ya no tiene que espejar nada
-- -----------------------------------------------------------------------------
do $$
declare v_l1 uuid := current_setting('app.r_l1')::uuid; v_a uuid := current_setting('app.r_a')::uuid;
begin
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  perform public.rename_node(v_l1, 'R capa 1 renombrada');
  perform public.update_node_style(v_l1, '{"color":"#abcdef","icon":"store"}'::jsonb);
  perform public.rename_node(v_a, 'R Raíz A renombrada');
  perform public.update_node_style(v_a, '{"color":"#123456"}'::jsonb);
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('R4 nombre y color de una capa llegan a territorial_layers',
    (select name from public.territorial_layers where id = v_l1) = 'R capa 1 renombrada'
    and (select color from public.territorial_layers where id = v_l1) = '#abcdef'
    and (select icon from public.territorial_layers where id = v_l1) = 'store');
  perform pg_temp.assert_that('R4 renombrar o pintar una carpeta raíz funciona sin tabla de grupos',
    (select name from public.layer_nodes where id = v_a) = 'R Raíz A renombrada'
    and (select style ->> 'color' from public.layer_nodes where id = v_a) = '#123456');
end $$;

-- -----------------------------------------------------------------------------
-- R5. Papelera: archivar, restaurar y purgar una raíz con capas y puntos
-- -----------------------------------------------------------------------------
do $$
declare v_a uuid := current_setting('app.r_a')::uuid; v_l1 uuid := current_setting('app.r_l1')::uuid; v_pts bigint; v_n int;
begin
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  perform public.archive_node(v_a);
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('R5 una raíz archivada sale de lo activo',
    not exists (select 1 from public.layer_nodes where id = v_a and archived_at is null));
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  perform public.restore_node(v_a);
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('R5 se restaura', exists (select 1 from public.layer_nodes where id = v_a and archived_at is null));

  -- Purga real: una raíz que lleva 40 días archivada, con una capa y puntos, cae completa y sin error.
  perform pg_temp.mk_layer(v_a, 'R capa borrada', 3);
  select count(*) into v_pts from public.territorial_features f join public.territorial_layers t on t.id = f.layer_id where t.group_id = v_a and t.name = 'R capa borrada';
  perform pg_temp.assert_that('R5 la capa a purgar tiene puntos', v_pts = 3, v_pts::text);
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  perform public.archive_node(v_a);
  perform pg_temp.reset_user();
  update public.layer_nodes set archived_at = now() - interval '40 days' where archived_at is not null and (id = v_a or parent_id = v_a);
  v_n := public.purge_archived_layer_nodes(30, 50);
  perform pg_temp.assert_that('R5 la purga se lleva la raíz archivada',
    v_n >= 1 and not exists (select 1 from public.layer_nodes where id = v_a));
  perform pg_temp.assert_that('R5 y sus capas y sus puntos caen por las FK (nadie queda apuntando a la raíz)',
    not exists (select 1 from public.territorial_layers where group_id = v_a)
    and not exists (select 1 from public.territorial_features f where f.layer_id in (select id from public.territorial_layers where group_id = v_a)));
end $$;

-- -----------------------------------------------------------------------------
-- R6. Duplicar una raíz con capas
-- -----------------------------------------------------------------------------
do $$
declare v_b uuid := current_setting('app.r_b')::uuid; v_copy public.layer_nodes;
begin
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  select * into v_copy from public.duplicate_node(v_b);
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('R6 la copia es otra raíz', v_copy.id <> v_b and v_copy.parent_id is null and v_copy.kind = 'folder');
  perform pg_temp.assert_that('R6 las capas copiadas tienen por group_id la raíz nueva',
    (select count(*) from public.territorial_layers where group_id = v_copy.id) >= 2
    and not exists (select 1 from public.territorial_layers t join public.layer_nodes n on n.id = t.id
                     where n.parent_id is not null and public._layer_nodes_root_of(t.id) is distinct from t.group_id));
end $$;

-- -----------------------------------------------------------------------------
-- R7. Importación (lo más usado): nueva carpeta raíz sin destino y modo nuevo bajo una carpeta
-- -----------------------------------------------------------------------------
do $$
declare v_b uuid := current_setting('app.r_b')::uuid; v_id uuid; v_top uuid; v_res jsonb;
  v_struct jsonb := $j$ {"key":"0","kind":"folder","name":"R Import","children":[
      {"key":"0.0","kind":"layer","name":"R Capa import","count":2},
      {"key":"0.1","kind":"folder","name":"R Sub import","children":[{"key":"0.1.0","kind":"layer","name":"R Hoja","count":1}]}]} $j$;
begin
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  v_id := public.create_layer_import('r.kml', 'kml', v_struct, 3);
  perform pg_temp.reset_user();
  perform pg_temp.stage(v_id, '0.0', 2);
  perform pg_temp.stage(v_id, '0.1.0', 1);
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  perform public.finish_layer_import_staging(v_id);
  v_res := public.commit_layer_import(v_id, 'new', null, array[]::text[]);   -- sin destino: crea una raíz nueva
  perform pg_temp.reset_user();
  select id into v_top from public.layer_nodes where parent_id is null and name = 'R Import';
  perform pg_temp.assert_that('R7 importar sin destino crea la raíz y sus capas', v_top is not null and (v_res ->> 'features')::int = 3);
  perform pg_temp.assert_that('R7 las capas importadas cuelgan (group_id) de la raíz nueva',
    (select count(*) from public.territorial_layers t where t.group_id = v_top) = 2
    and (select count(*) from public.territorial_features f join public.territorial_layers t on t.id = f.layer_id where t.group_id = v_top) = 3);

  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  v_id := public.create_layer_import('r2.kml', 'kml', '{"key":"0","kind":"layer","name":"R Suelta","count":2}'::jsonb, 2);
  perform pg_temp.reset_user();
  perform pg_temp.stage(v_id, '0', 2);
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  perform public.finish_layer_import_staging(v_id);
  v_res := public.commit_layer_import(v_id, 'new', v_b, array[]::text[]);     -- bajo una carpeta existente
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('R7 importar bajo una raíz existente: la capa nueva tiene su group_id',
    exists (select 1 from public.territorial_layers where name = 'R Suelta' and group_id = v_b));

  -- y se puede deshacer
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  perform public.revert_layer_import(v_id);
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('R7 deshacer una importación nueva manda lo creado a la papelera (30 días), no lo borra',
    exists (select 1 from public.territorial_layers t join public.layer_nodes n on n.id = t.id where t.name = 'R Suelta' and n.archived_at is not null)
    and not exists (select 1 from public.territorial_layers_active where name = 'R Suelta'));
end $$;

-- -----------------------------------------------------------------------------
-- R8. Reglas de rol por carpeta (folder_layer_roles.group_id) apuntan a una raíz
-- -----------------------------------------------------------------------------
do $$
declare v_b uuid := current_setting('app.r_b')::uuid; v_folder uuid; v_state text;
begin
  select id into v_folder from public.poi_folders limit 1;
  if v_folder is null then
    perform pg_temp.assert_that('R8 reglas de rol', true, 'omitido: no hay carpetas de POI');
    return;
  end if;
  v_state := pg_temp.try_sql(format('insert into public.folder_layer_roles (folder_id, group_id, role) values (%L, %L, %L)', v_folder, v_b, 'competencia'));
  perform pg_temp.assert_that('R8 una regla para una raíz existente se acepta', v_state = 'OK', v_state);
  v_state := pg_temp.try_sql(format('insert into public.folder_layer_roles (folder_id, group_id, role) values (%L, %L, %L)', v_folder, current_setting('app.r_sub')::uuid, 'ancla'));
  perform pg_temp.assert_that('R8 una regla para una subcarpeta se rechaza (debe ser una raíz)', v_state = '23503', v_state);
  v_state := pg_temp.try_sql(format('insert into public.folder_layer_roles (folder_id, group_id, role) values (%L, %L, %L)', v_folder, gen_random_uuid(), 'competencia'));
  perform pg_temp.assert_that('R8 una regla para un grupo que no existe se rechaza', v_state = '23503', v_state);
  delete from public.layer_nodes where id = v_b;
  perform pg_temp.assert_that('R8 al borrar la raíz caen sus reglas (cascade)',
    not exists (select 1 from public.folder_layer_roles where group_id = v_b));
end $$;

-- -----------------------------------------------------------------------------
-- R9. Lo que lee la app: raíces compartidas y activas (los "grupos")
-- -----------------------------------------------------------------------------
do $$
declare v_n int;
begin
  select count(*) into v_n from public.layer_nodes
   where kind = 'folder' and parent_id is null and archived_at is null and scope = 'shared'
     and created_at < now() - interval '1 hour';
  perform pg_temp.assert_that('R9 las 13 carpetas raíz reales siguen activas y compartidas', v_n = 13, v_n::text);
  perform pg_temp.assert_that('R9 todas traen slug en su estilo',
    not exists (select 1 from public.layer_nodes where kind = 'folder' and parent_id is null and scope = 'shared'
                   and created_at < now() - interval '1 hour' and coalesce(style ->> 'slug', '') = ''));
  select count(*) into v_n from public.territorial_layers_active;
  perform pg_temp.assert_that('R9 la vista de capas activas se sigue leyendo', v_n > 0, v_n::text);
end $$;
