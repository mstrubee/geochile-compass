-- =============================================================================
-- PROPUESTA (NO APLICADA) — Permisos de edificación, parte 1/4: procedencia, frescura y comunas
-- =============================================================================
-- Crea la base de CONFIABILIDAD que comparten todas las fuentes estadísticas:
--   pipeline_settings     umbrales configurables (nada hardcodeado en funciones)
--   data_sources          catálogo de fuentes (URL oficial, licencia, cadencia, estado de verificación)
--   source_snapshots      cada archivo/respuesta capturado: hash, fechas, período contenido, layout
--   source_checks         cada intento de revisar una fuente (aunque no traiga nada nuevo)
--   source_alerts         alertas de frescura (una abierta por fuente y tipo)
--   comunas               ÚNICA fuente de códigos CUT de la base (char(5)) + geometría reparada y auditada
--   comuna_geom_repairs   registro de cada reparación de geometría (original, área antes/después)
--   comuna_name_aliases   cruce NOMBRE -> CUT explícito y auditable (el archivo MINVU trae nombres)
--   source_freshness_v    vista: última fecha/período por fuente y si está atrasada
--   bucket privado `source-snapshots` para guardar el archivo ORIGINAL
--
-- Es SOLO ADITIVA: no modifica ninguna tabla existente.
-- Reglas: SQL_MIGRATION_GUARDRAILS.md (idempotencia, lock, log, conteos antes/después).
-- Rollback: supabase/rollbacks/20261020120000_permits_provenance_down.sql
-- =============================================================================

select pg_advisory_xact_lock(hashtext('permits_v1'));
set local statement_timeout = '5min';

insert into public._migration_log (sprint, notes) values ('permits_provenance_v1', 'start');

-- Conteos de lo que NO debe cambiar (cero pérdida de datos). Se vuelven a medir al final.
create temp table _permits_counts_before on commit drop as
  select 'layer_nodes'::text as t, count(*)::bigint as n from public.layer_nodes
  union all select 'territorial_layers', count(*) from public.territorial_layers
  union all select 'territorial_features', count(*) from public.territorial_features;

create extension if not exists postgis;

-- -----------------------------------------------------------------------------
-- 0. Umbrales configurables
-- -----------------------------------------------------------------------------
create table if not exists public.pipeline_settings (
  key         text primary key check (key ~ '^[a-z0-9_.]{3,60}$'),
  value       numeric not null,
  description text not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);

insert into public.pipeline_settings (key, value, description) values
  ('publish.max_reject_ratio',              0.005, 'Fracción máxima de filas rechazadas para poder publicar un snapshot (0,5 %). VALOR INICIAL.'),
  ('projects.near_border_m',                500,   'Metros de tolerancia al borde de la comuna para marcar un punto SEIA como near_border en vez de outside_declared. VALOR INICIAL.'),
  ('comunas.geom_repair_max_area_diff_pct', 1,     'Diferencia máxima de área (%) entre una geometría comunal reparada y la original; sobre esto queda needs_review.'),
  ('retention.keep_snapshots',              2,     'Snapshots por fuente cuyo contenido completo se puede reconstruir. Los archivos originales se conservan SIEMPRE.'),
  ('etl.monthly_keep_years',                5,     'Años recientes que se cargan del archivo mensual (el anual cubre desde 2002).'),
  ('etl.annual_from_year',                  2002,  'Primer año que se carga del archivo anual.')
on conflict (key) do nothing;

create or replace function public.pipeline_setting(p_key text)
returns numeric language plpgsql stable set search_path = public as $$
declare v numeric;
begin
  select value into v from public.pipeline_settings where key = p_key;
  if v is null then
    raise exception 'pipeline_settings: falta la clave %', p_key using errcode = 'undefined_object';
  end if;
  return v;
end $$;

