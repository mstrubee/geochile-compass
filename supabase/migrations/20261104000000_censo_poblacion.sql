-- =============================================================================
-- PROPUESTA (NO APLICADA) — Población comunal: UNA sola fuente trazable (Censo 2024, INE)
-- =============================================================================
-- Fuente: INE, Censo de Población y Vivienda 2024, tabulado «D1 Población censada por sexo y edad en grupos quinquenales».
--   «Población censada» = «cantidad total de residentes habituales censados» (definición del propio tabulado): NO es proyección ni estimación.
--   Hoja 2 (comuna) → poblacion_comunal · hoja 4 (comuna × grupo de edad quinquenal × sexo) → poblacion_comunal_edad (la penetración Isapre por edad y sexo la necesitará).
--   Licencia: CC BY-SA 4.0, declarada en los «Términos de Uso y Licencia de Datos Abiertos» del INE para el contenido de su sitio; el XLSX no la repite (ver verification_note).
--
--   poblacion_comunal_stage / _edad_stage  zona de paso (unlogged)
--   poblacion_comunal                      lo PUBLICADO: snapshot × comuna (CUT con FK a comunas): total, hombres, mujeres
--   poblacion_comunal_edad                 snapshot × comuna × grupo de edad (18 grupos): total, hombres, mujeres
--   publish_poblacion_snapshot()           único camino (SECURITY DEFINER, todo-o-nada): re-valida en la base los cuadres de la carga
--   _poblacion_current_snapshot() · get_poblacion_comunal() · get_poblacion_comunal_edad()   lectura (SECURITY INVOKER); anon sin acceso; authenticated solo lectura
--
-- PERÍODO (año del censo) ≠ FECHA DE PUBLICACIÓN (27-03-2025; tabla actualizada el 04-12-2025): se guardan por separado. Fechas exactas del levantamiento [NO COMPROBADO].
-- Requiere las partes de permisos/proyectos (data_sources, source_snapshots, comunas, pipeline_settings). SOLO ADITIVA.
-- Rollback: supabase/rollbacks/20261104000000_censo_poblacion_down.sql
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

select pg_advisory_xact_lock(hashtext('censo_poblacion_v1'));
set local statement_timeout = '5min';

insert into public._migration_log (sprint, notes) values ('censo_poblacion_v1', 'start');

do $$
begin
  if to_regclass('public.data_sources') is null or to_regclass('public.source_snapshots') is null or to_regclass('public.pipeline_settings') is null or to_regclass('public.comunas') is null then
    raise exception 'Guardrail: faltan las partes de permisos/proyectos (data_sources, source_snapshots, pipeline_settings, comunas); aplicarlas primero';
  end if;
end $$;

drop table if exists pg_temp._pob_counts_before;
create temp table _pob_counts_before on commit drop as
  select 'layer_nodes'::text as t, count(*)::bigint as n from public.layer_nodes
  union all select 'territorial_layers', count(*) from public.territorial_layers
  union all select 'territorial_features', count(*) from public.territorial_features
  union all select 'thematic_layers', count(*) from public.thematic_layers
  union all select 'comunas', count(*) from public.comunas
  union all select 'source_snapshots', count(*) from public.source_snapshots
  union all select 'data_sources_other', count(*) from public.data_sources where source_key <> 'ine_censo2024_poblacion_comunal';

-- -----------------------------------------------------------------------------
-- 1. Umbral de retención y fuente
-- -----------------------------------------------------------------------------
insert into public.pipeline_settings (key, value, description) values
  ('retention.keep_censo_snapshots', 2, 'Capturas de población censada cuyo contenido se conserva (por período; hoy solo el Censo 2024).')
on conflict (key) do nothing;

insert into public.data_sources
  (source_key, dataset, name, publisher, landing_url, data_url, license_label, license_url, attribution, access_mode,
   cadence_days, publication_lag_days, grace_days, check_every_days,
   verification_status, verified_at, verification_note, scope_note)
