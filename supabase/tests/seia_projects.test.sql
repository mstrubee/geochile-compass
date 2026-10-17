-- =============================================================================
-- PRUEBA de las migraciones del SEIA (20261021120000, 20261021120100, 20261021120200). Termina en ROLLBACK.
-- Requiere las partes 1, 2 y 3 de permisos + las tres del SEIA aplicadas y `comunas` sembrada con geometrías
-- reales (etl/permisos_comunas.py seed). Idempotencia: aplicar cada migración dos veces (ver DISENO.md, Parte 4).
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

create or replace function pg_temp.raises(p_sql text, p_msg text, p_like text default '%') returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm like p_like then raise notice 'ok   % (%)', p_msg, left(sqlerrm, 70); return; end if;
    raise exception 'FALLA: % — error inesperado: %', p_msg, sqlerrm;
  end;
  raise exception 'FALLA: % — no falló', p_msg;
end $$;

create temp table _fx as
  select (select id from public.data_sources where source_key = 'seia_proyectos_dia') as dia,
         (select id from public.data_sources where source_key = 'seia_proyectos_eia') as eia,
         (select id from public.data_sources where source_key = 'minvu_cedoc_permisos_anual') as minvu;
grant select on _fx to public;   -- las pruebas de RLS leen estas tablas con el rol authenticated

-- snapshot sintético: p_n_label da el uuid y el hash; status inicial 'validated'
create or replace function pg_temp.mk_snap(p_label int, p_source uuid, p_service_count int, p_rejected int default 0,
                                           p_status text default 'validated') returns uuid language plpgsql as $$
declare v_id uuid := ('00000000-0000-0000-0000-0000000000' || lpad(to_hex(p_label), 2, '0'))::uuid;
begin
  insert into public.source_snapshots
    (id, source_id, captured_by, capture_method, origin_url, storage_path, sha256, period_start, period_end, granularity,
     row_count_raw, rejected_count, status, validation_report, loaded_at)
  values (v_id, p_source, 'test:SINTETICO', 'api', 'https://example.test/sintetico-seia/' || p_label,
          'test/seia-' || p_label || '.json.gz', repeat(to_hex(p_label % 16), 64), current_date, current_date, 'snapshot',
          p_service_count, p_rejected, p_status,
          case when p_service_count is null then '{}'::jsonb else jsonb_build_object('service_count', p_service_count) end,
          case when p_status in ('loaded', 'superseded') then now() end);
  return v_id;
end $$;

create or replace function pg_temp.add_proj(p_snap uuid, p_source uuid, p_id text, p_name text, p_letter text, p_tname text,
    p_status text, p_submitted date, p_invest numeric, p_comunas text, p_cuts char(5)[], p_unres text[], p_geom geometry)
returns void language sql as $$
  insert into public.seia_projects
    (source_id, snapshot_id, external_id, name, typology_letter, typology_name, status_declared, submitted_at, investment_usd,
     comunas_declared, comuna_cuts, comunas_unresolved, geom, raw)
  values (p_source, p_snap, p_id, p_name, p_letter, p_tname, p_status, p_submitted, p_invest,
          p_comunas, p_cuts, coalesce(p_unres, '{}'), p_geom, jsonb_build_object('ID_EXPEDIENTE', p_id, 'NOMBRE_PROYECTO', p_name));
$$;

-- puntos construidos desde las geometrías reales
create temp table _pt as
  select ST_PointOnSurface((select geom from public.comunas where cut = '13115')) as barnechea,
         ST_PointOnSurface((select geom from public.comunas where cut = '13114')) as las_condes,
         -- el caso reportado: mismo meridiano, pero ~40 km al sur, en lat -33,80
         ST_SetSRID(ST_MakePoint(ST_X(ST_PointOnSurface((select geom from public.comunas where cut = '13115'))), -33.80), 4326) as praderas,
         -- ~150 m fuera del polígono de Lo Barnechea
         ST_Project(ST_ClosestPoint(ST_Boundary((select geom from public.comunas where cut = '13115')),
                                    ST_SetSRID(ST_MakePoint(-70.55, -33.80), 4326))::geography, 150, radians(180))::geometry as borde;
select pg_temp.assert((select ST_Y(praderas) = -33.80 from _pt), 'fixture: el punto del caso reportado está en lat -33,80');
select pg_temp.assert((select not ST_Covers((select geom from public.comunas where cut = '13115'), praderas) from _pt),
                      'fixture: el punto del caso reportado cae fuera de Lo Barnechea');

-- una foto VIEJA (n menor que la que se publicará): se crea ANTES porque n crece en orden de captura. Ver 3h.
select pg_temp.mk_snap(9, (select dia from _fx), 1);
select pg_temp.add_proj('00000000-0000-0000-0000-000000000009', (select dia from _fx), 'OLD-1', 'x', 'h.1', 'h.1) x', 'Aprobado', null, null, '', array['13115'], null, (select barnechea from _pt));
select public.seia_check_geometry('00000000-0000-0000-0000-000000000009');


-- -----------------------------------------------------------------------------
-- 1. Validación geográfica
-- -----------------------------------------------------------------------------
select pg_temp.mk_snap(1, (select dia from _fx), 6);
select pg_temp.add_proj('00000000-0000-0000-0000-000000000001', (select dia from _fx), 'SINT-1', 'Proyecto adentro', 'h.1', 'h.1) Proyectos inmobiliarios',
       'Aprobado', date '2019-05-10', 50000000, 'Lo Barnechea', array['13115'], null, (select barnechea from _pt));
