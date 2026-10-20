-- =============================================================================
-- PROPUESTA (NO APLICADA) — Salud: capacidad de los hospitales (camas de dotación y ocupación) con fuente, fecha y período trazables
-- =============================================================================
-- Fuentes (DEIS/MINSAL), detalle y verificación en docs/salud/HALLAZGOS_CAPACIDAD.md:
--   deis_rem20_hospitalizacion  REM 20 «Indicadores del proceso de hospitalización» (datos.gob.cl, CC0): mensual por establecimiento y ÁREA FUNCIONAL, 2014-01 en adelante.
--   deis_dotacion_camas         «Dotación de camas hospitalarias de establecimientos pertenecientes al SNSS», DEIS/DIGERA: anual por establecimiento y área funcional.
--                               LICENCIA [NO COMPROBADO]: el archivo no declara licencia ni condiciones de uso.
-- Pabellones (REM A21): FUERA de esta migración (aún no hay archivo oficial verificado). No existe health_theatres_month.
--
--   health_areas_funcionales             códigos de área funcional (REM 20 / dotación), con su glosa oficial. 100 = «Total» que publica el archivo de dotación
--   health_rem20_month_stage / health_beds_dotacion_stage   zonas de paso (unlogged)
--   health_rem20_month                   lo PUBLICADO de REM 20: snapshot × establecimiento × mes × área. Guarda los COMPONENTES (días-cama ocupados y disponibles, estada, egresos…); el índice NO se guarda: se deriva
--   health_beds_dotacion                 lo PUBLICADO de dotación: snapshot × establecimiento × año × área (100 = total publicado). Una celda vacía o de texto NO se guarda: es «sin dato»
--   health_capacity_fields               bandera client_ready POR CAMPO (todo nace en false)
--   publish_health_rem20_snapshot() · publish_health_dotacion_snapshot()   únicos caminos (SECURITY DEFINER, todo-o-nada): re-validan en la base los cuadres de la carga
--   get_health_capacity(code)            lectura de UN establecimiento (SECURITY INVOKER): dotación del último año, ocupación del último año completo y del último mes publicado, y las fuentes
--
-- ÍNDICE OCUPACIONAL = Σ días-cama ocupados / Σ días-cama disponibles × 100 (fórmula oficial DEIS, ficha «Porcentaje de ocupación o Índice ocupacional»), sobre TODAS las áreas funcionales
-- publicadas del establecimiento (incluye Pensionado, psiquiatría y sociosanitario) y sobre el período indicado. NUNCA se promedian los índices publicados por área. Σ disponibles = 0 → sin dato.
-- Nada se infiere, estima ni resta: dotación (camas asignadas por resolución) y camas disponibles (REM 20) son conceptos distintos y no se mezclan. Lo ausente es «sin dato» (NULL).
--
-- Requiere las partes de permisos/proyectos (data_sources, source_snapshots, pipeline_settings, comunas) y 20261102000000_health_establishments. SOLO ADITIVA.
-- Rollback: supabase/rollbacks/20261108000000_health_capacity_down.sql
-- =============================================================================

-- Guardrail de transacción (igual que 20261104000000): debe correr con `psql -1 -v ON_ERROR_STOP=1 -f …`.
drop table if exists pg_temp._tx_probe;
create temp table _tx_probe (x int) on commit drop;
do $$
begin
  if to_regclass('pg_temp._tx_probe') is null then
    raise exception 'Guardrail: esta migración debe correr dentro de UNA transacción (psql -1 -v ON_ERROR_STOP=1 -f …); sin -1 las tablas temporales ON COMMIT DROP se pierden y el guardrail final no puede comparar los conteos';
  end if;
end $$;

select pg_advisory_xact_lock(hashtext('salud_v1'));
set local statement_timeout = '5min';

insert into public._migration_log (sprint, notes) values ('health_capacity_v1', 'start');

do $$
begin
  if to_regclass('public.data_sources') is null or to_regclass('public.source_snapshots') is null or to_regclass('public.pipeline_settings') is null then
    raise exception 'Guardrail: faltan las partes de permisos/proyectos (data_sources, source_snapshots, pipeline_settings); aplicarlas primero';
  end if;
  if to_regclass('public.health_establishments') is null then
    raise exception 'Guardrail: falta 20261102000000_health_establishments; aplicarla primero';
  end if;
end $$;

drop table if exists pg_temp._cap_counts_before;
create temp table _cap_counts_before on commit drop as
  select 'layer_nodes'::text as t, count(*)::bigint as n from public.layer_nodes
  union all select 'territorial_layers', count(*) from public.territorial_layers
  union all select 'territorial_features', count(*) from public.territorial_features
  union all select 'thematic_layers', count(*) from public.thematic_layers
  union all select 'comunas', count(*) from public.comunas
  union all select 'health_establishments', count(*) from public.health_establishments
  union all select 'source_snapshots', count(*) from public.source_snapshots
  union all select 'data_sources_other', count(*) from public.data_sources where source_key not in ('deis_rem20_hospitalizacion', 'deis_dotacion_camas');

-- -----------------------------------------------------------------------------
-- 1. Retención y fuentes
-- -----------------------------------------------------------------------------
insert into public.pipeline_settings (key, value, description) values
  ('retention.keep_capacidad_snapshots', 2, 'Capturas de capacidad hospitalaria (REM 20 y dotación de camas, por separado) cuyo contenido se conserva.')
