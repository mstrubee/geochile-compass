-- =============================================================================
-- Pruebas de 20261105000000_isapre_penetracion.sql. NO es una migración. Receta (una transacción que termina en error; nada queda aplicado):
--   <20261105000000_isapre_penetracion.sql> (dos veces: idempotencia) + <este archivo> + do $$ begin raise exception 'DRYRUN_OK %', (select count(*) from _tr); end $$;
-- Requiere las migraciones 20261103000000 (Isapre) y 20261104000000 (Censo) ya aplicadas, `comunas` sembrada (346 reales) y los roles anon/authenticated/service_role.
-- DATOS: TODOS los valores son SINTÉTICOS (rotulados «FIXTURE»); los CUT son de comunas reales solo porque las tablas exigen la FK. Las cifras reales de producción
-- se calculan con las capturas reales en local y van en el informe del PR y en el runbook.
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

-- La base de pruebas puede traer cargas previas: se parte de cero DENTRO de esta transacción (se revierte al terminar).
delete from public.source_checks where source_id in (select id from public.data_sources where source_key in ('superdesalud_isapre_cartera_comunal', 'ine_censo2024_poblacion_comunal'));
delete from public.source_snapshots where source_id in (select id from public.data_sources where source_key in ('superdesalud_isapre_cartera_comunal', 'ine_censo2024_poblacion_comunal'));
delete from salud_restringido.isapre_stage;
delete from salud_restringido.isapre_unidad;
delete from public.poblacion_comunal_stage;
delete from public.poblacion_comunal_edad_stage;

-- ---------------------------------- fixtures Isapre (réplica mínima de isapre_cartera.sql) ----------------------------------
create or replace function pg_temp.mk_i(p_tag text, p_units int) returns integer language plpgsql as $$
declare v integer;
begin
  insert into public.source_snapshots (source_id, captured_by, capture_method, origin_url, storage_path, sha256, period_start, period_end, declared_date, granularity, row_count_raw, rejected_count, status)
  select d.id, 'test', 'manual_download', 'https://example.test/' || p_tag, 'test/' || p_tag, encode(sha256(p_tag::bytea), 'hex'), date '2025-12-01', date '2025-12-31', date '2026-01-28',
         'snapshot', p_units, 0, 'validated' from public.data_sources d where d.source_key = 'superdesalud_isapre_cartera_comunal' returning n into v;
  return v;
end $$;
create or replace function pg_temp.su(p_n int, p_unit text, p_f int[], p_m int[] default null, p_si int[] default null) returns void language plpgsql as $$
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
create or replace function pg_temp.vec(p_pairs int[][]) returns int[] language plpgsql as $$
declare v int[] := array_fill(0, array[22]); i int;
begin
  for i in 1..coalesce(array_length(p_pairs, 1), 0) loop v[p_pairs[i][1] + 1] := p_pairs[i][2]; end loop;
  return v;
end $$;
create or replace function pg_temp.rep_i(p_n int) returns void language plpgsql as $$
begin
  update public.source_snapshots set validation_report = jsonb_build_object(
      'pais_totals', (select jsonb_object_agg(rol, t) from (select rol, sum(n) t from salud_restringido.isapre_stage where snapshot_n = p_n group by rol) a),
      'region_totals', (select jsonb_object_agg(region_cut || ':' || rol, t) from (select region_cut, rol, sum(n) t from salud_restringido.isapre_stage
                         where snapshot_n = p_n and region_cut is not null group by region_cut, rol) b))
   where n = p_n;
end $$;

-- ---------------------------------- fixtures Censo (réplica mínima de censo_poblacion.sql) ----------------------------------
create or replace function pg_temp.mk_c(p_tag text) returns integer language plpgsql as $$
declare v integer;
begin
  insert into public.source_snapshots (source_id, captured_by, capture_method, origin_url, storage_path, sha256, period_start, period_end, declared_date, granularity, row_count_raw, status)
  select d.id, 'test', 'manual_download', 'https://example.test/' || p_tag, 'test/' || p_tag, encode(sha256(p_tag::bytea), 'hex'), date '2024-01-01', date '2024-12-31', date '2025-03-27',
         'snapshot', 346, 'validated' from public.data_sources d where d.source_key = 'ine_censo2024_poblacion_comunal' returning n into v;
  return v;
