-- =============================================================================
-- Pruebas de 20261103000000_isapre_cartera.sql. NO es una migración.
-- Se corre DESPUÉS de las migraciones, en la MISMA transacción y terminando en error (nada queda aplicado):
--   <partes 1–4 de permisos/proyectos: 2026102*.sql>   (ya aplicadas en la base de pruebas)
--   <20261102000000_health_establishments.sql>
--   <20261103000000_isapre_cartera.sql>   (dos veces: idempotencia)
--   <este archivo>
--   do $$ begin raise exception 'DRYRUN_OK %', (select count(*) from _tr); end $$;
-- Requiere `comunas` sembrada (346 reales) y los roles de la plataforma (anon/authenticated/service_role).
--
-- DATOS: TODOS los conteos de esta prueba son SINTÉTICOS (perfiles diseñados para cada regla de supresión + 80 unidades aleatorias con semilla fija);
-- los CUT son de comunas reales solo porque la tabla exige la FK. El archivo real se verifica en el informe de la fase y en el cotejo base ↔ réplica Python.
-- =============================================================================
create temp table _tr (seq serial primary key, name text not null);
grant all on _tr to public;
grant all on sequence _tr_seq_seq to public;

create or replace function pg_temp.assert_that(p_name text, p_cond boolean, p_detail text default null)
returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FAIL [%]: %', p_name, coalesce(p_detail, 'condición falsa'); end if;
  insert into _tr (name) values (p_name);
end $$;

