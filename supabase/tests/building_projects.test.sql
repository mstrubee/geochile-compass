-- =============================================================================
-- PRUEBA de la migración 4 (proyectos SEIA). Termina en ROLLBACK.
-- Requiere partes 1, 2 y 4 aplicadas y `comunas` sembrada con geometrías reales.
--
-- ⚠️  Los expedientes de esta prueba son SINTÉTICOS. Reproducen el CASO REPORTADO el 2026-10-16
--     ("Praderas La Dehesa", Lo Barnechea, con un punto en lat -33,80) con coordenadas construidas
--     desde la propia geometría comunal; NO son datos del SEIA.
-- =============================================================================
begin;

create or replace function pg_temp.assert(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'FALLA: %', p_msg; end if;
  raise notice 'ok   %', p_msg;
end $$;

create temp table _fx as select id as src_dia from public.data_sources where source_key = 'seia_proyectos_dia';

insert into public.source_snapshots
  (id, source_id, captured_by, capture_method, origin_url, storage_path, sha256, period_start, period_end, granularity,
   row_count_raw, rejected_count, status, validation_report)
select '00000000-0000-0000-0000-0000000000d1', src_dia, 'test:SINTETICO', 'api',
       'https://example.test/sintetico-seia', 'test/seia.json.gz', repeat('d', 64), current_date, current_date, 'snapshot',
       5, 0, 'received', jsonb_build_object('service_count_by_layer', jsonb_build_object('2', 5))
  from _fx;

-- 5 expedientes sintéticos sobre la geometría real de las comunas
insert into public.building_projects
  (source_id, snapshot_id, service_layer, external_id, name, typology_letter, typology_name, comunas_declared, comuna_cuts, geom, raw)
select (select src_dia from _fx), '00000000-0000-0000-0000-0000000000d1', 2, v.id, v.nm, 'h.1', 'h.1) Proyectos inmobiliarios', v.cm, v.cuts, v.g, '{}'::jsonb
  from (
    -- 1) adentro de Lo Barnechea
    select 'SINT-1' as id, 'Proyecto adentro' as nm, 'Lo Barnechea' as cm, array['13115']::char(5)[] as cuts,
           ST_PointOnSurface((select geom from public.comunas where cut = '13115')) as g
    union all -- 2) el caso reportado: punto ~50 km al sur, en lat -33,80
    select 'SINT-2', 'Praderas La Dehesa (caso reportado)', 'Lo Barnechea', array['13115'],
           ST_SetSRID(ST_MakePoint(ST_X(ST_PointOnSurface((select geom from public.comunas where cut = '13115'))), -33.80), 4326)
    union all -- 3) cerca del borde: 150 m al sur del vértice más al sur... (se construye con un punto 150 m fuera del polígono)
    select 'SINT-3', 'Proyecto en el borde', 'Lo Barnechea', array['13115'],
           ST_Project(ST_ClosestPoint(ST_Boundary((select geom from public.comunas where cut = '13115')),
                                      ST_SetSRID(ST_MakePoint(-70.55, -33.80), 4326))::geography, 150, radians(180))::geometry
    union all -- 4) comuna que no se pudo cruzar a CUT
    select 'SINT-4', 'Sin comuna cruzada', 'Comuna Inventada', array[]::char(5)[], ST_SetSRID(ST_MakePoint(-70.6, -33.4), 4326)
    union all -- 5) sin punto
    select 'SINT-5', 'Sin geometría', 'Lo Barnechea', array['13115'], null::geometry
  ) v;

select pg_temp.assert((select count(*) from public.building_projects where geo_check_status = 'pending') = 5, 'los proyectos cargados parten "pending"');

select public.check_project_geometry('00000000-0000-0000-0000-0000000000d1');   -- tolerancia = pipeline_settings 'projects.near_border_m' (500 m)