select pg_temp.add_proj('00000000-0000-0000-0000-000000000001', (select dia from _fx), 'SINT-2', 'Praderas La Dehesa (caso reportado)', 'h.1', 'h.1) Proyectos inmobiliarios',
       'En Calificación', date '2020-03-02', 10000000, 'Lo Barnechea', array['13115'], null, (select praderas from _pt));
select pg_temp.add_proj('00000000-0000-0000-0000-000000000001', (select dia from _fx), 'SINT-3', 'Proyecto en el borde', 'h.1', 'h.1) Proyectos inmobiliarios',
       'Aprobado', date '2021-07-01', 3000000, 'Lo Barnechea', array['13115'], null, (select borde from _pt));
select pg_temp.add_proj('00000000-0000-0000-0000-000000000001', (select dia from _fx), 'SINT-4', 'Sin comuna cruzada', 'g.1', 'g.1) Desarrollo urbano',
       'Aprobado', date '2018-01-15', null, 'Comuna Inventada', array[]::char(5)[], array['Comuna Inventada'], ST_SetSRID(ST_MakePoint(-70.6, -33.4), 4326));
select pg_temp.add_proj('00000000-0000-0000-0000-000000000001', (select dia from _fx), 'SINT-5', 'Sin geometría', 'a.1', 'a.1) Otra tipología',
       'Rechazado', null, 1000, 'Lo Barnechea', array['13115'], null, null);
-- dos comunas declaradas, una sin resolver; el punto cae dentro de Las Condes (resuelta)
select pg_temp.add_proj('00000000-0000-0000-0000-000000000001', (select dia from _fx), 'SINT-6', 'Dos comunas, una sin cruzar', 'h.2', 'h.2) Equipamiento',
       'Aprobado', date '2022-02-02', 7000000, 'Las Condes, Comuna Inventada', array['13114'], array['Comuna Inventada'], (select las_condes from _pt));

select pg_temp.assert((select count(*) from public.seia_projects p where p.snapshot_id = '00000000-0000-0000-0000-000000000001'
                          and not exists (select 1 from public.seia_project_geo_checks c where c.project_id = p.id)) = 6,
                      'los proyectos recién cargados no tienen validación (sin fila en seia_project_geo_checks)');

-- vista de prueba: resultado de la validación por expediente (los checks viven en una tabla angosta aparte)
create temp view _chk as
  select p.snapshot_id, p.external_id, c.status as geo_check_status, c.distance_m as geo_check_distance_m, c.detail as geo_check_detail
    from public.seia_projects p join public.seia_project_geo_checks c on c.project_id = p.id;
grant select on _chk to public;

select public.seia_check_geometry('00000000-0000-0000-0000-000000000001');   -- tolerancia = pipeline_settings 'projects.near_border_m' (500 m)

select pg_temp.assert((select geo_check_status = 'inside'           from _chk where external_id = 'SINT-1'), 'punto dentro de su comuna → inside');
select pg_temp.assert((select geo_check_status = 'outside_declared' from _chk where external_id = 'SINT-2'), 'caso Praderas La Dehesa: punto fuera de su comuna → outside_declared');
select pg_temp.assert((select geo_check_distance_m > 10000         from _chk where external_id = 'SINT-2'), 'la distancia al polígono declarado queda registrada (>10 km)');
select pg_temp.assert((select geo_check_status = 'near_border'      from _chk where external_id = 'SINT-3'), 'a ~150 m del borde → near_border (tolerancia 500 m)');
select pg_temp.assert((select geo_check_status = 'comuna_unmatched' from _chk where external_id = 'SINT-4'), 'comuna no cruzada → comuna_unmatched');
select pg_temp.assert((select geo_check_status = 'no_geometry'      from _chk where external_id = 'SINT-5'), 'sin punto → no_geometry');
select pg_temp.assert((select geo_check_status = 'inside' and geo_check_detail -> 'unresolved' = '["Comuna Inventada"]'::jsonb
                         from _chk where external_id = 'SINT-6'),
                      'una comuna sin resolver no esconde el resultado: inside con el fragmento en detail.unresolved');
select pg_temp.assert((select (geo_check_detail ->> 'tolerance_m')::numeric = 500 and not (geo_check_detail ? 'lat')
                         from _chk where external_id = 'SINT-2'), 'el detalle guarda la tolerancia usada (y no repite lo que ya está en el proyecto)');
select pg_temp.assert((select ST_Y(geom) = -33.80 from public.seia_projects where external_id = 'SINT-2'), 'la geometría ORIGINAL no se movió');

-- la tolerancia es configurable, no está hardcodeada
update public.pipeline_settings set value = 10 where key = 'projects.near_border_m';
select public.seia_check_geometry('00000000-0000-0000-0000-000000000001');
select pg_temp.assert((select geo_check_status = 'outside_declared' from _chk where external_id = 'SINT-3'), 'con tolerancia 10 m el punto a 150 m pasa a outside_declared');
select public.seia_check_geometry('00000000-0000-0000-0000-000000000001', 500);   -- el parámetro la sobrescribe
select pg_temp.assert((select geo_check_status = 'near_border' from _chk where external_id = 'SINT-3'), 'el parámetro sobrescribe la configuración');
update public.pipeline_settings set value = 500 where key = 'projects.near_border_m';
select pg_temp.assert((select count(*) = 6 from public.seia_project_geo_checks c join public.seia_projects p on p.id = c.project_id
                        where p.snapshot_id = '00000000-0000-0000-0000-000000000001'),
                      'repetir la validación actualiza las filas del resultado, no las duplica (6 y no 18)');
