-- =============================================================================
-- Pruebas de 20261103000100_casen_prevision.sql. NO es una migración. Receta (una transacción que termina en error):
--   <20261103000100_casen_prevision.sql> (dos veces: idempotencia) + <este archivo> + do $$ begin raise exception 'DRYRUN_OK %', (select count(*) from _tr); end $$;
-- DATOS: TODOS los valores son SINTÉTICOS (rotulados «FIXTURE»): 16 regiones × 6 sistemas con porcentajes que suman 100. Las cifras reales (67 publicables de 96, contraste
-- con el tabulado oficial) se verifican en el informe de la fase con la base CASEN real.
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

delete from public.source_checks where source_id in (select id from public.data_sources where source_key = 'mds_casen_2024_nacional');
delete from public.source_snapshots where source_id in (select id from public.data_sources where source_key = 'mds_casen_2024_nacional');
delete from public.casen_prevision_stage;

create or replace function pg_temp.mk(p_tag text, p_persons int, p_end date default date '2024-12-31') returns integer language plpgsql as $$
declare v integer;
begin
  insert into public.source_snapshots (source_id, captured_by, capture_method, origin_url, storage_path, sha256, period_start, period_end, declared_date, granularity, row_count_raw, status)
  select d.id, 'test', 'manual_download', 'https://example.test/' || p_tag, 'test/' || p_tag, encode(sha256(p_tag::bytea), 'hex'), date_trunc('year', p_end)::date, p_end, date '2026-06-10',
         'snapshot', p_persons, 'validated' from public.data_sources d where d.source_key = 'mds_casen_2024_nacional' returning n into v;
  return v;
end $$;

-- 16 regiones × 6 sistemas; casos 1000 por región repartidos; 'otro' con 3 casos (→ no publicable y «<5») y 'nosabe' con 40 (no publicable por < 60).
create or replace function pg_temp.stage(p_n int) returns void language plpgsql as $$
begin
  insert into public.casen_prevision_stage (snapshot_n, region_cut, sistema, n_sample, pct, se, ci_lo, ci_hi, n_psu, n_strata, df, publishable, reason, official_pct, official_se, official_n)
  select p_n, lpad(r::text, 2, '0'), s.sistema, s.n, s.pct, 0.5, greatest(0, s.pct - 1), least(100, s.pct + 1), 300, 10, 290, s.pub,
         case when s.pub then null when s.n < 5 then 'menos de 60 casos muestrales; estimación no fiable por tamaño muestral según nota oficial' else 'menos de 60 casos muestrales' end,
         s.pct, 0.5, s.n
    from generate_series(1, 16) r,
         (values ('fonasa', 760, 76.0, true), ('isapre', 190, 19.0, true), ('ffaa', 80, 3.0, true), ('ninguno', 67, 1.7, true), ('otro', 3, 0.3, false), ('nosabe', 0, 0.0, true)) s(sistema, n, pct, pub);
  update public.casen_prevision_stage set n_sample = 40, official_n = 40, pct = 0.0, official_pct = 0.0 where snapshot_n = p_n and sistema = 'nosabe';
  update public.casen_prevision_stage set publishable = false, reason = 'menos de 60 casos muestrales' where snapshot_n = p_n and sistema = 'nosabe';
  -- ajustar para que la suma de cada región sea exactamente 100 y los casos 1000: fonasa absorbe la diferencia
  update public.casen_prevision_stage s set pct = 100 - x.o, official_pct = 100 - x.o, n_sample = 1000 - x.n, official_n = 1000 - x.n
    from (select region_cut, sum(pct) filter (where sistema <> 'fonasa') o, sum(n_sample) filter (where sistema <> 'fonasa') n from public.casen_prevision_stage where snapshot_n = p_n group by 1) x
   where s.snapshot_n = p_n and s.region_cut = x.region_cut and s.sistema = 'fonasa';
  update public.casen_prevision_stage set ci_lo = greatest(0, pct - 1), ci_hi = least(100, pct + 1) where snapshot_n = p_n;
end $$;
create or replace function pg_temp.rep(p_n int, p_override jsonb default null) returns void language plpgsql as $$
begin
  update public.source_snapshots set validation_report = jsonb_build_object('official_totals',
      coalesce(p_override, (select jsonb_object_agg(region_cut, jsonb_build_object('n', n)) from (select region_cut, sum(n_sample) n from public.casen_prevision_stage where snapshot_n = p_n group by 1) a))) where n = p_n;
end $$;
create or replace function pg_temp.pub(p_tag text) returns jsonb language sql as $$
  select public.publish_casen_snapshot((select id from public.source_snapshots where storage_path = 'test/' || p_tag))
$$;