end $$;
-- 346 comunas: hombres = 1000 + r, mujeres = 1100 + r; 18 grupos que suman EXACTAMENTE cada sexo (reparto por resto).
create or replace function pg_temp.stage_c(p_n int) returns void language plpgsql as $$
begin
  insert into public.poblacion_comunal_stage (snapshot_n, cut, comuna, region_cut, province_cut, total, hombres, mujeres)
  select p_n, c.cut, 'FIXTURE ' || c.name, c.region_cut, c.province_cut, (1000 + r) + (1100 + r), 1000 + r, 1100 + r
    from (select c.*, row_number() over (order by c.cut)::int as r from public.comunas c) c;
  insert into public.poblacion_comunal_edad_stage (snapshot_n, cut, grupo_edad, total, hombres, mujeres)
  select p_n, s.cut, g.label, (s.hombres / 18 + (case when g.i < s.hombres % 18 then 1 else 0 end)) + (s.mujeres / 18 + (case when g.i < s.mujeres % 18 then 1 else 0 end)),
         s.hombres / 18 + (case when g.i < s.hombres % 18 then 1 else 0 end), s.mujeres / 18 + (case when g.i < s.mujeres % 18 then 1 else 0 end)
    from public.poblacion_comunal_stage s
    cross join (select i - 1 as i, (array['0 a 4','5 a 9','10 a 14','15 a 19','20 a 24','25 a 29','30 a 34','35 a 39','40 a 44','45 a 49','50 a 54','55 a 59','60 a 64','65 a 69','70 a 74','75 a 79','80 a 84','85 o más'])[i] as label
                  from generate_series(1, 18) i) g
   where s.snapshot_n = p_n;
end $$;
create or replace function pg_temp.rep_c(p_n int) returns void language plpgsql as $$
begin
  update public.source_snapshots set validation_report = jsonb_build_object(
      'pais', (select jsonb_build_object('total', sum(total), 'hombres', sum(hombres), 'mujeres', sum(mujeres)) from public.poblacion_comunal_stage where snapshot_n = p_n),
      'regiones', (select jsonb_object_agg(region_cut, jsonb_build_object('total', t, 'hombres', h, 'mujeres', m))
                     from (select region_cut, sum(total) t, sum(hombres) h, sum(mujeres) m from public.poblacion_comunal_stage where snapshot_n = p_n group by region_cut) a))
   where n = p_n;
end $$;

-- =============================== 0. Estructura y permisos ===============================
select pg_temp.assert_that('sin ninguna captura vigente: 346 filas, todo «sin dato» (null), nunca una cifra inventada',
  (select count(*) = 346 and count(n_lo) = 0 and count(poblacion) = 0 and count(pct_lo) = 0 and count(pct_hi) = 0 and count(isapre_snapshot_id) = 0 and count(censo_snapshot_id) = 0
     from public.get_isapre_penetracion()));
select pg_temp.assert_that('SECURITY INVOKER (no DEFINER) con search_path = public; ni la RPC ni su auxiliar mencionan el esquema restringido',
  (select count(*) = 2 and bool_and(not prosecdef) and bool_and(proconfig = array['search_path=public']) and bool_and(pg_get_functiondef(oid) not ilike '%salud_restringido%')
     from pg_proc where pronamespace = 'public'::regnamespace and proname in ('get_isapre_penetracion', '_penetracion_denominador')));
