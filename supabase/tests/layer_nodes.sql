-- =============================================================================
-- Pruebas de la Fase 1 (árbol de capas). NO es una migración.
-- =============================================================================
-- Se corre DESPUÉS de las tres migraciones 20261014120*, en la MISMA transacción
-- y terminando en error para que nada quede aplicado:
--
--   [opcional] sembrar un custom_layers de prueba (ver T10)
--   <20261014120000_layer_nodes_schema.sql>
--   <20261014120100_layer_nodes_backfill.sql>
--   <20261014120200_territorial_features_geom.sql>
--   <este archivo>
--   do $$ begin raise exception 'DRYRUN_OK %', (select jsonb_agg(name order by seq) from _tr); end $$;
--
-- Concatenado en un solo string corre en una transacción implícita y el RAISE
-- final la revierte. Cada prueba lanza `FAIL [nombre]: detalle` en el primer
-- fallo, así que el mensaje de error dice cuál.
--
-- Si antes se crea la tabla temporal `_bulk_vectors(a, b, expected)` con
-- `node scripts/gen-fractional-vectors.mjs --sql N`, T2 compara además la
-- función SQL contra la librería de referencia a escala.
-- =============================================================================

create temp table _tr (seq serial primary key, name text not null, detail text);
-- Las pruebas registran resultados también mientras simulan a un usuario autenticado.
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

