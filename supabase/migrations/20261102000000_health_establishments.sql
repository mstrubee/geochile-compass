-- =============================================================================
-- PROPUESTA (NO APLICADA) — Salud, Fase 1a: registro de establecimientos de salud (DEIS/MINSAL)
-- =============================================================================
-- Decisiones de diseño: docs/salud/DISENO.md §2 (leer antes). Resumen:
--   health_tipo_clasificacion        tipo de establecimiento -> clase (ambulatorio/hospitalario/mixto/sin_clasificar) y banderas de
--                                    alta complejidad (D1: dos definiciones). DECISIÓN DE DISEÑO propia (advertencia regla 3); editable por admin
--   health_establishments            una fila por (snapshot_n, code): textos crudos + normalizados + validación geográfica (se MARCA, jamás se mueve)
--   health_establishments_stage      zona de paso (UNLOGGED), se vacía al publicar
--   publish_health_establishments()  único camino para publicar (SECURITY DEFINER, todo-o-nada): re-valida dominios, duplicados, CUT y cuadres
--                                    en la base, calcula geo_status y las clases
--   get_health_establishments()      puntos por bbox con filtros (SECURITY INVOKER)
--   get_health_comuna_counts()       CAPA DERIVADA: establecimientos por comuna con los filtros elegidos y ranking
--   get_health_comuna_tipos()        desglose de una comuna por tipo y estado (qué hay detrás de un número del ranking)
--   get_health_summary()             leyenda y ficha: conteos por estado, geo_status, clase imputada, alta complejidad
--   get_health_tipo_clasificacion()  la tabla de clasificación, para mostrarla en la ficha
--
-- Fuente: establecimientos_20261014.csv, datos.gob.cl (CC0). Sondeo real en docs/salud/HALLAZGOS_FASE0.md. Se siembra una fila en data_sources.
-- Semántica que la interfaz NO puede perder: es un registro de establecimientos, no de capacidad ni de acceso; «en la comuna» no es «accesible»;
-- la clase ambulatorio/hospitalario de algunas filas está imputada por una tabla de diseño, no por la fuente; la alta complejidad tiene dos definiciones.
--
-- Requiere las partes 1–4 de permisos/proyectos (data_sources, source_snapshots, comunas, pipeline_settings, geo_rejected_rows). SOLO ADITIVA.
-- Se aplica ANTES de la migración de capas del árbol (20261102000100). Aplicar con: psql "$DB" -1 -v ON_ERROR_STOP=1 -f <archivo>
-- Rollback: supabase/rollbacks/20261102000000_health_establishments_down.sql
-- =============================================================================

select pg_advisory_xact_lock(hashtext('salud_v1'));
set local statement_timeout = '5min';

insert into public._migration_log (sprint, notes) values ('health_establishments_v1', 'start');

do $$
begin
  if to_regclass('public.geo_rejected_rows') is null or to_regclass('public.comunas') is null
     or to_regclass('public.data_sources') is null or to_regclass('public.pipeline_settings') is null then
    raise exception 'Guardrail: faltan las partes de permisos/proyectos (geo_rejected_rows, comunas, data_sources, pipeline_settings); aplicarlas primero';
  end if;
end $$;

drop table if exists pg_temp._salud_counts_before;           -- por si la migración se aplica dos veces en la misma transacción (prueba de idempotencia)
create temp table _salud_counts_before on commit drop as
  select 'layer_nodes'::text as t, count(*)::bigint as n from public.layer_nodes
  union all select 'territorial_layers', count(*) from public.territorial_layers
  union all select 'territorial_features', count(*) from public.territorial_features
  union all select 'comunas', count(*) from public.comunas
  union all select 'source_snapshots', count(*) from public.source_snapshots
  union all select 'data_sources_other', count(*) from public.data_sources where source_key <> 'deis_establecimientos';

-- -----------------------------------------------------------------------------
-- 1. Umbrales configurables (VALORES INICIALES; se midieron con el archivo real, ver DISENO.md §2.10)
-- -----------------------------------------------------------------------------
insert into public.pipeline_settings (key, value, description) values
  ('health.near_border_m',  500,  'Metros de tolerancia al borde de la comuna declarada para marcar un establecimiento como borde (1) en vez de fuera_declarada (3). VALOR INICIAL.'),
  ('health.coast_buffer_m', 2000, 'Metros desde el polígono de la comuna declarada hasta los que un punto que no cae en ninguna comuna se marca costero (2): cubre la costa simplificada del polígono comunal. VALOR INICIAL.')
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- 2. Fuente
-- -----------------------------------------------------------------------------
insert into public.data_sources
  (source_key, dataset, name, publisher, landing_url, data_url, license_label, attribution, access_mode,
   cadence_days, publication_lag_days, grace_days, check_every_days,
   verification_status, verified_at, verification_note, scope_note)