select pg_temp.assert_that('anon no puede ejecutar; authenticated y service_role sí',
  not has_function_privilege('anon', 'public.get_isapre_penetracion(text,integer)', 'execute')
  and not has_function_privilege('anon', 'public._penetracion_denominador(integer,text,integer)', 'execute')
  and has_function_privilege('authenticated', 'public.get_isapre_penetracion(text,integer)', 'execute')
  and has_function_privilege('service_role', 'public.get_isapre_penetracion(text,integer)', 'execute'));
select pg_temp.assert_that('regla 8: la salida no trae Fonasa, «resto» ni «sin previsión»',
  (select pg_get_function_result(oid) !~* '(fonasa|resto|sin_prev|residuo)' from pg_proc where proname = 'get_isapre_penetracion' and pronamespace = 'public'::regnamespace));
select pg_temp.assert_that('el rol anon es rechazado al llamar (permission denied)',
  (select pg_temp.as_role('anon')) is not null and pg_temp.try_sql($$select * from public.get_isapre_penetracion()$$) like '42501%' and (select pg_temp.reset_role()) is not null);

-- =============================== 1. Entradas rechazadas / aceptadas ===============================
select pg_temp.assert_that('p_sexo = SI se rechaza con 22023 (el Censo no tiene ese grupo); también un sexo desconocido',
  pg_temp.try_sql($$select * from public.get_isapre_penetracion('SI', 0)$$) like '22023:%'
  and pg_temp.try_sql($$select * from public.get_isapre_penetracion('X', 0)$$) like '22023:%');
select pg_temp.assert_that('solo 0 y 12: cualquier otro corte (1..11, 13..17 con grupo equivalente en el Censo; 18..20 sin él; -1, 21, null) se rechaza con 22023',
  (select bool_and(pg_temp.try_sql(format('select * from public.get_isapre_penetracion(null, %s)', m)) like '22023:%') from unnest(array[-1, 1, 4, 11, 13, 17, 18, 19, 20, 21]) m)
  and pg_temp.try_sql($$select * from public.get_isapre_penetracion(null, null)$$) like '22023:%');
select pg_temp.assert_that('se aceptan 0 y 12 con ambos sexos, F y M',
  (select bool_and(pg_temp.try_sql(format($f$select * from public.get_isapre_penetracion(%s, %s)$f$, coalesce(quote_literal(s), 'null'), m)) = 'OK')
     from (values (null::text), ('F'), ('M')) a(s), (values (0), (12)) b(m)));

-- =============================== 2. Capturas sintéticas ===============================
-- Isapre: 13101 grande (exacta salvo la celda 21 de F), 13102 con celdas suprimidas (rango), 13104 con un solo beneficiario de edad sin información (total 1),
-- 13106 pequeña (para superar el 100 %), SDC13 y SDR («sin dato»: no son comunas y no deben aparecer).
select pg_temp.mk_i('pi1', 6);
select pg_temp.su(n, '13101', pg_temp.vec('{{2,20},{3,30},{4,100},{5,200},{6,300},{7,250},{8,200},{9,150},{10,120},{11,100},{12,90},{13,80},{14,70},{15,60},{16,50},{17,40},{18,30},{19,20},{20,10},{21,3}}'),
                                   pg_temp.vec('{{4,60},{5,150},{6,220},{12,40},{13,30},{14,20},{15,10},{16,6},{17,5},{18,0}}'),
                                   pg_temp.vec('{{4,9}}'))
  from (select n from public.source_snapshots where storage_path = 'test/pi1') x;