select pg_temp.assert((select geo_check_status = 'inside'           from public.building_projects where external_id = 'SINT-1'), 'punto dentro de su comuna → inside');
select pg_temp.assert((select geo_check_status = 'outside_declared' from public.building_projects where external_id = 'SINT-2'), 'caso Praderas La Dehesa: punto fuera de su comuna → outside_declared');
select pg_temp.assert((select geo_check_distance_m > 10000         from public.building_projects where external_id = 'SINT-2'), 'la distancia al polígono declarado queda registrada (>10 km)');
select pg_temp.assert((select geo_check_status = 'near_border'      from public.building_projects where external_id = 'SINT-3'), 'a ~150 m del borde → near_border (tolerancia 500 m)');
select pg_temp.assert((select geo_check_status = 'comuna_unmatched' from public.building_projects where external_id = 'SINT-4'), 'comuna no cruzada → comuna_unmatched');
select pg_temp.assert((select geo_check_status = 'no_geometry'      from public.building_projects where external_id = 'SINT-5'), 'sin punto → no_geometry');
-- la tolerancia es configurable, no está hardcodeada
update public.pipeline_settings set value = 10 where key = 'projects.near_border_m';
select public.check_project_geometry('00000000-0000-0000-0000-0000000000d1');
select pg_temp.assert((select geo_check_status = 'outside_declared' from public.building_projects where external_id = 'SINT-3'), 'con la tolerancia en 10 m el punto a ~150 m del borde pasa a outside_declared');
update public.pipeline_settings set value = 500 where key = 'projects.near_border_m';
select public.check_project_geometry('00000000-0000-0000-0000-0000000000d1');
select pg_temp.assert((select geo_check_status = 'near_border' from public.building_projects where external_id = 'SINT-3'), 'con la tolerancia en 500 m vuelve a near_border');
-- NUNCA se corrige en silencio
select pg_temp.assert((select ST_Y(geom) = -33.80 from public.building_projects where external_id = 'SINT-2'), 'la geometría original NO se modificó (sigue en lat -33,80)');

-- inmutabilidad (salvo la validación y is_current)
do $$ begin
  begin
    update public.building_projects set geom = ST_SetSRID(ST_MakePoint(-70.5, -33.35), 4326) where external_id = 'SINT-2';
    raise exception 'FALLA: se pudo mover la geometría de un proyecto';
  exception when check_violation then raise notice 'ok   mover la geometría original está bloqueado (usar una revisión explícita)';
  end;
end $$;

-- publicar exige validar geometría, que lo cargado cuadre con el conteo del servicio y estado 'validated'
update public.source_snapshots set status = 'validated' where id = '00000000-0000-0000-0000-0000000000d1';
select pg_temp.assert((public.publish_project_snapshot('00000000-0000-0000-0000-0000000000d1') ->> 'rows')::int = 5, 'publish_project_snapshot carga 5 proyectos');
select pg_temp.assert((select count(*) from public.building_projects where is_current) = 5, '5 vigentes');

-- cuenta del servicio que no cuadra → rechazo
insert into public.source_snapshots
  (id, source_id, captured_by, capture_method, origin_url, storage_path, sha256, period_start, period_end, granularity,
   row_count_raw, rejected_count, status, validation_report)
select '00000000-0000-0000-0000-0000000000d2', src_dia, 'test:SINTETICO', 'api', 'https://example.test/s2', 'test/s2.json.gz', repeat('e', 64),
       current_date, current_date, 'snapshot', 1, 0, 'validated', jsonb_build_object('service_count_by_layer', jsonb_build_object('2', 28408))
  from _fx;
insert into public.building_projects (source_id, snapshot_id, service_layer, external_id, comuna_cuts, geom, raw, geo_check_status)
select src_dia, '00000000-0000-0000-0000-0000000000d2', 2, 'SINT-1', array['13115'], null, '{}'::jsonb, 'no_geometry' from _fx;
do $$ begin
  begin
    perform public.publish_project_snapshot('00000000-0000-0000-0000-0000000000d2');
    raise exception 'FALLA: se publicó una carga incompleta';
  exception when raise_exception then
    if sqlerrm like '%que informa el servicio%' then raise notice 'ok   carga incompleta (paginación cortada) rechazada';
    else raise; end if;
  end;
end $$;

-- revisión humana: append-only y visible; no reemplaza el punto original
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000aa') on conflict do nothing;
set local role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000000aa', true);
insert into public.building_project_geo_reviews (source_id, service_layer, external_id, decision, proposed_geom, note)
select id, 2, 'SINT-2', 'corrected', ST_SetSRID(ST_MakePoint(-70.52, -33.35), 4326), 'SINTETICO: ubicación según la dirección del expediente'
  from public.data_sources where source_key = 'seia_proyectos_dia';
select pg_temp.assert((select review_decision = 'corrected' and ST_Y(geom) = -33.80 and ST_Y(review_proposed_geom) = -33.35
                         from public.building_projects_current_v where external_id = 'SINT-2'),
                      'la vista muestra punto ORIGINAL y corrección PROPUESTA por separado');
do $$ declare n int; begin
  update public.building_project_geo_reviews set note = 'editada';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLA: se editó una revisión'; end if;
  raise notice 'ok   las revisiones son append-only (0 filas editables)';
end $$;
reset role;

rollback;