values
  ('deis_establecimientos', 'health_establishments',
   'Establecimientos de salud vigentes y cerrados (DEIS/MINSAL)',
   'Departamento de Estadísticas e Información de Salud (DEIS), Ministerio de Salud',
   'https://datos.gob.cl/dataset/3bf4cf7c-f638-4735-9a01-f65faae4beca',
   'https://datos.gob.cl/dataset/3bf4cf7c-f638-4735-9a01-f65faae4beca/resource/2c44d782-3365-44e3-aefb-2c8b8363a1bc/download/establecimientos_20261014.csv',
   'CC0 1.0 (dominio público, según datos.gob.cl)',
   'Fuente: DEIS, Ministerio de Salud (datos.gob.cl)',
   'manual', 30, 7, 30, 7,
   'comprobado', date '2026-10-17',
   'Sondeo real de la Fase 0 (2026-10-17): archivo establecimientos_20261014.csv, modificado 2026-10-14, 5.782 filas y 33 columnas, SHA-256 244426f9201ecfaa4f8dc964d3ee7479a65eef565c37b9ddf05d22cac31343a6. Código de establecimiento único (6 dígitos); 345 de 346 comunas con al menos un establecimiento; 370 filas sin coordenadas; 428 cerrados (73 sin fecha de cierre). La cadencia (30 días) es una hipótesis hasta medirla.',
   'Registro administrativo de establecimientos: NO mide capacidad, dotación, camas ni acceso; estar «en la comuna» no es ser accesible. Los cerrados se ocultan por defecto. La clase ambulatorio/hospitalario de algunas filas está imputada por una tabla de diseño (ver ficha), y la alta complejidad tiene dos definiciones (hospitales; ampliada con clínicas y centros de especialidades). Las coordenadas se validan contra la comuna declarada: se marcan, nunca se mueven.')
on conflict (source_key) do nothing;

-- -----------------------------------------------------------------------------
-- 3. Clasificación por tipo de establecimiento (datos, no código)
-- -----------------------------------------------------------------------------
--   tipo_norm = minúsculas con espacios colapsados (la fuente trae dobles espacios, p. ej. 'Sala  Externa de Toma de Muestras (SETM)')
--   clase     = SOLO se usa cuando la fuente no declara TipoAtencion (vacío o 'No Aplica'): manda lo oficial
create table if not exists public.health_tipo_clasificacion (
  tipo_norm       text primary key check (tipo_norm = lower(regexp_replace(btrim(tipo_norm), '\s+', ' ', 'g')) and tipo_norm <> ''),
  tipo_label      text not null check (btrim(tipo_label) <> ''),
  clase           text not null check (clase in ('ambulatorio', 'hospitalario', 'mixto', 'sin_clasificar')),
  alta_hospital   boolean not null default false,       -- D1 por defecto: complejidad alta Y tipo Hospital
  alta_ampliada   boolean not null default false,       -- D1 variante: además Clínica y Centro de Especialidades
  evidence        text not null check (btrim(evidence) <> ''),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id) on delete set null,
  constraint health_tipo_alta_coherente check (not alta_hospital or alta_ampliada)
);
comment on table public.health_tipo_clasificacion is
  'DECISIÓN DE DISEÑO (docs/salud/DISENO.md §2.3): clase ambulatorio/hospitalario por tipo, solo para completar filas sin TipoAtencion oficial. Toda cifra que la use lleva advertencia (regla 3).';

