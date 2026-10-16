-- =============================================================================
-- PROPUESTA (NO APLICADA) — Permisos de edificación, parte 2/4: estadística por comuna
-- =============================================================================
-- Requiere la parte 1 (20261020120000_permits_provenance.sql).
--
--   permit_series               DIMENSIÓN: (fuente, métrica, granularidad, destino ORIGINAL declarado, tipo de obra)
--                               + su clasificación normalizada. El texto vive UNA vez, no 200 mil veces.
--   permit_destination_map      cómo se normaliza cada destino declarado (datos, no código)
--   permit_stage                zona de paso: el ETL deja aquí el snapshot validado y publish() lo aplica
--   building_permit_statistics  HECHOS con VIGENCIA por snapshot: un valor se guarda UNA vez y solo se
--                               duplica cuando la fuente lo cambia (from_snapshot .. to_snapshot)
--   permit_rejected_rows        filas que el ETL rechazó, con el motivo
--   snapshot_control_totals     totales publicados por la fuente vs. suma de comunas
--   publish_permit_snapshot()   único camino para aplicar un snapshot (diff + validaciones en la base)
--   purge_superseded_permit_rows()  libera espacio de versiones viejas (el archivo original se conserva)
--   get_permit_choropleth()     valores por comuna para pintar el mapa (+ variación interanual honesta)
--   get_permit_series()         serie de una comuna, cada valor con su procedencia y celda de origen
--   get_layer_provenance()      fuentes + último período + frescura para la leyenda
--
-- ESPACIO: ver docs/permisos-edificacion/DISENO.md §3.4 (mediciones por tabla e índice).
-- Es SOLO ADITIVA. Reglas: SQL_MIGRATION_GUARDRAILS.md.
-- Rollback: supabase/rollbacks/20261020120100_building_permit_statistics_down.sql
-- =============================================================================

select pg_advisory_xact_lock(hashtext('permits_v1'));
set local statement_timeout = '5min';

insert into public._migration_log (sprint, notes) values ('permits_statistics_v1', 'start');

do $$
begin
  if to_regclass('public.data_sources') is null or to_regclass('public.source_snapshots') is null
     or to_regclass('public.comunas') is null or to_regclass('public.pipeline_settings') is null then
    raise exception 'Guardrail: falta la parte 1 (permits_provenance_v1); aplicarla primero';
  end if;
end $$;

create temp table _permits_counts_before on commit drop as
  select 'layer_nodes'::text as t, count(*)::bigint as n from public.layer_nodes
  union all select 'territorial_layers', count(*) from public.territorial_layers
  union all select 'territorial_features', count(*) from public.territorial_features
  union all select 'comunas', count(*) from public.comunas
  union all select 'source_snapshots', count(*) from public.source_snapshots;

-- -----------------------------------------------------------------------------
-- 1. Normalización de destinos y series (el destino ORIGINAL se guarda siempre)
-- -----------------------------------------------------------------------------
create table if not exists public.permit_destination_map (
  id                        bigint generated always as identity primary key,
  source_id                 uuid not null references public.data_sources(id) on delete cascade,
  destination_declared_norm text not null check (btrim(destination_declared_norm) <> ''),   -- minúsculas, sin tildes
  destination_class         text not null check (destination_class in (
    'housing_total', 'housing_houses', 'housing_apartments', 'non_housing_total',
    'commerce', 'offices', 'industry_warehouses', 'equipment', 'services', 'total', 'other')),
  note                      text,
  constraint permit_destination_map_uniq unique (source_id, destination_declared_norm)
);

create table if not exists public.permit_series (
  id                   smallint generated always as identity primary key,
  source_id            uuid not null references public.data_sources(id) on delete cascade,
  metric               text not null check (metric in ('units', 'area_m2')),
  granularity          text not null check (granularity in ('month', 'year')),
  destination_declared text not null check (btrim(destination_declared) <> ''),   -- tal cual en la fuente
  destination_class    text not null check (destination_class in (
    'housing_total', 'housing_houses', 'housing_apartments', 'non_housing_total',
    'commerce', 'offices', 'industry_warehouses', 'equipment', 'services', 'total', 'other')),
  work_type_declared   text not null default '',            -- 'obra nueva' | 'ampliación' | ''  (tal cual)
  work_type_class      text not null default 'unspecified'
                       check (work_type_class in ('new_works', 'extension', 'total', 'unspecified')),
  source_sheet         text,                                -- hoja/tabla de origen (para citar la celda)
  created_at           timestamptz not null default now(),
  constraint permit_series_uniq unique (source_id, metric, granularity, destination_declared, work_type_declared)
);