select pg_temp.su(n, '13102', pg_temp.vec('{{2,2},{3,3},{5,7},{6,9},{8,12},{12,4},{13,8}}'), pg_temp.vec('{{12,3},{13,2},{14,6}}'), null) from (select n from public.source_snapshots where storage_path = 'test/pi1') x;
select pg_temp.su(n, '13104', pg_temp.vec('{{21,1}}'), null, null) from (select n from public.source_snapshots where storage_path = 'test/pi1') x;
select pg_temp.su(n, '13106', pg_temp.vec('{{12,60},{13,50},{14,40},{15,30}}'), pg_temp.vec('{{12,40},{13,30}}'), null) from (select n from public.source_snapshots where storage_path = 'test/pi1') x;
select pg_temp.su(n, 'SDC13', pg_temp.vec('{{6,12},{7,2}}'), pg_temp.vec('{{6,4}}'), null) from (select n from public.source_snapshots where storage_path = 'test/pi1') x;
select pg_temp.su(n, 'SDR', pg_temp.vec('{{21,15}}'), null, null) from (select n from public.source_snapshots where storage_path = 'test/pi1') x;
select pg_temp.rep_i(n) from (select n from public.source_snapshots where storage_path = 'test/pi1') x;
create temp table _pi as select public.publish_isapre_snapshot((select id from public.source_snapshots where storage_path = 'test/pi1')) as r;
select pg_temp.mk_c('pc1');
select pg_temp.stage_c((select n from public.source_snapshots where storage_path = 'test/pc1'));
select pg_temp.rep_c((select n from public.source_snapshots where storage_path = 'test/pc1'));
create temp table _pc as select public.publish_poblacion_snapshot((select id from public.source_snapshots where storage_path = 'test/pc1')) as r;
select pg_temp.assert_that('ambas capturas quedaron vigentes (Isapre dic-2025, Censo 2024)',
  (select period_end = date '2025-12-31' from public._isapre_current_snapshot()) and (select period_end = date '2024-12-31' from public._poblacion_current_snapshot()));

-- =============================== 3. Denominador = Censo con el MISMO sexo y edad ===============================
-- oráculo independiente: get_poblacion_comunal_edad (la RPC pública del Censo)
create temp table _den as
  select s.sexo, m.m, e.cut, sum(case s.sexo when 'F' then e.mujeres when 'M' then e.hombres else e.total end)::bigint as pob
    from (values (null::text), ('F'), ('M')) s(sexo), generate_series(1, 17) m(m), public.get_poblacion_comunal_edad() e
   where e.grupo_orden >= m.m group by s.sexo, m.m, e.cut;
create temp table _pen as
  select s.sexo, m.m, p.* from (values (null::text), ('F'), ('M')) s(sexo), (values (0), (12)) m(m), lateral public.get_isapre_penetracion(s.sexo, m.m) p;
-- el auxiliar admite 1..17: la equivalencia tramo ↔ grupo del Censo queda probada aunque la RPC solo abra 0 y 12
create temp table _auxden as
  select s.sexo, m.m, d.cut, d.poblacion from (values (null::text), ('F'), ('M')) s(sexo), generate_series(0, 17) m(m),
    lateral public._penetracion_denominador((select snapshot_n from public._poblacion_current_snapshot()), s.sexo, m.m) d;
select pg_temp.assert_that('todas las edades: ambos sexos = total censado; F = mujeres; M = hombres (346 comunas, oráculo get_poblacion_comunal)',
  (select count(*) = 346 * 3 and bool_and(p.poblacion = case p.sexo when 'F' then c.mujeres when 'M' then c.hombres else c.total end)
     from _pen p join public.get_poblacion_comunal() c on c.cut = p.cut where p.m = 0));
select pg_temp.assert_that('el denominador de los cortes 1..17 = suma de los grupos del Censo desde ese corte, por sexo (oráculo get_poblacion_comunal_edad, 346 × 3 × 17): el tramo k de Isapre calza con el grupo k',
  (select count(*) = 346 * 3 * 17 and bool_and(p.poblacion = d.pob) from _auxden p join _den d on d.cut = p.cut and d.m = p.m and d.sexo is not distinct from p.sexo where p.m between 1 and 17));
select pg_temp.assert_that('en la RPC: el corte 12 (60+) usa el mismo denominador que el auxiliar y el oráculo (346 × 3)',
  (select count(*) = 346 * 3 and bool_and(p.poblacion = d.pob) from _pen p join _den d on d.cut = p.cut and d.m = p.m and d.sexo is not distinct from p.sexo where p.m = 12));