insert into public.health_tipo_clasificacion (tipo_norm, tipo_label, clase, alta_hospital, alta_ampliada, evidence) values
  ('hospital',                      'Hospital',                      'hospitalario', true,  true,  'Registro 2026-10-14: 233 de 234 con TipoAtencion declarada son hospitalarias.'),
  ('clínica',                       'Clínica',                       'mixto',        false, true,  'Registro 2026-10-14: 106 hospitalarias y 62 ambulatorias con dato; NO se imputa. Alta complejidad solo en la definición ampliada (D1).'),
  ('centro de especialidades',      'Centro de Especialidades',      'ambulatorio',  false, true,  'Registro: 112 ambulatorias y 2 hospitalarias con dato. Alta complejidad solo en la definición ampliada (D1).'),
  ('centro de salud privado',       'Centro de Salud Privado',       'ambulatorio',  false, false, 'Registro: 916 ambulatorias y 6 hospitalarias con dato.'),
  ('posta de salud rural (psr)',    'Posta de Salud Rural (PSR)',    'ambulatorio',  false, false, 'Registro: 1.132 ambulatorias con dato, ninguna hospitalaria.'),
  ('centro de salud familiar (cesfam)', 'Centro de Salud Familiar (CESFAM)', 'ambulatorio', false, false, 'Registro: 608 de 608 ambulatorias.'),
  ('laboratorio clínico',           'Laboratorio Clínico',           'ambulatorio',  false, false, 'Registro: 368 ambulatorias con dato; 11 No Aplica.'),
  ('clínica dental',                'Clínica Dental',                'ambulatorio',  false, false, 'Registro: 347 ambulatorias con dato.'),
  ('centro comunitario de salud familiar (cecosf)', 'Centro Comunitario de Salud Familiar (CECOSF)', 'ambulatorio', false, false, 'Registro: 304 ambulatorias con dato.'),
  ('servicio de atención primaria de urgencia (sapu)', 'Servicio de Atención Primaria de Urgencia (SAPU)', 'ambulatorio', false, false, 'Registro: 252 ambulatorias con dato.'),
  ('servicio de urgencia rural (sur)', 'Servicio de Urgencia Rural (SUR)', 'ambulatorio', false, false, 'Registro: 180 de 180 ambulatorias.'),
  ('servicio de atención primaria de urgencia de alta resolutividad (sar)', 'Servicio de Atención Primaria de Urgencia de Alta Resolutividad (SAR)', 'ambulatorio', false, false, 'Registro: 105 de 105 ambulatorias.'),
  ('vacunatorio',                   'Vacunatorio',                   'ambulatorio',  false, false, 'Registro: 136 ambulatorias con dato.'),
  ('centro de diálisis',            'Centro de Diálisis',            'ambulatorio',  false, false, 'Registro: 123 ambulatorias con dato.'),
  ('centro comunitario de salud mental (cosam)', 'Centro Comunitario de Salud Mental (COSAM)', 'ambulatorio', false, false, 'Registro: 118 ambulatorias con dato (+1 truncada «Atención Abierta-Ambu»).'),
  ('sala externa de toma de muestras (setm)', 'Sala Externa de Toma de Muestras (SETM)', 'ambulatorio', false, false, 'Registro: 108 ambulatorias con dato.'),
  ('unidad de procedimientos móvil', 'Unidad de Procedimientos Móvil', 'ambulatorio', false, false, 'Registro: 56 de 56 ambulatorias.'),
  ('consultorio general rural (cgr)', 'Consultorio General Rural (CGR)', 'ambulatorio', false, false, 'Registro: 14 de 14 ambulatorias.'),
  ('consultorio general urbano (cgu)', 'Consultorio General Urbano (CGU)', 'ambulatorio', false, false, 'Registro: 12 de 12 ambulatorias.'),
  ('centro de rehabilitación',      'Centro de Rehabilitación',      'ambulatorio',  false, false, 'Registro: 13 de 13 ambulatorias.'),
  ('centro de salud comunitario para personas con demencia', 'Centro de Salud Comunitario para Personas con Demencia', 'ambulatorio', false, false, 'Registro: 10 de 10 ambulatorias.'),
  ('centro de especialidades de atención primaria (ceap)', 'Centro de Especialidades de Atención Primaria (CEAP)', 'ambulatorio', false, false, 'Registro: 8 de 8 ambulatorias.'),
  ('hospital de día',               'Hospital de Día',               'ambulatorio',  false, false, 'Registro: 7 de 7 declaradas ambulatorias (pese al nombre).'),
  ('centros de diagnóstico y tratamiento privados', 'Centros de Diagnóstico y Tratamiento Privados', 'ambulatorio', false, false, 'Registro: 1 de 1 ambulatoria.'),
  ('centro de regulación médica de las urgencias (samu)', 'Centro de Regulación Médica de las Urgencias (SAMU)', 'ambulatorio', false, false, 'Registro: 1 declarada ambulatoria (central de regulación; no atiende pacientes en el local).'),
  ('centro corporación para la nutrición infantil (conin)', 'Centro Corporación para la Nutrición Infantil (CONIN)', 'hospitalario', false, false, 'Registro: 9 de 9 hospitalarias.'),
  ('otro',                          'Otro',                          'sin_clasificar', false, false, 'Tipo heterogéneo (115 ambulatorias, 6 hospitalarias, 42 No Aplica): sin base para imputar.'),
  ('dispositivo incorporado por crisis sanitaria', 'Dispositivo Incorporado por Crisis Sanitaria', 'sin_clasificar', false, false, 'Registro: 10 hospitalarias, 1 ambulatoria y 13 sin dato: sin base para imputar.'),
  ('atención remota',               'Atención Remota',               'sin_clasificar', false, false, 'Registro: 2 No Aplica (atención no presencial).')
on conflict (tipo_norm) do nothing;

-- -----------------------------------------------------------------------------
-- 4. Establecimientos
-- -----------------------------------------------------------------------------
--   geo_status: 0 dentro · 1 borde · 2 costero · 3 fuera_declarada · 4 sin_coordenadas · 5 comuna_sin_poligono · 6 coordenada_invalida
create table if not exists public.health_establishments (
  snapshot_n        integer  not null,
  code              text     not null check (code ~ '^[0-9]{6}$'),            -- EstablecimientoCodigo
  old_code          text,                                                     -- EstablecimientoCodigoAntiguo
  parent_code       text,                                                     -- EstablecimientoCodigoMadreNuevo
  name              text     not null check (btrim(name) <> ''),
  region_cut        char(2)  not null check (region_cut ~ '^[0-9]{2}$'),
  comuna_cut        char(5)  not null references public.comunas(cut),
  comuna_glosa      text,                                                     -- tal cual (auditar discrepancias nombre <-> CUT)
  tipo_glosa        text     not null,                                        -- TipoEstablecimientoGlosa tal cual
  tipo_norm         text     not null references public.health_tipo_clasificacion(tipo_norm),
  ambito            text,
  dependencia_raw   text,
  dependencia_norm  text     not null check (dependencia_norm in (
    'municipal', 'privado', 'servicio_salud', 'seremi', 'delegado', 'otra_institucion',
    'ejercito', 'armada', 'fach', 'carabineros', 'pdi', 'gendarmeria', 'sin_dato')),
  tipo_sistema_raw  text,                                                     -- TipoSistemaSaludGlosa tal cual (NO es lo mismo que «privado» por dependencia)
  snss              boolean,                                                  -- pertenece al Sistema Nacional de Servicios de Salud (null = No Aplica)
  nivel_atencion_raw text,
  complejidad_raw   text,
  complejidad       text     not null check (complejidad in ('alta', 'mediana', 'baja', 'no_aplica', 'sin_dato')),
  tipo_atencion_raw text,
  tipo_atencion     text     not null check (tipo_atencion in ('ambulatoria', 'hospitalaria', 'no_aplica', 'sin_dato')),
  clase_servicio    text     not null check (clase_servicio in ('ambulatorio', 'hospitalario', 'sin_clasificar')),
  clase_fuente      text     not null check (clase_fuente in ('oficial', 'tabla', 'sin_clasificar')),
  alta_hospital     boolean  not null,
  alta_ampliada     boolean  not null,
  estado            text     not null check (estado in ('vigente', 'cerrado')),
  fecha_inicio      date,
  fecha_cierre      date,
  tiene_urgencia    boolean,
  tipo_urgencia     text,
  address           text,
  lon_raw           double precision,                                         -- tal cual vienen (también cuando son inválidos)
  lat_raw           double precision,
  geo_status        smallint not null check (geo_status between 0 and 6),
  geo_distance_m    real,                                                     -- metros a la comuna declarada (solo si el punto no cae dentro)
  geom              geometry(Point, 4326),                                    -- el punto de la fuente; jamás corregido en sitio
  constraint health_establishments_pk primary key (snapshot_n, code),
  constraint health_establishments_geom_coherente check ((geo_status in (4, 6)) = (geom is null)),
  constraint health_establishments_alta_coherente check ((not alta_hospital) or (complejidad = 'alta' and alta_ampliada))
);
create index if not exists health_establishments_geom_gix on public.health_establishments using gist (geom);
create index if not exists health_establishments_comuna_idx on public.health_establishments (snapshot_n, comuna_cut);