-- MINVU: los destinos son los de los NOMBRES DE HOJA de los XLSX reales ("número_total", "m2_casas", …;
-- COMPROBADO sobre los dos archivos publicados el 2026-09-11, ver DISENO.md §1). Ambos archivos tienen las
-- mismas 6 hojas. El ANUAL aporta años (2002-2025; su 2026 viene mensual y es idéntico al del archivo
-- mensual, celda a celda, así que se usa solo como control cruzado y no se almacena dos veces). El
-- MENSUAL aporta meses. Por eso: anual = series 'year', mensual = series 'month'.
-- INE: SIN series a propósito (no se carga por ahora; destinos no comprobados): el ETL rechaza todo
-- destino sin mapeo (reason_code = destination_unmapped) en vez de adivinar su clase.
insert into public.permit_destination_map (source_id, destination_declared_norm, destination_class, note)
select d.id, m.decl, m.cls, 'segmento del nombre de hoja del XLSX CEDOC (número_/m2_ + total|casas|departamentos)'
  from public.data_sources d
  cross join (values ('total', 'housing_total'), ('casas', 'housing_houses'), ('departamentos', 'housing_apartments')) as m(decl, cls)
 where d.source_key in ('minvu_cedoc_permisos_anual', 'minvu_cedoc_permisos_mensual')
on conflict (source_id, destination_declared_norm) do nothing;

insert into public.permit_series (source_id, metric, granularity, destination_declared, destination_class, source_sheet)
select d.id, mt.metric,
       case d.source_key when 'minvu_cedoc_permisos_anual' then 'year' else 'month' end,
       m.declared, m.cls,
       case mt.metric when 'units' then 'número_' else 'm2_' end || m.declared
  from public.data_sources d
  cross join (values ('units'), ('area_m2')) as mt(metric)
  cross join (values ('total', 'housing_total'), ('casas', 'housing_houses'), ('departamentos', 'housing_apartments')) as m(declared, cls)
 where d.source_key in ('minvu_cedoc_permisos_anual', 'minvu_cedoc_permisos_mensual')
on conflict (source_id, metric, granularity, destination_declared, work_type_declared) do nothing;

-- -----------------------------------------------------------------------------
-- 2. Hechos con vigencia por snapshot
-- -----------------------------------------------------------------------------
-- Una fila = un valor y el rango de snapshots en que fue el vigente:
--   from_snapshot  primer snapshot que trajo ESTE valor (su procedencia: URL, hash, fecha, celda)
--   to_snapshot    NULL = sigue vigente; si no, el snapshot que lo cambió o lo retiró
-- Un valor que el nuevo archivo repite igual NO se vuelve a escribir. El contenido completo de un
-- snapshot S se reconstruye con: from_snapshot <= S and (to_snapshot is null or to_snapshot > S).
-- Tipos: value es integer (los 6 cuadros del XLSX real son 100 % enteros: 11.377 celdas por hoja, 0 decimales,
-- 0 vacíos, 0 negativos; máximo 1.169.064); el CUT es char(5); sin JSONB por fila.
create table if not exists public.building_permit_statistics (
  series_id      smallint not null references public.permit_series(id),
  comuna_cut     char(5)  not null references public.comunas(cut),
  period         date     not null,                       -- 1.er día del mes, o 1-ene del año (según la granularidad de la serie)
  value          integer  not null check (value >= 0),
  is_provisional boolean  not null default false,         -- no definitivo según la propia fuente
  from_snapshot  integer  not null references public.source_snapshots(n),
  to_snapshot    integer  references public.source_snapshots(n),
  constraint bps_range_order check (to_snapshot is null or to_snapshot > from_snapshot)
);
-- SIN clave primaria a propósito (medido: una PK (serie, comuna, período, snapshot) costaba 11 MB de 35):
--   * unicidad dentro de un snapshot: la garantiza la PK de permit_stage, y publish() inserta desde ahí;
--   * unicidad de lo VIGENTE (una fila por serie/período/comuna): la garantiza el índice parcial de abajo.
-- Los usuarios no tienen política de escritura, así que nada más inserta en esta tabla.
-- (Si algún día se publica por replicación lógica, fijar REPLICA IDENTITY USING INDEX sobre un índice único.)