values
  ('ine_censo2024_poblacion_comunal', 'poblacion_censo2024',
   'Censo de Población y Vivienda 2024 — D1 Población censada por sexo y edad en grupos quinquenales (por comuna)',
   'Instituto Nacional de Estadísticas (INE)',
   'https://censo2024.ine.gob.cl/',
   'https://censo2024.ine.gob.cl/wp-content/uploads/2025/03/D1_Poblacion-censada-por-sexo-y-edad-en-grupos-quinquenales.xlsx',
   'Creative Commons Reconocimiento-CompartirIgual 4.0 Internacional (CC BY-SA 4.0)',
   'https://creativecommons.org/licenses/by-sa/4.0/deed.es_ES',
   'Fuente: INE, Censo de Población y Vivienda 2024, tabulado D1 «Población censada por sexo y edad en grupos quinquenales» (publicado el 27-03-2025; tabla actualizada el 04-12-2025). Cifras tal como las publica el INE; esta plataforma no las modifica.',
   'manual', 3650, 0, 365, 180,
   'comprobado', date '2026-10-18',
   'Archivo D1 descargado y leído el 2026-10-18: 505.437 bytes, SHA-256 1f3a9c97a1b3defa47a2fc3b8495688c4e08f164063cab704e7a18c41239e009, Last-Modified 2025-12-04, «Fecha de publicación: 27 de marzo, 2025» (hoja Nota), nota 2: tabla actualizada el 04-12-2025 por el cambio de nombre de la comuna de Paihuano. Hoja 2: 346 comunas, Σ = 18.480.432 = total país; hoja 4: 18 grupos por comuna cuadran con la hoja 2. LICENCIA: la página «Términos de Uso y Licencia de Datos Abiertos» del INE (https://www.ine.gob.cl/terminos-de-uso-y-licencia-de-datos-abiertos, leída el 2026-10-18) declara que «el contenido de este sitio Web se rige bajo una licencia de Creative Commons Reconocimiento-CompartirIgual 4.0 Internacional»; el XLSX no repite la licencia y esa página no nombra el subdominio censo2024.ine.gob.cl [NO COMPROBADO que el archivo esté cubierto expresamente]. CompartirIgual: quien adapte el material debe difundir sus contribuciones bajo la misma licencia, indicar los cambios y no sugerir que el INE realizó el análisis [NO COMPROBADO su alcance sobre informes de clientes: consultar].',
   'POBLACIÓN CENSADA = «cantidad total de residentes habituales censados» (definición del tabulado), por comuna, sexo y grupo quinquenal. NO es proyección ni estimación posterior al censo. Período = año del censo 2024 (fechas exactas del levantamiento [NO COMPROBADO]); publicación 27-03-2025. No incluye hogares ni viviendas. Es la ÚNICA fuente de población comunal de la plataforma; las manzanas (Censo 2017 o GSE) son otra medida y se rotulan aparte.')
on conflict (source_key) do nothing;

-- -----------------------------------------------------------------------------
-- 2. Zona de paso y tablas publicadas
-- -----------------------------------------------------------------------------
create unlogged table if not exists public.poblacion_comunal_stage (
  snapshot_n    integer not null,
  cut           text    not null,
  comuna        text    not null,
  region_cut    text    not null,
  province_cut  text    not null,
  total         integer not null,
  hombres       integer not null,
  mujeres       integer not null
);
create unlogged table if not exists public.poblacion_comunal_edad_stage (
  snapshot_n    integer not null,
  cut           text    not null,
  grupo_edad    text    not null,
  total         integer not null,
  hombres       integer not null,
  mujeres       integer not null
);

create table if not exists public.poblacion_comunal (
  snapshot_n    integer  not null,
  cut           char(5)  not null references public.comunas(cut),
  comuna        text     not null check (btrim(comuna) <> ''),                 -- nombre tal como lo publica el INE (la clave es el CUT)
  region_cut    char(2)  not null check (region_cut ~ '^[0-9]{2}$'),
  total         integer  not null check (total >= 0),
  hombres       integer  not null check (hombres >= 0),
  mujeres       integer  not null check (mujeres >= 0),
  constraint poblacion_comunal_pk primary key (snapshot_n, cut),
  constraint poblacion_comunal_region check (left(cut, 2) = region_cut),
  constraint poblacion_comunal_suma check (hombres + mujeres = total)
);
create index if not exists poblacion_comunal_cut_idx on public.poblacion_comunal (cut);