select pg_temp.assert_that('la fuente está sembrada con su procedencia, SIN licencia inventada y con el alcance regional/no comunal',
  (select license_label is null and verification_status = 'comprobado' and scope_note like '%NO comunal%' and scope_note like '%menos de 60 casos%' and verification_note like '%ac2d48b5c0b17f6e%'
     from public.data_sources where source_key = 'mds_casen_2024_nacional'));
select pg_temp.assert_that('no existe ninguna columna ni tabla comunal de CASEN (D6)',
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name like 'casen_%' and column_name like '%comuna%') = 0);
select pg_temp.assert_that('umbrales: 60 casos, df ≥ 30 y tolerancia oficial 0,001 pp', public.pipeline_setting('casen.min_cases') = 60 and public.pipeline_setting('casen.min_df') = 30 and public.pipeline_setting('casen.max_diff_official') = 0.001);

select pg_temp.mk('c1', 16000);
select pg_temp.stage((select n from public.source_snapshots where storage_path = 'test/c1'));
select pg_temp.rep((select n from public.source_snapshots where storage_path = 'test/c1'));
create temp table _p1 as select pg_temp.pub('c1') as r;
create temp table _c as select r.* from public.casen_prevision_region r join public.source_snapshots s on s.n = r.snapshot_n where s.storage_path = 'test/c1';
select pg_temp.assert_that('publicó 96 estimaciones: 16 regiones × 6 sistemas; 64 publicables (fonasa, isapre, ffaa, ninguno) y 32 no (otro, nosabe)',
  (select count(*) from _c) = 96 and (select count(*) filter (where publishable) from _c) = 64 and (select count(*) filter (where not publishable) from _c) = 32);
select pg_temp.assert_that('lo NO publicable va con TODOS los valores en NULL y con su motivo (nunca una cifra con pocos casos)',
  (select count(*) from _c where not publishable and (pct is not null or se is not null or ci_lo is not null or ci_hi is not null or official_pct is not null or reason is null)) = 0);
select pg_temp.assert_that('un conteo de personas de 1 a 4 NO se publica: n_sample = 3 queda en NULL («<5»); 40 (no publicable) se muestra; 0 se publica como 0',
  (select count(*) from _c where sistema = 'otro' and n_sample is null) = 16 and (select count(*) from _c where sistema = 'nosabe' and n_sample = 40) = 16
  and (select count(*) from _c where n_sample between 1 and 4) = 0);
select pg_temp.assert_that('lo publicable es un RANGO coherente (IC 95 %): ci_lo ≤ pct ≤ ci_hi, con error estándar y df',
  (select count(*) from _c where publishable and not (ci_lo <= pct and pct <= ci_hi and se is not null and df >= 30)) = 0);
select pg_temp.assert_that('la suma de los porcentajes de las 6 categorías de cada región es 100 (comprobada en la zona de paso antes de publicar)',
  (select (r ->> 'rows')::int = 96 and (r ->> 'publishable')::int = 64 and (r ->> 'not_publishable')::int = 32 from _p1));
select pg_temp.assert_that('get_casen_prevision_region devuelve el nombre de la región, el período y el id de la captura',
  (select count(*) from public.get_casen_prevision_region()) = 96 and (select count(distinct region_name) from public.get_casen_prevision_region()) = 16
  and (select period_end from public.get_casen_prevision_region() limit 1) = date '2024-12-31');