-- Una sola fila VIGENTE por clave de negocio; el orden (serie, período, comuna) sirve a la coroplética
create unique index if not exists bps_one_current_idx
  on public.building_permit_statistics (series_id, period, comuna_cut) where to_snapshot is null;

-- Un valor publicado no se edita: lo único que cambia es to_snapshot (de NULL a un snapshot), una vez.
create or replace function public.bps_immutable()
returns trigger language plpgsql set search_path = public as $$
begin
  if (to_jsonb(new) - 'to_snapshot') is distinct from (to_jsonb(old) - 'to_snapshot')
     or (old.to_snapshot is not null and new.to_snapshot is distinct from old.to_snapshot) then
    raise exception 'building_permit_statistics es inmutable: cargar un snapshot nuevo en vez de editar (serie %, comuna %, período %)',
      old.series_id, old.comuna_cut, old.period using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists trg_bps_immutable on public.building_permit_statistics;
create trigger trg_bps_immutable before update on public.building_permit_statistics
  for each row execute function public.bps_immutable();

-- Zona de paso: el ETL carga aquí el snapshot YA validado; publish() la vacía.
create table if not exists public.permit_stage (
  snapshot_n     integer  not null references public.source_snapshots(n) on delete cascade,
  series_id      smallint not null references public.permit_series(id),
  comuna_cut     char(5)  not null references public.comunas(cut),
  period         date     not null,
  value          integer  not null check (value >= 0),
  is_provisional boolean  not null default false,
  constraint permit_stage_pkey primary key (snapshot_n, series_id, comuna_cut, period)
);

