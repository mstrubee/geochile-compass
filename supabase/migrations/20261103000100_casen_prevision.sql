-- =============================================================================
-- PROPUESTA (NO APLICADA) — Salud, Fase 1b (2/3): CASEN 2024, sistema previsional de salud por REGIÓN (Estimada, con error muestral)
-- =============================================================================
-- Diseño: docs/salud/DISENO.md §3.5. SOLO regional (D6): la CASEN no es representativa a nivel comunal y aquí no existe ninguna tabla comunal.
--   casen_prevision_stage      zona de paso (UNLOGGED): una fila por (región, sistema) con TODAS las estimaciones y sus errores
--   casen_prevision_region     lo PUBLICADO: estimación, error estándar e intervalo de confianza del 95 % SOLO si la estimación es publicable
--                              (≥ 60 casos muestrales y no «no fiable» según las notas del tabulado oficial); si no, los valores van en NULL con su motivo
--   publish_casen_snapshot()   único camino (SECURITY DEFINER, todo-o-nada): cuadra personas y población expandida contra el tabulado oficial y re-valida
--   get_casen_prevision_region()  lectura (SECURITY INVOKER) con su procedencia
-- Nivel (regla 9): ESTIMADA — se muestra SIEMPRE como rango (intervalo de confianza), nunca como cifra puntual. Sello: Estimado. client_ready = false (licencia sin confirmar).
-- No se guarda ninguna fila de persona: solo agregados regionales. Fonasa NO se usa como proporción comunal (regla 8) ni se suma con Isapre ni con el Censo.
--
-- Requiere partes 1–4 de permisos/proyectos (data_sources, source_snapshots). SOLO ADITIVA. Rollback: supabase/rollbacks/20261103000100_casen_prevision_down.sql
-- =============================================================================

-- Guardrail de transacción: esta migración depende de UNA sola transacción (tablas temporales ON COMMIT DROP, advisory lock de transacción y SET LOCAL).
-- Debe correr con `psql -1 -v ON_ERROR_STOP=1 -f …`. Sin -1 cada sentencia sería su propia transacción, la tabla de prueba se borraría al terminar su sentencia y esto falla de inmediato.
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

insert into public._migration_log (sprint, notes) values ('casen_prevision_v1', 'start');

do $$
begin
  if to_regclass('public.data_sources') is null or to_regclass('public.source_snapshots') is null or to_regclass('public.pipeline_settings') is null then
    raise exception 'Guardrail: faltan las partes de permisos/proyectos (data_sources, source_snapshots, pipeline_settings); aplicarlas primero';
  end if;
end $$;

drop table if exists pg_temp._casen_counts_before;
create temp table _casen_counts_before on commit drop as
  select 'layer_nodes'::text as t, count(*)::bigint as n from public.layer_nodes
  union all select 'territorial_layers', count(*) from public.territorial_layers
  union all select 'territorial_features', count(*) from public.territorial_features
  union all select 'comunas', count(*) from public.comunas
  union all select 'source_snapshots', count(*) from public.source_snapshots
  union all select 'data_sources_other', count(*) from public.data_sources where source_key <> 'mds_casen_2024_nacional';

insert into public.pipeline_settings (key, value, description) values
  ('casen.min_cases',          60,   'Casos muestrales mínimos para publicar una estimación CASEN (nota técnica b del tabulado oficial). VALOR OFICIAL.'),
  ('casen.min_df',             30,   'Grados de libertad mínimos (conglomerados − estratos) para publicar un intervalo de confianza.'),
  ('casen.max_diff_official',  0.001,'Diferencia máxima (puntos porcentuales) entre la estimación propia y la del tabulado oficial, y entre el error estándar propio y el oficial, para poder publicar.')
on conflict (key) do nothing;

insert into public.data_sources
  (source_key, dataset, name, publisher, landing_url, data_url, license_label, attribution, access_mode,
   cadence_days, publication_lag_days, grace_days, check_every_days,
   verification_status, verified_at, verification_note, scope_note)