-- Todo o nada
select pg_temp.mk('c_n', 16000, date '2025-12-31');
select pg_temp.stage((select n from public.source_snapshots where storage_path = 'test/c_n'));
select pg_temp.rep((select n from public.source_snapshots where storage_path = 'test/c_n'));
update public.source_snapshots set row_count_raw = 15999 where storage_path = 'test/c_n';
select pg_temp.assert_that('el cuadre de personas (Σ casos = filas del archivo) es obligatorio', pg_temp.raises_like($$select pg_temp.pub('c_n')$$, '%cuadre de personas%'));
update public.source_snapshots set row_count_raw = 16000 where storage_path = 'test/c_n';
select pg_temp.rep((select n from public.source_snapshots where storage_path = 'test/c_n'), (select jsonb_set(jsonb_object_agg(region_cut, jsonb_build_object('n', n)), '{05,n}', '999') from (select region_cut, sum(n_sample) n from public.casen_prevision_stage group by 1) a));
select pg_temp.assert_that('los casos de una región distintos de la fila «Total» del tabulado detienen la publicación', pg_temp.raises_like($$select pg_temp.pub('c_n')$$, '%tabulado oficial (región 05)%'));
update public.source_snapshots set validation_report = '{}'::jsonb where storage_path = 'test/c_n';
select pg_temp.assert_that('sin los totales oficiales en el reporte NO se publica', pg_temp.raises_like($$select pg_temp.pub('c_n')$$, '%falta official_totals%'));
select pg_temp.rep((select n from public.source_snapshots where storage_path = 'test/c_n'));
update public.casen_prevision_stage set pct = pct + 0.5 where region_cut = '03' and sistema = 'isapre';
select pg_temp.assert_that('porcentajes que no suman 100 detienen la publicación', pg_temp.raises_like($$select pg_temp.pub('c_n')$$, '%no es 100%'));
update public.casen_prevision_stage set pct = pct - 0.5 where region_cut = '03' and sistema = 'isapre';
update public.casen_prevision_stage set official_pct = official_pct + 0.01 where region_cut = '07' and sistema = 'isapre';
select pg_temp.assert_that('una estimación propia que difiere del tabulado oficial detiene la publicación', pg_temp.raises_like($$select pg_temp.pub('c_n')$$, '%difiere del tabulado oficial%'));
update public.casen_prevision_stage set official_pct = official_pct - 0.01 where region_cut = '07' and sistema = 'isapre';
update public.casen_prevision_stage set se = se + 0.01 where region_cut = '09' and sistema = 'isapre';
select pg_temp.assert_that('un ERROR ESTÁNDAR propio que difiere del oficial detiene la publicación (el contraste no es solo de la estimación puntual)', pg_temp.raises_like($$select pg_temp.pub('c_n')$$, '%error estándar propio difiere%'));
update public.casen_prevision_stage set se = se - 0.01 where region_cut = '09' and sistema = 'isapre';
update public.casen_prevision_stage set official_se = null where region_cut = '09' and sistema = 'isapre';
select pg_temp.assert_that('sin el error estándar oficial para contrastar NO se publica', pg_temp.raises_like($$select pg_temp.pub('c_n')$$, '%error estándar propio difiere%'));
update public.casen_prevision_stage set official_se = 0.5 where region_cut = '09' and sistema = 'isapre';
update public.casen_prevision_stage set lonely_strata = 1 where region_cut = '05' and sistema = 'fonasa';
select pg_temp.assert_that('un estrato con un solo conglomerado detiene la publicación (no se descarta en silencio)', pg_temp.raises_like($$select pg_temp.pub('c_n')$$, '%un solo conglomerado%'));
update public.casen_prevision_stage set lonely_strata = 0 where region_cut = '05' and sistema = 'fonasa';
update public.casen_prevision_stage set publishable = true, reason = null where region_cut = '07' and sistema = 'nosabe';
select pg_temp.assert_that('marcar publicable una estimación con < 60 casos detiene la publicación', pg_temp.raises_like($$select pg_temp.pub('c_n')$$, '%no cumple el mínimo de casos%'));
update public.casen_prevision_stage set publishable = false, reason = 'menos de 60 casos muestrales' where region_cut = '07' and sistema = 'nosabe';
update public.casen_prevision_stage set df = 10 where region_cut = '07' and sistema = 'isapre';
select pg_temp.assert_that('grados de libertad insuficientes detienen la publicación', pg_temp.raises_like($$select pg_temp.pub('c_n')$$, '%grados de libertad%'));
update public.casen_prevision_stage set df = 290 where region_cut = '07' and sistema = 'isapre';
delete from public.casen_prevision_stage where region_cut = '16' and sistema = 'otro';
select pg_temp.assert_that('faltan estimaciones (95 en vez de 96) y se detiene', pg_temp.raises_like($$select pg_temp.pub('c_n')$$, '%16 regiones × 6 sistemas%'));
select pg_temp.assert_that('un snapshot que no está validated no se publica', pg_temp.raises_like($$select pg_temp.pub('c1')$$, '%debe ser validated%'));
delete from public.casen_prevision_stage;
select pg_temp.mk('c_old', 16000, date '2023-12-31');
select pg_temp.assert_that('no se publica un período más viejo que uno ya cargado', pg_temp.raises_like($$select pg_temp.pub('c_old')$$, '%período más nuevo%'));

-- Permisos
select pg_temp.as_role('anon');
select pg_temp.assert_that('anon no lee la tabla ni ejecuta la RPC', pg_temp.try_sql('select count(*) from public.casen_prevision_region') like '42501%' and pg_temp.try_sql('select * from public.get_casen_prevision_region()') like '42501%');
select pg_temp.reset_role();
select pg_temp.as_role('authenticated');
select pg_temp.assert_that('authenticated lee la RPC pero no publica ni escribe ni ve la zona de paso',
  pg_temp.try_sql('select count(*) from public.get_casen_prevision_region()') = 'OK' and pg_temp.try_sql($$select public.publish_casen_snapshot('00000000-0000-0000-0000-000000000000')$$) like '42501%'
  and pg_temp.try_sql('delete from public.casen_prevision_region') like '42501%' and pg_temp.try_sql('select count(*) from public.casen_prevision_stage') like '42501%');
select pg_temp.reset_role();