on conflict (key) do nothing;

insert into public.data_sources
  (source_key, dataset, name, publisher, landing_url, data_url, license_label, license_url, attribution, access_mode,
   cadence_days, publication_lag_days, grace_days, check_every_days,
   verification_status, verified_at, verification_note, scope_note)
values
  ('deis_rem20_hospitalizacion', 'health_rem20',
   'Indicadores del proceso de hospitalización de los establecimientos públicos de Salud (REM 20)',
   'Departamento de Estadísticas e Información de Salud (DEIS), Ministerio de Salud',
   'https://datos.gob.cl/dataset/indicadores-hospitalarios-rem20',
   'https://datos.gob.cl/dataset/a756323f-85ba-4759-87dc-f5d5e63868cc/resource/657cc933-eac8-4bfc-b004-c4d6dcd988a8/download/indicadores_rem20_20260925.csv',
   'Creative Commons CCZero (CC0)', 'http://www.opendefinition.org/licenses/cc-zero',
   'Fuente: DEIS/MINSAL, «Indicadores del proceso de hospitalización de los establecimientos públicos de Salud» (REM 20), datos.gob.cl. Cifras tal como las publica el DEIS; esta plataforma no las modifica. El índice ocupacional del establecimiento se calcula con la fórmula oficial DEIS a partir de los días-cama publicados.',
   'automatic', 30, 25, 20, 7,
   'comprobado', date '2026-10-20',
   'Archivo leído el 2026-10-20: Indicadores_REM20.csv, 27.248.718 bytes, SHA-256 5085664576302b361f9207ce13b96acacd4a29da16477ebf2cccbce487571559, last_modified 2026-09-25, 168.474 filas, 2014-01 a 2026-08, 208 establecimientos, TIPO_PERTENENCIA = 1 en todas (solo red pública). Licencia CC0 según el metadato CKAN (package_show). La URL del recurso cambia con cada publicación (lleva la fecha): el ETL la resuelve por CKAN y registra la URL efectiva en source_snapshots.origin_url. Diccionario: diccionario-rem20.xlsx (sha256 6feebecdce70cf9f850054c37d07a292183747d9df1323084d15abf97be26c9a).',
   'Hospitalización de los establecimientos PÚBLICOS (SNSS) por área funcional y mes. NO incluye clínicas privadas ni FF.AA. (solo 2 códigos no SNSS aparecen alguna vez: Clínica de Puerto Varas 2014-2015 y Hospital Naval de Puerto Williams 2020). Un cero en días-cama disponibles es «sin denominador», no «0 % de ocupación». Un índice puede superar 100 %. Frecuencia de publicación, rezago y holgura: hipótesis hasta medirlas.'),
  ('deis_dotacion_camas', 'health_camas',
   'Dotación de camas hospitalarias de establecimientos pertenecientes al SNSS, por servicio de salud, establecimiento y área funcional',
   'DEIS y DIGERA (Departamento de Gestión de Redes Asistenciales), Ministerio de Salud',
   'https://deis.minsal.cl/',
   'https://repositoriodeis.minsal.cl/ContenidoSitioWeb2020/Estadisticas/DOTACION_CAMAS/Dotaci%C3%B3n%20de%20camas%202010-2025%20Establecimientos%20Pertenecientes%20al%20SNSS.xlsx',
   '[NO COMPROBADO] el archivo no declara licencia ni condiciones de uso', null,
   'Fuente: DEIS/DIGERA (MINSAL), «Dotación de camas hospitalarias de establecimientos pertenecientes al SNSS (Públicos)». Cifras tal como las publica el DEIS; esta plataforma no las modifica ni las suma.',
   'hybrid', 365, 0, 120, 30,
   'comprobado', date '2026-10-20',
   'Archivo 2010-2025 leído el 2026-10-20: 179.412 bytes, SHA-256 ef5ca45f30c1e3937621e489826766cb9844c5bca0253a375be4851f28ba078f, Last-Modified 2025-10-20; una hoja (2010-2025); 196 códigos; «Total País» 2025 = 26.738 = Σ de los totales por establecimiento. Versiones anteriores del mismo archivo (mismo nombre con 2010-2023 o 2010-2024) tienen cifras históricas DISTINTAS en 2011-2013: cada captura se guarda aparte. LICENCIA [NO COMPROBADO]: ni el archivo ni el repositorio declaran licencia; la consulta al DEIS la envía el dueño del proyecto; mientras no haya respuesta, el campo queda client_ready = false.',
   'DOTACIÓN = camas asignadas al establecimiento por resolución del Director de Servicio, instaladas las 24 h (ficha DEIS «Camas de dotación»). NO es «camas disponibles» (REM 20). Una cifra ANUAL por establecimiento y área; el archivo no dice a qué fecha del año corresponde. Solo establecimientos públicos del SNSS. Celdas con asteriscos o vacías = sin dato. La fila «Total» publicada puede no ser la suma de las áreas (se guarda tal cual).')
on conflict (source_key) do nothing;