values
  ('mds_casen_2024_nacional', 'casen_prevision',
   'Encuesta Casen 2024 — sistema previsional de salud por región (estimación propia con error muestral)',
   'Ministerio de Desarrollo Social y Familia (Observatorio Social)',
   'https://observatorio.ministeriodesarrollosocial.gob.cl/encuesta-casen-2024',
   'https://observatorio.ministeriodesarrollosocial.gob.cl/storage/docs/casen/2024/casen_2024.sav',
   null,
   'Fuente: Ministerio de Desarrollo Social y Familia, Encuesta Casen 2024 (estimaciones propias a partir de la base de datos)',
   'manual', 730, 240, 120, 60,
   'comprobado', date '2026-10-18',
   'Base casen_2024.sav descargada y leída el 2026-10-18: 749.656.107 bytes, SHA-256 ac2d48b5c0b17f6e9c9744dd55853d1021248e2d985d173871338abfe3c8758f, Last-Modified 2026-06-10, 218.367 personas, 16 regiones. Tabulado oficial Salud_Casen_2024.xlsx (1.855.192 bytes, SHA-256 bbb36105bb3c9549cf6a215acf5642b97aaae6b40fa3f70ec3f8cdb5959a4286): la estimación, el error estándar y los casos muestrales PROPIOS coinciden con los del tabulado (diferencia máxima 3·10^-6 pp en la estimación, 3·10^-8 pp en el error, 0 casos); personas y población expandida por región cuadran exactamente con las filas «Total». LICENCIA NO DECLARADA en lo leído: por confirmar. Fechas exactas del trabajo de campo [NO COMPROBADO]: el período se registra como el año 2024.',
   'Estimación por REGIÓN (la CASEN es representativa a nivel nacional, por área y regional; NO comunal: no existe ni se calcula nada comunal). Declaración de las personas, no registro administrativo: no se compara ni se suma con Fonasa, Isapre ni Censo (regla 8). Factores calibrados con la proyección de población base Censo 2017. Quedan excluidas comunas completas o parte de ellas (Ollagüe, Juan Fernández, áreas de General Lagos, Colchane, Tortel y Cabo de Hornos) y la Antártica. No se publica una estimación con menos de 60 casos muestrales ni una que las notas oficiales declaren no fiable. El error estándar y el intervalo del 95 % son cálculo propio por linealización de Taylor con el diseño muestral (estratos y conglomerados de varianza), contrastado con el tabulado oficial.')
on conflict (source_key) do nothing;

create unlogged table if not exists public.casen_prevision_stage (
  snapshot_n    integer  not null,
  region_cut    text     not null,
  sistema       text     not null,
  n_sample      integer  not null,
  pct           double precision not null,
  se            double precision not null,
  ci_lo         double precision not null,
  ci_hi         double precision not null,
  n_psu         integer  not null,
  n_strata      integer  not null,
  df            integer  not null,
  publishable   boolean  not null,
  reason        text,
  official_pct  double precision,
  official_se   double precision,
  official_n    integer,
  lonely_strata integer not null default 0          -- estratos con UN solo conglomerado: su varianza no se puede estimar (el ETL los descarta del cálculo); publicar se niega si hay alguno
);

