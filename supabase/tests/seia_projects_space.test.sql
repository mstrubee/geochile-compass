-- =============================================================================
-- MEDICIÓN de espacio y tiempos de las tablas del SEIA con un volumen REALISTA. Termina en ROLLBACK.
-- Mismo requisito que seia_projects.test.sql. Imprime con NOTICE; no tiene aserciones sobre tamaños absolutos
-- (dependen del texto real de los expedientes), pero sí sobre lo que el diseño promete: la purga acota el crecimiento.
--
-- ⚠️  SINTÉTICO. Los conteos son los del servicio al 2026-10-16 (EIA 1.594 + DIA 28.408 = 30.002). Los TEXTOS y las
--     coordenadas son inventados (largos parecidos a los del servicio); el tamaño real puede diferir. Medir de nuevo
--     con la primera carga real (DISENO.md, Parte 4, §"Espacio").
-- =============================================================================
begin;

create or replace function pg_temp.assert(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'FALLA: %', p_msg; end if;
  raise notice 'ok   %', p_msg;
end $$;

create or replace function pg_temp.sz(p_what text) returns text language sql as $$
  select pg_size_pretty(case p_what
    when 'tabla'   then pg_table_size('public.seia_projects')
    when 'indices' then pg_indexes_size('public.seia_projects')
    when 'checks'  then pg_total_relation_size('public.seia_project_geo_checks')
    else pg_total_relation_size('public.seia_projects') + pg_total_relation_size('public.seia_project_geo_checks') end)
$$;

-- N proyectos sintéticos repartidos por las comunas con geometría; ~60 % cae en la Región Metropolitana como en la realidad
create or replace function pg_temp.load_snap(p_label int, p_source text, p_rows int) returns uuid language plpgsql as $$
declare v_src uuid; v_snap uuid := ('00000000-0000-0000-0000-0000000001' || lpad(to_hex(p_label), 2, '0'))::uuid;
begin
  select id into v_src from public.data_sources where source_key = p_source;
  insert into public.source_snapshots
    (id, source_id, captured_by, capture_method, origin_url, storage_path, sha256, period_start, period_end, granularity,
     row_count_raw, rejected_count, status, validation_report)
  values (v_snap, v_src, 'test:SINTETICO', 'api', 'https://example.test/space/' || p_label, 'test/space-' || p_label || '.json.gz',
          md5(p_label::text) || md5((p_label + 1)::text), current_date, current_date, 'snapshot', p_rows, 0, 'validated',
          jsonb_build_object('service_count', p_rows));
  insert into public.seia_projects
    (source_id, snapshot_id, external_id, name, submission_form_declared, typology_letter, typology_name, region_declared, comunas_declared,
     comuna_cuts, titular, status_declared, submitted_at, qualified_at, investment_usd, expediente_url, geom, raw)
  select v_src, v_snap, (2000000000 + i)::text,
         'Proyecto sintético ' || md5(i::text) || ' ' || md5((i * 7)::text),
         case when i % 12 = 0 then 'Estudio de Impacto Ambiental' else 'Declaración de Impacto Ambiental' end,
         (array['g.1', 'h.1', 'h.2', 'i.1', 'o.7', 'a.1', 'k.1'])[1 + i % 7],
         (array['g.1) Desarrollo urbano', 'h.1) Proyectos inmobiliarios', 'h.2) Equipamiento', 'i.1) Proyectos industriales',
                'o.7) Saneamiento ambiental', 'a.1) Acueductos', 'k.1) Instalaciones fabriles'])[1 + i % 7] || ' ' || md5((i * 3)::text),
         c.region_name, c.name, array[c.cut::char(5)],
         'Titular sintético ' || md5((i * 11)::text),
         (array['Aprobado', 'En Calificación', 'Rechazado', 'No admitido a trámite', 'Desistido', 'Abandonado'])[1 + i % 6],
         date '2010-01-01' + (i % 5400), case when i % 3 = 0 then date '2012-01-01' + (i % 5000) end,
         case when i % 10 = 0 then null else (i % 997) * 100000 + 12345.67 end,
         null,
         ST_SetSRID(ST_MakePoint(ST_X(pt.p) + (random() - 0.5) * 0.02, ST_Y(pt.p) + (random() - 0.5) * 0.02), 4326),
         -- lo que el ETL guarda en raw: lo que NO está en una columna (el original completo va a Storage)
         jsonb_build_object('OBJECTID', i, 'FECHA_PRESENTACION', 1262304000000 + i * 86400000::bigint,
           'FECHA_CALIFICACION', 1325376000000 + i * 86400000::bigint, 'X', -70.5 + (i % 100) / 1000.0, 'Y', -33.4 - (i % 100) / 1000.0,
           'NUEVO_X', -70.5 + (i % 100) / 1000.0, 'NUEVO_Y', -33.4 - (i % 100) / 1000.0, 'MODIFICADO', 1700000000000 + i)
    from generate_series(1, p_rows) i
    join lateral (select cut, name, region_name from public.comunas
                   where geom is not null and (case when i % 10 < 6 then region_cut = '13' else true end)
                   order by md5(cut || i::text) limit 1) c on true
    join lateral (select ST_PointOnSurface(geom) as p from public.comunas where cut = c.cut) pt on true;
  return v_snap;
end $$;

do $$
declare
  t0 timestamptz; v_dia uuid; v_eia uuid; v_a uuid; v_b uuid; v_c uuid; v_src uuid;
  v_n bigint; v_ms numeric; v_checked jsonb;
begin
  -- Foto 1 de cada capa (DIA 28.408 + EIA 1.594)
  t0 := clock_timestamp();
  v_a := pg_temp.load_snap(1, 'seia_proyectos_dia', 28408);
  v_eia := pg_temp.load_snap(2, 'seia_proyectos_eia', 1594);
  raise notice 'carga sintética de 30.002 filas: % ms', round(extract(epoch from clock_timestamp() - t0) * 1000);
  raise notice 'UNA foto (30.002 filas) antes de validar: tabla % + índices %', pg_temp.sz('tabla'), pg_temp.sz('indices');

  t0 := clock_timestamp();
  perform public.seia_check_geometry(v_a);
  perform public.seia_check_geometry(v_eia);
  raise notice 'seia_check_geometry (30.002 puntos contra comunas reales): % ms', round(extract(epoch from clock_timestamp() - t0) * 1000);
  select jsonb_object_agg(status, n) into v_checked from (select status, count(*) n from public.seia_project_geo_checks group by 1) q;
  raise notice 'tras validar (tabla angosta seia_project_geo_checks): %; total tablas = %', pg_temp.sz('checks'), pg_temp.sz('total');
  raise notice 'estados de ubicación del sintético (el jitter aleatorio saca algunos del polígono): %', v_checked;

  perform public.seia_publish_snapshot(v_a);
  perform public.seia_publish_snapshot(v_eia);

  -- Mapa: recuadro de Santiago, con y sin filtro; mide la RPC completa
  t0 := clock_timestamp();
  select count(*) into v_n from public.get_seia_projects(-71.0, -34.5, -70.0, -33.0);
  raise notice 'get_seia_projects Santiago, sin filtro, límite 3000: % filas en % ms', v_n, round(extract(epoch from clock_timestamp() - t0) * 1000);
  t0 := clock_timestamp();
  select count(*) into v_n from public.get_seia_projects(-71.0, -34.5, -70.0, -33.0, array['g', 'h']);
  raise notice 'get_seia_projects Santiago, tipologías g+h: % filas en % ms', v_n, round(extract(epoch from clock_timestamp() - t0) * 1000);
  t0 := clock_timestamp();
  select count(*) into v_n from public.get_seia_projects(-76.0, -56.0, -66.0, -17.0, array['g', 'h'], null, null, 2018, 2024, true, 10000);
  raise notice 'get_seia_projects PAÍS completo, g+h, 2018-2024, límite 10000: % filas en % ms', v_n, round(extract(epoch from clock_timestamp() - t0) * 1000);
  t0 := clock_timestamp();
  perform public.get_seia_facets();
  raise notice 'get_seia_facets (30.002 filas): % ms', round(extract(epoch from clock_timestamp() - t0) * 1000);
  t0 := clock_timestamp();
  perform public.get_seia_project('seia_proyectos_dia', '2000000777');
  raise notice 'get_seia_project: % ms', round(extract(epoch from clock_timestamp() - t0) * 1000);

  -- Foto 2 y 3 de la DIA: sin purga el crecimiento es lineal; con K = 2 se acota
  v_b := pg_temp.load_snap(3, 'seia_proyectos_dia', 28408);
  perform public.seia_check_geometry(v_b); perform public.seia_publish_snapshot(v_b);
  raise notice 'SIN purgar, 2 fotos de la DIA + 1 de la EIA: %', pg_temp.sz('total');
  v_c := pg_temp.load_snap(4, 'seia_proyectos_dia', 28408);
  perform public.seia_check_geometry(v_c); perform public.seia_publish_snapshot(v_c);
  select count(*) into v_n from public.seia_projects;
  raise notice 'SIN purgar, 3 fotos de la DIA + 1 de la EIA: % filas, %', v_n, pg_temp.sz('total');
  perform pg_temp.assert(v_n = 28408 * 3 + 1594, 'sin purga, las filas crecen una foto completa por carga');

  select id into v_src from public.data_sources where source_key = 'seia_proyectos_dia';
  perform public.seia_purge_superseded(v_src);          -- K = retention.keep_snapshots = 2
  select count(*) into v_n from public.seia_projects where source_id = v_src;
  perform pg_temp.assert(v_n = 28408 * 2, 'con K = 2 la purga deja las 2 últimas fotos de la DIA (' || v_n || ' filas)');
  perform pg_temp.assert((select count(*) from public.seia_projects_current_v where source_id = v_src) = 28408, '…y la foto vigente completa');
  raise notice 'CON purga K=2 (filas borradas; el espacio vuelve a la tabla tras VACUUM, que aquí no corre): filas vivas %', (select count(*) from public.seia_projects);
end $$;

-- el tamaño físico solo baja con VACUUM FULL; esto estima lo que ocuparían las filas vivas
select pg_size_pretty(sum(pg_column_size(p.*))::bigint) as "bytes de las filas vivas (estimado)", count(*) as filas from public.seia_projects p;
select pg_size_pretty(avg(pg_column_size(raw))::bigint) as "raw jsonb promedio por fila" from public.seia_projects;

rollback;