-- -----------------------------------------------------------------------------
-- 1. Catálogo de fuentes
-- -----------------------------------------------------------------------------
create table if not exists public.data_sources (
  id                  uuid primary key default gen_random_uuid(),
  source_key          text not null unique check (source_key ~ '^[a-z0-9_]{3,60}$'),
  dataset             text not null check (dataset ~ '^[a-z0-9_]{3,40}$'),   -- 'building_permits' | 'building_projects' | ...
  name                text not null check (btrim(name) <> ''),
  publisher           text not null check (btrim(publisher) <> ''),
  landing_url         text not null check (landing_url ~ '^https://'),   -- página oficial
  data_url            text check (data_url is null or data_url ~ '^https://'),  -- archivo/servicio (puede rotar)
  license_label       text,
  license_url         text,
  attribution         text not null check (btrim(attribution) <> ''),
  access_mode         text not null check (access_mode in ('manual', 'automatic', 'hybrid')),
  -- Cada cuántos días la fuente publica un período nuevo, rezago esperado entre el fin del
  -- período y su publicación, y holgura antes de alertar. Son HIPÓTESIS hasta medirlas.
  cadence_days        int  not null check (cadence_days > 0),
  publication_lag_days int not null check (publication_lag_days >= 0),
  grace_days          int  not null default 15 check (grace_days >= 0),
  check_every_days    int  not null default 7 check (check_every_days > 0),
  -- Qué tan verificada está la fuente. Lo que no sea 'comprobado' se muestra como no verificado.
  verification_status text not null default 'documentado'
                      check (verification_status in ('comprobado', 'documentado', 'hipotesis', 'no_disponible')),
  verified_at         date,
  verification_note   text,
  scope_note          text,                       -- qué cubre y qué NO (ej. "solo vivienda")
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint data_sources_verified_has_date check (verification_status <> 'comprobado' or verified_at is not null)
);

-- -----------------------------------------------------------------------------
-- 2. Snapshots: cada captura con su hash, fechas, período y layout
-- -----------------------------------------------------------------------------
create table if not exists public.source_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  -- identificador COMPACTO (4 bytes) que usan las tablas de hechos en vez del uuid; crece en orden de captura
  n                   integer generated always as identity unique,
  source_id           uuid not null references public.data_sources(id) on delete restrict,
  captured_at         timestamptz not null default now(),         -- fecha de captura
  captured_by         text not null,                              -- 'manual:<email>' | 'etl:<host>'
  capture_method      text not null check (capture_method in ('manual_download', 'automatic_download', 'api')),
  origin_url          text not null check (origin_url ~ '^https://'),   -- URL EXACTA de donde salió
  original_filename   text,
  storage_bucket      text not null default 'source-snapshots',
  storage_path        text not null,                              -- archivo ORIGINAL, sin tocar
  sha256              text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes          bigint check (size_bytes is null or size_bytes >= 0),
  declared_date       date,                                       -- fecha declarada por el origen (NULL = no la declara)
  declared_date_note  text,                                       -- de dónde sale (p. ej. "propiedad modified del XLSX")
  period_start        date not null,                              -- primer DÍA cubierto por el archivo (ej. 2002-01-01)
  period_end          date not null,                              -- último DÍA cubierto (ej. 2026-07-31); en fuentes 'snapshot' = fecha de captura
  load_from           date,                                       -- primer período CARGADO a la base (p. ej. últimos 5 años del mensual)
  scope               text not null default 'full' check (scope in ('full', 'partial')),   -- 'full': lo ausente en el archivo se retira
  granularity         text not null check (granularity in ('month', 'year', 'month_and_year', 'snapshot')),
  row_count_raw       int check (row_count_raw is null or row_count_raw >= 0),
  rejected_count      int not null default 0 check (rejected_count >= 0),
  status              text not null default 'received'
                      check (status in ('received', 'validated', 'loaded', 'rejected', 'superseded')),
  validation_report   jsonb not null default '{}'::jsonb,
  layout              jsonb not null default '{}'::jsonb,         -- dónde estaba cada cosa en el archivo (hoja/fila/columna) para citar la celda
  loaded_at           timestamptz,
  note                text,
  created_at          timestamptz not null default now(),
  constraint source_snapshots_period_order check (period_end >= period_start),
  constraint source_snapshots_loaded_has_ts check (status not in ('loaded', 'superseded') or loaded_at is not null),
  -- el mismo archivo no se registra dos veces (reintentos idempotentes)
  constraint source_snapshots_source_hash_uniq unique (source_id, sha256),
  -- permite FK compuesta desde las tablas de datos (el snapshot pertenece a la fuente)
  constraint source_snapshots_id_source_uniq unique (id, source_id)
);
create index if not exists source_snapshots_source_period_idx
  on public.source_snapshots (source_id, period_end desc) where status in ('loaded', 'superseded');