create table if not exists public.casen_prevision_region (
  snapshot_n    integer  not null,
  region_cut    char(2)  not null check (region_cut ~ '^[0-9]{2}$'),
  sistema       text     not null check (sistema in ('fonasa', 'isapre', 'ffaa', 'ninguno', 'otro', 'nosabe')),
  publishable   boolean  not null,
  reason        text,
  n_sample      integer  check (n_sample is null or n_sample = 0 or n_sample >= 5),     -- NULL = «<5» (regla 5: ningún conteo de personas de 1 a 4 se publica)
  pct           numeric(9, 6) check (pct is null or pct between 0 and 100),
  se            numeric(9, 6) check (se is null or se >= 0),
  ci_lo         numeric(9, 6) check (ci_lo is null or ci_lo between 0 and 100),
  ci_hi         numeric(9, 6) check (ci_hi is null or ci_hi between 0 and 100),
  df            integer,
  official_pct  numeric(9, 6),
  constraint casen_prevision_region_pk primary key (snapshot_n, region_cut, sistema),
  constraint casen_publicable_coherente check (
    (publishable and pct is not null and se is not null and ci_lo is not null and ci_hi is not null and ci_lo <= pct and pct <= ci_hi and df is not null and reason is null)
    or (not publishable and pct is null and se is null and ci_lo is null and ci_hi is null and official_pct is null and reason is not null))
);
comment on table public.casen_prevision_region is 'CASEN 2024, sistema previsional de salud por REGIÓN: ESTIMADA (rango con IC 95 %). Solo regional (D6). Valores en NULL cuando la estimación no es publicable (< 60 casos o no fiable según nota oficial).';