comment on table public.health_establishments is
  'Registro de establecimientos de salud (DEIS). NO mide capacidad ni acceso. clase_fuente = tabla significa clase imputada por health_tipo_clasificacion (decisión de diseño).';
comment on column public.health_establishments.geo_status is '0 dentro de su comuna, 1 borde, 2 costero, 3 fuera_declarada, 4 sin_coordenadas, 5 comuna_sin_poligono, 6 coordenada_invalida. Se marca, jamás se mueve.';
comment on column public.health_establishments.geom is 'Punto de la fuente (null si no hay coordenadas o son inválidas). Nunca se modifica.';

create unlogged table if not exists public.health_establishments_stage (
  snapshot_n        integer  not null,
  code              text     not null,
  old_code          text,
  parent_code       text,
  name              text     not null,
  region_cut        text     not null,
  comuna_cut        text     not null,
  comuna_glosa      text,
  tipo_glosa        text     not null,
  ambito            text,
  dependencia_raw   text,
  dependencia_norm  text     not null,
  tipo_sistema_raw  text,
  snss              boolean,
  nivel_atencion_raw text,
  complejidad_raw   text,
  complejidad       text     not null,
  tipo_atencion_raw text,
  tipo_atencion     text     not null,
  estado            text     not null,
  fecha_inicio      date,
  fecha_cierre      date,
  tiene_urgencia    boolean,
  tipo_urgencia     text,
  address           text,
  coords_present    boolean  not null,                  -- la fuente trajo algún texto en latitud/longitud
  lon_raw           double precision,
  lat_raw           double precision
);