create table if not exists public.poblacion_comunal_edad (
  snapshot_n    integer  not null,
  cut           char(5)  not null,
  grupo_edad    text     not null check (grupo_edad in ('0 a 4', '5 a 9', '10 a 14', '15 a 19', '20 a 24', '25 a 29', '30 a 34', '35 a 39', '40 a 44',
                                                         '45 a 49', '50 a 54', '55 a 59', '60 a 64', '65 a 69', '70 a 74', '75 a 79', '80 a 84', '85 o más')),
  grupo_orden   smallint generated always as (case when grupo_edad = '85 o más' then 17 else split_part(grupo_edad, ' ', 1)::int / 5 end) stored,
  total         integer  not null check (total >= 0),
  hombres       integer  not null check (hombres >= 0),
  mujeres       integer  not null check (mujeres >= 0),
  constraint poblacion_comunal_edad_pk primary key (snapshot_n, cut, grupo_edad),
  constraint poblacion_comunal_edad_fk foreign key (snapshot_n, cut) references public.poblacion_comunal (snapshot_n, cut) on delete cascade,
  constraint poblacion_comunal_edad_suma check (hombres + mujeres = total)
);

comment on table public.poblacion_comunal is 'Población CENSADA 2024 (INE) por comuna: «residentes habituales censados». Única fuente de población comunal. No es proyección.';
comment on table public.poblacion_comunal_edad is 'Población censada 2024 (INE) por comuna, grupo de edad quinquenal y sexo (hoja 4 del tabulado D1).';