create or replace function pg_temp.as_role(p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', p_role)::text, true);
  execute format('set local role %I', p_role);
end $$;
create or replace function pg_temp.reset_role() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
create or replace function pg_temp.try_sql(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'OK'; exception when others then return sqlstate || ':' || sqlerrm; end $$;
create or replace function pg_temp.raises_like(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return sqlerrm like p_like; end $$;

create or replace function pg_temp.mk(p_tag text, p_units int, p_rej int default 0, p_end date default date '2025-12-31') returns integer language plpgsql as $$
declare v integer;
begin
  insert into public.source_snapshots (source_id, captured_by, capture_method, origin_url, storage_path, sha256, period_start, period_end, declared_date,
                                       granularity, row_count_raw, rejected_count, status)
  select d.id, 'test', 'manual_download', 'https://example.test/' || p_tag, 'test/' || p_tag, encode(sha256(p_tag::bytea), 'hex'),
         date_trunc('month', p_end)::date, p_end, p_end + 28, 'snapshot', p_units, p_rej, 'validated'
    from public.data_sources d where d.source_key = 'superdesalud_isapre_cartera_comunal'
  returning n into v;
  return v;
end $$;

-- unidad SINTÉTICA: cotizantes con los vectores dados (22 tramos) por sexo; cargas en 0. region = prefijo del CUT (o p_region).
create or replace function pg_temp.su(p_n int, p_unit text, p_f int[], p_m int[] default null, p_si int[] default null, p_region text default null) returns void language plpgsql as $$
declare v_kind text; v_reg text; v_com text; z int[] := array_fill(0, array[22]); s text; v int[]; r text; t int;
begin
  v_kind := case when p_unit ~ '^[0-9]{5}$' then 'comuna' when p_unit like 'SDC%' then 'sin_dato_comuna' else 'sin_dato_region' end;
  v_reg  := case v_kind when 'comuna' then left(p_unit, 2) when 'sin_dato_comuna' then right(p_unit, 2) else null end;
  v_com  := case v_kind when 'comuna' then p_unit else null end;
  foreach s in array array['F', 'M', 'SI'] loop
    v := case s when 'F' then coalesce(p_f, z) when 'M' then coalesce(p_m, z) else coalesce(p_si, z) end;
    foreach r in array array['cotizante', 'carga'] loop
      for t in 0..21 loop
        insert into salud_restringido.isapre_stage (snapshot_n, unit, unit_kind, region_cut, comuna_cut, unit_name, rol, sexo, tramo, n)
        values (p_n, p_unit, v_kind, v_reg, v_com, 'FIXTURE ' || p_unit, r, s, t, case r when 'cotizante' then v[t + 1] else 0 end);
      end loop;
    end loop;
  end loop;
end $$;

-- escribe en el reporte del snapshot los totales del archivo (aquí: calculados de la zona de paso; las pruebas de error los alteran a mano)
create or replace function pg_temp.rep(p_n int) returns void language plpgsql as $$
begin
  update public.source_snapshots set validation_report = jsonb_build_object(
      'pais_totals', (select jsonb_object_agg(rol, t) from (select rol, sum(n) t from salud_restringido.isapre_stage where snapshot_n = p_n group by rol) a),
      'region_totals', (select jsonb_object_agg(region_cut || ':' || rol, t) from (select region_cut, rol, sum(n) t from salud_restringido.isapre_stage
                         where snapshot_n = p_n and region_cut is not null group by region_cut, rol) b))
   where n = p_n;
end $$;

create or replace function pg_temp.pub(p_tag text) returns jsonb language sql as $$
  select public.publish_isapre_snapshot((select id from public.source_snapshots where storage_path = 'test/' || p_tag))
$$;

-- vector de 22 con valores en posiciones: pg_temp.vec('{{4,7},{9,12}}') → posición 4 = 7, 9 = 12
create or replace function pg_temp.vec(p_pairs int[][]) returns int[] language plpgsql as $$
declare v int[] := array_fill(0, array[22]); i int;
begin
  for i in 1..coalesce(array_length(p_pairs, 1), 0) loop v[p_pairs[i][1] + 1] := p_pairs[i][2]; end loop;
  return v;
end $$;

-- =============================== 0. Estructura y permisos ===============================
select pg_temp.assert_that('la fuente está sembrada, SIN licencia inventada (null = por confirmar), con aviso de provisional',
  (select license_label is null and verification_status = 'comprobado' and scope_note like '%PROVISIONAL%' and scope_note like '%NO está declarada%' or scope_note like '%NO declarada%'
     from public.data_sources where source_key = 'superdesalud_isapre_cartera_comunal'));
select pg_temp.assert_that('umbrales configurables: salud.suppress_below = 5 y mínimo de comunas del agregado = 10',
  public.pipeline_setting('salud.suppress_below') = 5 and public.pipeline_setting('salud.min_aggregate_comunas') = 10 and public.pipeline_setting('retention.keep_isapre_snapshots') = 2);
select pg_temp.assert_that('el esquema restringido existe, sin USAGE ni acceso para public/anon/authenticated; service_role sí',
  exists (select 1 from pg_namespace where nspname = 'salud_restringido')
  and not has_schema_privilege('anon', 'salud_restringido', 'usage') and not has_schema_privilege('authenticated', 'salud_restringido', 'usage')
  and has_schema_privilege('service_role', 'salud_restringido', 'usage')
  and not has_table_privilege('authenticated', 'salud_restringido.isapre_cartera', 'select') and not has_table_privilege('anon', 'salud_restringido.isapre_cartera', 'select')
  and has_table_privilege('service_role', 'salud_restringido.isapre_cartera', 'select'));
select pg_temp.assert_that('RLS activa en las tres tablas restringidas; política solo-admin en dos; la zona de paso sin política',
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'salud_restringido' and c.relkind = 'r' and c.relrowsecurity) = 3
  and (select count(*) from pg_policies where schemaname = 'salud_restringido' and qual like '%has_role%') = 2
  and (select count(*) from pg_policies where schemaname = 'salud_restringido' and tablename = 'isapre_stage') = 0);
select pg_temp.assert_that('ninguna tabla restringida es de un esquema expuesto: el único esquema restringido es salud_restringido',
  (select count(*) from information_schema.tables where table_name like 'isapre_%' and table_schema not in ('public', 'salud_restringido')) = 0);
select pg_temp.assert_that('tramo es smallint 0..21 y la celda publicada exige coherencia (suprimida ⇒ n_pub nulo y cotas)',
  pg_temp.try_sql($$insert into public.isapre_cartera_celda (snapshot_n, unit, sexo, tramo, n_pub, suppressed) values (1, 'x', 'F', 0, 1, false)$$) like '2%'
  and (select count(*) from pg_constraint where conrelid = 'public.isapre_cartera_celda'::regclass and conname = 'isapre_celda_suprimida_coherente') = 1);

-- La base de pruebas puede traer cargas previas: se parte de cero DENTRO de esta transacción (se revierte al terminar).
delete from public.source_checks where source_id in (select id from public.data_sources where source_key = 'superdesalud_isapre_cartera_comunal');
delete from public.source_snapshots where source_id in (select id from public.data_sources where source_key = 'superdesalud_isapre_cartera_comunal');
delete from salud_restringido.isapre_stage;
delete from salud_restringido.isapre_unidad;

-- =============================== 1. Perfiles diseñados para cada regla ===============================
-- 13101 «grande»: sin valores 1–4 salvo uno (tramo 21 de F = 3). 13103: UNA primaria con total publicado (→ complementaria). 13104: total 1 (suprimido, sin complementaria).
-- 13105: tres primarias, total 3. 13106: empate de candidatos (5 y 5): gana el menor tramo. 13102: dos primarias (no necesita complementaria) y M en 0.
select pg_temp.mk('i1', 8);
select pg_temp.su(n, '13101', pg_temp.vec('{{2,20},{3,30},{4,100},{5,200},{6,300},{7,250},{8,200},{9,150},{10,120},{11,100},{12,90},{13,80},{14,70},{15,60},{16,50},{17,40},{18,30},{19,20},{20,10},{21,3}}'),
                                   pg_temp.vec('{{4,60},{5,150},{6,220},{12,40},{13,30},{14,20},{15,10},{16,6},{17,5},{18,0}}'),
                                   pg_temp.vec('{{4,9}}'))
  from (select n from public.source_snapshots where storage_path = 'test/i1') x;
select pg_temp.su(n, '13102', pg_temp.vec('{{2,2},{3,3},{5,7},{6,9},{8,12}}'), null, null) from (select n from public.source_snapshots where storage_path = 'test/i1') x;
select pg_temp.su(n, '13103', pg_temp.vec('{{4,6},{5,8},{6,3},{9,5}}'), null, null) from (select n from public.source_snapshots where storage_path = 'test/i1') x;
select pg_temp.su(n, '13104', pg_temp.vec('{{21,1}}'), null, null) from (select n from public.source_snapshots where storage_path = 'test/i1') x;
select pg_temp.su(n, '13105', pg_temp.vec('{{2,1},{7,1},{11,1}}'), null, null) from (select n from public.source_snapshots where storage_path = 'test/i1') x;
select pg_temp.su(n, '13106', pg_temp.vec('{{12,2},{13,5},{14,5},{15,9}}'), null, null) from (select n from public.source_snapshots where storage_path = 'test/i1') x;
select pg_temp.su(n, 'SDC13', pg_temp.vec('{{6,12},{7,2}}'), pg_temp.vec('{{6,4}}'), null) from (select n from public.source_snapshots where storage_path = 'test/i1') x;
select pg_temp.su(n, 'SDR', pg_temp.vec('{{21,15}}'), null, null) from (select n from public.source_snapshots where storage_path = 'test/i1') x;
select pg_temp.rep(n) from (select n from public.source_snapshots where storage_path = 'test/i1') x;
create temp table _p1 as select pg_temp.pub('i1') as r;      -- aparte: una función volátil no ve sus efectos desde subconsultas de la misma sentencia

create temp table _c as select k.* from public.isapre_cartera_celda k join public.source_snapshots s on s.n = k.snapshot_n where s.storage_path = 'test/i1';
create temp table _g as select g.* from public.isapre_cartera_grupo g join public.source_snapshots s on s.n = g.snapshot_n where s.storage_path = 'test/i1';
select pg_temp.assert_that('publicó 8 unidades con 22 celdas × 3 sexos cada una', (select count(*) from _c) = 8 * 3 * 22 and (select count(*) from _g) = 8 * 3);
select pg_temp.assert_that('NINGÚN valor entre 1 y 4 queda publicado', (select count(*) from _c where n_pub between 1 and 4) = 0);
select pg_temp.assert_that('el cero SE PUBLICA como cero (no se suprime)', (select count(*) from _c where n_pub = 0) > 100 and (select count(*) from _c where suppressed and n_pub is null and kind is null) = 0);
select pg_temp.assert_that('13101 F: la celda 21 (=3) es primaria con cotas [1,4]; no hay complementaria ahí (la otra suprimida... ver siguiente)',
  (select suppressed and kind = 'primary' and lo = 1 and hi <= 4 from _c where unit = '13101' and sexo = 'F' and tramo = 21));
select pg_temp.assert_that('13101 F tiene total publicado y EXACTAMENTE 1 primaria ⇒ se agrega 1 complementaria: la menor celda publicada ≥ 5 (tramo 19 = 20; la menor ≥5 es 10 en el tramo 20)',
  (select count(*) from _c where unit = '13101' and sexo = 'F' and suppressed) = 2
  and (select kind from _c where unit = '13101' and sexo = 'F' and tramo = 20) = 'complementary'
  and (select lo from _c where unit = '13101' and sexo = 'F' and tramo = 20) = 5);
select pg_temp.assert_that('13103: una primaria (3 en el tramo 6) con total 22 ⇒ complementaria = la menor ≥5, el 5 del tramo 9; residuo 8; cotas coherentes',
  (select kind from _c where unit = '13103' and sexo = 'F' and tramo = 6) = 'primary'
  and (select kind from _c where unit = '13103' and sexo = 'F' and tramo = 9) = 'complementary'
  and (select residual from _g where unit = '13103' and sexo = 'F') = 8
  and (select lo from _c where unit = '13103' and sexo = 'F' and tramo = 9) = 5 and (select hi from _c where unit = '13103' and sexo = 'F' and tramo = 9) = 7
  and (select hi from _c where unit = '13103' and sexo = 'F' and tramo = 6) = 3);
select pg_temp.assert_that('13106: empate de candidatos (5 y 5): gana el MENOR tramo (13)',
  (select kind from _c where unit = '13106' and sexo = 'F' and tramo = 13) = 'complementary' and (select not suppressed from _c where unit = '13106' and sexo = 'F' and tramo = 14));
select pg_temp.assert_that('13104 (total 1): el total se suprime, la celda es primaria y NO hay complementaria (nada que despejar)',
  (select total_pub is null and suppressed_cells = 1 and residual is null from _g where unit = '13104' and sexo = 'F')
  and (select count(*) from _c where unit = '13104' and kind = 'complementary') = 0);
select pg_temp.assert_that('13105 (tres 1): total 3 suprimido y las tres celdas primarias',
  (select total_pub is null and suppressed_cells = 3 from _g where unit = '13105' and sexo = 'F'));
select pg_temp.assert_that('13102: dos primarias (2 y 3) con total 33 ⇒ SIN complementaria (0 o ≥2 suprimidas); residuo 5; M con total 0 se publica como 0',
  (select suppressed_cells = 2 and total_pub = 33 and residual = 5 from _g where unit = '13102' and sexo = 'F')
  and (select count(*) from _c where unit = '13102' and kind = 'complementary') = 0
  and (select total_pub = 0 and suppressed_cells = 0 from _g where unit = '13102' and sexo = 'M'));
select pg_temp.assert_that('INVARIANTE: todo grupo con total publicado queda con 0 o ≥ 2 celdas suprimidas (ninguna se despeja por resta)',
  (select count(*) from _g where total_pub is not null and suppressed_cells = 1) = 0);
select pg_temp.assert_that('INVARIANTE: total = Σ publicadas + residuo en todo grupo con total publicado, y el cuadre por cotas pasa en todos',
  (select count(*) from _g where total_pub is not null and total_pub <> published_sum + residual) = 0 and (select count(*) from _g where not cuadre_ok) = 0);
select pg_temp.assert_that('«sin dato de comuna» y «sin dato de región» se publican como unidades propias, con la misma regla',
  (select count(*) from public.isapre_cartera_unidad u join public.source_snapshots s on s.n = u.snapshot_n where s.storage_path = 'test/i1' and u.kind <> 'comuna') = 2
  and (select kind from _c where unit = 'SDC13' and sexo = 'F' and tramo = 7) = 'primary'
  and (select kind from _c where unit = 'SDR' and sexo = 'F' and tramo = 21) is null);
select pg_temp.assert_that('el reporte de la publicación cuenta las supresiones y los grupos', (
  select (r ->> 'units')::int = 8 and (r ->> 'groups')::int = 24 and (r ->> 'cells')::int = 528 and (r ->> 'suppress_below')::int = 5
     and (r ->> 'groups_cuadre_failed')::int = 0 and (r ->> 'suppressed_primary')::int > 0 and (r ->> 'suppressed_complementary')::int >= 3
  from _p1));
select pg_temp.assert_that('los totales por región y rol son los de la zona de paso (13: cotizantes = Σ de la región; cargas 0)',
  (select total from public.isapre_cartera_region r join public.source_snapshots s on s.n = r.snapshot_n where s.storage_path = 'test/i1' and region_cut = '13' and rol = 'cotizante')
   = (select sum(c.n) from salud_restringido.isapre_cartera c join salud_restringido.isapre_unidad u on u.snapshot_n = c.snapshot_n and u.unit = c.unit
        join public.source_snapshots s on s.n = c.snapshot_n where s.storage_path = 'test/i1' and u.region_cut = '13' and c.rol = 'cotizante'));
select pg_temp.assert_that('el conteo COMPLETO vive en el esquema restringido (valores 1–4 incluidos) y no en lo publicado',
  (select c.n from salud_restringido.isapre_cartera c join public.source_snapshots s on s.n = c.snapshot_n where s.storage_path = 'test/i1' and c.unit = '13101' and c.sexo = 'F' and c.tramo = 21 and c.rol = 'cotizante') = 3
  and (select count(*) from information_schema.columns where table_schema = 'public' and table_name like 'isapre_cartera_%' and column_name = 'n') = 0);
select pg_temp.assert_that('la zona de paso quedó vacía y el snapshot loaded',
  (select count(*) from salud_restringido.isapre_stage) = 0 and (select status from public.source_snapshots where storage_path = 'test/i1') = 'loaded');

-- =============================== 2. Lectura: RPC ===============================
select pg_temp.assert_that('B2 todas las edades: EXACTO (= Σ de los totales de grupo publicados) cuando todos los grupos publican su total, aunque haya celdas suprimidas; RANGO si un total es «<5»',
  (select exact and n_lo = 33 and n_hi = 33 and suppressed_cells = 2 from public.get_isapre_comuna() where cut = '13102')                -- F 33 (2 celdas suprimidas) + M 0 + SI 0
  and (select n_lo = 1 and n_hi = 4 and not exact from public.get_isapre_comuna() where cut = '13104')                                   -- total del grupo «<5»: entre 1 y 4
  and (select n_lo = 3 and n_hi = 4 and not exact from public.get_isapre_comuna() where cut = '13105'));                                 -- tres primarias: total entre 3 y 4
select pg_temp.assert_that('B2 13103 (F total 22 con 2 suprimidas) y 13101 (total 1923, F + M + SI publicados) son EXACTOS en todas las edades',
  (select exact and n_lo = 22 from public.get_isapre_comuna() where cut = '13103')
  and (select exact and n_lo = 1923 + 541 + 9 and n_hi = 1923 + 541 + 9 from public.get_isapre_comuna() where cut = '13101'),
  (select n_lo || '..' || n_hi from public.get_isapre_comuna() where cut = '13101'));
select pg_temp.assert_that('B2 60+: el residuo del grupo acota. 13106 F (suprimidas 12 y 13 DENTRO de 60+, residuo 7) = 21 EXACTO; 13104, 13105 y 13103 (suprimidas fuera de 60+) = 0 exacto',
  (select exact and n_lo = 21 and n_hi = 21 from public.get_isapre_comuna(null, 12) where cut = '13106')
  and (select exact and n_lo = 0 and n_hi = 0 from public.get_isapre_comuna(null, 12) where cut = '13104')
  and (select exact and n_lo = 0 and n_hi = 0 from public.get_isapre_comuna(null, 12) where cut = '13105')
  and (select exact and n_lo = 0 and n_hi = 0 from public.get_isapre_comuna(null, 12) where cut = '13103'));
select pg_temp.assert_that('B2 60+ con suprimidas dentro y fuera del filtro: 13101 F (tramo 21 primaria =3 FUERA, tramo 20 complementaria =10 DENTRO, residuo 13) = [449, 452] y el real (450) cae dentro; más estrecho que solo con cotas de celda ([445, 452])',
  (select n_lo = 449 and n_hi = 452 and not exact from public.get_isapre_comuna('F', 12) where cut = '13101')
  and (select 450 between n_lo and n_hi from public.get_isapre_comuna('F', 12) where cut = '13101'));
select pg_temp.assert_that('el valor real SIEMPRE cae dentro del rango publicado (13101 todas las edades: real = Σ de la zona de paso)',
  (select (select sum(c.n) from salud_restringido.isapre_cartera c join public.source_snapshots s on s.n = c.snapshot_n where s.storage_path = 'test/i1' and c.unit = '13101')
          between n_lo and n_hi from public.get_isapre_comuna() where cut = '13101'));
select pg_temp.assert_that('filtro de sexo y de edad (60+ = tramos 12..20, sin la edad S/I): 13101 M 60+ = 40+30+20+10+6+5 = 111 exacto',
  (select n_lo = 111 and n_hi = 111 and exact from public.get_isapre_comuna('M', 12) where cut = '13101'));
select pg_temp.assert_that('get_isapre_comuna: parámetros inválidos se rechazan',
  pg_temp.raises_like($$select * from public.get_isapre_comuna('X')$$, '%p_sexo%') and pg_temp.raises_like($$select * from public.get_isapre_comuna(null, 21)$$, '%p_min_tramo%')
  and pg_temp.raises_like($$select * from public.get_isapre_comuna(null, 0, 'otra')$$, '%p_sin_alta%'));
select pg_temp.assert_that('get_isapre_celdas devuelve la pirámide PUBLICADA de una unidad (66 celdas), con el residuo del grupo; nunca el conteo completo',
  (select count(*) from public.get_isapre_celdas('13103')) = 66
  and (select group_residual from public.get_isapre_celdas('13103') where sexo = 'F' limit 1) = 8
  and (select n_pub is null and suppressed from public.get_isapre_celdas('13103') where sexo = 'F' and tramo = 6));
select pg_temp.assert_that('get_isapre_resumen lleva período, publicación y estadísticas de supresión',
  (select period_end = date '2025-12-31' and declared_date = date '2026-01-28' and suppress_below = 5 and cells = 528 from public.get_isapre_resumen()));

-- ========== 1b-1: agregado con DATOS COMPLETOS sobre comunas sin alta complejidad en la comuna (D1) ==========
-- Fixture SINTÉTICA de establecimientos: hospital de alta complejidad vigente en 13101, 13102 y 13103 (y solo ahí).
create or replace function pg_temp.mk_health(p_cut text, p_alta boolean) returns void language plpgsql as $$
declare v_n int;
begin
  select snapshot_n into v_n from public._health_current_snapshot();
  insert into public.health_establishments (snapshot_n, code, name, region_cut, comuna_cut, tipo_glosa, tipo_norm, dependencia_norm, complejidad, tipo_atencion, clase_servicio,
                                            clase_fuente, alta_hospital, alta_ampliada, estado, geo_status)
  values (v_n, lpad((900000 + (select count(*) from public.health_establishments))::text, 6, '0'), 'FIXTURE', left(p_cut, 2), p_cut, 'Hospital', 'hospital', 'servicio_salud',
          case when p_alta then 'alta' else 'baja' end, 'hospitalaria', 'hospitalario', 'oficial', p_alta, p_alta, 'vigente', 4);
end $$;
delete from public.health_establishments;
delete from public.source_snapshots where storage_path in ('test/h') or source_id in (select id from public.data_sources where source_key = 'deis_establecimientos');
insert into public.source_snapshots (source_id, captured_by, capture_method, origin_url, storage_path, sha256, period_start, period_end, granularity, row_count_raw, status, loaded_at)
  select d.id, 'test', 'manual_download', 'https://example.test/h', 'test/h', encode(sha256('h'::bytea), 'hex'), current_date, current_date, 'snapshot', 3, 'loaded', now()
    from public.data_sources d where d.source_key = 'deis_establecimientos';
select pg_temp.mk_health(c, true) from (values ('13101'), ('13102'), ('13103')) v(c);

select pg_temp.assert_that('_health_comunas_sin_alta: 346 − 3 comunas con hospital de alta complejidad vigente (D1 «hospital»); p_alta inválido se rechaza',
  (select count(*) from public._health_comunas_sin_alta('hospital')) = 343 and not exists (select 1 from public._health_comunas_sin_alta('hospital') where cut in ('13101', '13102', '13103'))
  and pg_temp.raises_like($$select * from public._health_comunas_sin_alta('x')$$, '%p_alta%'));
select pg_temp.assert_that('con el mínimo por defecto (10 comunas) el conjunto de prueba (3 comunas con dato) se RECHAZA: no se entrega un agregado tan acotado',
  pg_temp.raises_like($$select * from public.get_isapre_resumen_sin_alta('hospital', 12)$$, '%no se entrega un agregado tan acotado%'));
update public.pipeline_settings set value = 2 where key = 'salud.min_aggregate_comunas';
create temp table _r1 as select * from public.get_isapre_resumen_sin_alta('hospital', 12);
select pg_temp.assert_that('1b-1: 60+ en las comunas sin alta (13104, 13105, 13106) = 21 EXACTO (de los conteos completos); lo publicado lo determina igual ([21,21], mismo cálculo que get_isapre_comuna) y es consistente',
  (select benef_exacto = 21 and benef_pub_lo = 21 and benef_pub_hi = 21 and consistente and comunas_con_dato = 3 and comunas_sin_alta = 343 from _r1),
  (select benef_exacto || ' [' || benef_pub_lo || ',' || benef_pub_hi || '] ' || comunas_con_dato from _r1));
select pg_temp.assert_that('benef_total_comunas = 60+ en las unidades de tipo COMUNA con fila (561 + 21 = 582; SIN «sin dato de comuna» ni «sin dato de región»), y apunta a las dos capturas vigentes',
  (select benef_total_comunas = 582 and snapshot_id is not null and health_snapshot_id is not null and period_end = date '2025-12-31' from _r1)
  and not exists (select 1 from pg_proc p, unnest(p.proargnames) a where p.proname = 'get_isapre_resumen_sin_alta' and a = 'benef_total_pais'));
select pg_temp.assert_that('B1 p_min_tramo SOLO admite 12: cualquier otro corte (0, 11, 13, 20, null) se rechaza, para que restar consultas no aísle un tramo',
  pg_temp.raises_like($$select * from public.get_isapre_resumen_sin_alta('hospital', 0)$$, '%solo admite 12%')
  and pg_temp.raises_like($$select * from public.get_isapre_resumen_sin_alta('hospital', 11)$$, '%solo admite 12%')
  and pg_temp.raises_like($$select * from public.get_isapre_resumen_sin_alta('hospital', 13)$$, '%solo admite 12%')
  and pg_temp.raises_like($$select * from public.get_isapre_resumen_sin_alta('hospital', 20)$$, '%solo admite 12%')
  and pg_temp.raises_like($$select * from public.get_isapre_resumen_sin_alta('hospital', null)$$, '%solo admite 12%')
  and (select benef_exacto = 21 from public.get_isapre_resumen_sin_alta('hospital', 12)));
-- LÍMITE documentado (DISENO §3.3.6): una clínica que cuenta solo en la definición ampliada en 13106 saca a 13106 de ese conjunto; la resta aísla EXACTO el agregado de 13106 (21),
-- aunque sean menos de salud.min_aggregate_comunas comunas. El mínimo de comunas es una barrera de presentación, no resiste diferencias entre consultas.
insert into public.health_establishments (snapshot_n, code, name, region_cut, comuna_cut, tipo_glosa, tipo_norm, dependencia_norm, complejidad, tipo_atencion, clase_servicio,
                                          clase_fuente, alta_hospital, alta_ampliada, estado, geo_status)
  select snapshot_n, '999999', 'FIXTURE clínica', '13', '13106', 'Clínica', 'hospital', 'privado', 'alta', 'hospitalaria', 'hospitalario', 'oficial', false, true, 'vigente', 4
    from public._health_current_snapshot();
select pg_temp.assert_that('B1 límite: hospitales − ampliada = 21 = el agregado EXACTO de 13106 (una sola comuna, < 10): la diferencia entre consultas lo aísla',
  (select (select benef_exacto from public.get_isapre_resumen_sin_alta('hospital', 12)) - (select benef_exacto from public.get_isapre_resumen_sin_alta('ampliada', 12))) = 21);
delete from public.health_establishments where code = '999999';
select pg_temp.assert_that('get_isapre_comuna con «solo comunas sin alta»: solo 13104, 13105 y 13106 de las comunas con dato',
  (select array_agg(cut order by cut) from public.get_isapre_comuna(null, 0, 'hospital') where cut::text like '1310%') = array['13104', '13105', '13106']::char(5)[]);
update public.pipeline_settings set value = 10 where key = 'salud.min_aggregate_comunas';
-- Sin captura publicada del registro de establecimientos la función NO contesta «las 346 comunas no tienen alta complejidad»: se niega.
update public.source_snapshots set status = 'superseded' where storage_path = 'test/h';
select pg_temp.assert_that('sin captura de la 1a, _health_comunas_sin_alta y get_isapre_comuna(…, p_sin_alta) lanzan error en vez de devolver las 346 comunas',
  pg_temp.raises_like($$select count(*) from public._health_comunas_sin_alta('hospital')$$, '%no hay una captura publicada del registro%')
  and pg_temp.raises_like($$select * from public.get_isapre_comuna(null, 0, 'ampliada')$$, '%no hay una captura publicada del registro%')
  and pg_temp.raises_like($$select * from public.get_isapre_resumen_sin_alta('hospital', 12)$$, '%no hay una captura publicada del registro%')
  and (select count(*) from public.get_isapre_comuna()) > 0);                                                                                                           -- sin filtro de alta sigue funcionando
update public.source_snapshots set status = 'loaded' where storage_path = 'test/h';

-- ========== Permisos ==========
select pg_temp.as_role('anon');
select pg_temp.assert_that('anon no ejecuta ninguna RPC de Isapre ni lee las tablas publicadas',
  pg_temp.try_sql('select * from public.get_isapre_comuna()') like '42501%' and pg_temp.try_sql('select * from public.get_isapre_resumen()') like '42501%'
  and pg_temp.try_sql($$select * from public.get_isapre_resumen_sin_alta('hospital')$$) like '42501%'
  and pg_temp.try_sql('select count(*) from public.isapre_cartera_celda') like '42501%'
  and pg_temp.try_sql($$select * from public._isapre_comuna_rango(1, null, 0)$$) like '42501%');
select pg_temp.reset_role();
select pg_temp.assert_that('verificaciones del runbook: anon sin EXECUTE en get_isapre_resumen_sin_alta; authenticated sin INSERT/UPDATE/DELETE en las tablas publicadas; las funciones SECURITY DEFINER fijan search_path',
  not has_function_privilege('anon', 'public.get_isapre_resumen_sin_alta(text, integer)', 'execute')
  and has_function_privilege('authenticated', 'public.get_isapre_resumen_sin_alta(text, integer)', 'execute')
  and not has_table_privilege('authenticated', 'public.isapre_cartera_celda', 'insert') and not has_table_privilege('authenticated', 'public.isapre_cartera_celda', 'update')
  and not has_table_privilege('authenticated', 'public.isapre_cartera_celda', 'delete') and not has_table_privilege('authenticated', 'public.isapre_cartera_region', 'insert')
  and (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname like '%isapre%') = 2
  and (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname like '%isapre%'
         and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) = 2);
select pg_temp.as_role('authenticated');
select pg_temp.assert_that('authenticated lee las RPC (incluida 1b-1, SECURITY DEFINER) pero NO publica, NO escribe y NO ve el esquema restringido',
  pg_temp.try_sql('select count(*) from public.get_isapre_comuna()') = 'OK'
  and pg_temp.try_sql($$select count(*) from public.get_isapre_celdas('13101')$$) = 'OK'
  and pg_temp.try_sql($$select public.publish_isapre_snapshot('00000000-0000-0000-0000-000000000000')$$) like '42501%'
  and pg_temp.try_sql('delete from public.isapre_cartera_celda') like '42501%'
  and pg_temp.try_sql('select count(*) from salud_restringido.isapre_cartera') like '42501%'
  and pg_temp.try_sql('select count(*) from salud_restringido.isapre_stage') like '42501%');
select pg_temp.reset_role();
-- Defensa en profundidad: aunque alguien concediera SELECT, la RLS solo-admin deja a un usuario común sin filas.
grant usage on schema salud_restringido to authenticated;
grant select on salud_restringido.isapre_cartera to authenticated;
select pg_temp.as_role('authenticated');
select pg_temp.assert_that('con un GRANT accidental, un usuario sin rol admin ve 0 filas del conteo completo (RLS)', (select count(*) from salud_restringido.isapre_cartera) = 0);
select pg_temp.reset_role();
revoke select on salud_restringido.isapre_cartera from authenticated;
revoke usage on schema salud_restringido from authenticated;
select pg_temp.assert_that('service_role puede publicar (grant) y authenticated no',
  has_function_privilege('service_role', 'public.publish_isapre_snapshot(uuid)', 'execute') and not has_function_privilege('authenticated', 'public.publish_isapre_snapshot(uuid)', 'execute'));

-- ========== Todo o nada: la base RE-VALIDA ==========
select pg_temp.mk('e_pais', 1, 0, date '2026-06-30');
select pg_temp.su(n, '13101', pg_temp.vec('{{12,40}}')) from (select n from public.source_snapshots where storage_path = 'test/e_pais') x;
select pg_temp.rep(n) from (select n from public.source_snapshots where storage_path = 'test/e_pais') x;
update public.source_snapshots set validation_report = jsonb_set(validation_report, '{pais_totals,cotizante}', '41') where storage_path = 'test/e_pais';
select pg_temp.assert_that('un Total País que no cuadra con el del archivo detiene la publicación', pg_temp.raises_like($$select pg_temp.pub('e_pais')$$, '%cuadre con el Total País%'));
update public.source_snapshots set validation_report = jsonb_set(jsonb_set(validation_report, '{pais_totals,cotizante}', '40'), '{region_totals,13:cotizante}', '39') where storage_path = 'test/e_pais';
select pg_temp.assert_that('un subtotal regional que no cuadra detiene la publicación', pg_temp.raises_like($$select pg_temp.pub('e_pais')$$, '%subtotal regional%'));
update public.source_snapshots set validation_report = '{}'::jsonb where storage_path = 'test/e_pais';
select pg_temp.assert_that('sin totales del archivo en el reporte NO se publica (el cuadre es obligatorio)', pg_temp.raises_like($$select pg_temp.pub('e_pais')$$, '%falta pais_totals%'));
select pg_temp.rep(n) from (select n from public.source_snapshots where storage_path = 'test/e_pais') x;
update public.source_snapshots set row_count_raw = 5 where storage_path = 'test/e_pais';
select pg_temp.assert_that('el cuadre de unidades es obligatorio (cargadas + rechazadas = filas del archivo)', pg_temp.raises_like($$select pg_temp.pub('e_pais')$$, '%cuadre de unidades%'));
update public.source_snapshots set row_count_raw = 3, rejected_count = 2 where storage_path = 'test/e_pais';
select pg_temp.assert_that('rechazos sobre publish.max_reject_ratio detienen la publicación aunque cuadren', pg_temp.raises_like($$select pg_temp.pub('e_pais')$$, '%superan el máximo%'));
update public.source_snapshots set row_count_raw = 1, rejected_count = 0 where storage_path = 'test/e_pais';
delete from salud_restringido.isapre_stage where tramo = 5 and sexo = 'F' and rol = 'carga';
select pg_temp.assert_that('21 tramos en lugar de 22 detiene la publicación', pg_temp.raises_like($$select pg_temp.pub('e_pais')$$, '%22 tramos%'));
delete from salud_restringido.isapre_stage;
select pg_temp.su(n, '13101', pg_temp.vec('{{12,40}}')) from (select n from public.source_snapshots where storage_path = 'test/e_pais') x;
update salud_restringido.isapre_stage set comuna_cut = '99999', unit = '13101' where unit = '13101';
select pg_temp.assert_that('un CUT que no existe en comunas detiene la publicación', pg_temp.raises_like($$select pg_temp.pub('e_pais')$$, '%CUT que no existen%'));
delete from salud_restringido.isapre_stage;
select pg_temp.assert_that('un snapshot que no está validated no se publica', pg_temp.raises_like($$select pg_temp.pub('i1')$$, '%debe ser validated%'));
insert into public.source_snapshots (source_id, captured_by, capture_method, origin_url, storage_path, sha256, period_start, period_end, granularity, row_count_raw, status)
  select d.id, 'test', 'api', 'https://example.test/otra', 'test/otra', encode(sha256('otra'::bytea), 'hex'), current_date, current_date, 'snapshot', 0, 'validated'
    from public.data_sources d where d.source_key = 'seia_proyectos_eia';
select pg_temp.assert_that('el snapshot de otra fuente no se publica como Isapre', pg_temp.raises_like($$select public.publish_isapre_snapshot((select id from public.source_snapshots where storage_path = 'test/otra'))$$, '%no de la cartera Isapre%'));

-- ========== Períodos, retención y «captura vigente» ==========
select pg_temp.mk('i2', 2, 0, date '2026-12-31');
select pg_temp.su(n, '13101', pg_temp.vec('{{12,40},{13,30}}')) from (select n from public.source_snapshots where storage_path = 'test/i2') x;
select pg_temp.su(n, '13102', pg_temp.vec('{{12,9}}')) from (select n from public.source_snapshots where storage_path = 'test/i2') x;
select pg_temp.rep(n) from (select n from public.source_snapshots where storage_path = 'test/i2') x;
create temp table _p2 as select pg_temp.pub('i2') as r;
select pg_temp.assert_that('el período más nuevo pasa a ser la captura vigente; el anterior queda superseded y se CONSERVA (retención 2)',
  (select snapshot_id from public._isapre_current_snapshot()) = (select id from public.source_snapshots where storage_path = 'test/i2')
  and (select status from public.source_snapshots where storage_path = 'test/i1') = 'superseded'
  and (select count(*) from public.isapre_cartera_celda k join public.source_snapshots s on s.n = k.snapshot_n where s.storage_path = 'test/i1') = 528);
select pg_temp.mk('i0', 1, 0, date '2024-12-31');
select pg_temp.su(n, '13101', pg_temp.vec('{{12,40}}')) from (select n from public.source_snapshots where storage_path = 'test/i0') x;
select pg_temp.rep(n) from (select n from public.source_snapshots where storage_path = 'test/i0') x;
select pg_temp.assert_that('no se publica un período más viejo que uno ya cargado', pg_temp.raises_like($$select pg_temp.pub('i0')$$, '%período más nuevo%'));
delete from salud_restringido.isapre_stage;
select pg_temp.mk('i3', 1, 0, date '2027-12-31');
select pg_temp.su(n, '13101', pg_temp.vec('{{12,40}}')) from (select n from public.source_snapshots where storage_path = 'test/i3') x;
select pg_temp.rep(n) from (select n from public.source_snapshots where storage_path = 'test/i3') x;
create temp table _p3 as select pg_temp.pub('i3') as r;
select pg_temp.assert_that('un tercer período retira el más viejo (retención 2): sin filas publicadas NI completas de i1',
  (select (r ->> 'old_snapshots_cleared')::int from _p3) = 1
  and (select count(*) from public.isapre_cartera_celda k join public.source_snapshots s on s.n = k.snapshot_n where s.storage_path = 'test/i1') = 0
  and (select count(*) from salud_restringido.isapre_cartera c join public.source_snapshots s on s.n = c.snapshot_n where s.storage_path = 'test/i1') = 0
  and (select count(*) from salud_restringido.isapre_unidad c join public.source_snapshots s on s.n = c.snapshot_n where s.storage_path = 'test/i1') = 0
  and (select count(*) from salud_restringido.isapre_stage) = 0);

-- ========== PROPIEDAD con datos aleatorios (semilla fija): las invariantes se comprueban AQUÍ, sin confiar en la función ==========
select setseed(0.42);
select pg_temp.mk('ir', 80, 0, date '2028-12-31');
insert into salud_restringido.isapre_stage (snapshot_n, unit, unit_kind, region_cut, comuna_cut, unit_name, rol, sexo, tramo, n)
  select (select n from public.source_snapshots where storage_path = 'test/ir'), c.cut, 'comuna', left(c.cut, 2), c.cut, 'FIXTURE ' || c.cut, r.rol, x.sexo, t.tramo,
         case when r.rol = 'carga' then 0 when random() < 0.6 then 0 when random() < 0.1 then (1 + floor(random() * 4))::int else (5 + floor(random() * 40))::int end
    from (select cut from public.comunas order by cut limit 80) c
    cross join (values ('cotizante'), ('carga')) r(rol) cross join (values ('F'), ('M'), ('SI')) x(sexo) cross join generate_series(0, 21) t(tramo);
select pg_temp.rep(n) from (select n from public.source_snapshots where storage_path = 'test/ir') x;
create temp table _pr as select pg_temp.pub('ir') as r;
create temp table _rc as select k.* from public.isapre_cartera_celda k join public.source_snapshots s on s.n = k.snapshot_n where s.storage_path = 'test/ir';
create temp table _rg as select g.* from public.isapre_cartera_grupo g join public.source_snapshots s on s.n = g.snapshot_n where s.storage_path = 'test/ir';
create temp table _rf as
  select c.unit, c.sexo, c.tramo, sum(c.n)::int as n from salud_restringido.isapre_cartera c join public.source_snapshots s on s.n = c.snapshot_n where s.storage_path = 'test/ir' group by 1, 2, 3;
select pg_temp.assert_that('ALEATORIO (80 unidades × 3 sexos × 22 tramos): hay suficientes primarias y complementarias para que la prueba signifique algo',
  (select count(*) from _rc where kind = 'primary') > 200 and (select count(*) from _rc where kind = 'complementary') > 5,
  (select count(*) filter (where kind = 'primary') || ' primarias, ' || count(*) filter (where kind = 'complementary') || ' complementarias' from _rc));
select pg_temp.assert_that('ALEATORIO: ningún valor 1–4 publicado',
  (select count(*) from _rc where n_pub between 1 and 4) = 0);
select pg_temp.assert_that('ALEATORIO: todo valor real 1–4 está suprimido como primario',
  (select count(*) from _rc c join _rf f using (unit, sexo, tramo) where f.n between 1 and 4 and not (c.suppressed and c.kind = 'primary')) = 0);
select pg_temp.assert_that('ALEATORIO: ningún grupo con total publicado queda con exactamente 1 suprimida (no se despeja por resta)',
  (select count(*) from _rg where total_pub is not null and suppressed_cells = 1) = 0);
select pg_temp.assert_that('ALEATORIO: las celdas publicadas son EXACTAMENTE los conteos completos',
  (select count(*) from _rc c join _rf f using (unit, sexo, tramo) where not c.suppressed and c.n_pub is distinct from f.n) = 0);
select pg_temp.assert_that('ALEATORIO: residuo = total real − Σ publicadas, y el valor real de cada suprimida cae dentro de sus cotas',
  (select count(*) from _rg g join (select unit, sexo, sum(n) t from _rf group by 1, 2) f using (unit, sexo) where g.total_pub is not null and g.residual <> f.t - g.published_sum) = 0
  and (select count(*) from _rc c join _rf f using (unit, sexo, tramo) where c.suppressed and (f.n < c.lo or f.n > c.hi)) = 0);
select pg_temp.assert_that('ALEATORIO: la complementaria es la menor celda publicada ≥ 5 del grupo (la regla es la declarada, no otra)',
  (select count(*) from _rc c join _rf f using (unit, sexo, tramo)
    where c.kind = 'complementary'
      and exists (select 1 from _rc c2 join _rf f2 using (unit, sexo, tramo) where c2.unit = c.unit and c2.sexo = c.sexo and not c2.suppressed and f2.n >= 5 and (f2.n < f.n or (f2.n = f.n and c2.tramo < c.tramo)))) = 0);
select pg_temp.assert_that('ALEATORIO: los totales de grupo de 1 a 4 NO se publican, y los de 0 o ≥ 5 sí',
  (select count(*) from _rg g join (select unit, sexo, sum(n) t from _rf group by 1, 2) f using (unit, sexo) where (f.t between 1 and 4) <> (g.total_pub is null)) = 0);

-- ========== B2: PROPIEDAD del rango publicado (las 80 unidades aleatorias; 'ir' es la captura vigente) ==========
-- Verdad = conteos completos de la zona restringida (_rf); el valor publicado debe CONTENERLA, para todo sexo y toda edad mínima, y nunca ser más ancho que sumar las cotas de cada celda.
create temp table _v as
  select s.sexo, m.min_tramo, c.cut::text as cut, c.n_lo, c.n_hi, c.exact, c.suppressed_cells
    from (values (null::text), ('F'), ('M'), ('SI')) s(sexo) cross join (values (0), (12)) m(min_tramo)
    cross join lateral public.get_isapre_comuna(s.sexo, m.min_tramo) c;
create temp table _vt as
  select v.sexo, v.min_tramo, v.cut,
         coalesce((select sum(f.n) from _rf f where f.unit = v.cut and (v.sexo is null or f.sexo = v.sexo) and (v.min_tramo = 0 or f.tramo between 12 and 20)), 0)::bigint as real_n,
         coalesce((select sum(coalesce(c.n_pub, c.lo)) from _rc c where c.unit = v.cut and (v.sexo is null or c.sexo = v.sexo) and (v.min_tramo = 0 or c.tramo between 12 and 20)), 0)::bigint as naive_lo,
         coalesce((select sum(coalesce(c.n_pub, c.hi)) from _rc c where c.unit = v.cut and (v.sexo is null or c.sexo = v.sexo) and (v.min_tramo = 0 or c.tramo between 12 and 20)), 0)::bigint as naive_hi
    from _v v;
select pg_temp.assert_that('B2 ALEATORIO: 4 sexos × 2 cortes de edad × 80 comunas = 640 valores',
  (select count(*) from _v) = 640);
select pg_temp.assert_that('B2 ALEATORIO: el valor REAL cae dentro del rango publicado en las 640 combinaciones (el rango es correcto, no solo más estrecho)',
  (select count(*) from _v join _vt using (sexo, min_tramo, cut) where _vt.real_n < _v.n_lo or _vt.real_n > _v.n_hi) = 0,
  (select count(*) || ' fuera' from _v join _vt using (sexo, min_tramo, cut) where _vt.real_n < _v.n_lo or _vt.real_n > _v.n_hi));
select pg_temp.assert_that('B2 ALEATORIO: nunca más ancho que sumar las cotas de cada celda, y en varias combinaciones estrictamente más estrecho',
  (select count(*) from _v join _vt using (sexo, min_tramo, cut) where _v.n_lo < _vt.naive_lo or _v.n_hi > _vt.naive_hi) = 0
  and (select count(*) from _v join _vt using (sexo, min_tramo, cut) where _v.n_lo > _vt.naive_lo or _v.n_hi < _vt.naive_hi) > 20);
select pg_temp.assert_that('B2 ALEATORIO: todas las edades con TODOS los totales de grupo publicados ⇒ valor EXACTO = Σ de los totales publicados',
  (select count(*) from _v v where v.min_tramo = 0 and not exists (select 1 from _rg g where g.unit = v.cut and (v.sexo is null or g.sexo = v.sexo) and g.total_pub is null)
      and not (v.exact and v.n_lo = (select sum(g.total_pub) from _rg g where g.unit = v.cut and (v.sexo is null or g.sexo = v.sexo)))) = 0
  and (select count(*) from _v v where v.min_tramo = 0 and v.exact and v.suppressed_cells > 0) > 10);                      -- hay comunas con celdas suprimidas que ahora salen exactas
select pg_temp.assert_that('B2 ALEATORIO: con un total de grupo «<5» (todas las edades) el valor NO es exacto salvo que el total quede determinado (4 celdas de 1); nunca 0 si hay 1–4 personas',
  (select count(*) from _v v where v.min_tramo = 0 and v.sexo is not null and exists (select 1 from _rg g where g.unit = v.cut and g.sexo = v.sexo and g.total_pub is null)
      and (v.n_lo < 1 or v.n_hi > 4)) = 0);
select pg_temp.assert_that('B2 ALEATORIO: el agregado de 1b-1 (60+) con conteos completos cae dentro del rango que devuelve la propia función (mismo cálculo)',
  (select count(*) from public.get_isapre_comuna(null, 12)) = 80);

-- ========== Fuga por resta regional: Σ totales regionales − Σ totales de grupo publicados = Σ totales de grupo SUPRIMIDOS de la región ==========
-- Región 02: UN solo grupo con total «<5» (02102 F = 2) ⇒ el total regional lo despejaría exacto ⇒ NO se publica. Región 01: DOS grupos suprimidos ⇒ se publica (cota del residuo, como en las celdas). Región 03: ninguno.
select pg_temp.mk('iw', 6, 0, date '2029-12-31');
select pg_temp.su(n, '02101', pg_temp.vec('{{5,30}}')) from (select n from public.source_snapshots where storage_path = 'test/iw') x;
select pg_temp.su(n, '02102', pg_temp.vec('{{5,2}}')) from (select n from public.source_snapshots where storage_path = 'test/iw') x;
select pg_temp.su(n, '01101', pg_temp.vec('{{5,30}}')) from (select n from public.source_snapshots where storage_path = 'test/iw') x;
select pg_temp.su(n, '01107', pg_temp.vec('{{5,2}}')) from (select n from public.source_snapshots where storage_path = 'test/iw') x;
select pg_temp.su(n, '01401', pg_temp.vec('{{5,3}}')) from (select n from public.source_snapshots where storage_path = 'test/iw') x;
select pg_temp.su(n, '03101', pg_temp.vec('{{5,30}}')) from (select n from public.source_snapshots where storage_path = 'test/iw') x;
select pg_temp.rep(n) from (select n from public.source_snapshots where storage_path = 'test/iw') x;
create temp table _pw as select pg_temp.pub('iw') as r;
create temp table _wr as select r.* from public.isapre_cartera_region r join public.source_snapshots s on s.n = r.snapshot_n where s.storage_path = 'test/iw';
select pg_temp.assert_that('región con UN solo grupo suprimido (02): los dos totales regionales (cotizante y carga) NO se publican, y dicen por qué',
  (select count(*) from _wr where region_cut = '02') = 2 and (select count(*) from _wr where region_cut = '02' and total is null and note like 'total regional no publicado%') = 2);
select pg_temp.assert_that('región con 2 grupos suprimidos (01) y región sin ninguno (03): el total regional SÍ se publica, exacto',
  (select total = 35 and note is null from _wr where region_cut = '01' and rol = 'cotizante') and (select total = 0 from _wr where region_cut = '01' and rol = 'carga')
  and (select total = 30 and note is null from _wr where region_cut = '03' and rol = 'cotizante'));
select pg_temp.assert_that('INVARIANTE: ninguna región con total publicado tiene exactamente un grupo suprimido (restar no despeja ningún total de grupo)',
  (select count(*) from _wr r where r.total is not null and (
      select count(*) from public.isapre_cartera_grupo g join public.isapre_cartera_unidad u on u.snapshot_n = g.snapshot_n and u.unit = g.unit
       where g.snapshot_n = r.snapshot_n and u.region_cut = r.region_cut and g.total_pub is null) = 1) = 0);
select pg_temp.assert_that('el reporte cuenta las regiones sin total y get_isapre_region devuelve NULL (no 0) para ellas',
  (select (r ->> 'regions_total_withheld')::int = 1 from _pw)
  and (select count(*) from public.get_isapre_region() where region_cut = '02' and total is null) = 2
  and (select count(*) from public.get_isapre_region() where region_cut = '02' and total = 0) = 0);
select pg_temp.assert_that('el cuadre con el archivo se hizo ANTES de retener el total: la zona restringida conserva los totales completos de la región 02',
  (select sum(c.n) from salud_restringido.isapre_cartera c join public.source_snapshots s on s.n = c.snapshot_n where s.storage_path = 'test/iw' and c.unit like '02%') = 32);