-- -----------------------------------------------------------------------------
-- 5. Publicación (única vía)
-- -----------------------------------------------------------------------------
create or replace function public.publish_health_establishments(p_snapshot_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_snap public.source_snapshots%rowtype;
  v_key text; v_n int; v_staged bigint; v_bad text; v_inserted bigint;
  v_max_reject numeric; v_near numeric; v_coast numeric; v_keep int; v_old record; v_removed int := 0; v_report jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('salud_publish'));
  perform set_config('statement_timeout', '10min', true);

  select * into v_snap from public.source_snapshots where id = p_snapshot_id for update;
  if not found then raise exception 'snapshot % no existe', p_snapshot_id; end if;
  select source_key into v_key from public.data_sources where id = v_snap.source_id;
  if v_key is distinct from 'deis_establecimientos' then raise exception 'el snapshot es de %, no de deis_establecimientos', v_key; end if;
  if v_snap.status <> 'validated' then raise exception 'el snapshot está en estado % (debe ser validated)', v_snap.status; end if;
  v_n := v_snap.n;
  if exists (select 1 from public.source_snapshots where source_id = v_snap.source_id and status = 'loaded' and n > v_n) then
    raise exception 'ya hay un snapshot más nuevo publicado; no se publica uno más viejo';
  end if;

  -- cuadre de conteos: lo cargado + lo rechazado = las filas del archivo
  select count(*) into v_staged from public.health_establishments_stage where snapshot_n = v_n;
  if v_staged + v_snap.rejected_count <> v_snap.row_count_raw then
    raise exception 'cuadre de conteos: cargados % + rechazados % <> filas del archivo %', v_staged, v_snap.rejected_count, v_snap.row_count_raw;
  end if;
  v_max_reject := public.pipeline_setting('publish.max_reject_ratio');
  if v_snap.row_count_raw = 0 or v_snap.rejected_count::numeric / v_snap.row_count_raw > v_max_reject then
    raise exception 'rechazos % de % superan el máximo configurado (%)', v_snap.rejected_count, v_snap.row_count_raw, v_max_reject;
  end if;

  -- dominios y claves
  if exists (select 1 from public.health_establishments_stage where snapshot_n = v_n group by code having count(*) > 1) then
    raise exception 'EstablecimientoCodigo duplicado dentro del snapshot';
  end if;
  select string_agg(distinct s.comuna_cut, ', ') into v_bad from public.health_establishments_stage s
    left join public.comunas c on c.cut = s.comuna_cut where s.snapshot_n = v_n and c.cut is null;
  if v_bad is not null then raise exception 'CUT que no existen en comunas: %', v_bad; end if;
  select string_agg(distinct s.tipo_glosa, ' | ') into v_bad from public.health_establishments_stage s
    left join public.health_tipo_clasificacion t on t.tipo_norm = lower(regexp_replace(btrim(s.tipo_glosa), '\s+', ' ', 'g'))
   where s.snapshot_n = v_n and t.tipo_norm is null;
  if v_bad is not null then
    raise exception 'tipos de establecimiento sin clasificar en health_tipo_clasificacion (agregue la fila con su evidencia): %', v_bad;
  end if;
  if exists (select 1 from public.health_establishments_stage where snapshot_n = v_n and left(comuna_cut, 2) <> region_cut) then
    raise exception 'RegionCodigo no coincide con el prefijo del CUT de la comuna';
  end if;

  v_near  := public.pipeline_setting('health.near_border_m');
  v_coast := public.pipeline_setting('health.coast_buffer_m');

  -- validación geográfica contra la comuna DECLARADA. La distancia solo se calcula si el punto no cae dentro.
  -- Rectángulo de Chile (incluye Rapa Nui y el territorio antártico): lon -110..-50, lat -90..-17; (0,0) es inválido.
  drop table if exists pg_temp._health_geo;
  create temp table _health_geo on commit drop as
    select s.code, s.comuna_cut, s.coords_present, s.lon_raw, s.lat_raw,
           (s.lon_raw is not null and s.lat_raw is not null
            and s.lon_raw between -110 and -50 and s.lat_raw between -90 and -17) as coord_ok,
           c.geom is not null as has_poly, c.geom as poly
      from public.health_establishments_stage s join public.comunas c on c.cut = s.comuna_cut
     where s.snapshot_n = v_n;
  alter table _health_geo add column pt geometry(Point, 4326), add column inside boolean, add column dist real, add column in_other boolean;
  update _health_geo set pt = ST_SetSRID(ST_MakePoint(lon_raw, lat_raw), 4326) where coord_ok;
  update _health_geo set inside = ST_Covers(poly, pt) where coord_ok and has_poly;
  update _health_geo set dist = ST_Distance(poly::geography, pt::geography)::real where coord_ok and has_poly and not inside;
  update _health_geo g set in_other = exists (
      select 1 from public.comunas o where o.cut <> g.comuna_cut and o.geom is not null and ST_Covers(o.geom, g.pt))
   where g.coord_ok and g.has_poly and not g.inside;

  insert into public.health_establishments (snapshot_n, code, old_code, parent_code, name, region_cut, comuna_cut, comuna_glosa, tipo_glosa, tipo_norm, ambito,
      dependencia_raw, dependencia_norm, tipo_sistema_raw, snss, nivel_atencion_raw, complejidad_raw, complejidad, tipo_atencion_raw, tipo_atencion,
      clase_servicio, clase_fuente, alta_hospital, alta_ampliada, estado, fecha_inicio, fecha_cierre, tiene_urgencia, tipo_urgencia, address,
      lon_raw, lat_raw, geo_status, geo_distance_m, geom)
  select s.snapshot_n, s.code, s.old_code, s.parent_code, s.name, s.region_cut, s.comuna_cut, s.comuna_glosa, s.tipo_glosa, t.tipo_norm, s.ambito,
         s.dependencia_raw, s.dependencia_norm, s.tipo_sistema_raw, s.snss, s.nivel_atencion_raw, s.complejidad_raw, s.complejidad, s.tipo_atencion_raw, s.tipo_atencion,
         -- manda lo oficial; la tabla solo completa lo que la fuente no declara
         -- 'mixto' y 'sin_clasificar' de la tabla NO se imputan: la fila queda sin clasificar
         case s.tipo_atencion when 'ambulatoria' then 'ambulatorio' when 'hospitalaria' then 'hospitalario'
              else case when t.clase in ('ambulatorio', 'hospitalario') then t.clase else 'sin_clasificar' end end,
         case when s.tipo_atencion in ('ambulatoria', 'hospitalaria') then 'oficial'
              when t.clase in ('ambulatorio', 'hospitalario') then 'tabla'
              else 'sin_clasificar' end,
         (s.complejidad = 'alta' and t.alta_hospital), (s.complejidad = 'alta' and t.alta_ampliada),
         s.estado, s.fecha_inicio, s.fecha_cierre, s.tiene_urgencia, s.tipo_urgencia, s.address,
         s.lon_raw, s.lat_raw,
         (case when not s.coords_present then 4
               when not g.coord_ok then 6
               when not g.has_poly then 5
               when g.inside then 0
               when g.dist <= v_near then 1
               when not coalesce(g.in_other, false) and g.dist <= v_coast then 2
               else 3 end)::smallint,
         g.dist,
         case when s.coords_present and g.coord_ok then g.pt end
    from public.health_establishments_stage s
    join _health_geo g on g.code = s.code
    join public.health_tipo_clasificacion t on t.tipo_norm = lower(regexp_replace(btrim(s.tipo_glosa), '\s+', ' ', 'g'))
   where s.snapshot_n = v_n;
  get diagnostics v_inserted = row_count;
  if v_inserted <> v_staged then raise exception 'se insertaron % filas y había % en la zona de paso', v_inserted, v_staged; end if;

  update public.source_snapshots set status = 'superseded'
   where source_id = v_snap.source_id and status = 'loaded' and id <> p_snapshot_id;
  update public.source_snapshots set status = 'loaded', loaded_at = now() where id = p_snapshot_id;

  v_keep := greatest(public.pipeline_setting('retention.keep_point_snapshots')::int, 1);
  for v_old in
    select s.n from public.source_snapshots s
     where s.source_id = v_snap.source_id and s.status in ('loaded', 'superseded') order by s.n desc offset v_keep
  loop
    delete from public.health_establishments where snapshot_n = v_old.n;
    v_removed := v_removed + 1;
  end loop;
  if exists (select 1 from public.health_establishments_stage where snapshot_n <> v_n) then
    delete from public.health_establishments_stage where snapshot_n = v_n;
  else
    truncate public.health_establishments_stage;          -- libera el espacio de inmediato (un DELETE deja las páginas muertas)
  end if;

  v_report := jsonb_build_object(
    'inserted', v_inserted, 'rejected', v_snap.rejected_count, 'old_snapshots_cleared', v_removed,
    'near_border_m', v_near, 'coast_buffer_m', v_coast,
    'estado', (select jsonb_object_agg(estado, n) from (select estado, count(*) n from public.health_establishments where snapshot_n = v_n group by 1) a),
    'geo_status', (select jsonb_object_agg(geo_status::text, n) from (select geo_status, count(*) n from public.health_establishments where snapshot_n = v_n group by 1) a),
    'clase_fuente', (select jsonb_object_agg(clase_fuente, n) from (select clase_fuente, count(*) n from public.health_establishments where snapshot_n = v_n group by 1) a),
    'alta_hospital_todos', (select count(*) from public.health_establishments where snapshot_n = v_n and alta_hospital),
    'alta_ampliada_todos', (select count(*) from public.health_establishments where snapshot_n = v_n and alta_ampliada),
    'alta_hospital_vigentes', (select count(*) from public.health_establishments where snapshot_n = v_n and alta_hospital and estado = 'vigente'),
    'alta_ampliada_vigentes', (select count(*) from public.health_establishments where snapshot_n = v_n and alta_ampliada and estado = 'vigente'),
    'alta_fuera_de_ambas', (select count(*) from public.health_establishments where snapshot_n = v_n and complejidad = 'alta' and not alta_ampliada));
  update public.source_snapshots set validation_report = validation_report || jsonb_build_object('publish', v_report) where id = p_snapshot_id;
  return v_report;