-- -----------------------------------------------------------------------------
-- 3. Publicación (única vía): re-valida en la base los cuadres que hizo el ETL
-- -----------------------------------------------------------------------------
create or replace function public.publish_poblacion_snapshot(p_snapshot_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_snap public.source_snapshots%rowtype; v_key text; v_n int; v_rep jsonb; v_keep int; v_old record; v_removed int := 0; v_report jsonb; v_exp numeric; v_bad text;
begin
  perform pg_advisory_xact_lock(hashtext('censo_poblacion_publish'));
  select * into v_snap from public.source_snapshots where id = p_snapshot_id for update;
  if not found then raise exception 'snapshot % no existe', p_snapshot_id; end if;
  select source_key into v_key from public.data_sources where id = v_snap.source_id;
  if v_key is distinct from 'ine_censo2024_poblacion_comunal' then raise exception 'el snapshot es de %, no del Censo 2024', v_key; end if;
  if v_snap.status <> 'validated' then raise exception 'el snapshot está en estado % (debe ser validated)', v_snap.status; end if;
  v_n := v_snap.n;
  if exists (select 1 from public.source_snapshots where source_id = v_snap.source_id and status = 'loaded' and period_end > v_snap.period_end) then
    raise exception 'ya hay un período más nuevo publicado; no se publica uno más viejo';
  end if;

  -- forma: 346 CUT distintos, todos de public.comunas (la FK lo exige; el runbook comprueba antes que tiene 346): cubre todas las comunas, sin «sin dato» silencioso; y 18 grupos de edad por comuna
  if (select count(*) from public.poblacion_comunal_stage where snapshot_n = v_n) <> 346
     or (select count(distinct cut) from public.poblacion_comunal_stage where snapshot_n = v_n) <> 346 then
    raise exception 'la zona de paso debe traer las 346 comunas, una vez cada una';
  end if;
  if v_snap.row_count_raw is distinct from 346 then raise exception 'row_count_raw (%) debe ser 346', v_snap.row_count_raw; end if;
  select string_agg(s.cut, ', ') into v_bad from public.poblacion_comunal_stage s left join public.comunas c on c.cut = s.cut where s.snapshot_n = v_n and c.cut is null;
  if v_bad is not null then raise exception 'CUT que no existen en comunas: %', v_bad; end if;
  if exists (select 1 from public.poblacion_comunal_stage where snapshot_n = v_n and (total < 0 or hombres < 0 or mujeres < 0 or hombres + mujeres <> total or left(cut, 2) <> region_cut or btrim(comuna) = '')) then
    raise exception 'valores fuera de dominio en la zona de paso (negativos, hombres + mujeres <> total, región ≠ prefijo del CUT o nombre vacío)';
  end if;
  if exists (select 1 from public.poblacion_comunal_edad_stage where snapshot_n = v_n group by cut, grupo_edad having count(*) > 1)
     or exists (select 1 from public.poblacion_comunal_edad_stage where snapshot_n = v_n group by cut having count(*) <> 18)
     or (select count(distinct cut) from public.poblacion_comunal_edad_stage where snapshot_n = v_n) <> 346 then
    raise exception 'cada comuna debe traer exactamente 18 grupos de edad, sin repetir';
  end if;
  if exists (select 1 from public.poblacion_comunal_edad_stage e where e.snapshot_n = v_n and (e.total < 0 or e.hombres < 0 or e.mujeres < 0 or e.hombres + e.mujeres <> e.total)) then
    raise exception 'valores fuera de dominio en los grupos de edad';
  end if;

  -- cuadres con los totales del archivo (el ETL los deja en el reporte del snapshot; aquí se vuelven a comprobar con los datos cargados)
  v_rep := v_snap.validation_report;
  if v_rep -> 'pais' is null or v_rep -> 'regiones' is null then raise exception 'falta pais / regiones en el reporte del snapshot (el cuadre es obligatorio)'; end if;
  if (select sum(total) from public.poblacion_comunal_stage where snapshot_n = v_n) is distinct from (v_rep -> 'pais' ->> 'total')::bigint
     or (select sum(hombres) from public.poblacion_comunal_stage where snapshot_n = v_n) is distinct from (v_rep -> 'pais' ->> 'hombres')::bigint
     or (select sum(mujeres) from public.poblacion_comunal_stage where snapshot_n = v_n) is distinct from (v_rep -> 'pais' ->> 'mujeres')::bigint then
    raise exception 'cuadre con el total país del archivo: publicado %, Σ comunas %', v_rep -> 'pais' ->> 'total', (select sum(total) from public.poblacion_comunal_stage where snapshot_n = v_n);
  end if;
  for v_old in select region_cut, sum(total)::numeric as t, sum(hombres)::numeric as h, sum(mujeres)::numeric as m from public.poblacion_comunal_stage where snapshot_n = v_n group by region_cut loop
    v_exp := (v_rep -> 'regiones' -> v_old.region_cut ->> 'total')::numeric;
    if v_exp is distinct from v_old.t
       or (v_rep -> 'regiones' -> v_old.region_cut ->> 'hombres')::numeric is distinct from v_old.h
       or (v_rep -> 'regiones' -> v_old.region_cut ->> 'mujeres')::numeric is distinct from v_old.m then
      raise exception 'cuadre con el total regional del archivo (región %): publicado %, Σ comunas %', v_old.region_cut, v_exp, v_old.t;
    end if;
  end loop;
  if (select count(*) from jsonb_object_keys(v_rep -> 'regiones')) <> 16 then raise exception 'el reporte debe traer las 16 regiones'; end if;
  select string_agg(s.cut, ', ') into v_bad
    from public.poblacion_comunal_stage s
    join (select cut, sum(total) t, sum(hombres) h, sum(mujeres) m from public.poblacion_comunal_edad_stage where snapshot_n = v_n group by cut) e on e.cut = s.cut
   where s.snapshot_n = v_n and (e.t <> s.total or e.h <> s.hombres or e.m <> s.mujeres);
  if v_bad is not null then raise exception 'Σ de los grupos de edad ≠ total de la comuna en: %', v_bad; end if;

  insert into public.poblacion_comunal (snapshot_n, cut, comuna, region_cut, total, hombres, mujeres)
    select snapshot_n, cut, comuna, region_cut, total, hombres, mujeres from public.poblacion_comunal_stage where snapshot_n = v_n;
  insert into public.poblacion_comunal_edad (snapshot_n, cut, grupo_edad, total, hombres, mujeres)
    select snapshot_n, cut, grupo_edad, total, hombres, mujeres from public.poblacion_comunal_edad_stage where snapshot_n = v_n;

  -- postcondiciones: lo publicado es exactamente lo cargado
  if (select count(*) from public.poblacion_comunal where snapshot_n = v_n) <> 346 or (select count(*) from public.poblacion_comunal_edad where snapshot_n = v_n) <> 346 * 18 then
    raise exception 'postcondición: conteos publicados distintos de 346 comunas y 6.228 filas de edad';
  end if;
  if (select sum(total) from public.poblacion_comunal where snapshot_n = v_n) is distinct from (v_rep -> 'pais' ->> 'total')::bigint then
    raise exception 'postcondición: Σ publicada ≠ total país del archivo';
  end if;

  update public.source_snapshots set status = 'superseded' where source_id = v_snap.source_id and status = 'loaded' and id <> p_snapshot_id;
  update public.source_snapshots set status = 'loaded', loaded_at = now() where id = p_snapshot_id;
  v_keep := greatest(public.pipeline_setting('retention.keep_censo_snapshots')::int, 1);
  for v_old in select s.n from public.source_snapshots s where s.source_id = v_snap.source_id and s.status in ('loaded', 'superseded') order by s.period_end desc, s.n desc offset v_keep loop
    delete from public.poblacion_comunal where snapshot_n = v_old.n;                       -- cascada a poblacion_comunal_edad
    v_removed := v_removed + 1;
  end loop;
  if exists (select 1 from public.poblacion_comunal_stage where snapshot_n <> v_n) then
    delete from public.poblacion_comunal_stage where snapshot_n = v_n;
    delete from public.poblacion_comunal_edad_stage where snapshot_n = v_n;
  else
    truncate public.poblacion_comunal_stage, public.poblacion_comunal_edad_stage;
  end if;

  v_report := jsonb_build_object('comunas', (select count(*) from public.poblacion_comunal where snapshot_n = v_n),
    'edad_rows', (select count(*) from public.poblacion_comunal_edad where snapshot_n = v_n),
    'total_pais', (select sum(total) from public.poblacion_comunal where snapshot_n = v_n), 'old_snapshots_cleared', v_removed);
  update public.source_snapshots set validation_report = validation_report || jsonb_build_object('publish', v_report) where id = p_snapshot_id;
  return v_report;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Lectura (SECURITY INVOKER; anon sin acceso, authenticated solo lectura)
-- -----------------------------------------------------------------------------
create or replace function public._poblacion_current_snapshot()
returns table (snapshot_n integer, snapshot_id uuid, period_start date, period_end date, declared_date date, captured_at timestamptz)
language sql stable set search_path = public as $$
  select s.n, s.id, s.period_start, s.period_end, s.declared_date, s.captured_at
    from public.source_snapshots s join public.data_sources d on d.id = s.source_id
   where d.source_key = 'ine_censo2024_poblacion_comunal' and s.status = 'loaded'
   order by s.period_end desc, s.n desc limit 1
$$;

-- Una fila por comuna con el período y la fecha de publicación de la captura vigente. Sin captura vigente devuelve 0 filas: el front dice «sin dato», nunca inventa una cifra.
create or replace function public.get_poblacion_comunal()
returns table (cut char(5), comuna text, region_cut char(2), total integer, hombres integer, mujeres integer,
               snapshot_id uuid, period_start date, period_end date, declared_date date)
language sql stable security invoker set search_path = public as $$
  select p.cut, p.comuna, p.region_cut, p.total, p.hombres, p.mujeres, cs.snapshot_id, cs.period_start, cs.period_end, cs.declared_date
    from public._poblacion_current_snapshot() cs join public.poblacion_comunal p on p.snapshot_n = cs.snapshot_n
   order by p.cut
$$;

create or replace function public.get_poblacion_comunal_edad(p_cut text default null)
returns table (cut char(5), grupo_edad text, grupo_orden smallint, total integer, hombres integer, mujeres integer, snapshot_id uuid)
language plpgsql stable security invoker set search_path = public as $$
begin
  if p_cut is not null and p_cut !~ '^[0-9]{5}$' then raise exception 'p_cut debe ser un CUT de 5 dígitos' using errcode = '22023'; end if;
  return query
  select e.cut, e.grupo_edad, e.grupo_orden, e.total, e.hombres, e.mujeres, cs.snapshot_id
    from public._poblacion_current_snapshot() cs join public.poblacion_comunal_edad e on e.snapshot_n = cs.snapshot_n
   where p_cut is null or e.cut = p_cut
   order by e.cut, e.grupo_orden;
end $$;

-- -----------------------------------------------------------------------------
-- 5. RLS y permisos
-- -----------------------------------------------------------------------------
alter table public.poblacion_comunal_stage      enable row level security;
alter table public.poblacion_comunal_edad_stage enable row level security;
alter table public.poblacion_comunal            enable row level security;
alter table public.poblacion_comunal_edad       enable row level security;
drop policy if exists poblacion_comunal_read on public.poblacion_comunal;
create policy poblacion_comunal_read on public.poblacion_comunal for select to authenticated using (true);
drop policy if exists poblacion_comunal_edad_read on public.poblacion_comunal_edad;
create policy poblacion_comunal_edad_read on public.poblacion_comunal_edad for select to authenticated using (true);
revoke all on public.poblacion_comunal, public.poblacion_comunal_edad, public.poblacion_comunal_stage, public.poblacion_comunal_edad_stage from anon;
revoke insert, update, delete, truncate on public.poblacion_comunal, public.poblacion_comunal_edad from authenticated;
revoke all on public.poblacion_comunal_stage, public.poblacion_comunal_edad_stage from authenticated;
-- Data API: desde el 2026-10-30 Supabase ya no concede permisos automáticos sobre tablas nuevas de public; se declaran aquí (anon sigue sin acceso).
grant select on public.poblacion_comunal, public.poblacion_comunal_edad to authenticated;
grant all on public.poblacion_comunal, public.poblacion_comunal_edad, public.poblacion_comunal_stage, public.poblacion_comunal_edad_stage to service_role;
revoke all on function public.publish_poblacion_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.publish_poblacion_snapshot(uuid) to service_role;
revoke all on function public._poblacion_current_snapshot(), public.get_poblacion_comunal(), public.get_poblacion_comunal_edad(text) from public, anon;
grant execute on function public._poblacion_current_snapshot(), public.get_poblacion_comunal(), public.get_poblacion_comunal_edad(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. Auditoría final: nada previo cambió (salvo +1 fuente sembrada)
-- -----------------------------------------------------------------------------
do $$
declare v_bad text;
begin
  select string_agg(b.t || ': ' || b.n || ' -> ' || a.n, ', ') into v_bad
    from _pob_counts_before b
    join (
      select 'layer_nodes'::text as t, count(*)::bigint as n from public.layer_nodes
      union all select 'territorial_layers', count(*) from public.territorial_layers
      union all select 'territorial_features', count(*) from public.territorial_features
      union all select 'thematic_layers', count(*) from public.thematic_layers
      union all select 'comunas', count(*) from public.comunas
      union all select 'source_snapshots', count(*) from public.source_snapshots
      union all select 'data_sources_other', count(*) from public.data_sources where source_key <> 'ine_censo2024_poblacion_comunal'
    ) a using (t)
   where a.n <> b.n;
  if v_bad is not null then raise exception 'Guardrail: cambiaron conteos de tablas existentes (%)', v_bad; end if;
end $$;

insert into public._migration_log (sprint, notes) values ('censo_poblacion_v1', 'done');