select pg_temp.raises($$ select public.seia_check_geometry('00000000-0000-0000-0000-000000000001', -1) $$, 'tolerancia negativa rechazada', '%tolerancia%');

-- -----------------------------------------------------------------------------
-- 2. Un proyecto cargado es inmutable: no hay UPDATE posible (la validación vive en otra tabla)
-- -----------------------------------------------------------------------------
select pg_temp.raises($$ update public.seia_projects set name = 'otro' where external_id = 'SINT-1' $$, 'no se edita el nombre', '%inmutable%');
select pg_temp.raises($$ update public.seia_projects set geom = ST_SetSRID(ST_MakePoint(-70.5, -33.4), 4326) where external_id = 'SINT-2' $$,
                      'no se "corrige" la geometría en sitio', '%inmutable%');
select pg_temp.raises($$ update public.seia_projects set investment_usd = 1 where external_id = 'SINT-1' $$, 'no se edita la inversión declarada', '%inmutable%');
select pg_temp.raises($$ update public.seia_projects set comuna_cuts = array['13101'] where external_id = 'SINT-1' $$, 'tampoco el cruce de comunas', '%inmutable%');
select pg_temp.raises($$ insert into public.seia_project_geo_checks (project_id, status) select id, 'invented' from public.seia_projects limit 1 $$,
                      'la validación solo admite estados conocidos', '%seia_project_geo_checks_status_check%');
select pg_temp.raises($$ insert into public.seia_projects (source_id, snapshot_id, external_id, raw)
                         select dia, '00000000-0000-0000-0000-000000000001', 'SINT-1', '{}' from _fx $$, 'expediente duplicado en un snapshot', '%sp_snapshot_key_uniq%');
select pg_temp.raises($$ insert into public.seia_projects (source_id, snapshot_id, external_id, raw)
                         select eia, '00000000-0000-0000-0000-000000000001', 'X-1', '{}' from _fx $$, 'el snapshot debe pertenecer a la fuente del proyecto', '%sp_snapshot_belongs_to_source%');
select pg_temp.raises($$ insert into public.seia_projects (source_id, snapshot_id, external_id, investment_usd, raw)
                         select dia, '00000000-0000-0000-0000-000000000001', 'NEG', -5, '{}' from _fx $$, 'inversión negativa rechazada', '%investment_usd%');

-- -----------------------------------------------------------------------------
-- 3. Publicación: cada guardia
-- -----------------------------------------------------------------------------
-- 3a. el conteo del servicio no cuadra (paginación cortada o servicio que cambió mientras se paginaba)
select pg_temp.mk_snap(2, (select dia from _fx), 99);
select pg_temp.add_proj('00000000-0000-0000-0000-000000000002', (select dia from _fx), 'B-1', 'x', 'h.1', 'h.1) x', 'Aprobado', null, null, '', array['13115'], null, (select barnechea from _pt));
select public.seia_check_geometry('00000000-0000-0000-0000-000000000002');
select pg_temp.raises($$ select public.seia_publish_snapshot('00000000-0000-0000-0000-000000000002') $$, 'paginación cortada (1 cargada de 99) se rechaza', '%informa el servicio%');
-- 3b. falta el conteo del servicio
select pg_temp.mk_snap(3, (select dia from _fx), null);
select pg_temp.add_proj('00000000-0000-0000-0000-000000000003', (select dia from _fx), 'B-1', 'x', 'h.1', 'h.1) x', 'Aprobado', null, null, '', array['13115'], null, (select barnechea from _pt));
select public.seia_check_geometry('00000000-0000-0000-0000-000000000003');
select pg_temp.raises($$ select public.seia_publish_snapshot('00000000-0000-0000-0000-000000000003') $$, 'sin service_count no se publica', '%falta service_count%');
-- 3c. quedan proyectos sin validar geometría
select pg_temp.mk_snap(4, (select dia from _fx), 1);
select pg_temp.add_proj('00000000-0000-0000-0000-000000000004', (select dia from _fx), 'B-1', 'x', 'h.1', 'h.1) x', 'Aprobado', null, null, '', array['13115'], null, (select barnechea from _pt));
select pg_temp.raises($$ select public.seia_publish_snapshot('00000000-0000-0000-0000-000000000004') $$, 'proyectos sin validar geometría', '%sin validar%');
-- 3d. demasiados rechazos (umbral 0,5 %): 1 rechazada de 2
select pg_temp.mk_snap(5, (select dia from _fx), 2, 1);
select pg_temp.add_proj('00000000-0000-0000-0000-000000000005', (select dia from _fx), 'B-1', 'x', 'h.1', 'h.1) x', 'Aprobado', null, null, '', array['13115'], null, (select barnechea from _pt));
select public.seia_check_geometry('00000000-0000-0000-0000-000000000005');
select pg_temp.raises($$ select public.seia_publish_snapshot('00000000-0000-0000-0000-000000000005') $$, 'tasa de rechazo sobre el umbral', '%umbral%');
-- 3e. no validado
select pg_temp.mk_snap(6, (select dia from _fx), 0, 0, 'received');
select pg_temp.raises($$ select public.seia_publish_snapshot('00000000-0000-0000-0000-000000000006') $$, 'un snapshot "received" no se publica', '%no está validado%');
-- 3f. sin filas
select pg_temp.mk_snap(7, (select dia from _fx), 0);
select pg_temp.raises($$ select public.seia_publish_snapshot('00000000-0000-0000-0000-000000000007') $$, 'sin filas no se publica', '%no tiene filas%');
-- 3g. fuente que no es del SEIA
select pg_temp.mk_snap(8, (select minvu from _fx), 1);
select pg_temp.raises($$ select public.seia_publish_snapshot('00000000-0000-0000-0000-000000000008') $$, 'una fuente de permisos no se publica como SEIA', '%no es del SEIA%');
select pg_temp.raises($$ select public.seia_publish_snapshot('00000000-0000-0000-0000-0000000000ff') $$, 'snapshot inexistente', '%no existe%');
-- 3h. (la foto vieja, snapshot 9, se creó al principio con un n menor que el del snapshot 1)
-- 3i. publicación correcta del snapshot 1 (6 filas, 0 rechazadas)
select pg_temp.assert((public.seia_publish_snapshot('00000000-0000-0000-0000-000000000001') ->> 'rows')::int = 6, 'publica el snapshot 1');
select pg_temp.assert((select count(*) from public.seia_projects_current_v where snapshot_id = '00000000-0000-0000-0000-000000000001') = 6, 'sus 6 filas quedan vigentes');
select pg_temp.assert((select snapshot_id = '00000000-0000-0000-0000-000000000001' from public.seia_current_snapshot where source_id = (select dia from _fx)),
                      'el puntero de la fuente apunta al snapshot publicado');