end $$;

-- -----------------------------------------------------------------------------
-- 6. Lectura (SECURITY INVOKER; la captura vigente es la última publicada)
-- -----------------------------------------------------------------------------
create or replace function public._health_current_snapshot()
returns table (snapshot_n integer, snapshot_id uuid, captured_at timestamptz)
language sql stable set search_path = public as $$
  select s.n, s.id, s.captured_at
    from public.source_snapshots s join public.data_sources d on d.id = s.source_id
   where d.source_key = 'deis_establecimientos' and s.status = 'loaded'
   order by s.n desc limit 1
$$;

-- p_alta: null = sin filtro · 'hospital' = alta complejidad (D1, por defecto) · 'ampliada' = D1 variante (con clínicas y centros de especialidades)
create or replace function public.get_health_establishments(
  p_west double precision default -180, p_south double precision default -90, p_east double precision default 180, p_north double precision default 90,
  p_include_closed boolean default false, p_dependencia text[] default null, p_complejidad text[] default null, p_clase text[] default null,
  p_alta text default null, p_limit integer default 6000, p_ambito text[] default null, p_tipo text[] default null)
returns table (
  code text, name text, tipo_glosa text, comuna_cut char(5), comuna_name text, dependencia_norm text, complejidad text, tipo_atencion text,
  clase_servicio text, clase_fuente text, estado text, alta_hospital boolean, alta_ampliada boolean, tiene_urgencia boolean, address text,
  lon double precision, lat double precision, geo_status smallint, geo_distance_m real, total_matching bigint, snapshot_id uuid, captured_at timestamptz)
