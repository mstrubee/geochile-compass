-- =============================================================================
-- Pruebas de la Fase 3 (edición del árbol). NO es una migración.
-- =============================================================================
-- Se corre DESPUÉS de las migraciones de las Fases 1 y 3, en la MISMA
-- transacción y terminando en error para que nada quede aplicado:
--
--   <20261014180000_layer_nodes_edit.sql>        (aplicarla dos veces prueba la idempotencia)
--   <este archivo>
--   do $$ begin raise exception 'DRYRUN_OK %', (select jsonb_agg(name order by seq) from _tr); end $$;
--
-- Todo lo que crea son carpetas/capas chicas de prueba (<= 5 puntos): no
-- reescribe territorial_features (la base del proyecto tiene un disco de 2 GB).
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

-- Ejecuta SQL y devuelve 'OK' o el SQLSTATE del error.
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

-- Capa heredada (la crea el código viejo: el puente le arma el nodo) con n puntos.
create or replace function pg_temp.mk_layer(p_group uuid, p_name text, p_n int default 0, p_color text default null)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into public.territorial_layers (id, group_id, name, color, feature_count)
  values (v, p_group, p_name, p_color, p_n);
  insert into public.territorial_features (layer_id, name, lat, lng, geometry)
  select v, 'P' || i, round((-33.0 - i * 0.01)::numeric, 2)::float8, round((-70.0 - i * 0.01)::numeric, 2)::float8,
         jsonb_build_object('type', 'Point', 'coordinates', jsonb_build_array(
           round((-70.0 - i * 0.01)::numeric, 2)::float8, round((-33.0 - i * 0.01)::numeric, 2)::float8))
    from generate_series(1, p_n) i;
  return v;
end $$;

create or replace function pg_temp.node(p_id uuid) returns public.layer_nodes
language sql as $$ select * from public.layer_nodes where id = p_id $$;