-- -----------------------------------------------------------------------------
-- 3. Revisiones y alertas de frescura
-- -----------------------------------------------------------------------------
-- Distingue "la URL responde pero no hay período nuevo" de "no hemos mirado":
-- cada revisión (manual o automática) queda registrada aunque no cargue nada.
create table if not exists public.source_checks (
  id                 bigint generated always as identity primary key,
  source_id          uuid not null references public.data_sources(id) on delete cascade,
  checked_at         timestamptz not null default now(),
  method             text not null check (method in ('manual', 'automatic')),
  outcome            text not null check (outcome in
                       ('ok_new_data', 'ok_no_new_period', 'ok_same_content', 'unreachable', 'blocked', 'parse_error')),
  http_status        int,
  content_sha256     text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  latest_period_seen date,
  detail             text,
  checked_by         text
);
create index if not exists source_checks_source_idx on public.source_checks (source_id, checked_at desc);

create table if not exists public.source_alerts (
  id         bigint generated always as identity primary key,
  source_id  uuid not null references public.data_sources(id) on delete cascade,
  kind       text not null check (kind in ('stale_period', 'check_overdue', 'never_loaded')),
  opened_at  timestamptz not null default now(),
  closed_at  timestamptz,
  detail     text
);
create unique index if not exists source_alerts_one_open_idx
  on public.source_alerts (source_id, kind) where closed_at is null;

-- -----------------------------------------------------------------------------
-- 4. Comunas: ÚNICA fuente de códigos CUT de la base
-- -----------------------------------------------------------------------------
-- La base NO tenía tabla de comunas (viven en public/codigos_territoriales.csv y public/comunas.geojson,
-- que el front lee tal cual). A partir de aquí, cualquier tabla que necesite un CUT lo toma de ESTA
-- tabla con una FK a comunas(cut). El CUT es char(5): texto de 5 dígitos, jamás número.
-- Se siembra desde el ETL (etl/permisos/seed.py), no desde esta migración.
--
-- GEOMETRÍA: geom es SIEMPRE válida (CHECK). Si la fuente trae una geometría inválida (al 2026-10-16:
-- 13110 La Florida y 06204 Marchihue, auto-intersección), set_comuna_geometry() la repara con
-- ST_MakeValid + ST_CollectionExtract(…, 3), guarda la ORIGINAL en geom_original (solo cuando hubo
-- reparación; NULL = geom es idéntica a la original) y deja una fila en comuna_geom_repairs. Si el
-- área reparada difiere más del umbral configurable, queda geom_status = 'needs_review'.
create table if not exists public.comunas (
  cut            char(5) primary key check (cut ~ '^[0-9]{5}$'),
  name           text not null check (btrim(name) <> ''),
  name_norm      text not null check (btrim(name_norm) <> ''),   -- minúsculas, sin tildes, para cruzar por nombre
  region_cut     char(2) not null check (region_cut ~ '^[0-9]{2}$'),
  region_name    text not null,
  province_cut   char(3) not null check (province_cut ~ '^[0-9]{3}$'),
  province_name  text not null,
  geom           geometry(MultiPolygon, 4326),     -- válida o NULL; 12202 Antártica no tiene polígono (tiene datos, no geometría)
  geom_original  geometry(Geometry, 4326),         -- tal como llegó, SOLO si hubo que repararla
  geom_status    text not null default 'absent' check (geom_status in ('ok', 'repaired', 'needs_review', 'absent')),
  geom_source    text,
  created_at     timestamptz not null default now(),
  constraint comunas_cut_prefix check (left(cut, 2) = region_cut and left(cut, 3) = province_cut),
  constraint comunas_geom_valid check (geom is null or ST_IsValid(geom)),
  constraint comunas_geom_status_coherent check (
    (geom_status = 'absent' and geom is null)
    or (geom_status in ('ok', 'repaired', 'needs_review'))),
  constraint comunas_region_name_uniq unique (region_cut, name_norm)
);
create index if not exists comunas_geom_gix on public.comunas using gist (geom);