-- -----------------------------------------------------------------------------
-- 3. Filas rechazadas y totales de control
-- -----------------------------------------------------------------------------
create table if not exists public.permit_rejected_rows (
  id          bigint generated always as identity primary key,
  snapshot_id uuid not null references public.source_snapshots(id) on delete cascade,
  row_ref     jsonb not null default '{}'::jsonb,        -- {sheet, row}
  reason_code text not null check (reason_code in (
    'comuna_unmatched', 'comuna_ambiguous', 'cut_invalid', 'duplicate_key', 'negative_value',
    'non_numeric', 'period_invalid', 'destination_unmapped', 'header_unrecognized', 'layout_mismatch', 'other')),
  detail      text,
  raw         jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists permit_rejected_rows_snapshot_idx on public.permit_rejected_rows (snapshot_id, reason_code);

create table if not exists public.snapshot_control_totals (
  id                bigint generated always as identity primary key,
  snapshot_id       uuid not null references public.source_snapshots(id) on delete cascade,
  series_id         smallint not null references public.permit_series(id),
  period            date not null,
  scope             text not null default 'national' check (scope in ('national', 'component')),
  declared_total    bigint not null,                      -- el total que PUBLICA la fuente (fila "Total País", boletín…)
  computed_total    bigint not null,                      -- la suma de las comunas cargadas
  tolerance         bigint not null default 0 check (tolerance >= 0),
  ok                boolean generated always as (abs(declared_total - computed_total) <= tolerance) stored,
  reference         text not null check (btrim(reference) <> ''),    -- de dónde sale el total declarado
  created_at        timestamptz not null default now()
);
create index if not exists snapshot_control_totals_snapshot_idx on public.snapshot_control_totals (snapshot_id);

-- -----------------------------------------------------------------------------
-- 4. Publicar un snapshot (único camino) y purgar versiones viejas
-- -----------------------------------------------------------------------------
-- El ETL deja el snapshot en 'validated' y sus filas en permit_stage; esta función RE-VALIDA en la base
-- (defensa en profundidad: no depende de que el ETL se porte bien) y aplica la diferencia:
--   igual a lo vigente  -> no se escribe nada
--   distinto            -> se cierra la versión vigente (to_snapshot) y se inserta la nueva
--   nuevo               -> se inserta
--   ausente (scope = 'full', dentro de la ventana cargada) -> se retira (to_snapshot)
create or replace function public.publish_permit_snapshot(p_snapshot_id uuid, p_max_reject_ratio numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s            public.source_snapshots;
  v_ratio      numeric;
  v_rows       bigint;
  v_expected   int;
  v_allowed    int;
  v_min_comunas int;
  v_bad        bigint;
  v_changed    bigint; v_retired bigint; v_inserted bigint;
begin
  select * into s from public.source_snapshots where id = p_snapshot_id for update;
  if not found then raise exception 'snapshot % no existe', p_snapshot_id; end if;
  perform pg_advisory_xact_lock(hashtext('permits_publish:' || s.source_id::text));

  if s.status in ('loaded', 'superseded') then
    return jsonb_build_object('snapshot_id', s.id, 'already_loaded', true);
  end if;
  if s.status <> 'validated' then
    raise exception 'snapshot % no está validado (status = %)', s.id, s.status;
  end if;

  -- no se publica un archivo más viejo que lo ya vigente
  if exists (select 1 from public.source_snapshots o
              where o.source_id = s.source_id and o.status in ('loaded', 'superseded') and o.period_end > s.period_end) then
    raise exception 'snapshot %: cubre hasta %, pero ya hay uno publicado que cubre más allá', s.id, s.period_end;
  end if;

  v_ratio := coalesce(p_max_reject_ratio, public.pipeline_setting('publish.max_reject_ratio'));

  select count(*) into v_rows from public.permit_stage where snapshot_n = s.n;
  if v_rows = 0 then raise exception 'snapshot % no tiene filas en permit_stage', s.id; end if;

  -- las series deben ser de la MISMA fuente que el snapshot
  select count(*) into v_bad
    from public.permit_stage g join public.permit_series ps on ps.id = g.series_id
   where g.snapshot_n = s.n and ps.source_id <> s.source_id;
  if v_bad > 0 then raise exception 'snapshot %: % filas usan series de otra fuente', s.id, v_bad; end if;

  -- el período debe tener la forma de la granularidad de su serie y caer dentro del archivo y de la ventana cargada
  select count(*) into v_bad
    from public.permit_stage g join public.permit_series ps on ps.id = g.series_id
   where g.snapshot_n = s.n
     and ( (ps.granularity = 'month' and g.period <> date_trunc('month', g.period)::date)
        or (ps.granularity = 'year'  and g.period <> date_trunc('year',  g.period)::date)
        or g.period < s.period_start or g.period > s.period_end
        or (s.load_from is not null and g.period < s.load_from));
  if v_bad > 0 then raise exception 'snapshot %: % filas con período fuera de forma o de rango', s.id, v_bad; end if;

  if s.row_count_raw is not null and s.row_count_raw > 0
     and s.rejected_count::numeric / s.row_count_raw > v_ratio then
    raise exception 'snapshot %: % de % filas rechazadas supera el umbral %', s.id, s.rejected_count, s.row_count_raw, v_ratio;
  end if;

  if exists (select 1 from public.snapshot_control_totals where snapshot_id = s.id and not ok) then
    raise exception 'snapshot %: hay totales de control que no cuadran con el total publicado', s.id;
  end if;

  -- 346 comunas por serie, salvo ausentes declaradas (y justificadas) en el reporte de validación
  select count(*) into v_expected from public.comunas;
  if v_expected <> 346 then
    raise exception 'Guardrail: la referencia de comunas tiene % filas (se esperan 346)', v_expected;
  end if;
  v_allowed := coalesce(jsonb_array_length(s.validation_report -> 'comunas_absent_declared'), 0);
  select min(n) into v_min_comunas from (
    select count(distinct comuna_cut) as n from public.permit_stage where snapshot_n = s.n group by series_id) t;
  if v_min_comunas < v_expected - v_allowed then
    raise exception 'snapshot %: una serie trae % comunas; se esperan % (% ausentes declaradas)', s.id, v_min_comunas, v_expected, v_allowed;
  end if;

  -- 1) cerrar las versiones vigentes que cambian
  update public.building_permit_statistics o
     set to_snapshot = s.n
    from public.permit_stage g
   where g.snapshot_n = s.n and o.to_snapshot is null
     and o.series_id = g.series_id and o.comuna_cut = g.comuna_cut and o.period = g.period
     and (o.value <> g.value or o.is_provisional <> g.is_provisional);
  get diagnostics v_changed = row_count;

  -- 2) retirar lo que la fuente ya no trae (solo foto completa, solo series presentes y dentro de la ventana)
  v_retired := 0;
  if s.scope = 'full' then
    update public.building_permit_statistics o
       set to_snapshot = s.n
     where o.to_snapshot is null
       and o.series_id in (select distinct series_id from public.permit_stage where snapshot_n = s.n)
       and o.period >= coalesce(s.load_from, s.period_start) and o.period <= s.period_end
       and not exists (select 1 from public.permit_stage g
                        where g.snapshot_n = s.n and g.series_id = o.series_id
                          and g.comuna_cut = o.comuna_cut and g.period = o.period);
    get diagnostics v_retired = row_count;
  end if;

  -- 3) insertar lo nuevo y las versiones nuevas (lo igual ya tiene fila vigente y se omite)
  insert into public.building_permit_statistics (series_id, comuna_cut, period, value, is_provisional, from_snapshot)
  select g.series_id, g.comuna_cut, g.period, g.value, g.is_provisional, s.n
    from public.permit_stage g
   where g.snapshot_n = s.n
     and not exists (select 1 from public.building_permit_statistics o
                      where o.to_snapshot is null and o.series_id = g.series_id
                        and o.comuna_cut = g.comuna_cut and o.period = g.period);
  get diagnostics v_inserted = row_count;

  delete from public.permit_stage where snapshot_n = s.n;
  -- si la zona de paso quedó vacía se TRUNCA (un DELETE deja el archivo inflado en disco)
  if not exists (select 1 from public.permit_stage) then
    truncate public.permit_stage;
  end if;

  update public.source_snapshots
     set status = 'loaded', loaded_at = now(),
         validation_report = validation_report || jsonb_build_object(
           'publish', jsonb_build_object('rows_in_file', v_rows, 'inserted', v_inserted, 'changed', v_changed,
                                         'retired', v_retired, 'unchanged', v_rows - v_inserted))
   where id = s.id;

  return jsonb_build_object('snapshot_id', s.id, 'snapshot_n', s.n, 'rows_in_file', v_rows, 'inserted', v_inserted,
                            'changed', v_changed, 'retired', v_retired, 'unchanged', v_rows - v_inserted);