select set_config('app.admin_uid', (select user_id::text from public.user_roles where role = 'admin' limit 1), true);
select set_config('app.user_b', gen_random_uuid()::text, true);
insert into auth.users (id, instance_id, aud, role, email)
values (current_setting('app.user_b')::uuid, '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'layer-nodes-edit-' || current_setting('app.user_b') || '@example.invalid');

-- Fotografía previa (para comprobar al final que lo real no se tocó)
select set_config('app.n_groups', (select count(*) from public.territorial_layer_groups)::text, true);
select set_config('app.n_layers', (select count(*) from public.territorial_layers)::text, true);
select set_config('app.n_feats',  (select count(*) from public.territorial_features)::text, true);

-- -----------------------------------------------------------------------------
-- E1. Una capa no puede estar en la raíz
-- -----------------------------------------------------------------------------
do $$
declare v_l uuid; v_state text;
begin
  select n.id into v_l from public.layer_nodes n where n.kind = 'layer' and n.archived_at is null limit 1;
  perform pg_temp.assert_that('E1 hay capas reales con las que probar', v_l is not null);

  v_state := pg_temp.try_sql(format(
    'insert into public.layer_nodes (kind, name, position) values (%L, %L, %L)', 'layer', 'suelta', 'zz'));
  perform pg_temp.assert_that('E1 insertar una capa en la raíz falla', v_state = '23514', v_state);

  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  v_state := pg_temp.try_sql(format('select public.move_node(%L, null)', v_l));
  perform pg_temp.assert_that('E1 mover una capa a la raíz falla', v_state = '23514', v_state);
  perform pg_temp.reset_user();

  perform pg_temp.assert_that('E1 todas las capas reales tienen carpeta',
    not exists (select 1 from public.layer_nodes where kind = 'layer' and parent_id is null));
end $$;

-- -----------------------------------------------------------------------------
-- E2. create_folder
-- -----------------------------------------------------------------------------
do $$
declare v_a public.layer_nodes; v_b public.layer_nodes; v_sub public.layer_nodes; v_state text;
        v_g0 int; v_layer uuid; v_last text;
begin
  select count(*) into v_g0 from public.territorial_layer_groups;
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  select * into v_a from public.create_folder(null, '  Estación Ñandú  ');
  select * into v_b from public.create_folder(null, 'Estación Ñandú');
  select * into v_sub from public.create_folder(v_a.id, 'Sub');
  perform pg_temp.reset_user();

  perform pg_temp.assert_that('E2 el nombre se recorta', v_a.name = 'Estación Ñandú' and v_a.kind = 'folder' and v_a.scope = 'shared');
  perform pg_temp.assert_that('E2 queda al final de la raíz',
    not exists (select 1 from public.layer_nodes where parent_id is null and archived_at is null and (position, id) > (v_b.position, v_b.id)));
  perform pg_temp.assert_that('E2 una carpeta raíz crea su grupo heredado',
    exists (select 1 from public.territorial_layer_groups where id = v_a.id and name = 'Estación Ñandú')
    and exists (select 1 from public.territorial_layer_groups where id = v_b.id));
  perform pg_temp.assert_that('E2 el slug va sin tildes y es único',
    (select slug from public.territorial_layer_groups where id = v_a.id) = 'estacion-nandu'
    and (select slug from public.territorial_layer_groups where id = v_b.id) = 'estacion-nandu-2');
  perform pg_temp.assert_that('E2 una subcarpeta NO crea grupo heredado',
    not exists (select 1 from public.territorial_layer_groups where id = v_sub.id)
    and (select count(*) from public.territorial_layer_groups) = v_g0 + 2);
  perform pg_temp.assert_that('E2 la subcarpeta cuelga de su padre', v_sub.parent_id = v_a.id);

  select id into v_layer from public.layer_nodes where kind = 'layer' and archived_at is null limit 1;
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  v_state := pg_temp.try_sql(format('select public.create_folder(%L, %L)', v_layer, 'x'));
  perform pg_temp.assert_that('E2 no se crea una carpeta dentro de una capa', v_state = '23514', v_state);
  v_state := pg_temp.try_sql('select public.create_folder(null, ''   '')');
  perform pg_temp.assert_that('E2 el nombre no puede quedar vacío', v_state = '23514', v_state);
  perform pg_temp.reset_user();

  perform pg_temp.set_user(current_setting('app.user_b')::uuid);
  v_state := pg_temp.try_sql('select public.create_folder(null, ''no puedo'')');
  perform pg_temp.assert_that('E2 un usuario sin rol no crea carpetas', v_state = '42501', v_state);
  perform pg_temp.reset_user();
  v_state := pg_temp.try_sql('select public.create_folder(null, ''anon'')');
  perform pg_temp.assert_that('E2 sin sesión tampoco', v_state = '42501', v_state);

  perform set_config('app.e2_root', v_a.id::text, true);
  perform set_config('app.e2_root_b', v_b.id::text, true);
  perform set_config('app.e2_sub', v_sub.id::text, true);
end $$;

-- -----------------------------------------------------------------------------
-- E3. Renombrar se refleja en lo heredado (y un nombre repetido en el grupo falla fuerte)
-- -----------------------------------------------------------------------------
do $$
declare v_root uuid := current_setting('app.e2_root')::uuid; v_sub uuid := current_setting('app.e2_sub')::uuid;
        v_la uuid; v_lb uuid; v_state text;
begin
  v_la := pg_temp.mk_layer(v_root, 'Capa A', 2);
  v_lb := pg_temp.mk_layer(v_root, 'Capa B', 1);
  perform pg_temp.assert_that('E3 el puente viejo->nuevo sigue armando nodos',
    (pg_temp.node(v_la)).parent_id = v_root and (pg_temp.node(v_la)).kind = 'layer');

  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  perform public.rename_node(v_root, 'Raíz renombrada');
  perform public.rename_node(v_la, 'Capa A2');
  v_state := pg_temp.try_sql(format('select public.rename_node(%L, %L)', v_lb, 'Capa A2'));
  perform pg_temp.reset_user();

  perform pg_temp.assert_that('E3 renombrar una carpeta raíz cambia su grupo heredado',
    (select name from public.territorial_layer_groups where id = v_root) = 'Raíz renombrada');
  perform pg_temp.assert_that('E3 renombrar una capa cambia territorial_layers',
    (select name from public.territorial_layers where id = v_la) = 'Capa A2');
  perform pg_temp.assert_that('E3 un nombre repetido en el mismo grupo falla (UNIQUE heredado)', v_state = '23505', v_state);
  perform pg_temp.assert_that('E3 y no deja nada a medias',
    (pg_temp.node(v_lb)).name = 'Capa B' and (select name from public.territorial_layers where id = v_lb) = 'Capa B');

  -- renombrar una subcarpeta no toca grupos
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  perform public.rename_node(v_sub, 'Sub 2');
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('E3 renombrar una subcarpeta no crea ni cambia grupos',
    not exists (select 1 from public.territorial_layer_groups where id = v_sub));

  perform set_config('app.e3_a', v_la::text, true);
  perform set_config('app.e3_b', v_lb::text, true);
end $$;

-- -----------------------------------------------------------------------------
-- E4. Propiedades (color, ícono, opacidad)
-- -----------------------------------------------------------------------------
do $$
declare v_la uuid := current_setting('app.e3_a')::uuid; v_root uuid := current_setting('app.e2_root')::uuid;
        v_n public.layer_nodes; v_state text; v_real_root public.layer_nodes; v_slug_before text;
begin
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  select * into v_n from public.update_node_style(v_la, '{"color":"#112233","icon":"🏥","opacity":0.5}');
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('E4 guarda color, ícono y opacidad',
    v_n.style ->> 'color' = '#112233' and v_n.style ->> 'icon' = '🏥' and (v_n.style ->> 'opacity')::numeric = 0.5);
  perform pg_temp.assert_that('E4 color e ícono se reflejan en territorial_layers',
    (select color from public.territorial_layers where id = v_la) = '#112233'
    and (select icon from public.territorial_layers where id = v_la) = '🏥');

  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  perform public.update_node_style(v_root, '{"color":"#abcdef"}');
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('E4 el color de una carpeta raíz llega a su grupo',
    (select color from public.territorial_layer_groups where id = v_root) = '#abcdef');

  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  v_state := pg_temp.try_sql(format('select public.update_node_style(%L, %L)', v_la, '{"color":"rojo"}'));
  perform pg_temp.assert_that('E4 un color inválido se rechaza', v_state = '22023', v_state);
  v_state := pg_temp.try_sql(format('select public.update_node_style(%L, %L)', v_la, '{"opacity":2}'));
  perform pg_temp.assert_that('E4 una opacidad fuera de 0..1 se rechaza', v_state = '22023', v_state);
  v_state := pg_temp.try_sql(format('select public.update_node_style(%L, %L)', v_la, '{"slug":"x"}'));
  perform pg_temp.assert_that('E4 una propiedad desconocida se rechaza', v_state = '22023', v_state);
  v_state := pg_temp.try_sql(format('select public.update_node_style(%L, %L)', v_la, '[1]'));
  perform pg_temp.assert_that('E4 p_style debe ser un objeto', v_state = '22023', v_state);

  -- null borra la clave; el resto se conserva
  select * into v_n from public.update_node_style(v_la, '{"icon":null}');
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('E4 null borra solo esa propiedad',
    not (v_n.style ? 'icon') and v_n.style ->> 'color' = '#112233' and (v_n.style ->> 'opacity')::numeric = 0.5);
  perform pg_temp.assert_that('E4 y se borra también en lo heredado',
    (select icon from public.territorial_layers where id = v_la) is null);

  -- una carpeta heredada conserva su slug al editar propiedades
  select * into v_real_root from public.layer_nodes where parent_id is null and style ? 'slug' and archived_at is null limit 1;
  v_slug_before := v_real_root.style ->> 'slug';
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  select * into v_n from public.update_node_style(v_real_root.id, '{"opacity":0.8}');
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('E4 editar propiedades no pierde el slug heredado',
    v_n.style ->> 'slug' = v_slug_before
    and (select slug from public.territorial_layer_groups where id = v_real_root.id) = v_slug_before);

  perform pg_temp.set_user(current_setting('app.user_b')::uuid);
  v_state := pg_temp.try_sql(format('select public.update_node_style(%L, %L)', v_la, '{"color":"#000000"}'));
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('E4 un usuario sin rol no edita propiedades', v_state = '42501', v_state);
end $$;

-- -----------------------------------------------------------------------------
-- E5. Mover mantiene territorial_layers.group_id = carpeta raíz
-- -----------------------------------------------------------------------------
do $$
declare v_ra uuid := current_setting('app.e2_root')::uuid;      -- raíz A (con "Capa A2" y "Capa B")
        v_rb uuid := current_setting('app.e2_root_b')::uuid;    -- raíz B
        v_sub uuid := current_setting('app.e2_sub')::uuid;      -- subcarpeta de A
        v_la uuid := current_setting('app.e3_a')::uuid; v_lb uuid := current_setting('app.e3_b')::uuid;
        v_n2 public.layer_nodes; v_lc uuid; v_lx uuid; v_ly uuid; v_state text; v_rc public.layer_nodes;
begin
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  select * into v_n2 from public.create_folder(v_rb, 'N2');
  perform pg_temp.reset_user();

  -- capa de A -> carpeta anidada en B
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  perform public.move_node(v_la, v_n2.id);
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('E5 mover a una subcarpeta de otro grupo cambia group_id a la raíz de destino',
    (select group_id from public.territorial_layers where id = v_la) = v_rb);

  -- de vuelta a A, dentro de su subcarpeta
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  perform public.move_node(v_la, v_sub);
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('E5 una capa en una subcarpeta tiene como grupo la raíz, no la subcarpeta',
    (select group_id from public.territorial_layers where id = v_la) = v_ra);

  -- una carpeta con capas cambia de raíz: sus capas la siguen
  -- (el código viejo crea la capa en el grupo raíz; después se mete en la subcarpeta)
  v_lc := pg_temp.mk_layer(v_rb, 'Capa C', 1);
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  perform public.move_node(v_lc, v_n2.id);
  perform pg_temp.assert_that('E5 mover a una subcarpeta de la misma raíz no cambia el grupo',
    (select group_id from public.territorial_layers where id = v_lc) = v_rb);
  perform public.move_node(v_n2.id, v_ra);
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('E5 mover una carpeta arrastra el grupo de sus capas',
    (select group_id from public.territorial_layers where id = v_lc) = v_ra
    and (pg_temp.node(v_lc)).parent_id = v_n2.id);

  -- una raíz pasa a ser subcarpeta: su grupo heredado queda fuera de la vista de activos
  v_lx := pg_temp.mk_layer(v_rb, 'Capa X', 1);
  perform pg_temp.assert_that('E5 antes de anidarla, la raíz B está en la vista de grupos activos',
    exists (select 1 from public.territorial_layer_groups_active where id = v_rb));
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  perform public.move_node(v_rb, v_ra);
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('E5 una raíz anidada deja de ser un grupo activo',
    not exists (select 1 from public.territorial_layer_groups_active where id = v_rb)
    and exists (select 1 from public.territorial_layer_groups where id = v_rb));
  perform pg_temp.assert_that('E5 y sus capas pasan al grupo de la nueva raíz',
    (select group_id from public.territorial_layers where id = v_lx) = v_ra);

  -- una subcarpeta pasa a raíz: se crea su grupo y arrastra sus capas
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  perform public.move_node(v_n2.id, null);
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('E5 una subcarpeta promovida a raíz crea su grupo heredado',
    exists (select 1 from public.territorial_layer_groups_active where id = v_n2.id));
  perform pg_temp.assert_that('E5 y sus capas pasan a ese grupo',
    (select group_id from public.territorial_layers where id = v_lc) = v_n2.id);

  -- un nombre repetido en el grupo de destino impide el movimiento completo
  v_ly := pg_temp.mk_layer(v_n2.id, 'Capa B', 1);   -- mismo nombre que v_lb (grupo A)
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  v_state := pg_temp.try_sql(format('select public.move_node(%L, %L)', v_ly, v_ra));
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('E5 mover a un grupo donde ya existe ese nombre falla', v_state = '23505', v_state);
  perform pg_temp.assert_that('E5 y la capa queda donde estaba',
    (pg_temp.node(v_ly)).parent_id = v_n2.id and (select group_id from public.territorial_layers where id = v_ly) = v_n2.id);

  perform set_config('app.e5_n2', v_n2.id::text, true);
  perform set_config('app.e5_lc', v_lc::text, true);
end $$;

-- -----------------------------------------------------------------------------
-- E6. Escrituras desde el código viejo siguen funcionando, sin rebotar
-- -----------------------------------------------------------------------------
do $$
declare v_ra uuid := current_setting('app.e2_root')::uuid; v_sub uuid := current_setting('app.e2_sub')::uuid;
        v_la uuid := current_setting('app.e3_a')::uuid; v_rb uuid := current_setting('app.e2_root_b')::uuid;
        v_pos_before text;
begin
  update public.territorial_layers set color = '#fedcba' where id = v_la;
  perform pg_temp.assert_that('E6 un cambio de color viejo llega al nodo',
    (pg_temp.node(v_la)).style ->> 'color' = '#fedcba');

  update public.territorial_layer_groups set name = 'Raíz desde lo viejo' where id = v_ra;
  perform pg_temp.assert_that('E6 un cambio de nombre viejo llega a la carpeta', (pg_temp.node(v_ra)).name = 'Raíz desde lo viejo');

  -- group_id desfasado (se simula con el candado puesto) y luego corregido a la raíz
  -- real del nodo: el nodo NO se reposiciona ni sale de su subcarpeta
  perform set_config('layer_nodes.syncing', 'on', true);
  update public.territorial_layers set group_id = v_rb where id = v_la;
  perform set_config('layer_nodes.syncing', 'off', true);
  v_pos_before := (pg_temp.node(v_la)).position;
  update public.territorial_layers set group_id = v_ra where id = v_la;
  perform pg_temp.assert_that('E6 reasignar el mismo grupo no saca a la capa de su subcarpeta',
    (pg_temp.node(v_la)).parent_id = v_sub and (pg_temp.node(v_la)).position = v_pos_before);

  perform pg_temp.assert_that('E6 el candado queda suelto al terminar',
    coalesce(current_setting('layer_nodes.syncing', true), 'off') <> 'on');
end $$;

-- -----------------------------------------------------------------------------
-- E7. Papelera y vistas de activos
-- -----------------------------------------------------------------------------
do $$
declare v_ra uuid := current_setting('app.e2_root')::uuid; v_la uuid := current_setting('app.e3_a')::uuid;
        v_n2 uuid := current_setting('app.e5_n2')::uuid; v_lc uuid := current_setting('app.e5_lc')::uuid;
        v_state text;
begin
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  perform public.archive_node(v_la);
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('E7 una capa archivada sale de la vista de activos pero no de la tabla',
    not exists (select 1 from public.territorial_layers_active where id = v_la)
    and exists (select 1 from public.territorial_layers where id = v_la));

  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  perform public.restore_node(v_la);
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('E7 al restaurarla vuelve a la vista', exists (select 1 from public.territorial_layers_active where id = v_la));

  -- carpeta raíz archivada: su grupo y sus capas dejan de ser activos
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  perform public.archive_node(v_n2);
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('E7 archivar una raíz saca su grupo y sus capas de las vistas',
    not exists (select 1 from public.territorial_layer_groups_active where id = v_n2)
    and not exists (select 1 from public.territorial_layers_active where id = v_lc));

  -- una capa archivada junto con su carpeta no puede volver sola
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  v_state := pg_temp.try_sql(format('select public.restore_node(%L)', v_lc));
  perform pg_temp.assert_that('E7 restaurar una capa cuya carpeta está en la papelera falla', v_state = '23514', v_state);
  perform public.restore_node(v_n2);
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('E7 restaurar la carpeta trae sus capas',
    exists (select 1 from public.territorial_layer_groups_active where id = v_n2)
    and exists (select 1 from public.territorial_layers_active where id = v_lc));
end $$;

-- -----------------------------------------------------------------------------
-- E8. Duplicar
-- -----------------------------------------------------------------------------
do $$
declare v_ra uuid := current_setting('app.e2_root')::uuid; v_sub uuid := current_setting('app.e2_sub')::uuid;
        v_la uuid := current_setting('app.e3_a')::uuid; v_n2 uuid := current_setting('app.e5_n2')::uuid;
        v_dup public.layer_nodes; v_dup2 public.layer_nodes; v_next text; v_fold public.layer_nodes; v_root_copy public.layer_nodes;
        v_big uuid; v_state text; v_n int;
begin
  -- capa: queda justo después del original, con sus puntos y su fila heredada
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  select * into v_dup from public.duplicate_node(v_la);
  select * into v_dup2 from public.duplicate_node(v_la);
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('E8 la copia lleva "(copia)" y cuelga del mismo padre',
    v_dup.name = 'Capa A2 (copia)' and v_dup.parent_id = v_sub and v_dup.kind = 'layer');
  perform pg_temp.assert_that('E8 la segunda copia no choca por nombre', v_dup2.name = 'Capa A2 (copia 2)');
  -- cada copia va inmediatamente después del original: la última queda primero
  perform pg_temp.assert_that('E8 queda inmediatamente después del original',
    (select x.id from public.layer_nodes x
      where x.parent_id = v_sub and x.archived_at is null
        and (x.position, x.id) > ((pg_temp.node(v_la)).position, v_la)
      order by x.position, x.id limit 1) = v_dup2.id
    and (select x.id from public.layer_nodes x
      where x.parent_id = v_sub and x.archived_at is null
        and (x.position, x.id) > (v_dup2.position, v_dup2.id)
      order by x.position, x.id limit 1) = v_dup.id);
  select count(*) into v_n from public.territorial_features where layer_id = v_dup.id and geom is not null;
  perform pg_temp.assert_that('E8 copia los puntos (con geom)',
    v_n = 2 and (select feature_count from public.territorial_layers where id = v_dup.id) = 2);
  perform pg_temp.assert_that('E8 la fila heredada cuelga de la raíz correcta',
    (select group_id from public.territorial_layers where id = v_dup.id) = v_ra);
  perform pg_temp.assert_that('E8 no toca el original',
    (select count(*) from public.territorial_features where layer_id = v_la) = 2);

  -- carpeta: copia todo el subárbol; los nombres de capa se desambiguan dentro del grupo
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  select * into v_fold from public.duplicate_node(v_sub);
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('E8 la carpeta copiada se llama "(copia)"', v_fold.name = 'Sub 2 (copia)' and v_fold.parent_id = v_ra);
  perform pg_temp.assert_that('E8 copia las capas de dentro con nombres únicos en el grupo',
    (select count(*) from public.layer_nodes where parent_id = v_fold.id and kind = 'layer') = 3
    and (select count(distinct name) from public.territorial_layers where group_id = v_ra) =
        (select count(*) from public.territorial_layers where group_id = v_ra));

  -- carpeta raíz: grupo nuevo con slug único
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  select * into v_root_copy from public.duplicate_node(v_n2);
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('E8 duplicar una raíz crea otra raíz con grupo heredado propio',
    v_root_copy.parent_id is null
    and exists (select 1 from public.territorial_layer_groups where id = v_root_copy.id)
    and (select slug from public.territorial_layer_groups where id = v_root_copy.id)
        <> (select slug from public.territorial_layer_groups where id = v_n2));
  perform pg_temp.assert_that('E8 las capas de una raíz copiada conservan su nombre',
    exists (select 1 from public.territorial_layers where group_id = v_root_copy.id and name = 'Capa C'));

  -- tope: la capa más grande (25 mil puntos) se rechaza ANTES de escribir nada
  select id into v_big from public.territorial_layers order by feature_count desc limit 1;
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  v_state := pg_temp.try_sql(format('select public.duplicate_node(%L)', v_big));
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('E8 una capa de más de 10.000 puntos no se duplica', v_state = '23514', v_state);

  perform pg_temp.set_user(current_setting('app.user_b')::uuid);
  v_state := pg_temp.try_sql(format('select public.duplicate_node(%L)', v_la));
  perform pg_temp.reset_user();
  perform pg_temp.assert_that('E8 un usuario sin rol no duplica', v_state = '42501', v_state);
end $$;

-- -----------------------------------------------------------------------------
-- E9. get_node_bounds
-- -----------------------------------------------------------------------------
do $$
declare v_ra uuid := current_setting('app.e2_root')::uuid; v_la uuid := current_setting('app.e3_a')::uuid;
        v_empty public.layer_nodes; v_b jsonb; v_big public.layer_nodes; v_arch uuid;
begin
  -- "Capa A2": dos puntos en (-33.01,-70.01) y (-33.02,-70.02)
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  select public.get_node_bounds(v_la) into v_b;
  perform pg_temp.assert_that('E9 límites exactos de una capa',
    round((v_b ->> 'west')::numeric, 6) = -70.02 and round((v_b ->> 'east')::numeric, 6) = -70.01
    and round((v_b ->> 'south')::numeric, 6) = -33.02 and round((v_b ->> 'north')::numeric, 6) = -33.01, v_b::text);
  select * into v_empty from public.create_folder(v_ra, 'Vacía');
  perform pg_temp.assert_that('E9 una carpeta sin puntos no tiene límites', public.get_node_bounds(v_empty.id) is null);
  perform pg_temp.assert_that('E9 un id que no existe devuelve null', public.get_node_bounds(gen_random_uuid()) is null);
  perform pg_temp.assert_that('E9 una carpeta junta los límites de sus capas',
    (public.get_node_bounds(v_ra) ->> 'west')::numeric <= -70.02);

  -- datos reales (solo lectura): la carpeta más grande cae dentro de Chile
  select * into v_big from public.layer_nodes n
   where n.parent_id is null and n.archived_at is null and n.name = 'SERV. AUTOMOTRICES' limit 1;
  if v_big.id is not null then
    v_b := public.get_node_bounds(v_big.id);
    perform pg_temp.assert_that('E9 SERV. AUTOMOTRICES queda dentro del rango de Chile',
      (v_b ->> 'west')::numeric between -110 and -66 and (v_b ->> 'east')::numeric between -110 and -66
      and (v_b ->> 'south')::numeric between -56 and -17 and (v_b ->> 'north')::numeric between -56 and -17, v_b::text);
  end if;
  perform pg_temp.reset_user();

  v_arch := pg_temp.mk_layer(v_ra, 'E9 archivada', 2);
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  perform pg_temp.assert_that('E9 antes de archivarla sí tiene límites', public.get_node_bounds(v_arch) is not null);
  perform public.archive_node(v_arch);
  perform pg_temp.assert_that('E9 una capa archivada no devuelve límites', public.get_node_bounds(v_arch) is null);
  perform pg_temp.reset_user();
end $$;

-- -----------------------------------------------------------------------------
-- E10. La purga también limpia lo heredado
-- -----------------------------------------------------------------------------
do $$
declare v_root public.layer_nodes; v_l uuid; v_n int;
begin
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  select * into v_root from public.create_folder(null, 'E10 a purgar');
  perform pg_temp.reset_user();
  v_l := pg_temp.mk_layer(v_root.id, 'Capa E10', 3);
  perform pg_temp.set_user(current_setting('app.admin_uid')::uuid);
  perform public.archive_node(v_root.id);
  perform pg_temp.reset_user();
  update public.layer_nodes set archived_at = now() - interval '40 days' where id in (v_root.id, v_l);

  select public.purge_archived_layer_nodes() into v_n;
  perform pg_temp.assert_that('E10 la purga se llevó la raíz', v_n >= 1 and not exists (select 1 from public.layer_nodes where id = v_root.id));
  perform pg_temp.assert_that('E10 se borró su grupo heredado', not exists (select 1 from public.territorial_layer_groups where id = v_root.id));
  perform pg_temp.assert_that('E10 se borró su capa heredada y sus puntos',
    not exists (select 1 from public.territorial_layers where id = v_l)
    and not exists (select 1 from public.territorial_features where layer_id = v_l));
end $$;

-- -----------------------------------------------------------------------------
-- E11. Privilegios
-- -----------------------------------------------------------------------------
do $$
begin
  perform pg_temp.assert_that('E11 anon no ejecuta las RPC nuevas',
    not has_function_privilege('anon', 'public.create_folder(uuid,text)', 'execute')
    and not has_function_privilege('anon', 'public.update_node_style(uuid,jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.duplicate_node(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.get_node_bounds(uuid)', 'execute'));
  perform pg_temp.assert_that('E11 authenticated sí',
    has_function_privilege('authenticated', 'public.create_folder(uuid,text)', 'execute')
    and has_function_privilege('authenticated', 'public.update_node_style(uuid,jsonb)', 'execute')
    and has_function_privilege('authenticated', 'public.duplicate_node(uuid)', 'execute')
    and has_function_privilege('authenticated', 'public.get_node_bounds(uuid)', 'execute'));
  perform pg_temp.assert_that('E11 los auxiliares y el trigger no son invocables por la API',
    not has_function_privilege('authenticated', 'public._layer_nodes_root_of(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public._legacy_slug(text)', 'execute')
    and not has_function_privilege('authenticated', 'public._layer_nodes_copy_subtree(public.layer_nodes,uuid,text,text)', 'execute')
    and not has_function_privilege('authenticated', 'public.trg_layer_nodes_to_legacy()', 'execute'));
  perform pg_temp.assert_that('E11 la vista de grupos activos no es legible por anon',
    not has_table_privilege('anon', 'public.territorial_layer_groups_active', 'select')
    and has_table_privilege('authenticated', 'public.territorial_layer_groups_active', 'select'));
end $$;

-- -----------------------------------------------------------------------------
-- E12. Lo real no se tocó
-- -----------------------------------------------------------------------------
do $$
declare v_g int; v_l int; v_f int;
begin
  -- Todo lo creado en esta prueba se cuenta aparte; lo real debe seguir completo.
  select count(*) into v_g from public.territorial_layer_groups g where g.created_at < now() - interval '1 hour';
  select count(*) into v_l from public.territorial_layers l where l.created_at < now() - interval '1 hour';
  select count(*) into v_f from public.territorial_features f where f.created_at < now() - interval '1 hour';
  perform pg_temp.assert_that('E12 los grupos reales siguen todos',
    v_g = current_setting('app.n_groups')::int, v_g || ' vs ' || current_setting('app.n_groups'));
  perform pg_temp.assert_that('E12 las capas reales siguen todas',
    v_l = current_setting('app.n_layers')::int, v_l || ' vs ' || current_setting('app.n_layers'));
  perform pg_temp.assert_that('E12 los puntos reales siguen todos',
    v_f = current_setting('app.n_feats')::int, v_f || ' vs ' || current_setting('app.n_feats'));
end $$;