select pg_temp.assert((select status = 'loaded' and loaded_at is not null from public.source_snapshots where id = '00000000-0000-0000-0000-000000000001'), 'el snapshot queda loaded');
select pg_temp.assert((public.seia_publish_snapshot('00000000-0000-0000-0000-000000000001') ->> 'already_loaded')::boolean, 'publicar dos veces es idempotente');
select pg_temp.raises($$ select public.seia_publish_snapshot('00000000-0000-0000-0000-000000000009') $$, 'una foto más vieja no reemplaza a la vigente', '%más vieja%');
select pg_temp.assert((select count(*) from public.seia_projects_current_v where source_id = (select eia from _fx)) = 0 and
                      not exists (select 1 from public.seia_current_snapshot where source_id = (select eia from _fx)), 'publicar DIA no toca lo vigente de EIA');

-- -----------------------------------------------------------------------------
-- 4. Fotos siguientes: lo vigente anterior deja de serlo; la purga conserva K
-- -----------------------------------------------------------------------------
-- snapshot 10: SINT-5 desaparece del servicio, SINT-1 cambia de nombre, aparece SINT-7 (6 filas)
select pg_temp.mk_snap(10, (select dia from _fx), 6);
select pg_temp.add_proj('00000000-0000-0000-0000-00000000000a', (select dia from _fx), 'SINT-1', 'Proyecto adentro (v2)', 'h.1', 'h.1) Proyectos inmobiliarios',
       'Aprobado', date '2019-05-10', 55000000, 'Lo Barnechea', array['13115'], null, (select barnechea from _pt));
select pg_temp.add_proj('00000000-0000-0000-0000-00000000000a', (select dia from _fx), 'SINT-2', 'Praderas La Dehesa (caso reportado)', 'h.1', 'h.1) Proyectos inmobiliarios',
       'En Calificación', date '2020-03-02', 10000000, 'Lo Barnechea', array['13115'], null, (select praderas from _pt));
select pg_temp.add_proj('00000000-0000-0000-0000-00000000000a', (select dia from _fx), 'SINT-3', 'Proyecto en el borde', 'h.1', 'h.1) Proyectos inmobiliarios',
       'Aprobado', date '2021-07-01', 3000000, 'Lo Barnechea', array['13115'], null, (select borde from _pt));
select pg_temp.add_proj('00000000-0000-0000-0000-00000000000a', (select dia from _fx), 'SINT-4', 'Sin comuna cruzada', 'g.1', 'g.1) Desarrollo urbano',
       'Aprobado', date '2018-01-15', null, 'Comuna Inventada', array[]::char(5)[], array['Comuna Inventada'], ST_SetSRID(ST_MakePoint(-70.6, -33.4), 4326));
select pg_temp.add_proj('00000000-0000-0000-0000-00000000000a', (select dia from _fx), 'SINT-6', 'Dos comunas, una sin cruzar', 'h.2', 'h.2) Equipamiento',
       'Aprobado', date '2022-02-02', 7000000, 'Las Condes, Comuna Inventada', array['13114'], array['Comuna Inventada'], (select las_condes from _pt));
select pg_temp.add_proj('00000000-0000-0000-0000-00000000000a', (select dia from _fx), 'SINT-7', 'Proyecto nuevo', 'g.1', 'g.1) Desarrollo urbano',
       'Aprobado', date '2024-09-09', 120000000, 'Providencia', array['13123'], null, ST_PointOnSurface((select geom from public.comunas where cut = '13123')));
select public.seia_check_geometry('00000000-0000-0000-0000-00000000000a');
select pg_temp.assert((public.seia_publish_snapshot('00000000-0000-0000-0000-00000000000a') ->> 'rows')::int = 6, 'publica el snapshot 10');
select pg_temp.assert((select count(*) from public.seia_projects_current_v where source_id = (select dia from _fx)) = 6, 'queda UNA sola foto vigente (6 filas)');
select pg_temp.assert((select count(*) = 1 and bool_and(snapshot_id = '00000000-0000-0000-0000-00000000000a') from public.seia_current_snapshot where source_id = (select dia from _fx)),
                      'el puntero se movió al snapshot 10 (una fila por fuente)');