language plpgsql stable security invoker set search_path = public as $$
begin
  if p_alta is not null and p_alta not in ('hospital', 'ampliada') then
    raise exception 'p_alta debe ser null, hospital o ampliada' using errcode = '22023';
  end if;
  return query
  select e.code, e.name, e.tipo_glosa, e.comuna_cut, c.name, e.dependencia_norm, e.complejidad, e.tipo_atencion, e.clase_servicio, e.clase_fuente,
         e.estado, e.alta_hospital, e.alta_ampliada, e.tiene_urgencia, e.address, ST_X(e.geom), ST_Y(e.geom), e.geo_status, e.geo_distance_m,
         count(*) over (), cs.snapshot_id, cs.captured_at
    from public._health_current_snapshot() cs
    join public.health_establishments e on e.snapshot_n = cs.snapshot_n
    join public.comunas c on c.cut = e.comuna_cut
   where e.geom is not null and e.geom && ST_MakeEnvelope(p_west, p_south, p_east, p_north, 4326)
     and (p_include_closed or e.estado = 'vigente')
     and (p_dependencia is null or e.dependencia_norm = any (p_dependencia))
     and (p_complejidad is null or e.complejidad = any (p_complejidad))
     and (p_clase is null or e.clase_servicio = any (p_clase))
     and (p_alta is null or (p_alta = 'hospital' and e.alta_hospital) or (p_alta = 'ampliada' and e.alta_ampliada))
     and (p_ambito is null or e.ambito = any (p_ambito))
     and (p_tipo is null or e.tipo_norm = any (p_tipo))
   order by e.alta_hospital desc, e.alta_ampliada desc, e.code
   limit p_limit;
end $$;

-- CAPA DERIVADA: una fila por comuna (las 346), con el conteo de los establecimientos que cumplen los filtros.
--   establishments  conteo REAL del registro (cero verdadero cuando no hay) — no se suprime (D11: son instalaciones, no personas)
--   imputed         de esos, cuántos tienen la clase ambulatorio/hospitalario imputada por la tabla de diseño (advertencia regla 3)
--   not_drawable    de esos, cuántos no se pueden dibujar (sin coordenadas, coordenada inválida o comuna sin polígono)
--   marked_geo      de esos, cuántos tienen la ubicación marcada (borde, costero o fuera de su comuna declarada)
--   rank            1 = la comuna con más establecimientos (empates comparten puesto)
-- QUÉ SE CUENTA: sin filtros, TODOS los tipos del registro (consultas, clínicas dentales, laboratorios, tomas de muestras, diálisis, vacunatorios…).
--   p_ambito  = AmbitoFuncionamiento de la fuente: 'Establecimiento de Salud' | 'Unidad de Atención' | 'Programa de Atención' | 'No Aplica'. El front cuenta por defecto
--               solo 'Establecimiento de Salud' (las unidades y programas cuelgan de un establecimiento) y lo dice en el panel.
--   p_tipo    = tipo_norm de health_tipo_clasificacion.
-- El número NO es oferta ni es comparable entre regiones: depende de cómo cada SEREMI autoriza y registra a los privados (HALLAZGOS_FASE1A.md §7).
create or replace function public.get_health_comuna_counts(
  p_include_closed boolean default false, p_dependencia text[] default null, p_complejidad text[] default null, p_clase text[] default null,
  p_alta text default null, p_ambito text[] default null, p_tipo text[] default null)
returns table (
  cut char(5), name text, region_cut char(2), region_name text, establishments bigint, imputed bigint, not_drawable bigint, marked_geo bigint,
  rank integer, snapshot_id uuid, captured_at timestamptz)
language plpgsql stable security invoker set search_path = public as $$
begin
  if p_alta is not null and p_alta not in ('hospital', 'ampliada') then
    raise exception 'p_alta debe ser null, hospital o ampliada' using errcode = '22023';
  end if;
  return query
  with cs as (select * from public._health_current_snapshot()),
  agg as (
    select e.comuna_cut as cut, count(*) as n,
           count(*) filter (where e.clase_fuente = 'tabla') as imputed,
           count(*) filter (where e.geo_status in (4, 5, 6)) as not_drawable,
           count(*) filter (where e.geo_status in (1, 2, 3)) as marked_geo
      from cs join public.health_establishments e on e.snapshot_n = cs.snapshot_n
     where (p_include_closed or e.estado = 'vigente')
       and (p_dependencia is null or e.dependencia_norm = any (p_dependencia))
       and (p_complejidad is null or e.complejidad = any (p_complejidad))
       and (p_clase is null or e.clase_servicio = any (p_clase))
       and (p_alta is null or (p_alta = 'hospital' and e.alta_hospital) or (p_alta = 'ampliada' and e.alta_ampliada))
       and (p_ambito is null or e.ambito = any (p_ambito))
       and (p_tipo is null or e.tipo_norm = any (p_tipo))
     group by e.comuna_cut)
  select c.cut, c.name, c.region_cut, c.region_name, coalesce(a.n, 0), coalesce(a.imputed, 0), coalesce(a.not_drawable, 0), coalesce(a.marked_geo, 0),
         (rank() over (order by coalesce(a.n, 0) desc))::integer, cs.snapshot_id, cs.captured_at
    from cs cross join public.comunas c left join agg a on a.cut = c.cut
   order by 9, c.cut;
end $$;

-- Desglose de UNA comuna por tipo de establecimiento y estado (para ver qué hay detrás de un número del ranking). Sin filtro de ámbito: muestra todo y el ámbito.
create or replace function public.get_health_comuna_tipos(p_cut char(5))
returns table (tipo_glosa text, ambito text, estado text, n bigint)
language sql stable security invoker set search_path = public as $$
  select e.tipo_glosa, e.ambito, e.estado, count(*)
    from public._health_current_snapshot() cs
    join public.health_establishments e on e.snapshot_n = cs.snapshot_n
   where e.comuna_cut = p_cut
   group by e.tipo_glosa, e.ambito, e.estado
   order by sum(count(*) filter (where e.estado = 'vigente')) over (partition by e.tipo_glosa) desc, e.tipo_glosa, e.ambito nulls last, e.estado