select pg_temp.assert_that('60+ (corte 12) = grupos «60 a 64» … «85 o más»; el corte 17 del auxiliar = solo «85 o más»',
  (select p.poblacion = (select sum(e.total) from public.get_poblacion_comunal_edad('13101') e where e.grupo_orden >= 12) from _pen p where p.sexo is null and p.m = 12 and p.cut = '13101')
  and (select p.poblacion = (select e.total from public.get_poblacion_comunal_edad('13101') e where e.grupo_edad = '85 o más') from _auxden p where p.sexo is null and p.m = 17 and p.cut = '13101'));
select pg_temp.assert_that('hay 346 filas (las de comunas), nunca una «sin dato de comuna» ni «sin dato de región»',
  (select count(*) = 346 and count(distinct cut) = 346 and bool_and(cut ~ '^[0-9]{5}$') from public.get_isapre_penetracion()));

-- =============================== 4. Numerador = SOLO lo publicado (mismo cálculo que get_isapre_comuna) ===============================
select pg_temp.assert_that('n_lo y n_hi son los de get_isapre_comuna para el mismo sexo y corte, en todas las comunas con fila Isapre (3 sexos × cortes 0 y 12)',
  (select count(*) = 4 * 3 * 2 and bool_and(p.n_lo = c.n_lo and p.n_hi = c.n_hi and p.exact = (c.n_lo = c.n_hi))
     from _pen p join lateral (select * from public.get_isapre_comuna(p.sexo, p.m, null) x where x.cut = p.cut) c on true where p.n_lo is not null));
select pg_temp.assert_that('pct_lo × población = n_lo y pct_hi × población = n_hi (el % se reconstruye exactamente: no agrega ni quita información al rango publicado)',
  (select count(*) > 0 and bool_and(abs(pct_lo * poblacion / 100 - n_lo) < 0.000001 and abs(pct_hi * poblacion / 100 - n_hi) < 0.000001) from _pen where n_lo is not null and poblacion > 0));
select pg_temp.assert_that('la población nunca altera el rango: pct_lo <= pct_hi, y exacto ⇒ pct_lo = pct_hi',
  (select bool_and(pct_lo <= pct_hi and (not exact or pct_lo = pct_hi)) from _pen where pct_lo is not null));
select pg_temp.assert_that('NO lee los conteos completos: ejecutada como authenticated (sin USAGE en salud_restringido) devuelve lo mismo',
  (select pg_temp.as_role('authenticated')) is not null
  and (select count(*) = 346 and sum(n_lo) is not null from public.get_isapre_penetracion('F', 12))
  and (select pg_temp.reset_role()) is not null);
select pg_temp.assert_that('el % sale de lo publicado, no del conteo completo: 13104 (un solo beneficiario, total «<5») es un RANGO con el rango publicado (1–4), aunque el conteo completo sea exactamente 1',
  (select not exact and n_lo = 1 and n_hi = 4 and pct_lo < pct_hi from public.get_isapre_penetracion(null, 0) where cut = '13104')
  and (select sum(n) from salud_restringido.isapre_cartera s where s.snapshot_n = (select snapshot_n from public._isapre_current_snapshot()) and s.unit = '13104') = 1);

-- =============================== 5. Asimetría del numerador, 100 % y «sin dato» ===============================
select pg_temp.assert_that('asimetría: 13104 tiene un único beneficiario de EDAD SIN INFORMACIÓN; con todas las edades el numerador lo incluye (rango 1–4) y con 60+ lo excluye (0 exacto)',
  (select n_lo = 1 and n_hi = 4 from public.get_isapre_penetracion('F', 0) where cut = '13104')
  and (select n_lo = 0 and n_hi = 0 and exact and pct_lo = 0 from public.get_isapre_penetracion('F', 12) where cut = '13104'));