end $$;

-- Libera espacio: conserva reconstruibles los últimos K snapshots (configurable) y borra las versiones
-- que ya no sirven a ninguno de ellos. NUNCA toca valores vigentes, y el registro del snapshot y su
-- ARCHIVO ORIGINAL (Storage) se conservan siempre: lo vigente sigue apuntando al snapshot donde nació.
create or replace function public.purge_superseded_permit_rows(p_source_id uuid, p_keep int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_keep int; v_min_n integer; v_deleted bigint; v_marked bigint;
begin
  v_keep := coalesce(p_keep, public.pipeline_setting('retention.keep_snapshots')::int);
  if v_keep < 1 then raise exception 'retención debe ser >= 1'; end if;
  perform pg_advisory_xact_lock(hashtext('permits_publish:' || p_source_id::text));

  select min(n) into v_min_n from (
    select n from public.source_snapshots where source_id = p_source_id and status = 'loaded' order by n desc limit v_keep) t;
  if v_min_n is null then
    return jsonb_build_object('rows_deleted', 0, 'snapshots_marked', 0);
  end if;

  -- versiones cerradas en o antes del snapshot reconstruible más antiguo: no sirven a ninguno de los retenidos
  delete from public.building_permit_statistics b
   using public.permit_series ps
   where ps.id = b.series_id and ps.source_id = p_source_id
     and b.to_snapshot is not null and b.to_snapshot <= v_min_n;
  get diagnostics v_deleted = row_count;

  -- solo se marcan los snapshots cuyo original está archivado (sin archivo no habría cómo reconstruir)
  update public.source_snapshots
     set status = 'superseded'
   where source_id = p_source_id and status = 'loaded' and n < v_min_n
     and storage_path is not null and length(sha256) = 64;
  get diagnostics v_marked = row_count;

  return jsonb_build_object('source_id', p_source_id, 'keep', v_keep, 'rows_deleted', v_deleted, 'snapshots_marked', v_marked);
end $$;

-- -----------------------------------------------------------------------------
-- 5. Lectura para el mapa y la ficha
-- -----------------------------------------------------------------------------
-- Letra de columna de Excel (3 -> 'C', 27 -> 'AA') para citar la celda de origen.
create or replace function public._xl_col(p_n int)
returns text language plpgsql immutable set search_path = public as $$
declare v_n int := p_n; v_s text := '';
begin
  if p_n is null or p_n < 1 then return null; end if;
  while v_n > 0 loop
    v_s := chr(65 + ((v_n - 1) % 26)) || v_s;
    v_n := (v_n - 1) / 26;
  end loop;
  return v_s;
end $$;

-- p_granularity: 'month' | 'year' | 'ytd' (enero..p_month acumulado, comparable año contra año).
-- Un valor solo se devuelve si el período está COMPLETO; faltante = NULL, nunca 0.
-- La variación interanual solo se calcula si ambos lados están completos: un año parcial
-- (p. ej. 2026 hasta julio) contra un año entero NO es una variación válida.
create or replace function public.get_permit_choropleth(
  p_source_key text, p_granularity text, p_year int, p_month int default null,
  p_metric text default 'units', p_destination_class text default 'housing_total',
  p_work_type_class text default 'unspecified')
returns table (
  comuna_cut text, comuna_name text, value numeric, prev_value numeric, yoy_pct numeric,
  coverage_ok boolean, is_provisional boolean, snapshot_ids uuid[])
language plpgsql stable security invoker set search_path = public as $$
declare
  v_src uuid; v_gran text; v_from date; v_to date; v_n int; v_series smallint[]; v_cov_end date;
begin
  if p_granularity not in ('month', 'year', 'ytd') then
    raise exception 'granularidad inválida: %', p_granularity using errcode = 'invalid_parameter_value';
  end if;
  select id into v_src from public.data_sources where source_key = p_source_key;
  if v_src is null then
    raise exception 'fuente % no existe', p_source_key using errcode = 'invalid_parameter_value';
  end if;

  if p_granularity = 'year' then
    v_gran := 'year'; v_from := make_date(p_year, 1, 1); v_to := v_from; v_n := 1;
  else
    if p_month is null or p_month not between 1 and 12 then
      raise exception 'p_month (1-12) es obligatorio para %', p_granularity using errcode = 'invalid_parameter_value';
    end if;
    v_gran := 'month';
    v_to := make_date(p_year, p_month, 1);
    if p_granularity = 'month' then v_from := v_to; v_n := 1;
    else v_from := make_date(p_year, 1, 1); v_n := p_month; end if;
  end if;

  select coalesce(array_agg(id), '{}') into v_series from public.permit_series
   where source_id = v_src and metric = p_metric and destination_class = p_destination_class
     and work_type_class = p_work_type_class and granularity = v_gran;
  -- hasta dónde llega lo publicado de esta fuente (para saber si un año está completo)
  select max(period_end) into v_cov_end from public.source_snapshots
   where source_id = v_src and status in ('loaded', 'superseded');

  return query
  with cur as (
    select s.comuna_cut as cut, sum(s.value)::numeric as v, count(distinct s.period)::int as n,
           bool_or(s.is_provisional) as prov, array_agg(distinct sn.id) as snaps
      from public.building_permit_statistics s
      join public.source_snapshots sn on sn.n = s.from_snapshot
     where s.to_snapshot is null and s.series_id = any (v_series)
       and s.period between v_from and v_to
     group by s.comuna_cut
  ), prev as (
    select s.comuna_cut as cut, sum(s.value)::numeric as v, count(distinct s.period)::int as n
      from public.building_permit_statistics s
     where s.to_snapshot is null and s.series_id = any (v_series)
       and s.period between (v_from - interval '1 year')::date and (v_to - interval '1 year')::date
     group by s.comuna_cut
  )
  select c.cut::text, c.name,
         case when cc.ok_cur then cur.v end,
         case when prev.n = v_n then prev.v end,
         case when cc.ok_cur and prev.n = v_n and prev.v > 0 then round((cur.v / prev.v - 1) * 100, 2) end,
         coalesce(cc.ok_cur, false),
         cur.prov,
         cur.snaps
    from public.comunas c
    left join cur  on cur.cut = c.cut
    left join prev on prev.cut = c.cut
    left join lateral (
      select (cur.n = v_n and (p_granularity <> 'year' or v_cov_end >= make_date(p_year, 12, 31))) as ok_cur
    ) cc on true
   order by c.cut;
end $$;

create or replace function public.get_permit_series(
  p_cut text, p_source_key text, p_metric text default 'units',
  p_destination_class text default 'housing_total', p_granularity text default 'month')
returns table (
  period date, granularity text, value integer, is_provisional boolean, quality_note text,
  destination_declared text, work_type_declared text, source_sheet text, cell_ref text,
  first_snapshot_id uuid, first_captured_at timestamptz, first_origin_url text, first_declared_date date,
  latest_snapshot_id uuid, latest_captured_at timestamptz, latest_period_end date,
  landing_url text, source_key text, verification_status text)
language sql stable security invoker set search_path = public as $$
  select s.period, ps.granularity, s.value, s.is_provisional,
         case when s.is_provisional then sf.validation_report -> 'quality' ->> 'provisional_note' end,
         ps.destination_declared, ps.work_type_declared, ps.source_sheet,
         -- Celda de origen en el archivo donde NACIÓ el valor. layout.rows[cut] es [fila] o, para las
         -- comunas que el archivo trae duplicadas (Ñuble / ex-Biobío), {split, before, from}: la fila que
         -- aplica depende del período.
         case when sf.layout ? 'rows' and ps.source_sheet is not null then
           ps.source_sheet || '!'
             || public._xl_col((sf.layout -> 'cols' ->> (to_char(s.period, 'YYYY-MM-DD') || ':' || ps.granularity))::int)
             || case jsonb_typeof(sf.layout -> 'rows' -> trim(s.comuna_cut))
                  when 'array' then (sf.layout -> 'rows' -> trim(s.comuna_cut)) ->> 0
                  when 'object' then case when s.period < ((sf.layout -> 'rows' -> trim(s.comuna_cut)) ->> 'split')::date
                                          then (sf.layout -> 'rows' -> trim(s.comuna_cut)) ->> 'before'
                                          else (sf.layout -> 'rows' -> trim(s.comuna_cut)) ->> 'from' end
                end
         end,
         sf.id, sf.captured_at, sf.origin_url, sf.declared_date,
         sl.id, sl.captured_at, sl.period_end,
         d.landing_url, d.source_key, d.verification_status
    from public.building_permit_statistics s
    join public.permit_series ps on ps.id = s.series_id
    join public.data_sources d on d.id = ps.source_id
    join public.source_snapshots sf on sf.n = s.from_snapshot
    left join lateral (
      select x.* from public.source_snapshots x
       where x.source_id = d.id and x.status in ('loaded', 'superseded') order by x.n desc limit 1
    ) sl on true
   where s.to_snapshot is null
     and s.comuna_cut = p_cut and d.source_key = p_source_key
     and ps.metric = p_metric and ps.destination_class = p_destination_class
     and ps.granularity = p_granularity
   order by s.period, ps.destination_declared;
$$;

create or replace function public.get_layer_provenance(p_dataset text default 'building_permits')
returns table (
  source_key text, name text, publisher text, landing_url text, attribution text, license_label text,
  verification_status text, scope_note text, access_mode text,
  freshness_status text, check_overdue boolean, overdue_since date, last_checked_at timestamptz,
  snapshot_id uuid, origin_url text, sha256 text, captured_at timestamptz,
  period_start date, period_end date, load_from date, declared_date date,
  definitive_until int, quality_note text)
language sql stable security invoker set search_path = public as $$
  select f.source_key, f.name, f.publisher, f.landing_url, f.attribution, f.license_label,
         f.verification_status, f.scope_note, f.access_mode,
         f.freshness_status, f.check_overdue, f.overdue_since, f.last_checked_at,
         ls.id, ls.origin_url, ls.sha256, ls.captured_at, ls.period_start, ls.period_end, ls.load_from, ls.declared_date,
         (ls.validation_report -> 'quality' ->> 'definitive_until')::int, ls.validation_report -> 'quality' ->> 'provisional_note'
    from public.source_freshness_v f
    left join lateral (
      select s.* from public.source_snapshots s
       where s.source_id = f.source_id and s.status in ('loaded', 'superseded')
       order by s.period_end desc, s.n desc limit 1
    ) ls on true
   where f.dataset = p_dataset
   order by f.source_key;
$$;

-- -----------------------------------------------------------------------------
-- 6. RLS y permisos
-- -----------------------------------------------------------------------------
alter table public.permit_destination_map     enable row level security;
alter table public.permit_series              enable row level security;
alter table public.building_permit_statistics enable row level security;
alter table public.permit_stage               enable row level security;
alter table public.permit_rejected_rows       enable row level security;
alter table public.snapshot_control_totals    enable row level security;

drop policy if exists permit_destination_map_read on public.permit_destination_map;
create policy permit_destination_map_read on public.permit_destination_map for select to authenticated using (true);
drop policy if exists permit_destination_map_write on public.permit_destination_map;
create policy permit_destination_map_write on public.permit_destination_map for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists permit_series_read on public.permit_series;
create policy permit_series_read on public.permit_series for select to authenticated using (true);
drop policy if exists permit_series_write on public.permit_series;
create policy permit_series_write on public.permit_series for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists bps_read on public.building_permit_statistics;
create policy bps_read on public.building_permit_statistics for select to authenticated using (true);
-- sin política de escritura para usuarios: solo el ETL (rol de base de datos / service_role) escribe;
-- permit_stage no tiene ninguna política: solo el ETL la ve.

drop policy if exists permit_rejected_rows_read on public.permit_rejected_rows;
create policy permit_rejected_rows_read on public.permit_rejected_rows for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));
drop policy if exists snapshot_control_totals_read on public.snapshot_control_totals;
create policy snapshot_control_totals_read on public.snapshot_control_totals for select to authenticated using (true);