create table if not exists public.comuna_geom_repairs (
  id               bigint generated always as identity primary key,
  cut              char(5) not null references public.comunas(cut) on delete cascade,
  repaired_at      timestamptz not null default now(),
  source           text,
  invalid_reason   text not null,                       -- ST_IsValidReason de la original
  method           text not null,
  area_original_m2 double precision,
  area_repaired_m2 double precision,
  area_diff_pct    numeric(10, 4),
  threshold_pct    numeric(10, 4) not null,
  status           text not null check (status in ('repaired', 'needs_review')),
  note             text
);
create index if not exists comuna_geom_repairs_cut_idx on public.comuna_geom_repairs (cut, repaired_at desc);

-- Fija (o reemplaza) la geometría de una comuna. Única puerta de escritura de comunas.geom.
create or replace function public.set_comuna_geometry(p_cut char(5), p_geom geometry, p_source text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_orig geometry; v_rep geometry; v_reason text;
  v_a0 float8; v_a1 float8; v_diff numeric; v_thr numeric; v_status text;
begin
  if not exists (select 1 from public.comunas where cut = p_cut) then
    raise exception 'comuna % no existe', p_cut using errcode = 'foreign_key_violation';
  end if;

  if p_geom is null then
    update public.comunas set geom = null, geom_original = null, geom_status = 'absent', geom_source = p_source where cut = p_cut;
    return jsonb_build_object('cut', p_cut, 'status', 'absent');
  end if;

  v_orig := ST_SetSRID(p_geom, 4326);

  v_thr := public.pipeline_setting('comunas.geom_repair_max_area_diff_pct');

  if ST_IsValid(v_orig) then
    -- válida pero sin superficie (p. ej. tres puntos alineados): no es un límite comunal utilizable
    if ST_IsEmpty(ST_CollectionExtract(v_orig, 3)) or ST_Area(v_orig::geography) <= 0 then
      update public.comunas set geom = null, geom_original = v_orig, geom_status = 'needs_review', geom_source = p_source where cut = p_cut;
      insert into public.comuna_geom_repairs (cut, source, invalid_reason, method, threshold_pct, status, note)
      values (p_cut, p_source, 'geometría válida pero de área cero', 'ninguno', v_thr, 'needs_review', 'no es un polígono con superficie');
      return jsonb_build_object('cut', p_cut, 'status', 'needs_review', 'reason', 'zero_area');
    end if;
    update public.comunas
       set geom = ST_Multi(ST_CollectionExtract(v_orig, 3)), geom_original = null, geom_status = 'ok', geom_source = p_source
     where cut = p_cut;
    return jsonb_build_object('cut', p_cut, 'status', 'ok');
  end if;

  v_reason := ST_IsValidReason(v_orig);
  v_rep    := ST_CollectionExtract(ST_MakeValid(v_orig), 3);       -- solo polígonos
  if v_rep is null or ST_IsEmpty(v_rep) then
    -- no quedó ningún polígono: no hay nada que mostrar; se conserva la original para revisión manual
    update public.comunas set geom = null, geom_original = v_orig, geom_status = 'needs_review', geom_source = p_source where cut = p_cut;
    insert into public.comuna_geom_repairs (cut, source, invalid_reason, method, threshold_pct, status, note)
    values (p_cut, p_source, v_reason, 'ST_MakeValid+ST_CollectionExtract(3)', v_thr, 'needs_review', 'la reparación no dejó ningún polígono');
    return jsonb_build_object('cut', p_cut, 'status', 'needs_review', 'reason', 'empty_after_repair');
  end if;

  v_rep  := ST_Multi(v_rep);
  v_a0   := ST_Area(v_orig::geography);
  v_a1   := ST_Area(v_rep::geography);
  v_diff := case when v_a0 > 0 then round((abs(v_a1 - v_a0) / v_a0 * 100)::numeric, 4) end;
  v_status := case when v_diff is not null and v_diff <= v_thr then 'repaired' else 'needs_review' end;

  -- Aun en needs_review se publica la geometría reparada (válida) para que la comuna se dibuje,
  -- pero marcada: la decisión final es humana. La original queda guardada.
  update public.comunas
     set geom = v_rep, geom_original = v_orig, geom_status = v_status, geom_source = p_source
   where cut = p_cut;
  insert into public.comuna_geom_repairs
    (cut, source, invalid_reason, method, area_original_m2, area_repaired_m2, area_diff_pct, threshold_pct, status)
  values (p_cut, p_source, v_reason, 'ST_MakeValid+ST_CollectionExtract(3)', v_a0, v_a1, v_diff, v_thr, v_status);

  return jsonb_build_object('cut', p_cut, 'status', v_status, 'area_diff_pct', v_diff, 'reason', v_reason);
end $$;

-- Lo que requiere mirada humana
create or replace view public.comunas_geom_review_v with (security_invoker = true) as
select c.cut, c.name, c.geom_status, c.geom_source,
       r.invalid_reason, r.area_diff_pct, r.threshold_pct, r.repaired_at
  from public.comunas c
  left join lateral (
    select * from public.comuna_geom_repairs x where x.cut = c.cut order by x.repaired_at desc limit 1
  ) r on true
 where c.geom_status = 'needs_review';

-- El archivo MINVU trae NOMBRE de comuna, no CUT, y con grafías distintas a la tabla oficial
-- ("Coyhaique" vs "Coihaique"). El cruce se hace por (región, nombre normalizado) y cada
-- excepción queda escrita aquí con su motivo; lo que no calce se RECHAZA y se reporta, nunca se adivina.
create table if not exists public.comuna_name_aliases (
  id               bigint generated always as identity primary key,
  source_id        uuid not null references public.data_sources(id) on delete cascade,
  raw_region_norm  text not null default '',
  raw_name_norm    text not null check (btrim(raw_name_norm) <> ''),
  cut              char(5) not null references public.comunas(cut),
  reason           text not null check (btrim(reason) <> ''),
  created_by       text,
  created_at       timestamptz not null default now(),
  constraint comuna_name_aliases_uniq unique (source_id, raw_region_norm, raw_name_norm)
);

-- -----------------------------------------------------------------------------
-- 5. Frescura
-- -----------------------------------------------------------------------------
-- Un período nuevo se espera a: fin del último período + cadencia + rezago + holgura.
-- Pasada esa fecha la fuente figura 'stale' aunque su URL siga respondiendo.
create or replace view public.source_freshness_v with (security_invoker = true) as
with loaded as (
  select source_id,
         max(period_end)    as last_period_end,
         max(captured_at)   as last_captured_at,
         max(declared_date) as last_declared_date
    from public.source_snapshots
   where status in ('loaded', 'superseded')
   group by source_id
), checks as (
  select source_id, max(checked_at) as last_checked_at
    from public.source_checks
   group by source_id
)
select d.id as source_id, d.source_key, d.dataset, d.name, d.publisher, d.landing_url,
       d.license_label, d.license_url, d.attribution,
       d.verification_status, d.verified_at, d.scope_note, d.access_mode,
       l.last_period_end, l.last_captured_at, l.last_declared_date, c.last_checked_at,
       (l.last_period_end + (d.cadence_days + d.publication_lag_days + d.grace_days)) as overdue_since,
       case
         when l.last_period_end is null then 'never_loaded'
         when current_date > l.last_period_end + (d.cadence_days + d.publication_lag_days + d.grace_days) then 'stale'
         else 'fresh'
       end as freshness_status,
       (c.last_checked_at is null or c.last_checked_at < now() - make_interval(days => d.check_every_days * 2)) as check_overdue
  from public.data_sources d
  left join loaded l on l.source_id = d.id
  left join checks c on c.source_id = d.id
 where d.is_active;

-- Abre/cierra alertas según la vista. La corre pg_cron una vez al día.
create or replace function public.raise_freshness_alerts()
returns int language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select * from public.source_freshness_v loop
    if r.freshness_status = 'stale' then
      insert into public.source_alerts (source_id, kind, detail)
      values (r.source_id, 'stale_period',
              format('último período %s; se esperaba uno nuevo desde %s', r.last_period_end, r.overdue_since))
      on conflict (source_id, kind) where closed_at is null do nothing;
    else
      update public.source_alerts set closed_at = now()
       where source_id = r.source_id and kind = 'stale_period' and closed_at is null;
    end if;
    if r.freshness_status = 'never_loaded' then
      insert into public.source_alerts (source_id, kind, detail)
      values (r.source_id, 'never_loaded', 'la fuente no tiene ningún snapshot cargado')
      on conflict (source_id, kind) where closed_at is null do nothing;
    else
      update public.source_alerts set closed_at = now()
       where source_id = r.source_id and kind = 'never_loaded' and closed_at is null;
    end if;
    if r.check_overdue then
      insert into public.source_alerts (source_id, kind, detail)
      values (r.source_id, 'check_overdue', format('sin revisión registrada desde %s', coalesce(r.last_checked_at::text, 'nunca')))
      on conflict (source_id, kind) where closed_at is null do nothing;
    else
      update public.source_alerts set closed_at = now()
       where source_id = r.source_id and kind = 'check_overdue' and closed_at is null;
    end if;
  end loop;
  return (select count(*) from public.source_alerts where closed_at is null)::int;
end $$;

-- Diaria; cron.schedule con un nombre existente lo reemplaza (re-aplicar es seguro).
select cron.schedule('check-source-freshness', '41 6 * * *', $$ select public.raise_freshness_alerts(); $$);

-- -----------------------------------------------------------------------------
-- 6. Fuentes iniciales (HIPÓTESIS de cadencia/rezago hasta medirlas 3+ meses)
-- -----------------------------------------------------------------------------
-- verification_status refleja lo que de verdad se probó, no lo que se espera:
--   minvu: estructura y cuadres COMPROBADOS sobre los dos XLSX publicados el 2026-09-11 (SHA-256 en
--          verification_note; verificados por el usuario y por la sesión de diseño). La LICENCIA sigue
--          pendiente (P5: los archivos no la traen).
--   ine:   nada comprobado.
--   seia:  servicio ArcGIS REST COMPROBADO por el usuario el 2026-10-16 desde otro entorno.
insert into public.data_sources
  (source_key, dataset, name, publisher, landing_url, data_url, license_label, attribution, access_mode,
   cadence_days, publication_lag_days, grace_days, check_every_days,
   verification_status, verified_at, verification_note, scope_note)
values
  ('minvu_cedoc_permisos_anual', 'building_permits',
   'MINVU CEDOC — Permisos de edificación: viviendas por comuna y año',
   'MINVU — Centro de Estudios de Ciudad y Territorio (CEDOC)',
   'https://centrodeestudios.minvu.gob.cl/repositorio/categoria/permisos-de-edificacion/',
   null,
   'Uso autorizado citando la fuente (por confirmar en el sitio: los archivos no traen licencia)',
   'Fuente: MINVU, Centro de Estudios de Ciudad y Territorio (CEDOC)',
   'manual', 30, 75, 15, 7,
   'comprobado', date '2026-10-16',
   'Archivo "PE Viviendas unidades y superficie según año y comuna 2002 a jul 2026" (publicado 2026-09-11), SHA-256 158af0e4af401a909b6d30dfb4860b1f77c7a608c35c67d42a0bb2503b4705b7. 6 hojas (número/m2 x total/casas/departamentos), 367 filas de comuna (346 + 21 de Ñuble duplicadas), fila "Total País" que cuadra con la suma de comunas en todas las columnas. Años 2002-2025 anuales; 2026 en meses (idéntico al archivo mensual). Sin CUT: solo nombres. catalogo.minvu.cl corta TLS desde nubes: descarga manual / IP chilena. Licencia pendiente (P5).',
   'Solo vivienda (casas y departamentos). No incluye no vivienda. Definitivo hasta 2024; 2025 en adelante preliminar (difiere del INE según la nota del archivo).'),
  ('minvu_cedoc_permisos_mensual', 'building_permits',
   'MINVU CEDOC — Permisos de edificación: viviendas por comuna y mes',
   'MINVU — Centro de Estudios de Ciudad y Territorio (CEDOC)',
   'https://centrodeestudios.minvu.gob.cl/repositorio/categoria/permisos-de-edificacion/',
   null,
   'Uso autorizado citando la fuente (por confirmar en el sitio: los archivos no traen licencia)',
   'Fuente: MINVU, Centro de Estudios de Ciudad y Territorio (CEDOC)',
   'manual', 30, 75, 15, 7,
   'comprobado', date '2026-10-16',
   'Archivo "PE Viviendas unidades y superficie según mes y comuna 2002 a jul 2026" (publicado 2026-09-11), SHA-256 5f9a63ac993ea217aa4495224d54d29713dc5ebb787704fe211b7d575bd94e6c. Mismas 6 hojas y filas que el anual; 295 columnas de mes (2002-ene a 2026-jul) con el año en la fila 6 (celda combinada de 12) y los meses en la fila 7. La suma de los meses de cada comuna y año coincide con el archivo anual (0 diferencias en las 6 hojas). La hoja m2_casas declara 65.536 filas (formato basura).',
   'Solo vivienda. Definitivo hasta 2024; 2025 en adelante preliminar.'),
  ('ine_permisos_superficie', 'building_permits',
   'INE — Permisos de edificación: superficie autorizada',
   'Instituto Nacional de Estadísticas (INE)',
   'https://www.ine.gob.cl/estadisticas/economia/edificacion-y-construccion/permisos-de-edificacion',
   null,
   null,
   'Fuente: Instituto Nacional de Estadísticas (INE)',
   'manual', 30, 45, 15, 7,
   'documentado', null,
   'NO SE CARGA por ahora (decisión del usuario). Incluye no vivienda (destino). Desde 2020-12-30 sin número de permiso ni de recepción final (secreto estadístico, Ley 17.374 art. 29). Archivo, campos y grano comunal NO comprobados.',
   'Superficie autorizada en m2; bases provisorias.'),
  ('seia_proyectos_eia', 'building_projects',
   'SEA — Proyectos SEIA: Estudios de Impacto Ambiental (EIA)',
   'Servicio de Evaluación Ambiental (SEA)',
   'https://seia.sea.gob.cl/busqueda/buscarProyecto.php',
   'https://arcgisv11.sea.gob.cl/server/rest/services/WEBServices/ProyectosSEIA/MapServer/1',
   null,
   'Fuente: Servicio de Evaluación Ambiental (SEA), e-SEIA',
   'automatic', 7, 0, 7, 7,
   'comprobado', date '2026-10-16',
   'Servicio ArcGIS REST público, capa 1 (1.594 registros el 2026-10-16). Comprobado por el usuario desde otro entorno; no re-verificable desde la sesión de diseño (proxy bloquea el host).',
   'Solo proyectos que ingresan al SEIA. FECHA_CALIFICACION no es permiso de edificación ni inicio de obras. INVERSION_US es declarada.'),
  ('seia_proyectos_dia', 'building_projects',
   'SEA — Proyectos SEIA: Declaraciones de Impacto Ambiental (DIA)',
   'Servicio de Evaluación Ambiental (SEA)',
   'https://seia.sea.gob.cl/busqueda/buscarProyecto.php',
   'https://arcgisv11.sea.gob.cl/server/rest/services/WEBServices/ProyectosSEIA/MapServer/2',
   null,
   'Fuente: Servicio de Evaluación Ambiental (SEA), e-SEIA',
   'automatic', 7, 0, 7, 7,
   'comprobado', date '2026-10-16',
   'Servicio ArcGIS REST público, capa 2 (28.408 registros el 2026-10-16), maxRecordCount 2000 con paginación. Comprobado por el usuario desde otro entorno.',
   'Solo proyectos que ingresan al SEIA. FECHA_CALIFICACION no es permiso de edificación ni inicio de obras. INVERSION_US es declarada.')
on conflict (source_key) do nothing;

-- -----------------------------------------------------------------------------
-- 7. RLS (coherente con territorial_* y layer_nodes: lee autenticado, escribe admin)
-- -----------------------------------------------------------------------------
alter table public.pipeline_settings    enable row level security;
alter table public.data_sources         enable row level security;
alter table public.source_snapshots     enable row level security;
alter table public.source_checks        enable row level security;
alter table public.source_alerts        enable row level security;
alter table public.comunas              enable row level security;
alter table public.comuna_geom_repairs  enable row level security;
alter table public.comuna_name_aliases  enable row level security;

drop policy if exists pipeline_settings_read on public.pipeline_settings;
create policy pipeline_settings_read on public.pipeline_settings for select to authenticated using (true);
drop policy if exists pipeline_settings_write on public.pipeline_settings;
create policy pipeline_settings_write on public.pipeline_settings for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists data_sources_read on public.data_sources;
create policy data_sources_read on public.data_sources for select to authenticated using (true);
drop policy if exists data_sources_write on public.data_sources;
create policy data_sources_write on public.data_sources for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists source_snapshots_read on public.source_snapshots;
create policy source_snapshots_read on public.source_snapshots for select to authenticated using (true);
drop policy if exists source_snapshots_write on public.source_snapshots;
create policy source_snapshots_write on public.source_snapshots for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists source_checks_read on public.source_checks;
create policy source_checks_read on public.source_checks for select to authenticated using (true);
drop policy if exists source_checks_write on public.source_checks;
create policy source_checks_write on public.source_checks for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists source_alerts_read on public.source_alerts;
create policy source_alerts_read on public.source_alerts for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

drop policy if exists comunas_read on public.comunas;
create policy comunas_read on public.comunas for select to authenticated using (true);
-- comunas NO tiene política de escritura para usuarios: la geometría solo entra por set_comuna_geometry()
-- (service_role / ETL), que valida y deja registro.

drop policy if exists comuna_geom_repairs_read on public.comuna_geom_repairs;
create policy comuna_geom_repairs_read on public.comuna_geom_repairs for select to authenticated using (true);

drop policy if exists comuna_name_aliases_read on public.comuna_name_aliases;
create policy comuna_name_aliases_read on public.comuna_name_aliases for select to authenticated using (true);
drop policy if exists comuna_name_aliases_write on public.comuna_name_aliases;
create policy comuna_name_aliases_write on public.comuna_name_aliases for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

revoke all on public.pipeline_settings, public.data_sources, public.source_snapshots, public.source_checks,
              public.source_alerts, public.comunas, public.comuna_geom_repairs, public.comuna_name_aliases,
              public.source_freshness_v, public.comunas_geom_review_v from anon;
grant select on public.source_freshness_v, public.comunas_geom_review_v to authenticated;
-- Data API: desde el 2026-10-30 Supabase ya no concede permisos automáticos sobre tablas nuevas de public; se declaran aquí (anon sigue sin acceso).
grant select on public.pipeline_settings, public.data_sources, public.source_snapshots, public.source_checks, public.source_alerts, public.comunas, public.comuna_geom_repairs, public.comuna_name_aliases to authenticated;
grant all on public.pipeline_settings, public.data_sources, public.source_snapshots, public.source_checks, public.source_alerts, public.comunas, public.comuna_geom_repairs, public.comuna_name_aliases, public.source_freshness_v, public.comunas_geom_review_v to service_role;
grant insert, update, delete on public.pipeline_settings, public.data_sources, public.source_snapshots, public.source_checks, public.comuna_name_aliases to authenticated;  -- solo las admite la política *_write (admin)

revoke all on function public.raise_freshness_alerts() from public, anon, authenticated;
grant execute on function public.raise_freshness_alerts() to service_role;
revoke all on function public.set_comuna_geometry(char, geometry, text) from public, anon, authenticated;
grant execute on function public.set_comuna_geometry(char, geometry, text) to service_role;
revoke all on function public.pipeline_setting(text) from public, anon;
grant execute on function public.pipeline_setting(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 8. Bucket privado para el archivo ORIGINAL (mismo patrón que territorial-sources)
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('source-snapshots', 'source-snapshots', false)
on conflict (id) do nothing;

drop policy if exists "Admins read source snapshots" on storage.objects;
create policy "Admins read source snapshots" on storage.objects
  for select to authenticated
  using (bucket_id = 'source-snapshots' and private.has_role(auth.uid(), 'admin'::app_role));
drop policy if exists "Admins upload source snapshots" on storage.objects;
create policy "Admins upload source snapshots" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'source-snapshots' and private.has_role(auth.uid(), 'admin'::app_role));
-- Sin UPDATE ni DELETE para usuarios: el original capturado no se reescribe ni se borra desde la app.

-- -----------------------------------------------------------------------------
-- 9. Auditoría final: nada previo cambió
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
    ) a using (t)
   where a.n <> b.n;
  if v_bad is not null then
    raise exception 'Guardrail: cambiaron conteos de tablas existentes (%)', v_bad;
  end if;
  if (select count(*) from public.data_sources where source_key in
        ('minvu_cedoc_permisos_anual','minvu_cedoc_permisos_mensual','ine_permisos_superficie','seia_proyectos_eia','seia_proyectos_dia')) <> 5 then
    raise exception 'Guardrail: faltan fuentes iniciales en data_sources';
  end if;
  if (select count(*) from public.pipeline_settings) < 6 then
    raise exception 'Guardrail: faltan umbrales en pipeline_settings';
  end if;
end $$;

insert into public._migration_log (sprint, notes) values ('permits_provenance_v1', 'done');