select pg_temp.assert((select count(*) from public.seia_projects_current_v where external_id = 'SINT-1') = 1, 'un expediente tiene una sola fila vigente');
select pg_temp.assert((select name = 'Proyecto adentro (v2)' from public.seia_projects_current_v where external_id = 'SINT-1'), 'lo vigente es la versión nueva');
select pg_temp.assert((select count(*) = 0 from public.seia_projects_current_v where external_id = 'SINT-5'), 'un expediente que desapareció del servicio ya no es vigente');
select pg_temp.assert((select count(*) = 1 from public.seia_projects where external_id = 'SINT-5'), '…pero su fila histórica sigue en su snapshot');
select pg_temp.assert((select status = 'superseded' from public.source_snapshots where id = '00000000-0000-0000-0000-000000000001'), 'el snapshot anterior pasa a superseded');

-- snapshot 11: copia del 10 (el servicio no cambió); la purga con K = 2 debe borrar solo lo del snapshot 1 y lo rechazado
select pg_temp.mk_snap(11, (select dia from _fx), 6);
insert into public.seia_projects (source_id, snapshot_id, external_id, name, typology_letter, typology_name, status_declared, submitted_at, investment_usd,
                                  comunas_declared, comuna_cuts, comunas_unresolved, geom, raw)
select source_id, '00000000-0000-0000-0000-00000000000b', external_id, name, typology_letter, typology_name, status_declared, submitted_at, investment_usd,
       comunas_declared, comuna_cuts, comunas_unresolved, geom, raw
  from public.seia_projects where snapshot_id = '00000000-0000-0000-0000-00000000000a';
select public.seia_check_geometry('00000000-0000-0000-0000-00000000000b');
select public.seia_publish_snapshot('00000000-0000-0000-0000-00000000000b');

-- una carga que falló al publicar queda 'rejected' (lo hace el ETL): sus filas inútiles también se purgan
update public.source_snapshots set status = 'rejected' where id = '00000000-0000-0000-0000-000000000002';

-- una revisión humana debe SOBREVIVIR a la purga: se identifica por (fuente, expediente)
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000aa'), ('00000000-0000-0000-0000-0000000000bb') on conflict do nothing;
insert into public.seia_project_geo_reviews (source_id, external_id, decision, proposed_geom, note, reviewed_by)
select dia, 'SINT-2', 'corrected', ST_SetSRID(ST_MakePoint(-70.52, -33.35), 4326), 'SINTETICO: ubicación según la dirección del expediente',
       '00000000-0000-0000-0000-0000000000aa' from _fx;

select pg_temp.assert((select count(*) from public.seia_projects where snapshot_id not in (select snapshot_id from public.seia_current_snapshot)) > 0, 'antes de purgar hay filas históricas');
select pg_temp.raises($$ select public.seia_purge_superseded((select dia from _fx), 0) $$, 'retención 0 rechazada', '%retención%');
select public.seia_purge_superseded((select dia from _fx), 2);
select pg_temp.assert((select count(*) = 0 from public.seia_projects where snapshot_id = '00000000-0000-0000-0000-000000000001'),
                      'purga K=2: se borran las filas del snapshot más viejo (el 1)');
select pg_temp.assert((select count(*) = 0 from public.seia_projects where snapshot_id = '00000000-0000-0000-0000-000000000002'),
                      'purga: también las filas de una carga rechazada');
select pg_temp.assert((select count(*) = 1 from public.seia_projects where snapshot_id = '00000000-0000-0000-0000-000000000003'),
                      'purga: una carga "validated" (en curso o abandonada) NO se toca');
select pg_temp.assert((select count(*) = 6 from public.seia_projects where snapshot_id = '00000000-0000-0000-0000-00000000000a'),
                      'purga K=2: el snapshot 10 (el penúltimo) conserva sus filas');