-- Ejecuta SQL y devuelve 'OK' o el SQLSTATE del error.
create or replace function pg_temp.try_sql(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate;
end $$;

-- Simula una sesión autenticada de PostgREST / vuelve a superusuario.
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

-- Crea un nodo como superusuario (siempre al final de sus hermanos).
create or replace function pg_temp.mk_node(p_kind text, p_name text, p_parent uuid)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.layer_nodes (kind, name, parent_id, position)
  values (p_kind, p_name, p_parent, public._layer_nodes_next_position(p_parent))
  returning id into v;
  return v;
end $$;

-- Hijos activos de un padre, en orden.
create or replace function pg_temp.children(p_parent uuid)
returns uuid[] language sql as $$
  select coalesce(array_agg(id order by position, id), '{}'::uuid[])
    from public.layer_nodes where parent_id is not distinct from p_parent and archived_at is null;
$$;

-- Usuarios: el admin real y uno nuevo SIN roles (se revierte con todo lo demás).
select set_config('app.admin_uid', (select user_id::text from public.user_roles where role = 'admin' limit 1), true);
select set_config('app.user_b', gen_random_uuid()::text, true);
insert into auth.users (id, instance_id, aud, role, email)
values (current_setting('app.user_b')::uuid, '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'layer-nodes-test-' || current_setting('app.user_b') || '@example.invalid');

-- -----------------------------------------------------------------------------
-- T1. La copia inicial es fiel
-- -----------------------------------------------------------------------------
do $$
declare v_groups int; v_layers int; v_f int; v_l int; v_active int; v_nogeom int; v_dup int;
begin
  select count(*) into v_groups from territorial_layer_groups;
  select count(*) into v_layers from territorial_layers;
  select count(*) into v_f from layer_nodes where kind = 'folder' and parent_id is null;
  select count(*) into v_l from layer_nodes where kind = 'layer';
  perform pg_temp.assert_that('T1 carpetas raíz = grupos', v_f = v_groups, v_f || ' vs ' || v_groups);
  perform pg_temp.assert_that('T1 capas = territorial_layers', v_l = v_layers, v_l || ' vs ' || v_layers);

  select count(*) into v_active from territorial_layers_active;
  perform pg_temp.assert_that('T1 vista de capas activas = todas', v_active = v_layers, v_active || ' vs ' || v_layers);

  select count(*) into v_nogeom from territorial_features where geom is null;
  perform pg_temp.assert_that('T1 todas las features tienen geom', v_nogeom = 0, v_nogeom || ' sin geom');

  select count(*) into v_dup from (
    select 1 from layer_nodes where archived_at is null group by parent_id, position having count(*) > 1
  ) x;
  perform pg_temp.assert_that('T1 posiciones únicas entre hermanos', v_dup = 0, v_dup || ' empates');
end $$;

-- -----------------------------------------------------------------------------
-- T1b. sync_layer_nodes_from_legacy: idempotente y refleja cambios de lo viejo
--      (va antes de las demás pruebas porque estas editan el árbol, y la
--      sincronización es justamente la que pisa lo del árbol con lo heredado)
-- -----------------------------------------------------------------------------
do $$
declare
  r jsonb; v_g uuid; v_a uuid; v_b uuid; v_oa int; v_ob int; v_first_before uuid; v_first_after uuid;
begin
  r := public.sync_layer_nodes_from_legacy(true);
  perform pg_temp.assert_that('T1b una segunda sincronización no cambia nada',
    (r ->> 'new_folders')::int = 0 and (r ->> 'new_layers')::int = 0 and (r ->> 'updated')::int = 0
    and (r ->> 'moved')::int = 0 and (r ->> 'reordered')::int = 0, r::text);

  -- Se reordenan dos capas en lo viejo (lo que hace hoy el diálogo de administración)
  select g.id into v_g from territorial_layer_groups g
   where (select count(*) from territorial_layers t where t.group_id = g.id) >= 2
   order by g.order_index limit 1;
  select id, order_index into v_a, v_oa from territorial_layers where group_id = v_g order by order_index, created_at, id limit 1;
  select id, order_index into v_b, v_ob from territorial_layers where group_id = v_g and id <> v_a order by order_index, created_at, id limit 1;
  v_first_before := (pg_temp.children(v_g))[1];
  update territorial_layers set order_index = v_ob + 1000 where id = v_a;   -- A pasa a ir después de B
  r := public.sync_layer_nodes_from_legacy(true);
  v_first_after := (pg_temp.children(v_g))[1];
  perform pg_temp.assert_that('T1b reordenar en lo viejo se refleja al sincronizar',
    v_first_before = v_a and v_first_after <> v_a and (r ->> 'reordered')::int > 0,
    v_first_before || ' -> ' || v_first_after || ' ' || r::text);

  -- Mover una capa de grupo en lo viejo
  update territorial_layers set group_id = v_g where id = v_a;  -- sin cambio: no debe mover nada
  r := public.sync_layer_nodes_from_legacy(true);
  perform pg_temp.assert_that('T1b sin cambios de grupo no hay movimientos', (r ->> 'moved')::int = 0, r::text);
end $$;

-- -----------------------------------------------------------------------------
-- T2. generate_key_between a escala contra la librería de referencia
-- -----------------------------------------------------------------------------
do $$
declare v_bad int; v_n int;
begin
  if to_regclass('pg_temp._bulk_vectors') is null then
    perform pg_temp.assert_that('T2 vectores a escala', true, 'omitido: el runner no creó _bulk_vectors');
  else
    execute 'select count(*) from pg_temp._bulk_vectors' into v_n;
    execute 'select count(*) from pg_temp._bulk_vectors t where public.generate_key_between(t.a, t.b) is distinct from t.expected' into v_bad;
    perform pg_temp.assert_that('T2 vectores a escala', v_bad = 0 and v_n > 0, v_n || ' casos, ' || v_bad || ' distintos');
  end if;
  perform pg_temp.assert_that('T2 a >= b lanza',
    pg_temp.try_sql($q$ select public.generate_key_between('a1', 'a0') $q$) = '22023');
  perform pg_temp.assert_that('T2 clave inválida lanza',
    pg_temp.try_sql($q$ select public.generate_key_between('a10', null) $q$) = '22023');
end $$;

-- -----------------------------------------------------------------------------
-- T3. Permisos: admin vs. usuario sin roles vs. sin sesión
-- -----------------------------------------------------------------------------
do $$
declare
  v_admin uuid := current_setting('app.admin_uid')::uuid;
  v_b uuid := current_setting('app.user_b')::uuid;
  v_node uuid; v_name text; v_state text; v_cnt int;
begin
  select id into v_node from layer_nodes where kind = 'layer' and archived_at is null order by position limit 1;

  perform pg_temp.set_user(v_admin);
  select name into v_name from rename_node(v_node, '  Renombrada por admin  ');
  v_state := pg_temp.try_sql(format('select public.rename_node(%L, %L)', v_node, '   '));
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('T3 admin renombra y recorta espacios', v_name = 'Renombrada por admin', v_name);
  perform pg_temp.assert_that('T3 admin: nombre vacío rechazado', v_state = '23514', v_state);

  perform pg_temp.set_user(v_b);
  v_state := pg_temp.try_sql(format('select public.rename_node(%L, %L)', v_node, 'intruso'));
  select count(*) into v_cnt from layer_nodes where archived_at is null;
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('T3 usuario sin rol no puede renombrar', v_state = '42501', v_state);
  perform pg_temp.assert_that('T3 usuario sin rol SÍ ve lo compartido activo', v_cnt > 0, v_cnt::text);

  -- Sin sesión (auth.uid() null)
  v_state := pg_temp.try_sql(format('select public.rename_node(%L, %L)', v_node, 'anonimo'));
  perform pg_temp.assert_that('T3 sin sesión no puede renombrar', v_state = '42501', v_state);
end $$;

-- -----------------------------------------------------------------------------
-- T4. move_node: orden, anclas, ciclos y tipos
-- -----------------------------------------------------------------------------
do $$
declare
  v_admin uuid := current_setting('app.admin_uid')::uuid;
  f1 uuid; f2 uuid; f3 uuid; l1 uuid; s1 uuid; s2 uuid; s3 uuid;
  v_state text; r public.layer_nodes; v_last_root text;
begin
  f1 := pg_temp.mk_node('folder', 'T4 F1', null);
  f2 := pg_temp.mk_node('folder', 'T4 F2', f1);
  f3 := pg_temp.mk_node('folder', 'T4 F3', f2);
  l1 := pg_temp.mk_node('layer',  'T4 L1', f3);
  s1 := pg_temp.mk_node('layer',  'T4 S1', f1);
  s2 := pg_temp.mk_node('layer',  'T4 S2', f1);
  s3 := pg_temp.mk_node('layer',  'T4 S3', f1);
  perform pg_temp.assert_that('T4 orden inicial', pg_temp.children(f1) = array[f2, s1, s2, s3]);

  perform pg_temp.set_user(v_admin);

  -- ciclos
  v_state := pg_temp.try_sql(format('select public.move_node(%L, %L)', f1, f3));
  perform pg_temp.assert_that('T4 no se mueve una carpeta dentro de su descendiente', v_state = '23514', v_state);
  v_state := pg_temp.try_sql(format('select public.move_node(%L, %L)', f1, f1));
  perform pg_temp.assert_that('T4 no se mueve una carpeta dentro de sí misma', v_state = '23514', v_state);
  v_state := pg_temp.try_sql(format('update layer_nodes set parent_id = %L where id = %L', f3, f1));
  perform pg_temp.assert_that('T4 la guarda ataja también el UPDATE directo', v_state = '23514', v_state);

  -- tipos
  v_state := pg_temp.try_sql(format('select public.move_node(%L, %L)', f3, l1));
  perform pg_temp.assert_that('T4 el destino debe ser carpeta', v_state = '23514', v_state);
  v_state := pg_temp.try_sql(format('insert into layer_nodes (kind, name, parent_id, position) values (''layer'', ''x'', %L, ''a5'')', l1));
  perform pg_temp.assert_that('T4 una capa no tiene hijos (insert directo)', v_state = '23514', v_state);
  v_state := pg_temp.try_sql(format('update layer_nodes set kind = ''layer'' where id = %L', f2));
  perform pg_temp.assert_that('T4 kind no se puede cambiar', v_state = '23514', v_state);

  -- anclas
  perform public.move_node(s3, f1, p_before_id := f2);
  perform pg_temp.assert_that('T4 before_id: S3 antes de F2', pg_temp.children(f1) = array[s3, f2, s1, s2]);
  perform public.move_node(s3, f1, p_after_id := s2);
  perform pg_temp.assert_that('T4 after_id: S3 después de S2', pg_temp.children(f1) = array[f2, s1, s2, s3]);
  perform public.move_node(s1, f1, p_before_id := s3, p_after_id := s2);
  perform pg_temp.assert_that('T4 ambas anclas: S1 entre S2 y S3', pg_temp.children(f1) = array[f2, s2, s1, s3]);
  perform public.move_node(f2, f1);
  perform pg_temp.assert_that('T4 sin anclas: al final', pg_temp.children(f1) = array[s2, s1, s3, f2]);

  -- anclas inválidas
  v_state := pg_temp.try_sql(format('select public.move_node(%L, %L, p_before_id := %L)', s2, f1, l1));
  perform pg_temp.assert_that('T4 ancla que no es hermana', v_state = '23514', v_state);
  v_state := pg_temp.try_sql(format('select public.move_node(%L, %L, p_before_id := %L, p_after_id := %L)', s1, f1, s2, f2));
  perform pg_temp.assert_that('T4 anclas fuera de orden', v_state = '23514', v_state);

  -- a la raíz: una carpeta queda al final de la raíz (una capa no puede ir ahí: Fase 3)
  v_state := pg_temp.try_sql(format('select public.move_node(%L, null)', s1));
  perform pg_temp.assert_that('T4 una capa no puede ir a la raíz', v_state = '23514', v_state);
  perform public.move_node(f2, null);
  select * into r from layer_nodes where id = f2;
  select max(position) into v_last_root from layer_nodes where parent_id is null and archived_at is null;
  perform pg_temp.assert_that('T4 a la raíz queda última', r.parent_id is null and r.position = v_last_root, r.position || ' vs ' || v_last_root);
  perform pg_temp.assert_that('T4 la carpeta origen conserva el resto', pg_temp.children(f1) = array[s2, s1, s3]);

  -- a otra carpeta
  perform public.move_node(s1, f3);
  perform pg_temp.assert_that('T4 entre carpetas', pg_temp.children(f3) = array[l1, s1]);

  perform pg_temp.reset_user();
end $$;

-- -----------------------------------------------------------------------------
-- T5. Papelera: archivar, restaurar y visibilidad de lo archivado
-- -----------------------------------------------------------------------------
do $$
declare
  v_admin uuid := current_setting('app.admin_uid')::uuid;
  v_b uuid := current_setting('app.user_b')::uuid;
  v_g uuid; v_n_layers int; v_before int; v_mid int; v_after int; v_state text;
  v_cnt_b int; v_cnt_admin int; r public.layer_nodes;
  a1 uuid; a2 uuid; a3 uuid; b1 uuid; b2 uuid; b3 uuid;
begin
  select g.id into v_g from territorial_layer_groups g
   where (select count(*) from territorial_layers t where t.group_id = g.id) >= 2
   order by g.order_index limit 1;
  select count(*) into v_n_layers from territorial_layers where group_id = v_g;
  select count(*) into v_before from territorial_layers_active;

  perform pg_temp.set_user(v_admin);
  select * into r from archive_node(v_g);
  v_state := pg_temp.try_sql(format('select public.archive_node(%L)', v_g));
  perform pg_temp.reset_user();

  perform pg_temp.assert_that('T5 archiva la carpeta y toda su descendencia con el mismo timestamp',
    r.archived_at is not null and not exists (
      select 1 from layer_nodes n where (n.id = v_g or n.parent_id = v_g) and n.archived_at is distinct from r.archived_at));
  select count(*) into v_mid from territorial_layers_active;
  perform pg_temp.assert_that('T5 las capas archivadas salen de territorial_layers_active',
    v_mid = v_before - v_n_layers, v_mid || ' vs ' || (v_before - v_n_layers));
  perform pg_temp.assert_that('T5 no se archiva dos veces', v_state = '23514', v_state);

  perform pg_temp.set_user(v_b);
  select count(*) into v_cnt_b from layer_nodes where archived_at is not null;
  perform pg_temp.reset_user();
  perform pg_temp.set_user(v_admin);
  select count(*) into v_cnt_admin from layer_nodes where archived_at is not null;
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('T5 un usuario sin rol no ve la papelera', v_cnt_b = 0, v_cnt_b::text);
  perform pg_temp.assert_that('T5 el admin sí la ve', v_cnt_admin >= v_n_layers + 1, v_cnt_admin::text);

  perform pg_temp.set_user(v_admin);
  perform restore_node(v_g);
  perform pg_temp.reset_user();
  select count(*) into v_after from territorial_layers_active;
  perform pg_temp.assert_that('T5 restaurar devuelve todo', v_after = v_before and not exists (
    select 1 from layer_nodes n where (n.id = v_g or n.parent_id = v_g) and n.archived_at is not null), v_after || ' vs ' || v_before);

  -- Restaurar un hijo cuya carpeta sigue en la papelera lo manda a la raíz.
  a1 := pg_temp.mk_node('folder', 'T5 A1', null);
  a2 := pg_temp.mk_node('folder', 'T5 A2', a1);
  a3 := pg_temp.mk_node('folder', 'T5 A3', a2);   -- carpeta: una capa no puede volver sola a la raíz (Fase 3)
  perform pg_temp.set_user(v_admin);
  perform archive_node(a1);
  perform restore_node(a3);
  perform pg_temp.reset_user();
  select * into r from layer_nodes where id = a3;
  perform pg_temp.assert_that('T5 hijo restaurado con carpeta archivada va a la raíz',
    r.parent_id is null and r.archived_at is null);
  perform pg_temp.assert_that('T5 sus ex-padres siguen archivados',
    (select count(*) from layer_nodes where id in (a1, a2) and archived_at is not null) = 2);
  perform pg_temp.set_user(v_admin);
  perform restore_node(a1);
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('T5 restaurar la carpeta trae su subárbol archivado junto',
    (select count(*) from layer_nodes where id in (a1, a2) and archived_at is null) = 2);

  -- Un descendiente archivado ANTES que su padre no vuelve cuando se restaura el padre.
  b1 := pg_temp.mk_node('folder', 'T5 B1', null);
  b2 := pg_temp.mk_node('layer',  'T5 B2', b1);
  b3 := pg_temp.mk_node('layer',  'T5 B3', b1);
  perform pg_temp.set_user(v_admin);
  perform archive_node(b2);
  perform archive_node(b1);
  perform restore_node(b1);
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('T5 lo archivado antes se queda en la papelera',
    (select archived_at is not null from layer_nodes where id = b2)
    and (select archived_at is null from layer_nodes where id = b1)
    and (select archived_at is null from layer_nodes where id = b3));
end $$;

-- -----------------------------------------------------------------------------
-- T6. Visibilidad por usuario
-- -----------------------------------------------------------------------------
do $$
declare
  v_admin uuid := current_setting('app.admin_uid')::uuid;
  v_b uuid := current_setting('app.user_b')::uuid;
  v_g uuid; v_n int; v_w int; v_rows_admin int; v_rows_b int; v_vis_admin int; v_one uuid; v_state text;
begin
  select g.id into v_g from territorial_layer_groups g
   where (select count(*) from territorial_layers t where t.group_id = g.id) >= 3
   order by g.order_index limit 1;
  select count(*) into v_n from layer_nodes where parent_id = v_g and kind = 'layer' and archived_at is null;

  perform pg_temp.set_user(v_admin);
  v_w := public.set_node_visibility(v_g, true);
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('T6 prender una carpeta escribe una fila por capa', v_w = v_n, v_w || ' vs ' || v_n);

  perform pg_temp.set_user(v_b);
  select count(*) into v_rows_b from layer_node_visibility;
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('T6 otro usuario no ve filas ajenas', v_rows_b = 0, v_rows_b::text);

  perform pg_temp.set_user(v_b);
  perform public.set_node_visibility(v_g, false);
  perform pg_temp.reset_user();
  select count(*) filter (where visible) into v_vis_admin from layer_node_visibility where user_id = v_admin;
  perform pg_temp.assert_that('T6 lo de un usuario no pisa lo del otro', v_vis_admin = v_n, v_vis_admin || ' vs ' || v_n);

  select id into v_one from layer_nodes where parent_id = v_g and kind = 'layer' and archived_at is null order by position limit 1;
  perform pg_temp.set_user(v_admin);
  perform public.set_node_visibility(v_one, false);
  perform public.set_node_visibility(v_g, true);
  perform pg_temp.reset_user();
  select count(*) into v_rows_admin from layer_node_visibility where user_id = v_admin;
  perform pg_temp.assert_that('T6 re-aplicar no duplica filas (upsert)', v_rows_admin = v_n, v_rows_admin || ' vs ' || v_n);

  -- Las archivadas no cuentan
  perform pg_temp.set_user(v_admin);
  perform public.archive_node(v_one);
  v_w := public.set_node_visibility(v_g, true);
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('T6 las capas archivadas no se prenden', v_w = v_n - 1, v_w || ' vs ' || (v_n - 1));

  v_state := pg_temp.try_sql(format('select public.set_node_visibility(%L, true)', v_g));
  perform pg_temp.assert_that('T6 sin sesión no se puede', v_state = '42501', v_state);
end $$;

-- -----------------------------------------------------------------------------
-- T7. Puente viejo -> nuevo: lo que escribe el código actual aparece en el árbol
-- -----------------------------------------------------------------------------
do $$
declare
  g1 uuid; g2 uuid; l1 uuid; l2 uuid; n1 layer_nodes; n2 layer_nodes; v_cnt int;
begin
  insert into territorial_layer_groups (name, slug, order_index, color)
  values ('T7 grupo', 't7_grupo_' || gen_random_uuid(), 99999, '#112233') returning id into g1;
  select * into n1 from layer_nodes where id = g1;
  perform pg_temp.assert_that('T7 un grupo nuevo crea su carpeta raíz',
    n1.kind = 'folder' and n1.parent_id is null and n1.name = 'T7 grupo' and n1.style ->> 'color' = '#112233', n1::text);
  perform pg_temp.assert_that('T7 y queda al final de las raíces',
    n1.position = (select max(position) from layer_nodes where parent_id is null and archived_at is null));

  insert into territorial_layers (group_id, name, order_index) values (g1, 'T7 capa 1', 0) returning id into l1;
  insert into territorial_layers (group_id, name, order_index) values (g1, 'T7 capa 2', 1) returning id into l2;
  select * into n1 from layer_nodes where id = l1;
  select * into n2 from layer_nodes where id = l2;
  perform pg_temp.assert_that('T7 una capa nueva cuelga de su grupo, en orden',
    n1.kind = 'layer' and n1.parent_id = g1 and n2.parent_id = g1 and n1.position < n2.position);

  update territorial_layers set name = 'T7 capa 1b', color = '#abcdef', icon = 'pin' where id = l1;
  select * into n1 from layer_nodes where id = l1;
  perform pg_temp.assert_that('T7 renombrar/pintar en lo viejo se refleja en el nodo',
    n1.name = 'T7 capa 1b' and n1.style ->> 'color' = '#abcdef' and n1.style ->> 'icon' = 'pin', n1.style::text);

  update territorial_layer_groups set name = 'T7 grupo b' where id = g1;
  perform pg_temp.assert_that('T7 renombrar un grupo se refleja', (select name from layer_nodes where id = g1) = 'T7 grupo b');

  insert into territorial_layer_groups (name, slug, order_index) values ('T7 grupo 2', 't7_grupo2_' || gen_random_uuid(), 100000) returning id into g2;
  update territorial_layers set group_id = g2 where id = l1;
  perform pg_temp.assert_that('T7 mover una capa de grupo la re-cuelga',
    (select parent_id from layer_nodes where id = l1) = g2);

  delete from territorial_layers where id = l1;
  perform pg_temp.assert_that('T7 borrar una capa borra su nodo', not exists (select 1 from layer_nodes where id = l1));

  delete from territorial_layer_groups where id = g1;
  select count(*) into v_cnt from layer_nodes where id in (g1, l2);
  perform pg_temp.assert_that('T7 borrar un grupo borra su carpeta y las capas hijas', v_cnt = 0, v_cnt::text);

  -- la FK exige nodo: un insert con id explícito también lo crea
  insert into territorial_layers (id, group_id, name) values (gen_random_uuid(), g2, 'T7 capa con id') returning id into l1;
  perform pg_temp.assert_that('T7 insert con id explícito crea su nodo', exists (select 1 from layer_nodes where id = l1));

  delete from territorial_layer_groups where id = g2;
end $$;

-- -----------------------------------------------------------------------------
-- T8. PostGIS: geom se mantiene sola, repara y descarta Z
-- -----------------------------------------------------------------------------
do $$
declare
  g uuid; l uuid; f1 uuid; f2 uuid; f3 uuid; v geometry;
begin
  insert into territorial_layer_groups (name, slug, order_index) values ('T8', 't8_' || gen_random_uuid(), 99999) returning id into g;
  insert into territorial_layers (group_id, name) values (g, 'T8 capa') returning id into l;

  insert into territorial_features (layer_id, geometry)
  values (l, '{"type":"Polygon","coordinates":[[[-70,-33,500],[-69,-33,500],[-69,-32,500],[-70,-32,500],[-70,-33,500]]]}')
  returning id into f1;
  select geom into v from territorial_features where id = f1;
  perform pg_temp.assert_that('T8 polígono con Z queda 2D con SRID 4326',
    v is not null and ST_NDims(v) = 2 and ST_SRID(v) = 4326 and ST_IsValid(v), ST_AsText(v));

  insert into territorial_features (layer_id, geometry)
  values (l, '{"type":"Polygon","coordinates":[[[0,0],[2,2],[2,0],[0,2],[0,0]]]}')
  returning id into f2;
  select geom into v from territorial_features where id = f2;
  perform pg_temp.assert_that('T8 polígono auto-intersectado se repara', v is not null and ST_IsValid(v), ST_AsText(v));

  insert into territorial_features (layer_id, geometry) values (l, '{"type":"Nope","coordinates":[]}') returning id into f3;
  perform pg_temp.assert_that('T8 geometría ilegible: inserta igual y geom queda NULL',
    (select geom is null from territorial_features where id = f3));

  update territorial_features set geometry = '{"type":"Point","coordinates":[-70.6,-33.4]}' where id = f3;
  perform pg_temp.assert_that('T8 al cambiar geometry se recalcula geom',
    (select ST_X(geom) from territorial_features where id = f3) = -70.6);

  perform pg_temp.assert_that('T8 el índice GIST existe',
    exists (select 1 from pg_indexes where indexname = 'idx_territorial_features_geom' and indexdef ilike '%gist%'));

  delete from territorial_layer_groups where id = g;
end $$;

-- -----------------------------------------------------------------------------
-- T9. Purga de la papelera
-- -----------------------------------------------------------------------------
do $$
declare
  v_admin uuid := current_setting('app.admin_uid')::uuid;
  g uuid; l uuid; g_recent uuid; v_state text; v_n int;
  v_old timestamptz := now() - interval '40 days';
  v_recent timestamptz := now() - interval '10 days';
  v_log layer_node_purge_log;
begin
  insert into territorial_layer_groups (name, slug, order_index) values ('T9', 't9_' || gen_random_uuid(), 99999) returning id into g;
  insert into territorial_layers (group_id, name) values (g, 'T9 capa') returning id into l;
  insert into territorial_features (layer_id, geometry) values
    (l, '{"type":"Point","coordinates":[-70,-33]}'), (l, '{"type":"Point","coordinates":[-71,-34]}');
  g_recent := pg_temp.mk_node('folder', 'T9 reciente', null);

  perform pg_temp.set_user(v_admin);
  perform archive_node(g);
  perform archive_node(g_recent);
  perform pg_temp.reset_user();
  update layer_nodes set archived_at = v_old    where id in (g, l);   -- mismo timestamp: es UN subárbol
  update layer_nodes set archived_at = v_recent where id = g_recent;

  v_state := pg_temp.try_sql('select public.purge_archived_layer_nodes(3)');
  perform pg_temp.assert_that('T9 no se puede purgar con menos de 7 días', v_state = '22023', v_state);

  v_n := public.purge_archived_layer_nodes();
  perform pg_temp.assert_that('T9 purga lo vencido', v_n >= 1, v_n::text);
  perform pg_temp.assert_that('T9 el subárbol vencido desaparece (nodos, detalle y features)',
    not exists (select 1 from layer_nodes where id in (g, l))
    and not exists (select 1 from territorial_layers where id = l)
    and not exists (select 1 from territorial_features where layer_id = l));
  perform pg_temp.assert_that('T9 lo archivado hace 10 días se conserva',
    exists (select 1 from layer_nodes where id = g_recent and archived_at is not null));

  select * into v_log from layer_node_purge_log where node_id = g;
  perform pg_temp.assert_that('T9 deja registro de lo que se llevó',
    v_log.kind = 'folder' and v_log.descendants = 1 and v_log.features = 2, v_log::text);

  delete from territorial_layer_groups where id = g;   -- el grupo heredado queda huérfano; se limpia
end $$;

-- -----------------------------------------------------------------------------
-- T10. custom_layers -> capas reales (solo si el runner sembró la fila de prueba)
-- -----------------------------------------------------------------------------
do $$
declare
  v_id uuid := '00000000-0000-4000-8000-0000000c0de1';
  v_group uuid; v_layer territorial_layers; v_n int; v_nogeom int;
begin
  if not exists (select 1 from custom_layers where id = v_id) then
    perform pg_temp.assert_that('T10 custom_layers', true, 'omitido: el runner no sembró la fila de prueba');
    return;
  end if;
  select * into v_layer from territorial_layers where id = v_id;
  select id into v_group from territorial_layer_groups where slug = 'capas_personalizadas';
  perform pg_temp.assert_that('T10 la capa existe dentro del grupo "Capas personalizadas"',
    v_layer.id is not null and v_layer.group_id = v_group and v_layer.name = 'Seed custom' and v_layer.color = '#ff0000');
  select count(*) into v_n from territorial_features where layer_id = v_id;
  perform pg_temp.assert_that('T10 las features se explotan (la sin geometría se omite)', v_n = 3 and v_layer.feature_count = 3, v_n::text);
  select count(*) into v_nogeom from territorial_features where layer_id = v_id and geom is null;
  perform pg_temp.assert_that('T10 y tienen geom', v_nogeom = 0, v_nogeom::text);
  perform pg_temp.assert_that('T10 el nodo cuelga del grupo y no está archivado (activo=false se ignora)',
    exists (select 1 from layer_nodes where id = v_id and kind = 'layer' and parent_id = v_group and archived_at is null));
  perform pg_temp.assert_that('T10 la tabla original no se toca', exists (select 1 from custom_layers where id = v_id));
end $$;

-- -----------------------------------------------------------------------------
-- T11. Reequilibrio de claves largas
-- -----------------------------------------------------------------------------
do $$
declare
  v_admin uuid := current_setting('app.admin_uid')::uuid;
  f uuid; ids uuid[] := '{}'; model uuid[]; cur uuid[]; v_first uuid; v_second uuid; v_last uuid;
  v_len int; v_prev_len int := 0; v_maxlen int := 0; v_dropped boolean := false; v_final int; i int;
begin
  f := pg_temp.mk_node('folder', 'T11', null);
  for i in 1..5 loop ids := ids || pg_temp.mk_node('layer', 'T11 ' || i, f); end loop;
  model := ids;

  perform pg_temp.set_user(v_admin);
  for i in 1..400 loop
    cur := pg_temp.children(f);
    v_first := cur[1]; v_second := cur[2]; v_last := cur[array_length(cur, 1)];
    -- Peor caso: insertar siempre entre los mismos dos vecinos hace crecer la clave.
    perform public.move_node(v_last, f, p_before_id := v_second, p_after_id := v_first);
    model := array[model[1], v_last] || model[2:array_length(model, 1) - 1];
    select max(length(position)) into v_len from layer_nodes where parent_id = f;
    -- Sin reequilibrio la clave más larga solo puede crecer: una baja delata que ocurrió.
    if v_len < v_prev_len then v_dropped := true; end if;
    v_prev_len := v_len;
    v_maxlen := greatest(v_maxlen, v_len);
  end loop;
  perform pg_temp.reset_user();

  select max(length(position)) into v_final from layer_nodes where parent_id = f;
  perform pg_temp.assert_that('T11 400 movimientos conservan el orden esperado', pg_temp.children(f) = model);
  perform pg_temp.assert_that('T11 las claves nunca pasan del umbral y se reequilibró al menos una vez',
    v_dropped and v_maxlen <= 48, 'máx visto ' || v_maxlen || ', final ' || v_final || ', reequilibró ' || v_dropped);
end $$;

-- -----------------------------------------------------------------------------
-- T12. Alcance personal vs. compartido, RLS y escrituras directas
-- -----------------------------------------------------------------------------
do $$
declare
  v_admin uuid := current_setting('app.admin_uid')::uuid;
  v_b uuid := current_setting('app.user_b')::uuid;
  pb uuid; sf uuid; v_state text; v_cnt int; r public.layer_nodes;
begin
  sf := pg_temp.mk_node('folder', 'T12 compartida', null);

  perform pg_temp.set_user(v_b);
  insert into layer_nodes (kind, name, position, scope, owner_id)
  values ('folder', 'T12 personal de B', 'a0', 'personal', v_b) returning id into pb;
  v_state := pg_temp.try_sql(format('insert into layer_nodes (kind, name, position) values (''folder'', ''x'', ''a0'')'));
  perform pg_temp.assert_that('T12 un usuario sin rol no puede crear nodos compartidos (RLS)', v_state = '42501', v_state);
  v_state := pg_temp.try_sql(format('insert into layer_nodes (kind, name, position, scope, owner_id, parent_id) values (''folder'', ''y'', ''a0'', ''personal'', %L, %L)', v_b, sf));
  perform pg_temp.assert_that('T12 un nodo personal no cuelga de uno compartido', v_state = '23514', v_state);
  v_state := pg_temp.try_sql(format('select public.move_node(%L, %L)', pb, sf));
  perform pg_temp.assert_that('T12 move_node no cruza personal y compartido', v_state = '23514', v_state);
  perform pg_temp.reset_user();

  perform pg_temp.set_user(v_admin);
  select count(*) into v_cnt from layer_nodes where id = pb;
  v_state := pg_temp.try_sql(format('select public.rename_node(%L, ''robada'')', pb));
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('T12 el admin no ve lo personal de otro', v_cnt = 0, v_cnt::text);
  perform pg_temp.assert_that('T12 ni lo puede editar por RPC', v_state = '42501', v_state);

  -- nadie puede colgar nodos de algo en la papelera
  perform pg_temp.set_user(v_admin);
  perform public.archive_node(sf);
  v_state := pg_temp.try_sql(format('insert into layer_nodes (kind, name, parent_id, position) values (''layer'', ''z'', %L, ''a0'')', sf));
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('T12 no se crea nada bajo una carpeta archivada', v_state = '23514', v_state);

  -- scope y owner son inmutables
  v_state := pg_temp.try_sql(format('update layer_nodes set scope = ''shared'', owner_id = null where id = %L', pb));
  perform pg_temp.assert_that('T12 scope y owner no se cambian', v_state = '23514', v_state);
end $$;

-- -----------------------------------------------------------------------------
-- T13. Privilegios de ejecución y de tabla
-- -----------------------------------------------------------------------------
do $$
declare v_b uuid := current_setting('app.user_b')::uuid; v_state text;
begin
  perform pg_temp.assert_that('T13 anon no ejecuta las RPC',
    not has_function_privilege('anon', 'public.move_node(uuid,uuid,uuid,uuid)', 'execute')
    and not has_function_privilege('anon', 'public.archive_node(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.sync_layer_nodes_from_legacy(boolean)', 'execute'));
  perform pg_temp.assert_that('T13 authenticated sí ejecuta las RPC públicas',
    has_function_privilege('authenticated', 'public.move_node(uuid,uuid,uuid,uuid)', 'execute')
    and has_function_privilege('authenticated', 'public.set_node_visibility(uuid,boolean)', 'execute'));
  perform pg_temp.assert_that('T13 los helpers y la purga no son invocables por clientes',
    not has_function_privilege('authenticated', 'public.generate_key_between(text,text)', 'execute')
    and not has_function_privilege('authenticated', 'public.purge_archived_layer_nodes(int,int)', 'execute')
    and not has_function_privilege('authenticated', 'public._layer_nodes_next_position(uuid)', 'execute'));

  perform pg_temp.set_user(v_b);
  v_state := pg_temp.try_sql('select public.sync_layer_nodes_from_legacy(true)');
  perform pg_temp.assert_that('T13 sync_layer_nodes_from_legacy es solo admin', v_state = '42501', v_state);
  perform pg_temp.reset_user();

  execute 'set local role anon';
  v_state := pg_temp.try_sql('select count(*) from public.layer_nodes');
  execute 'reset role';
  perform pg_temp.assert_that('T13 anon no lee layer_nodes', v_state = '42501', v_state);

  perform pg_temp.assert_that('T13 las copias de respaldo no son legibles por la API',
    not has_table_privilege('anon', 'public._backup_territorial_layers_v1_20261014', 'select')
    and not has_table_privilege('authenticated', 'public._backup_territorial_layer_groups_v1_20261014', 'select'));
end $$;

-- -----------------------------------------------------------------------------
-- T14. Nada de lo que no debía tocarse cambió
-- -----------------------------------------------------------------------------
do $$
declare v_roles int; v_pre jsonb; v_first jsonb;
begin
  -- `v_pre`: lo previo a la ÚLTIMA aplicación. `v_first`: lo previo a la PRIMERA
  -- (el respaldo se toma una sola vez, así que es contra esa foto que se compara).
  select notes::jsonb into v_pre   from _migration_log where sprint = 'layer_nodes_v1_backfill_pre' order by id desc limit 1;
  select notes::jsonb into v_first from _migration_log where sprint = 'layer_nodes_v1_backfill_pre' order by id asc  limit 1;
  select count(*) into v_roles from folder_layer_roles;
  perform pg_temp.assert_that('T14 folder_layer_roles intacta', v_roles = (v_pre ->> 'roles')::int, v_roles || ' vs ' || (v_pre ->> 'roles'));
  perform pg_temp.assert_that('T14 el backup de grupos coincide con lo previo a la primera aplicación',
    (select count(*) from _backup_territorial_layer_groups_v1_20261014) = (v_first ->> 'groups')::int);
  perform pg_temp.assert_that('T14 el backup de capas coincide con lo previo a la primera aplicación',
    (select count(*) from _backup_territorial_layers_v1_20261014) = (v_first ->> 'layers')::int);
  perform pg_temp.assert_that('T14 existe el job de purga diaria',
    exists (select 1 from cron.job where jobname = 'purge-archived-layer-nodes' and schedule = '23 3 * * *'));
  perform pg_temp.assert_that('T14 la migración dejó su registro',
    (select count(distinct sprint) from _migration_log where sprint like 'layer_nodes_v1%' and notes = 'done') = 3);
end $$;