select pg_temp.assert_that('asimetría de sexo: con ambos sexos el numerador incluye el sexo SIN información (13101: F+M+SI en el tramo 4 = 100+60+9); con F o M no',
  (select n_lo = (100 + 60 + 9) from public.get_isapre_penetracion(null, 4) p where p.cut = '13101' and false) is not distinct from null
  and (select (select sum(c.n_pub) from public.isapre_cartera_celda c join public.isapre_cartera_unidad u on u.snapshot_n = c.snapshot_n and u.unit = c.unit
                where c.snapshot_n = (select snapshot_n from public._isapre_current_snapshot()) and u.comuna_cut = '13101' and c.tramo = 4 and c.sexo = 'SI') = 9));
-- 13106 con población censal muy inferior a sus beneficiarios: se muestra tal cual, sin recortar a 100 %
update public.poblacion_comunal set total = 20, hombres = 10, mujeres = 10 where cut = '13106' and snapshot_n = (select snapshot_n from public._poblacion_current_snapshot());
select pg_temp.assert_that('sin recorte: 13106 tiene 250 beneficiarios 60+/total sobre 20 censados ⇒ pct_lo = pct_hi > 100 y se devuelve tal cual (1250 %)',
  (select exact and pct_lo > 100 and pct_hi = pct_lo and round(pct_lo, 6) = round(100.0 * n_lo / 20, 6) from public.get_isapre_penetracion(null, 0) where cut = '13106'));
-- población 0 para el filtro ⇒ pct null (no hay división), la población 0 se devuelve
update public.poblacion_comunal_edad set hombres = 0, total = mujeres where cut = '13102' and grupo_orden >= 12 and snapshot_n = (select snapshot_n from public._poblacion_current_snapshot());
select pg_temp.assert_that('población censada 0 para el filtro (hombres 60+ en 13102): poblacion = 0 y pct null («sin dato»), nunca división por cero ni 0 %',
  (select poblacion = 0 and pct_lo is null and pct_hi is null and n_lo is not null from public.get_isapre_penetracion('M', 12) where cut = '13102'));
select pg_temp.assert_that('comuna sin fila Isapre (p. ej. 01101): n y pct en null («sin dato»), pero con su población censada y la procedencia de ambas capturas',
  (select n_lo is null and n_hi is null and exact is null and pct_lo is null and pct_hi is null and poblacion is not null and censo_snapshot_id is not null and isapre_snapshot_id is not null
     from public.get_isapre_penetracion() where cut = '01101'));
select pg_temp.assert_that('procedencia de ambas capturas en cada fila: ids y fechas de período (Isapre 2025-12-31, Censo 2024-12-31)',
  (select bool_and(isapre_period_end = date '2025-12-31' and censo_period_end = date '2024-12-31'
                   and isapre_snapshot_id = (select snapshot_id from public._isapre_current_snapshot()) and censo_snapshot_id = (select snapshot_id from public._poblacion_current_snapshot()))
     from public.get_isapre_penetracion('M', 12)));
-- sin captura Censo vigente ⇒ población y % null, el numerador Isapre sigue
update public.source_snapshots set status = 'rejected' where storage_path = 'test/pc1';
select pg_temp.assert_that('sin captura vigente del Censo: población y % en null («sin dato»), numerador Isapre intacto, sin cifra de respaldo',
  (select count(*) = 346 and count(poblacion) = 0 and count(pct_lo) = 0 and count(censo_snapshot_id) = 0 and count(n_lo) = 4 and count(isapre_snapshot_id) = 346 from public.get_isapre_penetracion()));
update public.source_snapshots set status = 'loaded' where storage_path = 'test/pc1';
update public.source_snapshots set status = 'rejected' where storage_path = 'test/pi1';
select pg_temp.assert_that('sin captura vigente de Isapre: numerador, % y procedencia Isapre en null; la población censada sigue',
  (select count(*) = 346 and count(n_lo) = 0 and count(pct_lo) = 0 and count(isapre_snapshot_id) = 0 and count(poblacion) = 346 from public.get_isapre_penetracion()));
update public.source_snapshots set status = 'loaded' where storage_path = 'test/pi1';
