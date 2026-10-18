-- =============================================================================
-- Pruebas de 20261104000000_censo_poblacion.sql. NO es una migración. Receta (una transacción que termina en error):
--   <20261104000000_censo_poblacion.sql> (dos veces: idempotencia) + <este archivo> + do $$ begin raise exception 'DRYRUN_OK %', (select count(*) from _tr); end $$;
-- Requiere `comunas` sembrada (346 reales) y los roles de la plataforma (anon/authenticated/service_role).
-- DATOS: TODOS los valores son SINTÉTICOS (rotulados «FIXTURE»): 346 comunas reales (la FK las exige) con población inventada. Las cifras reales (346, 18.480.432, Santiago 438.856,
-- Puente Alto 568.086, Camarones 861) se verifican con el archivo real en el informe del PR y en el runbook, no aquí.
-- =============================================================================
create temp table _tr (seq serial primary key, name text not null);
grant all on _tr to public;
grant all on sequence _tr_seq_seq to public;
create or replace function pg_temp.assert_that(p_name text, p_cond boolean, p_detail text default null) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FAIL [%]: %', p_name, coalesce(p_detail, 'condición falsa'); end if;
  insert into _tr (name) values (p_name);
end $$;
create or replace function pg_temp.as_role(p_role text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('role', p_role)::text, true); execute format('set local role %I', p_role); end $$;
create or replace function pg_temp.reset_role() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
create or replace function pg_temp.try_sql(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'OK'; exception when others then return sqlstate || ':' || sqlerrm; end $$;
create or replace function pg_temp.raises_like(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return sqlerrm like p_like; end $$;

delete from public.source_checks where source_id in (select id from public.data_sources where source_key = 'ine_censo2024_poblacion_comunal');
delete from public.source_snapshots where source_id in (select id from public.data_sources where source_key = 'ine_censo2024_poblacion_comunal');
delete from public.poblacion_comunal_stage;
delete from public.poblacion_comunal_edad_stage;

create or replace function pg_temp.mk(p_tag text, p_comunas int default 346, p_end date default date '2024-12-31') returns integer language plpgsql as $$
declare v integer;
begin
  insert into public.source_snapshots (source_id, captured_by, capture_method, origin_url, storage_path, sha256, period_start, period_end, declared_date, granularity, row_count_raw, status)
  select d.id, 'test', 'manual_download', 'https://example.test/' || p_tag, 'test/' || p_tag, encode(sha256(p_tag::bytea), 'hex'), date_trunc('year', p_end)::date, p_end, date '2025-03-27',
         'snapshot', p_comunas, 'validated' from public.data_sources d where d.source_key = 'ine_censo2024_poblacion_comunal' returning n into v;
  return v;
end $$;

create or replace function pg_temp.stage_edad(p_n int, p_cut text) returns void language plpgsql as $$
begin
  insert into public.poblacion_comunal_edad_stage (snapshot_n, cut, grupo_edad, total, hombres, mujeres)
  select p_n, s.cut, g.label, (s.hombres / 18 + (case when g.i < s.hombres % 18 then 1 else 0 end)) + (s.mujeres / 18 + (case when g.i < s.mujeres % 18 then 1 else 0 end)),
         s.hombres / 18 + (case when g.i < s.hombres % 18 then 1 else 0 end), s.mujeres / 18 + (case when g.i < s.mujeres % 18 then 1 else 0 end)
    from public.poblacion_comunal_stage s
    cross join (select i - 1 as i, (array['0 a 4','5 a 9','10 a 14','15 a 19','20 a 24','25 a 29','30 a 34','35 a 39','40 a 44','45 a 49','50 a 54','55 a 59','60 a 64','65 a 69','70 a 74','75 a 79','80 a 84','85 o más'])[i] as label
                  from generate_series(1, 18) i) g
   where s.snapshot_n = p_n and (p_cut is null or s.cut = p_cut);
end $$;
-- FIXTURE: las 346 comunas con población inventada (total par = hombres + mujeres) y 18 grupos de edad que suman exactamente el total, por sexo.
create or replace function pg_temp.stage(p_n int) returns void language plpgsql as $$
begin
  insert into public.poblacion_comunal_stage (snapshot_n, cut, comuna, region_cut, province_cut, total, hombres, mujeres)
  select p_n, c.cut, 'FIXTURE ' || c.name, c.region_cut, c.province_cut, 2 * (1000 + r) - (r % 7) + (r % 7) , (1000 + r) - (r % 7), (1000 + r) + (r % 7)
    from (select c.*, row_number() over (order by c.cut)::int as r from public.comunas c) c;
  perform pg_temp.stage_edad(p_n, null);
end $$;
-- reporte con los totales «del archivo»: aquí, calculados de la zona de paso; las pruebas de error los alteran a mano
create or replace function pg_temp.rep(p_n int) returns void language plpgsql as $$
begin
  update public.source_snapshots set validation_report = jsonb_build_object(
      'pais', (select jsonb_build_object('total', sum(total), 'hombres', sum(hombres), 'mujeres', sum(mujeres)) from public.poblacion_comunal_stage where snapshot_n = p_n),
      'regiones', (select jsonb_object_agg(region_cut, jsonb_build_object('total', t, 'hombres', h, 'mujeres', m))
                     from (select region_cut, sum(total) t, sum(hombres) h, sum(mujeres) m from public.poblacion_comunal_stage where snapshot_n = p_n group by region_cut) a))
   where n = p_n;
end $$;
create or replace function pg_temp.pub(p_tag text) returns jsonb language sql as $$
  select public.publish_poblacion_snapshot((select id from public.source_snapshots where storage_path = 'test/' || p_tag))
$$;

-- =============================== 0. Estructura y permisos ===============================
select pg_temp.assert_that('la fuente está sembrada con procedencia: CC BY-SA 4.0 declarada por el INE, comprobada, con la nota de lo NO comprobado y el concepto «censada»',
  (select license_label like '%CC BY-SA 4.0%' and license_url like 'https://creativecommons.org/licenses/by-sa/4.0%' and verification_status = 'comprobado'
          and verification_note like '%1f3a9c97a1b3defa47a2fc3b8495688c4e08f164063cab704e7a18c41239e009%' and verification_note like '%[NO COMPROBADO%' and scope_note like '%NO es proyección%'
          and data_url like 'https://censo2024.ine.gob.cl/%' and dataset = 'poblacion_censo2024'
     from public.data_sources where source_key = 'ine_censo2024_poblacion_comunal'));
select pg_temp.assert_that('umbral de retención sembrado (2 capturas)', public.pipeline_setting('retention.keep_censo_snapshots') = 2);
select pg_temp.assert_that('sin captura vigente las RPC devuelven 0 filas (el front dice «sin dato»; nunca una cifra inventada)',
  (select count(*) from public.get_poblacion_comunal()) = 0 and (select count(*) from public.get_poblacion_comunal_edad()) = 0);
select pg_temp.assert_that('las tablas publicadas exigen FK a comunas, hombres + mujeres = total y región = prefijo del CUT',
  pg_temp.try_sql($$insert into public.poblacion_comunal values (1, '99999', 'x', '99', 1, 1, 0)$$) like '23503%'
  and pg_temp.try_sql($$insert into public.poblacion_comunal values (1, '13101', 'x', '13', 10, 5, 4)$$) like '23514%'
  and pg_temp.try_sql($$insert into public.poblacion_comunal values (1, '13101', 'x', '12', 10, 5, 5)$$) like '23514%');

-- =============================== 1. Publicación con las 346 comunas ===============================
select pg_temp.mk('c1');
select pg_temp.stage((select n from public.source_snapshots where storage_path = 'test/c1'));
select pg_temp.rep((select n from public.source_snapshots where storage_path = 'test/c1'));
create temp table _p1 as select pg_temp.pub('c1') as r;
select pg_temp.assert_that('publicó 346 comunas y 6.228 filas de edad (346 × 18); el total publicado = Σ de la zona de paso',
  (select (r ->> 'comunas')::int = 346 and (r ->> 'edad_rows')::int = 6228 from _p1)
  and (select count(*) from public.poblacion_comunal p join public.source_snapshots s on s.n = p.snapshot_n where s.storage_path = 'test/c1') = 346
  and (select (r ->> 'total_pais')::bigint from _p1) = (select sum(total) from public.get_poblacion_comunal()));
select pg_temp.assert_that('el snapshot quedó loaded, la zona de paso vacía, y la captura vigente trae período (año del censo) y fecha de publicación POR SEPARADO',
  (select status from public.source_snapshots where storage_path = 'test/c1') = 'loaded'
  and (select count(*) from public.poblacion_comunal_stage) = 0 and (select count(*) from public.poblacion_comunal_edad_stage) = 0
  and (select period_start = date '2024-01-01' and period_end = date '2024-12-31' and declared_date = date '2025-03-27' from public._poblacion_current_snapshot()));
select pg_temp.assert_that('get_poblacion_comunal: 346 filas, una por CUT, con nombre, región, hombres, mujeres y la procedencia de la captura',
  (select count(*) = 346 and count(distinct cut) = 346 and bool_and(hombres + mujeres = total) and bool_and(snapshot_id is not null and period_end = date '2024-12-31') from public.get_poblacion_comunal())
  and (select comuna from public.get_poblacion_comunal() where cut = '13101') like 'FIXTURE%');
select pg_temp.assert_that('get_poblacion_comunal_edad: 18 grupos por comuna, en orden, suman el total y el sexo de la comuna; p_cut inválido se rechaza',
  (select count(*) = 18 and sum(total) = (select total from public.get_poblacion_comunal() where cut = '13101') and min(grupo_edad) filter (where grupo_orden = 0) = '0 a 4'
          and min(grupo_edad) filter (where grupo_orden = 17) = '85 o más' from public.get_poblacion_comunal_edad('13101'))
  and (select count(*) from public.get_poblacion_comunal_edad()) = 6228
  and pg_temp.raises_like($$select * from public.get_poblacion_comunal_edad('1310')$$, '%p_cut%'));
select pg_temp.assert_that('get_layer_provenance (la ficha de procedencia que ya usa el front) devuelve esta fuente con su licencia y su fecha de publicación',
  (select count(*) = 1 and bool_and(license_label like '%CC BY-SA%') and bool_and(declared_date = date '2025-03-27') from public.get_layer_provenance('poblacion_censo2024')));

-- =============================== 2. Todo o nada: la base RE-VALIDA ===============================
select pg_temp.mk('c_n', 346, date '2025-12-31');
select pg_temp.stage((select n from public.source_snapshots where storage_path = 'test/c_n'));
select pg_temp.rep((select n from public.source_snapshots where storage_path = 'test/c_n'));
update public.source_snapshots set validation_report = jsonb_set(validation_report, '{pais,total}', to_jsonb((validation_report -> 'pais' ->> 'total')::bigint + 1)) where storage_path = 'test/c_n';
select pg_temp.assert_that('un total país del archivo que no cuadra con Σ comunas detiene la publicación', pg_temp.raises_like($$select pg_temp.pub('c_n')$$, '%cuadre con el total país%'));
select pg_temp.rep((select n from public.source_snapshots where storage_path = 'test/c_n'));
update public.source_snapshots set validation_report = jsonb_set(validation_report, '{regiones,13,total}', to_jsonb((validation_report -> 'regiones' -> '13' ->> 'total')::bigint + 1)) where storage_path = 'test/c_n';
select pg_temp.assert_that('un total regional que no cuadra detiene la publicación', pg_temp.raises_like($$select pg_temp.pub('c_n')$$, '%total regional%región 13%'));
select pg_temp.rep((select n from public.source_snapshots where storage_path = 'test/c_n'));
update public.source_snapshots set validation_report = '{}'::jsonb where storage_path = 'test/c_n';
select pg_temp.assert_that('sin los totales del archivo en el reporte NO se publica (el cuadre es obligatorio)', pg_temp.raises_like($$select pg_temp.pub('c_n')$$, '%falta pais / regiones%'));
select pg_temp.rep((select n from public.source_snapshots where storage_path = 'test/c_n'));
update public.poblacion_comunal_edad_stage set total = total + 1, hombres = hombres + 1 where cut = '13101' and grupo_edad = '30 a 34';
select pg_temp.assert_that('Σ de los grupos de edad ≠ total de la comuna detiene la publicación', pg_temp.raises_like($$select pg_temp.pub('c_n')$$, '%Σ de los grupos de edad%13101%'));
update public.poblacion_comunal_edad_stage set total = total - 1, hombres = hombres - 1 where cut = '13101' and grupo_edad = '30 a 34';
update public.poblacion_comunal_stage set hombres = hombres + 1 where cut = '13101';
select pg_temp.assert_that('hombres + mujeres ≠ total en una comuna detiene la publicación', pg_temp.raises_like($$select pg_temp.pub('c_n')$$, '%fuera de dominio%'));
update public.poblacion_comunal_stage set hombres = hombres - 1 where cut = '13101';
delete from public.poblacion_comunal_edad_stage where cut = '13101' and grupo_edad = '85 o más';
select pg_temp.assert_that('17 grupos de edad en una comuna detiene la publicación', pg_temp.raises_like($$select pg_temp.pub('c_n')$$, '%18 grupos de edad%'));
delete from public.poblacion_comunal_edad_stage where cut = '13101';
select pg_temp.stage_edad((select n from public.source_snapshots where storage_path = 'test/c_n'), '13101');
insert into public.poblacion_comunal_edad_stage select snapshot_n, cut, '0 a 4', total, hombres, mujeres from public.poblacion_comunal_edad_stage where cut = '13101' and grupo_edad = '0 a 4';
select pg_temp.assert_that('un grupo de edad repetido en una comuna detiene la publicación', pg_temp.raises_like($$select pg_temp.pub('c_n')$$, '%18 grupos de edad%'));
delete from public.poblacion_comunal_edad_stage where cut = '13101';
select pg_temp.stage_edad((select n from public.source_snapshots where storage_path = 'test/c_n'), '13101');
update public.source_snapshots set row_count_raw = 345 where storage_path = 'test/c_n';
select pg_temp.assert_that('row_count_raw ≠ 346 (filas leídas del archivo) detiene la publicación aunque la zona de paso esté completa', pg_temp.raises_like($$select pg_temp.pub('c_n')$$, '%row_count_raw%'));
update public.source_snapshots set row_count_raw = 346 where storage_path = 'test/c_n';
delete from public.poblacion_comunal_stage where cut = '15102';
delete from public.poblacion_comunal_edad_stage where cut = '15102';
select pg_temp.assert_that('faltan comunas (345 en vez de 346) y se detiene: no hay «sin dato» silencioso', pg_temp.raises_like($$select pg_temp.pub('c_n')$$, '%346 comunas%'));
select pg_temp.assert_that('un snapshot que no está validated no se publica', pg_temp.raises_like($$select pg_temp.pub('c1')$$, '%debe ser validated%'));
insert into public.source_snapshots (source_id, captured_by, capture_method, origin_url, storage_path, sha256, period_start, period_end, granularity, row_count_raw, status)
  select d.id, 'test', 'api', 'https://example.test/otra', 'test/otra', encode(sha256('otra'::bytea), 'hex'), current_date, current_date, 'snapshot', 0, 'validated'
    from public.data_sources d where d.source_key = 'seia_proyectos_eia';
select pg_temp.assert_that('el snapshot de otra fuente no se publica como Censo', pg_temp.raises_like($$select public.publish_poblacion_snapshot((select id from public.source_snapshots where storage_path = 'test/otra'))$$, '%no del Censo 2024%'));
select pg_temp.assert_that('tras todos los intentos fallidos sigue vigente la captura anterior, intacta (todo o nada)',
  (select snapshot_id from public._poblacion_current_snapshot()) = (select id from public.source_snapshots where storage_path = 'test/c1')
  and (select count(*) from public.poblacion_comunal p join public.source_snapshots s on s.n = p.snapshot_n where s.storage_path = 'test/c_n') = 0);
delete from public.poblacion_comunal_stage;
delete from public.poblacion_comunal_edad_stage;

-- =============================== 3. Períodos y retención ===============================
select pg_temp.mk('c_old', 346, date '2023-12-31');
select pg_temp.stage((select n from public.source_snapshots where storage_path = 'test/c_old'));
select pg_temp.rep((select n from public.source_snapshots where storage_path = 'test/c_old'));
select pg_temp.assert_that('no se publica un período más viejo que uno ya cargado', pg_temp.raises_like($$select pg_temp.pub('c_old')$$, '%período más nuevo%'));
delete from public.poblacion_comunal_stage; delete from public.poblacion_comunal_edad_stage;
select pg_temp.mk('c2', 346, date '2034-12-31');
select pg_temp.stage((select n from public.source_snapshots where storage_path = 'test/c2'));
select pg_temp.rep((select n from public.source_snapshots where storage_path = 'test/c2'));
create temp table _p2 as select pg_temp.pub('c2') as r;
select pg_temp.assert_that('un período más nuevo pasa a ser la captura vigente; el anterior queda superseded y se CONSERVA (retención 2)',
  (select snapshot_id from public._poblacion_current_snapshot()) = (select id from public.source_snapshots where storage_path = 'test/c2')
  and (select status from public.source_snapshots where storage_path = 'test/c1') = 'superseded'
  and (select count(*) from public.poblacion_comunal p join public.source_snapshots s on s.n = p.snapshot_n where s.storage_path = 'test/c1') = 346);
select pg_temp.mk('c3', 346, date '2044-12-31');
select pg_temp.stage((select n from public.source_snapshots where storage_path = 'test/c3'));
select pg_temp.rep((select n from public.source_snapshots where storage_path = 'test/c3'));
create temp table _p3 as select pg_temp.pub('c3') as r;
select pg_temp.assert_that('un tercer período retira el más viejo (retención 2): sin filas de población NI de edad de c1',
  (select (r ->> 'old_snapshots_cleared')::int from _p3) = 1
  and (select count(*) from public.poblacion_comunal p join public.source_snapshots s on s.n = p.snapshot_n where s.storage_path = 'test/c1') = 0
  and (select count(*) from public.poblacion_comunal_edad e join public.source_snapshots s on s.n = e.snapshot_n where s.storage_path = 'test/c1') = 0
  and (select count(*) from public.poblacion_comunal_stage) = 0);

-- =============================== 4. Permisos ===============================
select pg_temp.as_role('anon');
select pg_temp.assert_that('anon no lee las tablas ni ejecuta ninguna RPC de población',
  pg_temp.try_sql('select count(*) from public.poblacion_comunal') like '42501%' and pg_temp.try_sql('select count(*) from public.poblacion_comunal_edad') like '42501%'
  and pg_temp.try_sql('select * from public.get_poblacion_comunal()') like '42501%' and pg_temp.try_sql('select * from public.get_poblacion_comunal_edad()') like '42501%');
select pg_temp.reset_role();
select pg_temp.as_role('authenticated');
select pg_temp.assert_that('authenticated SOLO lee: puede consultar las RPC y las tablas, pero no publica, no escribe, no borra y no ve la zona de paso',
  pg_temp.try_sql('select count(*) from public.get_poblacion_comunal()') = 'OK' and pg_temp.try_sql($$select count(*) from public.get_poblacion_comunal_edad('13101')$$) = 'OK'
  and pg_temp.try_sql('select count(*) from public.poblacion_comunal') = 'OK'
  and pg_temp.try_sql($$select public.publish_poblacion_snapshot('00000000-0000-0000-0000-000000000000')$$) like '42501%'
  and pg_temp.try_sql($$insert into public.poblacion_comunal values (1, '13101', 'x', '13', 2, 1, 1)$$) like '42501%'
  and pg_temp.try_sql('update public.poblacion_comunal set total = 1') like '42501%' and pg_temp.try_sql('delete from public.poblacion_comunal') like '42501%'
  and pg_temp.try_sql('select count(*) from public.poblacion_comunal_stage') like '42501%');
select pg_temp.reset_role();
select pg_temp.assert_that('service_role puede publicar (grant) y authenticated no; la función de publicación fija search_path (SECURITY DEFINER)',
  has_function_privilege('service_role', 'public.publish_poblacion_snapshot(uuid)', 'execute') and not has_function_privilege('authenticated', 'public.publish_poblacion_snapshot(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.publish_poblacion_snapshot(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.get_poblacion_comunal()', 'execute') and not has_function_privilege('anon', 'public.get_poblacion_comunal_edad(text)', 'execute')
  and has_function_privilege('authenticated', 'public.get_poblacion_comunal()', 'execute')
  and (select prosecdef and exists (select 1 from unnest(proconfig) c where c like 'search_path=%') from pg_proc where oid = 'public.publish_poblacion_snapshot(uuid)'::regprocedure));