create or replace function public.publish_casen_snapshot(p_snapshot_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_snap public.source_snapshots%rowtype; v_key text; v_n int; v_rep jsonb; v_min int; v_mindf int; v_tol numeric; v_keep int; v_old record; v_removed int := 0; v_bad text; v_report jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('salud_publish'));
  select * into v_snap from public.source_snapshots where id = p_snapshot_id for update;
  if not found then raise exception 'snapshot % no existe', p_snapshot_id; end if;
  select source_key into v_key from public.data_sources where id = v_snap.source_id;
  if v_key is distinct from 'mds_casen_2024_nacional' then raise exception 'el snapshot es de %, no de CASEN', v_key; end if;
  if v_snap.status <> 'validated' then raise exception 'el snapshot está en estado % (debe ser validated)', v_snap.status; end if;
  v_n := v_snap.n;
  if exists (select 1 from public.source_snapshots where source_id = v_snap.source_id and status = 'loaded' and period_end > v_snap.period_end) then
    raise exception 'ya hay un período más nuevo publicado; no se publica uno más viejo';
  end if;
  v_min := public.pipeline_setting('casen.min_cases')::int; v_mindf := public.pipeline_setting('casen.min_df')::int; v_tol := public.pipeline_setting('casen.max_diff_official');

  -- forma: 16 regiones × 6 sistemas, una vez cada uno
  if (select count(*) from public.casen_prevision_stage where snapshot_n = v_n) <> 96
     or exists (select 1 from public.casen_prevision_stage where snapshot_n = v_n group by region_cut, sistema having count(*) > 1)
     or (select count(distinct region_cut) from public.casen_prevision_stage where snapshot_n = v_n) <> 16
     or exists (select 1 from public.casen_prevision_stage where snapshot_n = v_n group by region_cut having count(*) <> 6) then
    raise exception 'la zona de paso debe traer 16 regiones × 6 sistemas, una vez cada uno';
  end if;
  if exists (select 1 from public.casen_prevision_stage where snapshot_n = v_n and (sistema not in ('fonasa', 'isapre', 'ffaa', 'ninguno', 'otro', 'nosabe') or region_cut !~ '^[0-9]{2}$'
             or pct < 0 or pct > 100 or se < 0 or n_sample < 0)) then
    raise exception 'valores fuera de dominio en la zona de paso';
  end if;

  -- cuadres (datos completos): personas = filas del archivo; Σ pct por región = 100; personas y población expandida por región = filas «Total» del tabulado oficial
  v_rep := v_snap.validation_report;
  if (select sum(n_sample) from public.casen_prevision_stage where snapshot_n = v_n) <> v_snap.row_count_raw then
    raise exception 'cuadre de personas: Σ casos % <> filas del archivo %', (select sum(n_sample) from public.casen_prevision_stage where snapshot_n = v_n), v_snap.row_count_raw;
  end if;
  if exists (select 1 from public.casen_prevision_stage where snapshot_n = v_n group by region_cut having abs(sum(pct) - 100) > 0.0001) then
    raise exception 'cuadre: la suma de los porcentajes de una región no es 100';
  end if;
  if v_rep -> 'official_totals' is null then raise exception 'falta official_totals en el reporte del snapshot (el cuadre con el tabulado es obligatorio)'; end if;
  for v_old in select region_cut, sum(n_sample)::numeric as got from public.casen_prevision_stage where snapshot_n = v_n group by region_cut loop
    if (v_rep -> 'official_totals' -> v_old.region_cut ->> 'n')::numeric is distinct from v_old.got then
      raise exception 'cuadre con los casos muestrales totales del tabulado oficial (región %): publicado %, cargado %', v_old.region_cut, v_rep -> 'official_totals' -> v_old.region_cut ->> 'n', v_old.got;
    end if;
  end loop;
  -- contraste con el tabulado oficial: estimación, ERROR ESTÁNDAR y casos propios = oficiales (misma tolerancia, en puntos porcentuales)
  if exists (select 1 from public.casen_prevision_stage where snapshot_n = v_n and (official_pct is null or abs(pct - official_pct) > v_tol or official_n is distinct from n_sample)) then
    raise exception 'la estimación propia difiere del tabulado oficial en más de % pp (o falta el contraste)', v_tol;
  end if;
  if exists (select 1 from public.casen_prevision_stage where snapshot_n = v_n and (official_se is null or abs(se - official_se) > v_tol)) then
    raise exception 'el error estándar propio difiere del tabulado oficial en más de % pp (o falta el contraste)', v_tol;
  end if;
  -- un estrato con un solo conglomerado no aporta varianza: el error estándar quedaría subestimado en silencio. No se publica.
  if exists (select 1 from public.casen_prevision_stage where snapshot_n = v_n and lonely_strata > 0) then
    raise exception 'hay estratos con un solo conglomerado (% estimaciones afectadas): el error muestral estaría subestimado; no se publica', (select count(*) from public.casen_prevision_stage where snapshot_n = v_n and lonely_strata > 0);
  end if;
  -- publicable = >= mínimo de casos, df suficiente y no «no fiable»; si no, NULL
  if exists (select 1 from public.casen_prevision_stage where snapshot_n = v_n and publishable and (n_sample < v_min or df < v_mindf or ci_lo > pct or ci_hi < pct)) then
    raise exception 'una estimación marcada publicable no cumple el mínimo de casos, los grados de libertad o el orden del intervalo';
  end if;
  if exists (select 1 from public.casen_prevision_stage where snapshot_n = v_n and not publishable and reason is null) then
    raise exception 'toda estimación no publicable debe traer su motivo';
  end if;

  insert into public.casen_prevision_region (snapshot_n, region_cut, sistema, publishable, reason, n_sample, pct, se, ci_lo, ci_hi, df, official_pct)
    select snapshot_n, region_cut, sistema, publishable, case when publishable then null else reason end, case when n_sample between 1 and 4 then null else n_sample end,
           case when publishable then pct end, case when publishable then se end, case when publishable then ci_lo end, case when publishable then ci_hi end,
           case when publishable then df end, case when publishable then official_pct end
      from public.casen_prevision_stage where snapshot_n = v_n;

  update public.source_snapshots set status = 'superseded' where source_id = v_snap.source_id and status = 'loaded' and id <> p_snapshot_id;
  update public.source_snapshots set status = 'loaded', loaded_at = now() where id = p_snapshot_id;
  v_keep := greatest(public.pipeline_setting('retention.keep_snapshots')::int, 1);
  for v_old in select s.n from public.source_snapshots s where s.source_id = v_snap.source_id and s.status in ('loaded', 'superseded') order by s.period_end desc, s.n desc offset v_keep loop
    delete from public.casen_prevision_region where snapshot_n = v_old.n;
    v_removed := v_removed + 1;
  end loop;
  if exists (select 1 from public.casen_prevision_stage where snapshot_n <> v_n) then delete from public.casen_prevision_stage where snapshot_n = v_n; else truncate public.casen_prevision_stage; end if;

  v_report := jsonb_build_object('rows', (select count(*) from public.casen_prevision_region where snapshot_n = v_n),
    'publishable', (select count(*) from public.casen_prevision_region where snapshot_n = v_n and publishable),
    'not_publishable', (select count(*) from public.casen_prevision_region where snapshot_n = v_n and not publishable), 'old_snapshots_cleared', v_removed);
  update public.source_snapshots set validation_report = validation_report || jsonb_build_object('publish', v_report) where id = p_snapshot_id;
  return v_report;