-- -----------------------------------------------------------------------------
-- 2. Áreas funcionales, banderas por campo, zonas de paso y tablas publicadas
-- -----------------------------------------------------------------------------
create table if not exists public.health_areas_funcionales (
  area    smallint primary key,
  nombre  text not null check (btrim(nombre) <> '')
);
insert into public.health_areas_funcionales (area, nombre) values
  (100, 'Total (fila «Total» del archivo de dotación)'),
  (330, 'Área Pensionado'), (401, 'Área Médica Adulto Cuidados Básicos'), (402, 'Área Médica Adulto Cuidados Medios'),
  (403, 'Área Médico-Quirúrgico Cuidados Básicos'), (404, 'Área Médico-Quirúrgico Cuidados Medios'), (405, 'Área Cuidados Intensivos Adultos'),
  (406, 'Área Cuidados Intermedios Adultos'), (407, 'Área Médica Pediátrica Cuidados Básicos'), (408, 'Área Médica Pediátrica Cuidados Medios'),
  (409, 'Área Médico-Quirúrgico Pediátrica Cuidados Básicos'), (410, 'Área Médico-Quirúrgico Pediátrica Cuidados Medios'), (411, 'Área Cuidados Intensivos Pediátricos'),
  (412, 'Área Cuidados Intermedios Pediátricos'), (413, 'Área Neonatología Cuidados Básicos'), (414, 'Área Neonatología Cuidados Intensivos'),
  (415, 'Área Neonatología Cuidados Intermedios'), (416, 'Área Obstetricia'), (418, 'Área Psiquiatría Adulto Corta estadía'),
  (419, 'Área Psiquiatría Adulto Mediana estadía'), (420, 'Área Psiquiatría Adulto Larga estadía'), (421, 'Área Psiquiatría Infanto-adolescente corta estadía'),
  (422, 'Área Psiquiatría Infanto-adolescente mediana estadía'), (423, 'Área Psiquiatría Forense Adulto evaluación e inicio tto.'), (424, 'Área Psiquiatría Forense Adulto tratamiento'),
  (425, 'Área Psiquiatría Forense Infanto Adolescente evaluación e inicio tto.'), (426, 'Área Psiquiatría Forense Infanto Adolescente tratamiento'), (427, 'Área Sociosanitaria Adulto'),
  (428, 'Área de Hospitalización de Cuidados Intensivos en Psiquiatría Adulto'), (429, 'Área de Hospitalización de Cuidados Intensivos en Psiquiatría Infanto Adolescente')
on conflict (area) do nothing;

create table if not exists public.health_capacity_fields (
  field_key          text primary key check (field_key in ('dotacion', 'ocupacion')),
  label              text not null,
  client_ready       boolean not null default false,
  client_ready_note  text
);
insert into public.health_capacity_fields (field_key, label, client_ready, client_ready_note) values
  ('dotacion', 'Camas de dotación', false, 'Licencia del archivo de dotación [NO COMPROBADO]: consulta al DEIS en curso. No usar en informes a clientes hasta confirmarla.'),
  ('ocupacion', 'Ocupación (REM 20)', false, 'Campo nuevo sin evaluar para informes a clientes: pendiente de aprobación del dueño del proyecto.')
on conflict (field_key) do nothing;

create unlogged table if not exists public.health_rem20_month_stage (
  snapshot_n             integer  not null,
  code                   text     not null,
  period                 date     not null,
  area                   smallint not null,
  dias_cama_ocupados     integer  not null,
  dias_cama_disponibles  integer  not null,
  dias_estada            integer  not null,
  egresos                integer  not null,
  egresos_fallecidos     integer  not null,
  traslados              integer  not null,
  filas                  smallint not null
);
create unlogged table if not exists public.health_beds_dotacion_stage (
  snapshot_n  integer  not null,
  code        text     not null,
  year        smallint not null,
  area        smallint not null,
  beds        integer  not null
);

-- code: código DEIS de 6 dígitos del establecimiento. SIN FK a health_establishments (cuya PK incluye snapshot_n): la publicación exige que exista en la captura vigente.
create table if not exists public.health_rem20_month (
  snapshot_n             integer  not null,
  code                   text     not null check (code ~ '^[0-9]{6}$'),
  period                 date     not null check (period = date_trunc('month', period)::date),
  area                   smallint not null references public.health_areas_funcionales(area) check (area <> 100),
  dias_cama_ocupados     integer  not null check (dias_cama_ocupados >= 0),
  dias_cama_disponibles  integer  not null check (dias_cama_disponibles >= 0),
  dias_estada            integer  not null check (dias_estada >= 0),
  egresos                integer  not null check (egresos >= 0),
  egresos_fallecidos     integer  not null check (egresos_fallecidos >= 0),
  traslados              integer  not null check (traslados >= 0),
  filas                  smallint not null default 1 check (filas >= 1),          -- filas de origen sumadas (2 = clave duplicada en el archivo; sus componentes se SUMARON)
  constraint health_rem20_month_pk primary key (snapshot_n, code, period, area),
  constraint health_rem20_month_snapshot_fk foreign key (snapshot_n) references public.source_snapshots (n) on delete cascade
);
create index if not exists health_rem20_month_period_idx on public.health_rem20_month (snapshot_n, period);

create table if not exists public.health_beds_dotacion (
  snapshot_n  integer  not null,
  code        text     not null check (code ~ '^[0-9]{6}$'),
  year        smallint not null check (year between 2000 and 2100),
  area        smallint not null references public.health_areas_funcionales(area),   -- 100 = «Total» tal como lo publica el archivo (puede no ser la suma de las áreas)
  beds        integer  not null check (beds >= 0),
  constraint health_beds_dotacion_pk primary key (snapshot_n, code, year, area),
  constraint health_beds_dotacion_snapshot_fk foreign key (snapshot_n) references public.source_snapshots (n) on delete cascade
);
create index if not exists health_beds_dotacion_year_idx on public.health_beds_dotacion (snapshot_n, year);