revoke all on public.permit_destination_map, public.permit_series, public.building_permit_statistics,
              public.permit_stage, public.permit_rejected_rows, public.snapshot_control_totals from anon;
revoke all on public.permit_stage from authenticated;

revoke all on function public.publish_permit_snapshot(uuid, numeric), public.purge_superseded_permit_rows(uuid, int)
  from public, anon, authenticated;
grant execute on function public.publish_permit_snapshot(uuid, numeric), public.purge_superseded_permit_rows(uuid, int)
  to service_role;

revoke all on function public.get_permit_choropleth(text, text, int, int, text, text, text),
                       public.get_permit_series(text, text, text, text, text),
                       public.get_layer_provenance(text), public._xl_col(int) from public, anon;
grant execute on function public.get_permit_choropleth(text, text, int, int, text, text, text),
                          public.get_permit_series(text, text, text, text, text),
                          public.get_layer_provenance(text), public._xl_col(int) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 7. Auditoría final: nada previo cambió
-- -----------------------------------------------------------------------------
do $$
declare v_bad text;
begin
  select string_agg(b.t || ': ' || b.n || ' -> ' || a.n, ', ') into v_bad
    from _permits_counts_before b
    join (
      select 'layer_nodes'::text as t, count(*)::bigint as n from public.layer_nodes
      union all select 'territorial_layers', count(*) from public.territorial_layers
      union all select 'territorial_features', count(*) from public.territorial_features
      union all select 'comunas', count(*) from public.comunas
      union all select 'source_snapshots', count(*) from public.source_snapshots
    ) a using (t)
   where a.n <> b.n;
  if v_bad is not null then
    raise exception 'Guardrail: cambiaron conteos de tablas existentes (%)', v_bad;
  end if;
  if (select count(*) from public.permit_series) <> 12 then
    raise exception 'Guardrail: se esperaban 12 series MINVU sembradas (6 anuales + 6 mensuales)';
  end if;
end $$;

insert into public._migration_log (sprint, notes) values ('permits_statistics_v1', 'done');