end $$;

create or replace function public._casen_current_snapshot()
returns table (snapshot_n integer, snapshot_id uuid, period_start date, period_end date, declared_date date, captured_at timestamptz)
language sql stable set search_path = public as $$
  select s.n, s.id, s.period_start, s.period_end, s.declared_date, s.captured_at
    from public.source_snapshots s join public.data_sources d on d.id = s.source_id
   where d.source_key = 'mds_casen_2024_nacional' and s.status = 'loaded' order by s.period_end desc, s.n desc limit 1
$$;

-- Por región y sistema: estimación e intervalo de confianza del 95 % (NULL si no es publicable, con su motivo). Región con su nombre desde `comunas`.
create or replace function public.get_casen_prevision_region()
returns table (region_cut char(2), region_name text, sistema text, publishable boolean, reason text, n_sample integer, pct numeric, se numeric, ci_lo numeric, ci_hi numeric,
               snapshot_id uuid, period_end date)
language sql stable security invoker set search_path = public as $$
  select r.region_cut, (select min(c.region_name) from public.comunas c where c.region_cut = r.region_cut), r.sistema, r.publishable, r.reason, r.n_sample,
         r.pct, r.se, r.ci_lo, r.ci_hi, cs.snapshot_id, cs.period_end
    from public._casen_current_snapshot() cs join public.casen_prevision_region r on r.snapshot_n = cs.snapshot_n
   order by r.region_cut, case r.sistema when 'fonasa' then 1 when 'isapre' then 2 when 'ffaa' then 3 when 'ninguno' then 4 when 'otro' then 5 else 6 end
$$;

alter table public.casen_prevision_stage  enable row level security;
alter table public.casen_prevision_region enable row level security;
drop policy if exists casen_prevision_read on public.casen_prevision_region;
create policy casen_prevision_read on public.casen_prevision_region for select to authenticated using (true);
revoke all on public.casen_prevision_stage, public.casen_prevision_region from anon;
revoke insert, update, delete, truncate on public.casen_prevision_region from authenticated;
revoke all on public.casen_prevision_stage from authenticated;
revoke all on function public.publish_casen_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.publish_casen_snapshot(uuid) to service_role;
revoke all on function public._casen_current_snapshot(), public.get_casen_prevision_region() from public, anon;
grant execute on function public._casen_current_snapshot(), public.get_casen_prevision_region() to authenticated, service_role;

do $$
declare v_bad text;
begin
  select string_agg(b.t || ': ' || b.n || ' -> ' || a.n, ', ') into v_bad
    from _casen_counts_before b
    join (
      select 'layer_nodes'::text as t, count(*)::bigint as n from public.layer_nodes
      union all select 'territorial_layers', count(*) from public.territorial_layers
      union all select 'territorial_features', count(*) from public.territorial_features
      union all select 'comunas', count(*) from public.comunas
      union all select 'source_snapshots', count(*) from public.source_snapshots
      union all select 'data_sources_other', count(*) from public.data_sources where source_key <> 'mds_casen_2024_nacional'
    ) a using (t)
   where a.n <> b.n;
  if v_bad is not null then raise exception 'Guardrail: cambiaron conteos de tablas existentes (%)', v_bad; end if;
end $$;

insert into public._migration_log (sprint, notes) values ('casen_prevision_v1', 'done');