comment on table public.health_rem20_month is 'REM 20 (DEIS): componentes mensuales por establecimiento y área funcional. El índice ocupacional NO se guarda: Σ ocupados / Σ disponibles × 100 (fórmula oficial).';
comment on table public.health_beds_dotacion is 'Dotación de camas (DEIS/DIGERA) por establecimiento, año y área funcional; área 100 = total publicado. Sin celda = sin dato.';
comment on table public.health_capacity_fields is 'client_ready por campo de capacidad (todo nace en false).';

-- -----------------------------------------------------------------------------
-- 3. Publicación REM 20 (única vía)
-- -----------------------------------------------------------------------------
create or replace function public.publish_health_rem20_snapshot(p_snapshot_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_snap public.source_snapshots%rowtype; v_key text; v_n int; v_rep jsonb; v_keep int; v_old record; v_removed int := 0; v_report jsonb;
  v_cur int; v_bad text; v_rows bigint; v_codes bigint;
begin
  perform pg_advisory_xact_lock(hashtext('health_capacity_publish'));
  select * into v_snap from public.source_snapshots where id = p_snapshot_id for update;
  if not found then raise exception 'snapshot % no existe', p_snapshot_id; end if;
  select source_key into v_key from public.data_sources where id = v_snap.source_id;
  if v_key is distinct from 'deis_rem20_hospitalizacion' then raise exception 'el snapshot es de %, no de REM 20', v_key; end if;
  if v_snap.status <> 'validated' then raise exception 'el snapshot está en estado % (debe ser validated)', v_snap.status; end if;
  v_n := v_snap.n;
  if exists (select 1 from public.source_snapshots where source_id = v_snap.source_id and status = 'loaded' and period_end > v_snap.period_end) then
    raise exception 'ya hay un período más nuevo publicado; no se publica uno más viejo';
  end if;

  select count(*), count(distinct code) into v_rows, v_codes from public.health_rem20_month_stage where snapshot_n = v_n;
  if v_rows = 0 then raise exception 'la zona de paso de REM 20 está vacía'; end if;
  v_rep := v_snap.validation_report;
  if v_rep -> 'totales' is null or v_rep ->> 'rows_raw' is null or v_rep ->> 'rows_stage' is null or v_rep ->> 'establecimientos' is null then
    raise exception 'falta totales / rows_raw / rows_stage / establecimientos en el reporte del snapshot (el cuadre es obligatorio)';
  end if;
  if v_rows <> (v_rep ->> 'rows_stage')::bigint then raise exception 'filas en la zona de paso (%) distintas de las del reporte (%)', v_rows, v_rep ->> 'rows_stage'; end if;
  if v_snap.row_count_raw is distinct from (v_rep ->> 'rows_raw')::int then raise exception 'row_count_raw (%) distinto de rows_raw del reporte (%)', v_snap.row_count_raw, v_rep ->> 'rows_raw'; end if;
  if (select sum(filas) from public.health_rem20_month_stage where snapshot_n = v_n) <> (v_rep ->> 'rows_raw')::bigint then
    raise exception 'Σ de filas de origen en la zona de paso distinta de rows_raw';
  end if;
  if v_codes <> (v_rep ->> 'establecimientos')::bigint then raise exception 'establecimientos distintos en la zona de paso (%) ≠ reporte (%)', v_codes, v_rep ->> 'establecimientos'; end if;

  -- dominio y claves
  if exists (select 1 from public.health_rem20_month_stage where snapshot_n = v_n
              and (code !~ '^[0-9]{6}$' or period <> date_trunc('month', period)::date or area = 100 or filas < 1
                   or dias_cama_ocupados < 0 or dias_cama_disponibles < 0 or dias_estada < 0 or egresos < 0 or egresos_fallecidos < 0 or traslados < 0)) then
    raise exception 'valores fuera de dominio en la zona de paso (código, mes, área, negativos)';
  end if;
  if exists (select 1 from public.health_rem20_month_stage where snapshot_n = v_n group by code, period, area having count(*) > 1) then
    raise exception 'clave (código, mes, área) repetida en la zona de paso: las duplicadas del archivo deben llegar ya sumadas';
  end if;
  select string_agg(distinct s.area::text, ', ') into v_bad from public.health_rem20_month_stage s left join public.health_areas_funcionales a on a.area = s.area where s.snapshot_n = v_n and a.area is null;
  if v_bad is not null then raise exception 'áreas funcionales no registradas en health_areas_funcionales: % (agregarlas con su glosa oficial antes de cargar)', v_bad; end if;
  -- período: el que declara el snapshot
  if (select min(period) from public.health_rem20_month_stage where snapshot_n = v_n) <> v_snap.period_start
     or (select (max(period) + interval '1 month' - interval '1 day')::date from public.health_rem20_month_stage where snapshot_n = v_n) <> v_snap.period_end then
    raise exception 'el período de los datos no coincide con period_start / period_end del snapshot';
  end if;
  -- empalme: todo código debe existir en la captura vigente de establecimientos (sin huérfanos silenciosos)
  select snapshot_n into v_cur from public._health_current_snapshot();
  if v_cur is null then raise exception 'no hay captura vigente de establecimientos: publicarla primero'; end if;
  select string_agg(c, ', ') into v_bad
    from (select distinct s.code c from public.health_rem20_month_stage s left join public.health_establishments e on e.snapshot_n = v_cur and e.code = s.code where s.snapshot_n = v_n and e.code is null order by 1) x;
  if v_bad is not null then raise exception 'códigos que no existen en la captura vigente de establecimientos: %', v_bad; end if;

  -- cuadre con los totales calculados sobre el archivo crudo
  if (select sum(dias_cama_ocupados) from public.health_rem20_month_stage where snapshot_n = v_n) is distinct from (v_rep -> 'totales' ->> 'dias_cama_ocupados')::bigint
     or (select sum(dias_cama_disponibles) from public.health_rem20_month_stage where snapshot_n = v_n) is distinct from (v_rep -> 'totales' ->> 'dias_cama_disponibles')::bigint
     or (select sum(dias_estada) from public.health_rem20_month_stage where snapshot_n = v_n) is distinct from (v_rep -> 'totales' ->> 'dias_estada')::bigint
     or (select sum(egresos) from public.health_rem20_month_stage where snapshot_n = v_n) is distinct from (v_rep -> 'totales' ->> 'egresos')::bigint then
    raise exception 'cuadre con los totales del archivo: Σ ocupados % / disponibles % ≠ reporte % / %',
      (select sum(dias_cama_ocupados) from public.health_rem20_month_stage where snapshot_n = v_n), (select sum(dias_cama_disponibles) from public.health_rem20_month_stage where snapshot_n = v_n),
      v_rep -> 'totales' ->> 'dias_cama_ocupados', v_rep -> 'totales' ->> 'dias_cama_disponibles';
  end if;

  insert into public.health_rem20_month (snapshot_n, code, period, area, dias_cama_ocupados, dias_cama_disponibles, dias_estada, egresos, egresos_fallecidos, traslados, filas)
    select snapshot_n, code, period, area, dias_cama_ocupados, dias_cama_disponibles, dias_estada, egresos, egresos_fallecidos, traslados, filas
      from public.health_rem20_month_stage where snapshot_n = v_n;
  if (select count(*) from public.health_rem20_month where snapshot_n = v_n) <> v_rows
     or (select sum(dias_cama_ocupados) from public.health_rem20_month where snapshot_n = v_n) is distinct from (v_rep -> 'totales' ->> 'dias_cama_ocupados')::bigint then
    raise exception 'postcondición: lo publicado no es exactamente lo cargado';
  end if;

  update public.source_snapshots set status = 'superseded' where source_id = v_snap.source_id and status = 'loaded' and id <> p_snapshot_id;
  update public.source_snapshots set status = 'loaded', loaded_at = now() where id = p_snapshot_id;
  v_keep := greatest(public.pipeline_setting('retention.keep_capacidad_snapshots')::int, 1);
  for v_old in select s.n from public.source_snapshots s where s.source_id = v_snap.source_id and s.status in ('loaded', 'superseded') order by s.period_end desc, s.n desc offset v_keep loop
    delete from public.health_rem20_month where snapshot_n = v_old.n;
    v_removed := v_removed + 1;
  end loop;
  if exists (select 1 from public.health_rem20_month_stage where snapshot_n <> v_n) then
    delete from public.health_rem20_month_stage where snapshot_n = v_n;
  else
    truncate public.health_rem20_month_stage;
  end if;

  v_report := jsonb_build_object('filas', v_rows, 'establecimientos', v_codes, 'period_start', v_snap.period_start, 'period_end', v_snap.period_end,
    'dias_cama_ocupados', (select sum(dias_cama_ocupados) from public.health_rem20_month where snapshot_n = v_n),
    'dias_cama_disponibles', (select sum(dias_cama_disponibles) from public.health_rem20_month where snapshot_n = v_n),
    'claves_duplicadas_sumadas', (select count(*) from public.health_rem20_month where snapshot_n = v_n and filas > 1), 'old_snapshots_cleared', v_removed);
  update public.source_snapshots set validation_report = validation_report || jsonb_build_object('publish', v_report) where id = p_snapshot_id;
  return v_report;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Publicación de dotación (única vía)
-- -----------------------------------------------------------------------------
create or replace function public.publish_health_dotacion_snapshot(p_snapshot_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_snap public.source_snapshots%rowtype; v_key text; v_n int; v_rep jsonb; v_keep int; v_old record; v_removed int := 0; v_report jsonb;
  v_cur int; v_bad text; v_rows bigint; v_codes bigint; v_y record;
begin
  perform pg_advisory_xact_lock(hashtext('health_capacity_publish'));
  select * into v_snap from public.source_snapshots where id = p_snapshot_id for update;
  if not found then raise exception 'snapshot % no existe', p_snapshot_id; end if;
  select source_key into v_key from public.data_sources where id = v_snap.source_id;
  if v_key is distinct from 'deis_dotacion_camas' then raise exception 'el snapshot es de %, no de la dotación de camas', v_key; end if;
  if v_snap.status <> 'validated' then raise exception 'el snapshot está en estado % (debe ser validated)', v_snap.status; end if;
  v_n := v_snap.n;
  if exists (select 1 from public.source_snapshots where source_id = v_snap.source_id and status = 'loaded' and period_end > v_snap.period_end) then
    raise exception 'ya hay un período más nuevo publicado; no se publica uno más viejo';
  end if;

  select count(*), count(distinct code) into v_rows, v_codes from public.health_beds_dotacion_stage where snapshot_n = v_n;
  if v_rows = 0 then raise exception 'la zona de paso de dotación está vacía'; end if;
  v_rep := v_snap.validation_report;
  if v_rep -> 'total_pais' is null or v_rep ->> 'rows_stage' is null or v_rep ->> 'establecimientos' is null then
    raise exception 'falta total_pais / rows_stage / establecimientos en el reporte del snapshot (el cuadre es obligatorio)';
  end if;
  if v_rows <> (v_rep ->> 'rows_stage')::bigint then raise exception 'filas en la zona de paso (%) distintas de las del reporte (%)', v_rows, v_rep ->> 'rows_stage'; end if;
  if v_codes <> (v_rep ->> 'establecimientos')::bigint then raise exception 'establecimientos distintos en la zona de paso (%) ≠ reporte (%)', v_codes, v_rep ->> 'establecimientos'; end if;
  if exists (select 1 from public.health_beds_dotacion_stage where snapshot_n = v_n and (code !~ '^[0-9]{6}$' or beds < 0 or year not between 2000 and 2100)) then
    raise exception 'valores fuera de dominio en la zona de paso (código, año, camas negativas)';
  end if;
  if exists (select 1 from public.health_beds_dotacion_stage where snapshot_n = v_n group by code, year, area having count(*) > 1) then
    raise exception 'clave (código, año, área) repetida en la zona de paso: los bloques duplicados del archivo deben llegar ya sumados';
  end if;
  select string_agg(distinct s.area::text, ', ') into v_bad from public.health_beds_dotacion_stage s left join public.health_areas_funcionales a on a.area = s.area where s.snapshot_n = v_n and a.area is null;
  if v_bad is not null then raise exception 'áreas funcionales no registradas en health_areas_funcionales: %', v_bad; end if;
  if (select min(year) from public.health_beds_dotacion_stage where snapshot_n = v_n) <> extract(year from v_snap.period_start)
     or (select max(year) from public.health_beds_dotacion_stage where snapshot_n = v_n) <> extract(year from v_snap.period_end) then
    raise exception 'el rango de años de los datos no coincide con period_start / period_end del snapshot';
  end if;
  select snapshot_n into v_cur from public._health_current_snapshot();
  if v_cur is null then raise exception 'no hay captura vigente de establecimientos: publicarla primero'; end if;
  select string_agg(c, ', ') into v_bad
    from (select distinct s.code c from public.health_beds_dotacion_stage s left join public.health_establishments e on e.snapshot_n = v_cur and e.code = s.code where s.snapshot_n = v_n and e.code is null order by 1) x;
  if v_bad is not null then raise exception 'códigos que no existen en la captura vigente de establecimientos: %', v_bad; end if;

  -- cuadre: Σ de los totales por establecimiento = «Total País» del propio archivo, año por año
  for v_y in select year, sum(beds)::bigint as t from public.health_beds_dotacion_stage where snapshot_n = v_n and area = 100 group by year loop
    if (v_rep -> 'total_pais' ->> v_y.year::text)::bigint is distinct from v_y.t then
      raise exception 'cuadre con «Total País» del archivo, año %: publicado %, Σ totales %', v_y.year, v_rep -> 'total_pais' ->> v_y.year::text, v_y.t;
    end if;
  end loop;
  if (select count(distinct year) from public.health_beds_dotacion_stage where snapshot_n = v_n and area = 100) <> (select count(*) from jsonb_object_keys(v_rep -> 'total_pais')) then
    raise exception 'los años con totales no coinciden con los años de «Total País» del archivo';
  end if;

  insert into public.health_beds_dotacion (snapshot_n, code, year, area, beds)
    select snapshot_n, code, year, area, beds from public.health_beds_dotacion_stage where snapshot_n = v_n;
  if (select count(*) from public.health_beds_dotacion where snapshot_n = v_n) <> v_rows then raise exception 'postcondición: filas publicadas distintas de las cargadas'; end if;

  update public.source_snapshots set status = 'superseded' where source_id = v_snap.source_id and status = 'loaded' and id <> p_snapshot_id;
  update public.source_snapshots set status = 'loaded', loaded_at = now() where id = p_snapshot_id;
  v_keep := greatest(public.pipeline_setting('retention.keep_capacidad_snapshots')::int, 1);
  for v_old in select s.n from public.source_snapshots s where s.source_id = v_snap.source_id and s.status in ('loaded', 'superseded') order by s.period_end desc, s.n desc offset v_keep loop
    delete from public.health_beds_dotacion where snapshot_n = v_old.n;
    v_removed := v_removed + 1;
  end loop;
  if exists (select 1 from public.health_beds_dotacion_stage where snapshot_n <> v_n) then
    delete from public.health_beds_dotacion_stage where snapshot_n = v_n;
  else
    truncate public.health_beds_dotacion_stage;
  end if;

  v_report := jsonb_build_object('filas', v_rows, 'establecimientos', v_codes, 'year_from', extract(year from v_snap.period_start), 'year_to', extract(year from v_snap.period_end),
    'old_snapshots_cleared', v_removed);
  update public.source_snapshots set validation_report = validation_report || jsonb_build_object('publish', v_report) where id = p_snapshot_id;
  return v_report;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Lectura de UN establecimiento (SECURITY INVOKER; anon sin acceso)
-- -----------------------------------------------------------------------------
create or replace function public._health_capacity_current_snapshot(p_source_key text)
returns table (snapshot_n integer, snapshot_id uuid, period_start date, period_end date, declared_date date, declared_date_note text, captured_at timestamptz,
               origin_url text, sha256 text, source_name text, license_label text, verification_status text)
language sql stable set search_path = public as $$
  select s.n, s.id, s.period_start, s.period_end, s.declared_date, s.declared_date_note, s.captured_at, s.origin_url, s.sha256, d.name, d.license_label, d.verification_status
    from public.source_snapshots s join public.data_sources d on d.id = s.source_id
   where d.source_key = p_source_key and s.status = 'loaded'
   order by s.period_end desc, s.n desc limit 1
$$;

-- Devuelve un jsonb (todo NULL cuando no hay dato; JAMÁS un 0 inventado):
--   snss, dependencia_norm        de la captura vigente de establecimientos (null si el código no existe)
--   dotacion          { year, total, snapshot_id, areas:[{area,nombre,camas}] }  — último año de la captura vigente; total = fila «Total» publicada (null si no hay)
--   ocupacion_anual   { year, months, ocupados, disponibles, indice, areas:[…] } — último AÑO COMPLETO (el último año con diciembre en el archivo)
--   ocupacion_mes     { period, ocupados, disponibles, indice, areas:[…] }       — último mes publicado
--   fuentes           { dotacion:{…}, rem20:{ … } } con URL de origen, sha256, fecha declarada, período y licencia
--   client_ready      { dotacion:{client_ready,note}, ocupacion:{…} }
create or replace function public.get_health_capacity(p_code text)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_e record; v_d record; v_r record; v_year int; v_dot jsonb; v_ano jsonb; v_mes jsonb; v_month date; v_months int;
begin
  if p_code is null or p_code !~ '^[0-9]{6}$' then raise exception 'p_code debe ser un código DEIS de 6 dígitos' using errcode = '22023'; end if;
  select e.snss, e.dependencia_norm, e.estado into v_e
    from public._health_current_snapshot() cs join public.health_establishments e on e.snapshot_n = cs.snapshot_n where e.code = p_code;
  select * into v_d from public._health_capacity_current_snapshot('deis_dotacion_camas');
  select * into v_r from public._health_capacity_current_snapshot('deis_rem20_hospitalizacion');

  -- dotación: último año de la captura vigente
  if v_d.snapshot_n is not null then
    v_year := extract(year from v_d.period_end)::int;
    if exists (select 1 from public.health_beds_dotacion b where b.snapshot_n = v_d.snapshot_n and b.code = p_code and b.year = v_year) then
      v_dot := jsonb_build_object('year', v_year, 'snapshot_id', v_d.snapshot_id,
        'total', (select b.beds from public.health_beds_dotacion b where b.snapshot_n = v_d.snapshot_n and b.code = p_code and b.year = v_year and b.area = 100),
        'areas', coalesce((select jsonb_agg(jsonb_build_object('area', b.area, 'nombre', a.nombre, 'camas', b.beds) order by b.area)
                             from public.health_beds_dotacion b join public.health_areas_funcionales a on a.area = b.area
                            where b.snapshot_n = v_d.snapshot_n and b.code = p_code and b.year = v_year and b.area <> 100), '[]'::jsonb));
    end if;
  end if;

  -- ocupación: último año completo y último mes publicado (REM 20)
  if v_r.snapshot_n is not null then
    v_year := case when extract(month from v_r.period_end) = 12 then extract(year from v_r.period_end)::int else extract(year from v_r.period_end)::int - 1 end;
    select count(distinct m.period) into v_months from public.health_rem20_month m
     where m.snapshot_n = v_r.snapshot_n and m.code = p_code and m.period >= make_date(v_year, 1, 1) and m.period <= make_date(v_year, 12, 1);
    if v_months > 0 then
      v_ano := (
        with a as (select m.area, sum(m.dias_cama_ocupados)::bigint o, sum(m.dias_cama_disponibles)::bigint d
                     from public.health_rem20_month m
                    where m.snapshot_n = v_r.snapshot_n and m.code = p_code and m.period >= make_date(v_year, 1, 1) and m.period <= make_date(v_year, 12, 1) group by m.area)
        select jsonb_build_object('year', v_year, 'months', v_months, 'expected_months', 12, 'snapshot_id', v_r.snapshot_id,
                 'ocupados', (select sum(o) from a), 'disponibles', (select sum(d) from a),
                 'indice', case when (select sum(d) from a) > 0 then round(100.0 * (select sum(o) from a) / (select sum(d) from a), 2) end,
                 'areas', (select jsonb_agg(jsonb_build_object('area', a.area, 'nombre', f.nombre, 'ocupados', a.o, 'disponibles', a.d,
                                                               'indice', case when a.d > 0 then round(100.0 * a.o / a.d, 2) end) order by a.area)
                             from a join public.health_areas_funcionales f on f.area = a.area)));
    end if;
    v_month := date_trunc('month', v_r.period_end)::date;
    if exists (select 1 from public.health_rem20_month m where m.snapshot_n = v_r.snapshot_n and m.code = p_code and m.period = v_month) then
      v_mes := (
        with a as (select m.area, sum(m.dias_cama_ocupados)::bigint o, sum(m.dias_cama_disponibles)::bigint d
                     from public.health_rem20_month m where m.snapshot_n = v_r.snapshot_n and m.code = p_code and m.period = v_month group by m.area)
        select jsonb_build_object('period', to_char(v_month, 'YYYY-MM'), 'snapshot_id', v_r.snapshot_id,
                 'ocupados', (select sum(o) from a), 'disponibles', (select sum(d) from a),
                 'indice', case when (select sum(d) from a) > 0 then round(100.0 * (select sum(o) from a) / (select sum(d) from a), 2) end,
                 'areas', (select jsonb_agg(jsonb_build_object('area', a.area, 'nombre', f.nombre, 'ocupados', a.o, 'disponibles', a.d,
                                                               'indice', case when a.d > 0 then round(100.0 * a.o / a.d, 2) end) order by a.area)
                             from a join public.health_areas_funcionales f on f.area = a.area)));
    end if;
  end if;

  return jsonb_build_object(
    'code', p_code, 'snss', v_e.snss, 'dependencia_norm', v_e.dependencia_norm,
    'dotacion', v_dot, 'ocupacion_anual', v_ano, 'ocupacion_mes', v_mes,
    'fuentes', jsonb_build_object(
      'dotacion', case when v_d.snapshot_n is null then null else jsonb_build_object('name', v_d.source_name, 'origin_url', v_d.origin_url, 'sha256', v_d.sha256,
          'declared_date', v_d.declared_date, 'declared_date_note', v_d.declared_date_note, 'captured_at', v_d.captured_at,
          'period_start', v_d.period_start, 'period_end', v_d.period_end, 'license_label', v_d.license_label, 'verification_status', v_d.verification_status) end,
      'rem20', case when v_r.snapshot_n is null then null else jsonb_build_object('name', v_r.source_name, 'origin_url', v_r.origin_url, 'sha256', v_r.sha256,
          'declared_date', v_r.declared_date, 'declared_date_note', v_r.declared_date_note, 'captured_at', v_r.captured_at,
          'period_start', v_r.period_start, 'period_end', v_r.period_end, 'license_label', v_r.license_label, 'verification_status', v_r.verification_status) end),
    'client_ready', (select jsonb_object_agg(f.field_key, jsonb_build_object('client_ready', f.client_ready, 'note', f.client_ready_note)) from public.health_capacity_fields f));
end $$;

-- -----------------------------------------------------------------------------
-- 6. RLS y permisos
-- -----------------------------------------------------------------------------
alter table public.health_areas_funcionales        enable row level security;
alter table public.health_capacity_fields          enable row level security;
alter table public.health_rem20_month              enable row level security;
alter table public.health_beds_dotacion            enable row level security;
alter table public.health_rem20_month_stage        enable row level security;
alter table public.health_beds_dotacion_stage      enable row level security;
drop policy if exists health_areas_funcionales_read on public.health_areas_funcionales;
create policy health_areas_funcionales_read on public.health_areas_funcionales for select to authenticated using (true);
drop policy if exists health_capacity_fields_read on public.health_capacity_fields;
create policy health_capacity_fields_read on public.health_capacity_fields for select to authenticated using (true);
drop policy if exists health_rem20_month_read on public.health_rem20_month;
create policy health_rem20_month_read on public.health_rem20_month for select to authenticated using (true);
drop policy if exists health_beds_dotacion_read on public.health_beds_dotacion;
create policy health_beds_dotacion_read on public.health_beds_dotacion for select to authenticated using (true);
revoke all on public.health_areas_funcionales, public.health_capacity_fields, public.health_rem20_month, public.health_beds_dotacion,
              public.health_rem20_month_stage, public.health_beds_dotacion_stage from anon;
revoke insert, update, delete, truncate on public.health_areas_funcionales, public.health_capacity_fields, public.health_rem20_month, public.health_beds_dotacion from authenticated;
revoke all on public.health_rem20_month_stage, public.health_beds_dotacion_stage from authenticated;
revoke all on function public.publish_health_rem20_snapshot(uuid), public.publish_health_dotacion_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.publish_health_rem20_snapshot(uuid), public.publish_health_dotacion_snapshot(uuid) to service_role;
revoke all on function public._health_capacity_current_snapshot(text), public.get_health_capacity(text) from public, anon;
grant execute on function public._health_capacity_current_snapshot(text), public.get_health_capacity(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 7. Auditoría final: nada previo cambió (salvo +2 fuentes sembradas)
-- -----------------------------------------------------------------------------
do $$
declare v_bad text;
begin
  select string_agg(b.t || ': ' || b.n || ' -> ' || a.n, ', ') into v_bad
    from _cap_counts_before b
    join (
      select 'layer_nodes'::text as t, count(*)::bigint as n from public.layer_nodes
      union all select 'territorial_layers', count(*) from public.territorial_layers
      union all select 'territorial_features', count(*) from public.territorial_features
      union all select 'thematic_layers', count(*) from public.thematic_layers
      union all select 'comunas', count(*) from public.comunas
      union all select 'health_establishments', count(*) from public.health_establishments
      union all select 'source_snapshots', count(*) from public.source_snapshots
      union all select 'data_sources_other', count(*) from public.data_sources where source_key not in ('deis_rem20_hospitalizacion', 'deis_dotacion_camas')
    ) a using (t)
   where a.n <> b.n;
  if v_bad is not null then raise exception 'Guardrail: cambiaron conteos de tablas existentes (%)', v_bad; end if;
end $$;

insert into public._migration_log (sprint, notes) values ('health_capacity_v1', 'done');