select pg_temp.assert((select count(*) = 6 from public.seia_projects_current_v), 'la purga no toca lo vigente');
select pg_temp.assert((select count(*) = 3 from public.source_snapshots where id in
                        ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a')),
                      'los REGISTROS de snapshot se conservan (y su archivo original en Storage)');
select pg_temp.assert((select count(*) = 1 from public.seia_project_geo_reviews where external_id = 'SINT-2'), 'la revisión humana sobrevive a la purga');
select public.seia_purge_superseded((select dia from _fx), 1);
select pg_temp.assert((select count(*) = 0 from public.seia_projects where snapshot_id = '00000000-0000-0000-0000-00000000000a'), 'purga K=1: solo queda la foto vigente');
select pg_temp.assert((select count(*) = 6 from public.seia_projects_current_v), '…y lo vigente sigue intacto');
select pg_temp.assert((public.seia_purge_superseded((select eia from _fx), 2) ->> 'rows_deleted')::int = 0, 'purgar una fuente sin cargas no hace nada');

-- -----------------------------------------------------------------------------
-- 5. Lectura: mapa por recuadro, filtros, ficha, facetas
--    vigentes: SINT-1 (inside, h.1, 2019, 55 M) · SINT-2 (outside, h.1, 2020, 10 M) · SINT-3 (near_border, h.1, 2021, 3 M)
--              SINT-4 (unmatched, g.1, 2018, sin inversión) · SINT-6 (inside, h.2, 2022, 7 M) · SINT-7 (inside, g.1, 2024, 120 M)
-- -----------------------------------------------------------------------------
create temp table _bb as select -71.0::float8 as w, -34.5::float8 as s, -70.0::float8 as e, -33.0::float8 as n;
grant select on _bb to public;

select pg_temp.assert((select count(*) from public.get_seia_projects((select w from _bb), (select s from _bb), (select e from _bb), (select n from _bb))) = 6,
                      'el recuadro de Santiago devuelve los 6 vigentes con punto');
select pg_temp.assert((select count(*) = 0 from public.get_seia_projects(-60, -10, -59, -9)), 'un recuadro vacío no devuelve filas');
select pg_temp.assert((select bool_and(total_matching = 6) from public.get_seia_projects((select w from _bb), (select s from _bb), (select e from _bb), (select n from _bb))),
                      'total_matching cuenta todas las coincidencias');
select pg_temp.assert((select array_agg(external_id order by external_id)::text[] = array['SINT-1','SINT-2','SINT-3']
                         from public.get_seia_projects((select w from _bb), (select s from _bb), (select e from _bb), (select n from _bb), array['h.1'], null, null)),
                      'p_typology = {h.1} devuelve solo h.1');
select pg_temp.assert((select array_agg(external_id)::text[] = array['SINT-6']
                         from public.get_seia_projects((select w from _bb), (select s from _bb), (select e from _bb), (select n from _bb), array['h.2'])),
                      'h.2 (industrial) NO entra por pedir h.1: los códigos son exactos, no por letra');
select pg_temp.assert((select count(*) = 0 from public.get_seia_projects((select w from _bb), (select s from _bb), (select e from _bb), (select n from _bb), array['h'])),
                      'la letra sola ("h") NO casa con h.1: el panel expande los grupos, la RPC no adivina');
select pg_temp.assert((select count(*) = 2 from public.get_seia_projects((select w from _bb), (select s from _bb), (select e from _bb), (select n from _bb), array['g.1'])),
                      'p_typology = {g.1} devuelve g.1');
select pg_temp.assert((select count(*) = 3 from public.get_seia_projects((select w from _bb), (select s from _bb), (select e from _bb), (select n from _bb), array[' H.1 '])),
                      'la tipología no distingue mayúsculas ni espacios');
select pg_temp.assert((select count(*) = 2 from public.get_seia_projects((select w from _bb), (select s from _bb), (select e from _bb), (select n from _bb), array['G.1.'])),
                      'ni el punto final (el servicio trae códigos como "c.")');
select pg_temp.assert((select count(*) = 6 from public.get_seia_projects((select w from _bb), (select s from _bb), (select e from _bb), (select n from _bb), array['g.1', 'h.1', 'h.2'])),
                      'varios códigos a la vez');
select pg_temp.assert((select count(*) = 0 from public.get_seia_projects((select w from _bb), (select s from _bb), (select e from _bb), (select n from _bb), array['zz.9'])),
                      'un código que no existe devuelve vacío (no todo)');
select pg_temp.assert((select count(*) = 0 from public.get_seia_projects((select w from _bb), (select s from _bb), (select e from _bb), (select n from _bb), array[]::text[])),
                      'un arreglo vacío de tipologías devuelve vacío: «ninguna» es distinto de «todas» (NULL)');
select pg_temp.assert((select count(*) = 1 from public.get_seia_projects((select w from _bb), (select s from _bb), (select e from _bb), (select n from _bb), null, array['En Calificación'])),
                      'filtro por estado declarado exacto');
select pg_temp.assert((select count(*) = 2 from public.get_seia_projects((select w from _bb), (select s from _bb), (select e from _bb), (select n from _bb), null, null, null, 2021, 2022)),
                      'filtro de años 2021-2022 (por FECHA_PRESENTACION)');
select pg_temp.assert((select count(*) = 6 from public.get_seia_projects((select w from _bb), (select s from _bb), (select e from _bb), (select n from _bb), null, null, array['seia_proyectos_dia'])),
                      'filtro por fuente: DIA');
select pg_temp.assert((select count(*) = 0 from public.get_seia_projects((select w from _bb), (select s from _bb), (select e from _bb), (select n from _bb), null, null, array['seia_proyectos_eia'])),
                      'filtro por fuente: EIA no tiene vigentes');
select pg_temp.assert((select count(*) = 4 from public.get_seia_projects((select w from _bb), (select s from _bb), (select e from _bb), (select n from _bb), null, null, null, null, null, true)),
                      'p_hide_flagged oculta outside_declared y comuna_unmatched');
select pg_temp.assert((select count(*) = 6 from public.get_seia_projects((select w from _bb), (select s from _bb), (select e from _bb), (select n from _bb), null, null, null, null, null, false)),
                      'por defecto las ubicaciones dudosas SÍ se devuelven (marcadas)');
-- recorte: se devuelven los de MAYOR inversión y total_matching avisa que hay más
select pg_temp.assert((select array_agg(external_id order by investment_usd desc) = array['SINT-7','SINT-1'] and max(total_matching) = 6
                         from public.get_seia_projects((select w from _bb), (select s from _bb), (select e from _bb), (select n from _bb), null, null, null, null, null, false, 2)),
                      'p_limit recorta por mayor inversión declarada y total_matching dice cuántos había');
select pg_temp.assert((select investment_usd is null from public.get_seia_projects((select w from _bb), (select s from _bb), (select e from _bb), (select n from _bb)) where external_id = 'SINT-4'),
                      'inversión faltante → NULL');
select pg_temp.raises($$ select * from public.get_seia_projects(-70, -33, -71, -34) $$, 'recuadro invertido', '%recuadro inválido%');
select pg_temp.raises($$ select * from public.get_seia_projects(null, -34, -70, -33) $$, 'recuadro con nulos', '%recuadro inválido%');
select pg_temp.raises($$ select * from public.get_seia_projects(-71, -34, -70, -33, null, null, null, null, null, false, 0) $$, 'límite 0', '%p_limit%');
select pg_temp.raises($$ select * from public.get_seia_projects(-71, -34, -70, -33, null, null, null, null, null, false, 10001) $$, 'límite excesivo', '%p_limit%');

-- la revisión muestra la corrección PROPUESTA aparte; el punto original no cambia
select pg_temp.assert((select review_decision = 'corrected' and lat = -33.80 and review_lat = -33.35 and review_lon = -70.52
                         from public.get_seia_projects((select w from _bb), (select s from _bb), (select e from _bb), (select n from _bb)) where external_id = 'SINT-2'),
                      'el mapa recibe punto ORIGINAL y corrección PROPUESTA por separado');
select pg_temp.assert((select review_lat is null from public.get_seia_projects((select w from _bb), (select s from _bb), (select e from _bb), (select n from _bb)) where external_id = 'SINT-1'),
                      'sin revisión no hay punto propuesto');

-- facetas
select pg_temp.assert((public.get_seia_facets() ->> 'total')::int = 6 and (public.get_seia_facets() ->> 'with_point')::int = 6, 'facetas: total y con punto');
select pg_temp.assert((public.get_seia_facets() -> 'by_source' ->> 'seia_proyectos_dia')::int = 6, 'facetas: por fuente');
select pg_temp.assert((public.get_seia_facets() -> 'geo_status' ->> 'outside_declared')::int = 1
                      and (public.get_seia_facets() -> 'geo_status' ->> 'inside')::int = 3
                      and (public.get_seia_facets() -> 'geo_status' ->> 'near_border')::int = 1
                      and (public.get_seia_facets() -> 'geo_status' ->> 'comuna_unmatched')::int = 1, 'facetas: conteo por calidad de ubicación');
select pg_temp.assert(jsonb_array_length(public.get_seia_facets() -> 'typologies') = 3
                      and (public.get_seia_facets() -> 'typologies' -> 0 ->> 'letter') = 'g.1', 'facetas: tipologías reales (g.1, h.1, h.2)');
select pg_temp.assert((public.get_seia_facets() ->> 'year_min')::int = 2018 and (public.get_seia_facets() ->> 'year_max')::int = 2024, 'facetas: rango de años');
select pg_temp.assert((public.get_seia_facets() -> 'statuses' -> 0 ->> 'value') = 'Aprobado', 'facetas: estados declarados por frecuencia');
select pg_temp.assert((public.get_seia_facets(array['seia_proyectos_eia']) ->> 'total')::int = 0, 'facetas filtradas por fuente');

-- ficha
select pg_temp.assert((public.get_seia_project('seia_proyectos_dia', 'SINT-2') -> 'project' ->> 'name') = 'Praderas La Dehesa (caso reportado)', 'ficha: campos');
select pg_temp.assert((public.get_seia_project('seia_proyectos_dia', 'SINT-2') -> 'project' ->> 'geo_check_status') = 'outside_declared', 'ficha: estado de la ubicación');
select pg_temp.assert((public.get_seia_project('seia_proyectos_dia', 'SINT-2') -> 'raw' ->> 'ID_EXPEDIENTE') = 'SINT-2', 'ficha: atributos originales');
select pg_temp.assert((public.get_seia_project('seia_proyectos_dia', 'SINT-2') -> 'snapshot' ->> 'origin_url') = 'https://example.test/sintetico-seia/11', 'ficha: URL de origen del snapshot vigente');
select pg_temp.assert((public.get_seia_project('seia_proyectos_dia', 'SINT-2') -> 'source' ->> 'verification_status') = 'comprobado'
                      and (public.get_seia_project('seia_proyectos_dia', 'SINT-2') -> 'source' ->> 'scope_note') like '%no es permiso%',
                      'ficha: la fuente trae su alcance ("no es permiso de edificación")');
select pg_temp.assert(jsonb_array_length(public.get_seia_project('seia_proyectos_dia', 'SINT-2') -> 'reviews') = 1
                      and (public.get_seia_project('seia_proyectos_dia', 'SINT-2') -> 'reviews' -> 0 ->> 'decision') = 'corrected', 'ficha: revisiones');
select pg_temp.assert((public.get_seia_project('seia_proyectos_dia', 'SINT-5')) is null, 'ficha: un expediente que ya no es vigente devuelve NULL');
select pg_temp.assert((public.get_seia_project('seia_proyectos_dia', 'NO-EXISTE')) is null, 'ficha: expediente inexistente devuelve NULL');
select pg_temp.assert((public.get_seia_project('seia_proyectos_eia', 'SINT-2')) is null, 'ficha: la fuente cuenta (mismo expediente en otra fuente no calza)');

-- -----------------------------------------------------------------------------
-- 6. Hoja en el árbol (migración 3)
-- -----------------------------------------------------------------------------
select pg_temp.assert((select count(*) = 1 from public.thematic_layers where dataset = 'seia_projects' and renderer = 'points_projects'), 'hay UNA capa temática del SEIA');
select pg_temp.assert((select n.kind = 'layer' and n.name = 'Proyectos SEIA'
                         and n.parent_id = (select id from public.layer_nodes where kind = 'folder' and style ->> 'slug' = 'edificacion_expansion')
                         from public.layer_nodes n join public.thematic_layers t on t.layer_id = n.id where t.dataset = 'seia_projects'),
                      'la hoja "Proyectos SEIA" cuelga de "Edificación y expansión urbana"');
select pg_temp.assert((select default_params -> 'typology' = '["g","h.1"]'::jsonb and jsonb_array_length(default_params -> 'source_keys') = 2
                         from public.thematic_layers where dataset = 'seia_projects'), 'los parámetros por defecto son datos de la hoja');
select pg_temp.assert((select count(*) = 1 from public.thematic_layers where dataset = 'building_permits'), 'la hoja de permisos sigue ahí, aparte');
select pg_temp.assert((select count(*) = 1 from public.layer_nodes where kind = 'folder' and style ->> 'slug' = 'edificacion_expansion'), 'la carpeta es una sola, compartida');

-- -----------------------------------------------------------------------------
-- 7. Permisos y RLS
-- -----------------------------------------------------------------------------
set local role anon;
select pg_temp.raises($$ select count(*) from public.seia_projects $$, 'anon no lee proyectos', '%permission denied%');
select pg_temp.raises($$ select count(*) from public.seia_projects_current_v $$, 'anon no lee la vista', '%permission denied%');
select pg_temp.raises($$ select * from public.get_seia_facets() $$, 'anon no ejecuta las RPC de lectura', '%permission denied%');
select pg_temp.raises($$ select count(*) from public.seia_current_snapshot $$, 'anon no lee el puntero', '%permission denied%');
select pg_temp.raises($$ select count(*) from public.seia_project_geo_checks $$, 'anon no lee las validaciones', '%permission denied%');
reset role;

set local role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000000bb', true);   -- usuario NO admin
select pg_temp.assert((select count(*) = 6 from public.seia_projects_current_v), 'authenticated lee la vista');
select pg_temp.assert((select count(*) = 6 from public.get_seia_projects(-71, -34.5, -70, -33)), 'authenticated ejecuta get_seia_projects');
select pg_temp.assert((public.get_seia_facets() ->> 'total')::int = 6, 'authenticated ejecuta get_seia_facets');
select pg_temp.assert(public.get_seia_project('seia_proyectos_dia', 'SINT-1') is not null, 'authenticated ejecuta get_seia_project');
select pg_temp.raises($$ insert into public.seia_projects (source_id, snapshot_id, external_id, raw)
                         select dia, '00000000-0000-0000-0000-00000000000b', 'HACK', '{}' from _fx $$, 'nadie escribe proyectos por la API', '%row-level security%');
do $$ declare n int; begin
  update public.seia_projects set name = name;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLA: authenticated pudo actualizar proyectos'; end if;
  raise notice 'ok   authenticated no actualiza proyectos (0 filas)';
end $$;
select pg_temp.raises($$ insert into public.seia_project_geo_checks (project_id, status) select id, 'inside' from public.seia_projects limit 1 $$,
                      'nadie escribe validaciones por la API', '%row-level security%');
select pg_temp.raises($$ insert into public.seia_current_snapshot (source_id, snapshot_id) select eia, '00000000-0000-0000-0000-00000000000b' from _fx $$,
                      'nadie mueve el puntero de foto vigente por la API', '%row-level security%');
do $$ declare n int; begin
  update public.seia_current_snapshot set snapshot_id = '00000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLA: authenticated pudo mover el puntero'; end if;
  raise notice 'ok   authenticated no actualiza el puntero (0 filas)';
end $$;
select pg_temp.raises($$ select public.seia_publish_snapshot('00000000-0000-0000-0000-00000000000b') $$, 'authenticated no puede publicar', '%permission denied%');
select pg_temp.raises($$ select public.seia_check_geometry('00000000-0000-0000-0000-00000000000b') $$, 'authenticated no puede validar geometrías', '%permission denied%');
select pg_temp.raises($$ select public.seia_purge_superseded((select dia from _fx)) $$, 'authenticated no puede purgar', '%permission denied%');
select pg_temp.raises($$ insert into public.seia_project_geo_reviews (source_id, external_id, decision, note, reviewed_by)
                         select dia, 'SINT-1', 'confirmed_ok', 'no soy admin', '00000000-0000-0000-0000-0000000000bb' from _fx $$,
                      'un usuario que no es admin no revisa ubicaciones', '%row-level security%');
reset role;

-- revisión humana: solo admin, a nombre propio, append-only
set local role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000000aa', true);   -- admin
insert into public.seia_project_geo_reviews (source_id, external_id, decision, note)
select dia, 'SINT-1', 'confirmed_ok', 'SINTETICO: ubicación correcta' from _fx;
select pg_temp.assert((select count(*) = 1 from public.seia_project_geo_reviews where external_id = 'SINT-1' and reviewed_by = '00000000-0000-0000-0000-0000000000aa'),
                      'un admin registra una revisión (reviewed_by = auth.uid())');
select pg_temp.raises($$ insert into public.seia_project_geo_reviews (source_id, external_id, decision, note, reviewed_by)
                         select dia, 'SINT-1', 'confirmed_ok', 'a nombre de otro', '00000000-0000-0000-0000-0000000000bb' from _fx $$,
                      'no se firma una revisión a nombre de otro', '%row-level security%');
select pg_temp.raises($$ insert into public.seia_project_geo_reviews (source_id, external_id, decision, note)
                         select dia, 'SINT-1', 'corrected', 'sin punto propuesto' from _fx $$, 'corrected exige punto propuesto', '%spgr_corrected_has_geom%');
select pg_temp.raises($$ insert into public.seia_project_geo_reviews (source_id, external_id, decision, note)
                         select dia, 'SINT-1', 'confirmed_ok', '   ' from _fx $$, 'la nota es obligatoria', '%check%');
do $$ declare n int; begin
  update public.seia_project_geo_reviews set note = 'editada';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLA: se editó una revisión'; end if;
  delete from public.seia_project_geo_reviews;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLA: se borró una revisión'; end if;
  raise notice 'ok   las revisiones son append-only (0 filas editables o borrables)';
end $$;
reset role;

-- la vista muestra la ÚLTIMA revisión de cada expediente
select pg_temp.assert((select review_decision = 'confirmed_ok' from public.seia_projects_current_v where external_id = 'SINT-1'), 'la vista muestra la última revisión del expediente');

rollback;