$$;

-- Conteos para leyenda y ficha, en formato largo (dimension, value, n) de la captura vigente.
create or replace function public.get_health_summary()
returns table (dimension text, value text, n bigint)
language sql stable security invoker set search_path = public as $$
  with cs as (select * from public._health_current_snapshot()),
  e as (select x.* from cs join public.health_establishments x on x.snapshot_n = cs.snapshot_n)
  select 'total', 'todos', count(*) from e
  union all select 'estado', estado, count(*) from e group by estado
  union all select 'geo_status', geo_status::text, count(*) from e where estado = 'vigente' group by geo_status
  union all select 'clase_fuente', clase_fuente, count(*) from e where estado = 'vigente' group by clase_fuente
  union all select 'clase_servicio', clase_servicio, count(*) from e where estado = 'vigente' group by clase_servicio
  union all select 'complejidad', complejidad, count(*) from e where estado = 'vigente' group by complejidad
  union all select 'dependencia', dependencia_norm, count(*) from e where estado = 'vigente' group by dependencia_norm
  union all select 'alta_hospital_vigentes', 'si', count(*) from e where estado = 'vigente' and alta_hospital
  union all select 'alta_ampliada_vigentes', 'si', count(*) from e where estado = 'vigente' and alta_ampliada
  union all select 'alta_fuera_de_ambas_vigentes', 'si', count(*) from e where estado = 'vigente' and complejidad = 'alta' and not alta_ampliada
  union all select 'cerrado_sin_fecha_cierre', 'si', count(*) from e where estado = 'cerrado' and fecha_cierre is null
  order by 1, 2
$$;

create or replace function public.get_health_tipo_clasificacion()
returns table (tipo_norm text, tipo_label text, clase text, alta_hospital boolean, alta_ampliada boolean, evidence text)
language sql stable security invoker set search_path = public as $$
  select t.tipo_norm, t.tipo_label, t.clase, t.alta_hospital, t.alta_ampliada, t.evidence from public.health_tipo_clasificacion t order by t.tipo_label
$$;

-- -----------------------------------------------------------------------------
-- 7. RLS y permisos
-- -----------------------------------------------------------------------------
alter table public.health_tipo_clasificacion      enable row level security;
alter table public.health_establishments          enable row level security;
alter table public.health_establishments_stage    enable row level security;

drop policy if exists health_tipo_read on public.health_tipo_clasificacion;
create policy health_tipo_read on public.health_tipo_clasificacion for select to authenticated using (true);
drop policy if exists health_tipo_write on public.health_tipo_clasificacion;
create policy health_tipo_write on public.health_tipo_clasificacion for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
drop policy if exists health_establishments_read on public.health_establishments;
create policy health_establishments_read on public.health_establishments for select to authenticated using (true);
-- health_establishments_stage no tiene política: solo el ETL (service_role) la ve.

revoke all on public.health_tipo_clasificacion, public.health_establishments, public.health_establishments_stage from anon;
revoke insert, update, delete, truncate on public.health_establishments from authenticated;
revoke all on public.health_establishments_stage from authenticated;

revoke all on function public.publish_health_establishments(uuid) from public, anon, authenticated;
grant execute on function public.publish_health_establishments(uuid) to service_role;
revoke all on function public._health_current_snapshot(),
  public.get_health_establishments(double precision, double precision, double precision, double precision, boolean, text[], text[], text[], text, integer, text[], text[]),
  public.get_health_comuna_counts(boolean, text[], text[], text[], text, text[], text[]), public.get_health_comuna_tipos(char),
  public.get_health_summary(), public.get_health_tipo_clasificacion() from public, anon;
grant execute on function public._health_current_snapshot(),
  public.get_health_establishments(double precision, double precision, double precision, double precision, boolean, text[], text[], text[], text, integer, text[], text[]),
  public.get_health_comuna_counts(boolean, text[], text[], text[], text, text[], text[]), public.get_health_comuna_tipos(char),
  public.get_health_summary(), public.get_health_tipo_clasificacion() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 8. Auditoría final: nada previo cambió (salvo +1 fuente sembrada)
-- -----------------------------------------------------------------------------
do $$
declare v_bad text;
begin
  select string_agg(b.t || ': ' || b.n || ' -> ' || a.n, ', ') into v_bad
    from _salud_counts_before b
    join (
      select 'layer_nodes'::text as t, count(*)::bigint as n from public.layer_nodes
      union all select 'territorial_layers', count(*) from public.territorial_layers
      union all select 'territorial_features', count(*) from public.territorial_features
      union all select 'comunas', count(*) from public.comunas
      union all select 'source_snapshots', count(*) from public.source_snapshots
      union all select 'data_sources_other', count(*) from public.data_sources where source_key <> 'deis_establecimientos'
    ) a using (t)
   where a.n <> b.n;
  if v_bad is not null then raise exception 'Guardrail: cambiaron conteos de tablas existentes (%)', v_bad; end if;
end $$;

insert into public._migration_log (sprint, notes) values ('health_establishments_v1', 'done');
