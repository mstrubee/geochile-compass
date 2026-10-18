-- =============================================================================
-- PROPUESTA (NO APLICADA) — Salud, Fase 1b (1/3): cartera de beneficiarios del Sistema Isapre por comuna, edad y sexo
-- =============================================================================
-- Diseño: docs/salud/DISENO.md §3 (leer antes). Fuente: Superintendencia de Salud, «Estadística anual de cartera de beneficiarios del Sistema Isapre a
-- nivel comunal» (XLSX, diciembre 2025). La comuna llega SOLO por nombre; el ETL la cruza a CUT con alias explícitos.
--
--   salud_restringido            esquema con los CONTEOS COMPLETOS (con rol cotizante/carga). Fuera de «Exposed schemas»; REVOKE a public/anon/authenticated;
--                                RLS con política solo-admin (sin efecto mientras nadie conceda SELECT); acceso real: service_role y SQL directo del dueño.
--   isapre_cartera_unidad        unidades publicadas: comuna, «sin dato de comuna» de cada región y «sin dato de región»
--   isapre_cartera_celda         lo PUBLICADO: unidad × sexo × tramo (beneficiarios = cotizantes + cargas), con supresión (regla 5) y cotas
--   isapre_cartera_grupo         total del grupo (unidad × sexo), suma publicada y residuo «<5 agrupado», cotas y cuadre
--   isapre_cartera_region        totales por región y rol (siempre grandes; se cuadran contra los subtotales del archivo)
--   publish_isapre_snapshot()    único camino (SECURITY DEFINER, todo-o-nada): cuadra contra los totales del archivo, SUPRIME en la base y re-valida
--   get_isapre_comuna()          valor por comuna con filtros (sexo, edad mínima, «solo comunas sin hospital de alta complejidad»); EXACTO cuando lo publicado lo determina
--                                (todos los totales de grupo publicados, o el residuo cae por completo dentro del filtro) y RANGO si no
--   get_isapre_celdas()          la pirámide publicada de una unidad
--   get_isapre_resumen_sin_alta() 1b-1: agregado con DATOS COMPLETOS sobre un conjunto fijo y grande de comunas (SOLO 60+) + su contraste con el rango publicado
--   get_isapre_resumen()         captura vigente y estadísticas de supresión (ficha)
--
-- Semántica que la interfaz NO puede perder: información PROVISIONAL («sujeta a modificación»); la semántica de «comuna» (domicilio, contrato) NO está declarada
-- [NO COMPROBADO]; no se compara ni se suma con Fonasa ni con el Censo (regla 8); «en la comuna» no es «accesible».
--
-- Requiere 20261102000000_health_establishments (get_isapre_resumen_sin_alta lee el registro de establecimientos). SOLO ADITIVA.
-- Rollback: supabase/rollbacks/20261103000000_isapre_cartera_down.sql
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

insert into public._migration_log (sprint, notes) values ('isapre_cartera_v1', 'start');

do $$
begin
  if to_regclass('public.health_establishments') is null or to_regclass('public.geo_rejected_rows') is null or to_regclass('public.comunas') is null then
    raise exception 'Guardrail: falta 20261102000000_health_establishments (y las partes de permisos/proyectos); aplicarlas primero';
  end if;
end $$;

drop table if exists pg_temp._isapre_counts_before;
create temp table _isapre_counts_before on commit drop as
  select 'layer_nodes'::text as t, count(*)::bigint as n from public.layer_nodes
  union all select 'territorial_layers', count(*) from public.territorial_layers
  union all select 'territorial_features', count(*) from public.territorial_features
  union all select 'comunas', count(*) from public.comunas
  union all select 'source_snapshots', count(*) from public.source_snapshots
  union all select 'data_sources_other', count(*) from public.data_sources where source_key <> 'superdesalud_isapre_cartera_comunal';

-- -----------------------------------------------------------------------------
-- 1. Umbrales configurables y fuente
-- -----------------------------------------------------------------------------
insert into public.pipeline_settings (key, value, description) values
  ('salud.suppress_below',            5,  'Un conteo de personas entre 1 y este valor − 1 se publica como «<5» (regla 5, DISENO §2.9 y §3.3). VALOR INICIAL del dueño.'),
  ('salud.min_aggregate_comunas',     10, 'Un agregado calculado con datos completos solo se entrega si cubre al menos este número de comunas (DISENO §3.3 punto 6).'),
  ('retention.keep_isapre_snapshots', 2,  'Capturas de la cartera Isapre cuyo contenido se conserva (por período, p. ej. dic-2024 y dic-2025).')
on conflict (key) do nothing;

insert into public.data_sources
  (source_key, dataset, name, publisher, landing_url, data_url, license_label, attribution, access_mode,
   cadence_days, publication_lag_days, grace_days, check_every_days,
   verification_status, verified_at, verification_note, scope_note)
values
  ('superdesalud_isapre_cartera_comunal', 'isapre_cartera',
   'Estadística anual de cartera de beneficiarios del Sistema Isapre a nivel comunal',
   'Superintendencia de Salud',
   'https://www.superdesalud.gob.cl/',
   'https://www.superdesalud.gob.cl/app/uploads/2026/01/estadistica-anual-de-cartera-de-beneficiarios-comunal-2025.xlsx',
   null,
   'Fuente: Superintendencia de Salud (Estadística anual de cartera de beneficiarios del Sistema Isapre a nivel comunal)',
   'manual', 365, 30, 60, 30,
   'comprobado', date '2026-10-18',
   'Archivo diciembre 2025 descargado y re-comprobado el 2026-10-18: SHA-256 0b810d7438fc1d489f1e0dc8ca46403cc74dc4889a0f1afefe3a3f981df20ff1, 797.428 bytes, Last-Modified 2026-01-28, «fecha de extracción» 2026-01-22. 363 unidades (346 comunas + 16 «sin dato de comuna» + 1 «sin dato de región»), 22 tramos de edad, hojas por rol y sexo. Cuadra contra los totales del propio archivo: cotizantes 1.557.693 y cargas 959.612. LICENCIA NO DECLARADA en el archivo ni en su «Ficha Metadatos»: queda por confirmar.',
   'Cartera VIGENTE al período, por comuna, tramo de edad y sexo. Información PROVISIONAL («sujeta a modificación», nota oficial). La semántica de la comuna (domicilio, contrato u otra) NO está declarada. No incluye Fonasa ni otros sistemas; no se compara ni se suma con Fonasa ni con el Censo (regla 8). Los conteos de 1 a 4 se publican como «<5» con supresión complementaria (política de presentación: el archivo completo es público).')
on conflict (source_key) do nothing;

-- -----------------------------------------------------------------------------
-- 2. Esquema restringido (conteos completos)
-- -----------------------------------------------------------------------------
create schema if not exists salud_restringido;
revoke all on schema salud_restringido from public, anon, authenticated;
grant usage on schema salud_restringido to service_role;
comment on schema salud_restringido is 'Conteos COMPLETOS de personas (regla 5). Fuera de «Exposed schemas»; sin acceso para anon ni authenticated.';

create table if not exists salud_restringido.isapre_unidad (
  snapshot_n   integer not null,
  unit         text    not null check (unit ~ '^([0-9]{5}|SDC[0-9]{2}|SDR)$'),    -- CUT | «sin dato de comuna» de la región | «sin dato de región»
  kind         text    not null check (kind in ('comuna', 'sin_dato_comuna', 'sin_dato_region')),
  region_cut   char(2) check (region_cut is null or region_cut ~ '^[0-9]{2}$'),
  comuna_cut   char(5) references public.comunas(cut),
  name         text    not null check (btrim(name) <> ''),
  constraint isapre_unidad_pk primary key (snapshot_n, unit),
  constraint isapre_unidad_coherente check (
    (kind = 'comuna' and comuna_cut is not null and unit = comuna_cut and region_cut = left(comuna_cut, 2))
    or (kind = 'sin_dato_comuna' and comuna_cut is null and region_cut is not null and unit = 'SDC' || region_cut)
    or (kind = 'sin_dato_region' and comuna_cut is null and region_cut is null and unit = 'SDR'))
);

create table if not exists salud_restringido.isapre_cartera (
  snapshot_n  integer  not null,
  unit        text     not null,
  rol         text     not null check (rol in ('cotizante', 'carga')),
  sexo        text     not null check (sexo in ('F', 'M', 'SI')),
  tramo       smallint not null check (tramo between 0 and 21),                   -- 0..20 = 0-4 … >=100; 21 = S/I (edad sin información)
  n           integer  not null check (n > 0),                                    -- solo celdas con valor; el cero es implícito
  constraint isapre_cartera_pk primary key (snapshot_n, unit, rol, sexo, tramo),
  constraint isapre_cartera_unidad_fk foreign key (snapshot_n, unit) references salud_restringido.isapre_unidad (snapshot_n, unit) on delete cascade
);

create unlogged table if not exists salud_restringido.isapre_stage (
  snapshot_n  integer  not null,
  unit        text     not null,
  unit_kind   text     not null,
  region_cut  text,
  comuna_cut  text,
  unit_name   text     not null,
  rol         text     not null,
  sexo        text     not null,
  tramo       smallint not null,
  n           integer  not null
);

-- -----------------------------------------------------------------------------
-- 3. Tablas PUBLICADAS (solo lo ya suprimido)
-- -----------------------------------------------------------------------------
create table if not exists public.isapre_cartera_unidad (
  snapshot_n  integer not null,
  unit        text    not null check (unit ~ '^([0-9]{5}|SDC[0-9]{2}|SDR)$'),
  kind        text    not null check (kind in ('comuna', 'sin_dato_comuna', 'sin_dato_region')),
  region_cut  char(2),
  comuna_cut  char(5) references public.comunas(cut),
  name        text    not null,
  constraint isapre_cartera_unidad_pub_pk primary key (snapshot_n, unit)
);

-- tramo: 0..20 quinquenales (60-64 = 12 … >=100 = 20), 21 = edad sin información. n_pub NULL = suprimida («<5»).
create table if not exists public.isapre_cartera_celda (
  snapshot_n  integer  not null,
  unit        text     not null,
  sexo        text     not null check (sexo in ('F', 'M', 'SI')),
  tramo       smallint not null check (tramo between 0 and 21),
  n_pub       integer  check (n_pub is null or n_pub >= 0),
  suppressed  boolean  not null,
  kind        text     check (kind in ('primary', 'complementary')),
  lo          integer,
  hi          integer,
  constraint isapre_cartera_celda_pk primary key (snapshot_n, unit, sexo, tramo),
  constraint isapre_cartera_celda_unidad_fk foreign key (snapshot_n, unit) references public.isapre_cartera_unidad (snapshot_n, unit) on delete cascade,
  constraint isapre_celda_suprimida_coherente check ((suppressed and n_pub is null and kind is not null and lo is not null and hi is not null and lo <= hi)
                                                   or (not suppressed and n_pub is not null and kind is null and lo is null and hi is null))
);
create index if not exists isapre_cartera_celda_unit_idx on public.isapre_cartera_celda (snapshot_n, unit);

create table if not exists public.isapre_cartera_grupo (
  snapshot_n        integer  not null,
  unit              text     not null,
  sexo              text     not null check (sexo in ('F', 'M', 'SI')),
  total_pub         integer  check (total_pub is null or total_pub = 0 or total_pub >= 5),   -- NULL = total de 1 a 4 («<5»); 0 se publica como 0
  published_sum     integer  not null check (published_sum >= 0),
  suppressed_cells  smallint not null check (suppressed_cells >= 0),
  residual          integer  check (residual is null or residual >= 0),           -- «<5 agrupado»: total − Σ publicadas (solo si el total se publica)
  lo_sum            integer  not null,
  cuadre_ok         boolean  not null,
  constraint isapre_cartera_grupo_pk primary key (snapshot_n, unit, sexo),
  constraint isapre_cartera_grupo_unidad_fk foreign key (snapshot_n, unit) references public.isapre_cartera_unidad (snapshot_n, unit) on delete cascade
);

create table if not exists public.isapre_cartera_region (
  snapshot_n  integer  not null,
  region_cut  char(2)  not null check (region_cut ~ '^[0-9]{2}$'),
  rol         text     not null check (rol in ('cotizante', 'carga')),
  total       integer  check (total is null or total = 0 or total >= 5),       -- un 1–4 aquí no se publica (la base lo rechaza); NULL = total NO publicado (ver note)
  note        text,
  constraint isapre_cartera_region_pk primary key (snapshot_n, region_cut, rol),
  constraint isapre_region_nota check ((total is null) = (note is not null))
);

comment on table public.isapre_cartera_celda is 'Beneficiarios Isapre (cotizantes + cargas) por unidad, sexo y tramo. n_pub NULL = «<5» (primaria o complementaria); lo/hi son las cotas. Política de presentación, no protección real: el archivo completo es público.';
comment on table public.isapre_cartera_grupo is 'Total por unidad y sexo, suma publicada y residuo «<5 agrupado» con su cuadre por cotas.';

-- -----------------------------------------------------------------------------
-- 4. Publicación (única vía): cuadra, SUPRIME en la base y re-valida
-- -----------------------------------------------------------------------------
create or replace function public.publish_isapre_snapshot(p_snapshot_id uuid)
returns jsonb language plpgsql security definer set search_path = public, salud_restringido as $$
declare
  v_snap public.source_snapshots%rowtype;
  v_key text; v_n int; v_units bigint; v_thr int; v_keep int; v_old record; v_removed int := 0; v_bad text; v_report jsonb;
  v_max_reject numeric; v_rep jsonb; v_exp numeric; v_got numeric;
begin
  perform pg_advisory_xact_lock(hashtext('salud_publish'));
  perform set_config('statement_timeout', '10min', true);

  select * into v_snap from public.source_snapshots where id = p_snapshot_id for update;
  if not found then raise exception 'snapshot % no existe', p_snapshot_id; end if;
  select source_key into v_key from public.data_sources where id = v_snap.source_id;
  if v_key is distinct from 'superdesalud_isapre_cartera_comunal' then raise exception 'el snapshot es de %, no de la cartera Isapre', v_key; end if;
  if v_snap.status <> 'validated' then raise exception 'el snapshot está en estado % (debe ser validated)', v_snap.status; end if;
  v_n := v_snap.n;
  if exists (select 1 from public.source_snapshots where source_id = v_snap.source_id and status = 'loaded' and period_end > v_snap.period_end) then
    raise exception 'ya hay un período más nuevo publicado; no se publica uno más viejo';
  end if;
  v_thr := public.pipeline_setting('salud.suppress_below')::int;
  if v_thr < 2 then raise exception 'salud.suppress_below debe ser >= 2'; end if;

  -- cuadre de unidades: leídas = cargadas + rechazadas (el rechazo es por comuna sin cruce, con su código)
  select count(distinct unit) into v_units from salud_restringido.isapre_stage where snapshot_n = v_n;
  if v_units + v_snap.rejected_count <> v_snap.row_count_raw then
    raise exception 'cuadre de unidades: cargadas % + rechazadas % <> filas de unidad del archivo %', v_units, v_snap.rejected_count, v_snap.row_count_raw;
  end if;
  v_max_reject := public.pipeline_setting('publish.max_reject_ratio');
  if v_snap.row_count_raw = 0 or v_snap.rejected_count::numeric / v_snap.row_count_raw > v_max_reject then
    raise exception 'rechazos % de % superan el máximo configurado (%)', v_snap.rejected_count, v_snap.row_count_raw, v_max_reject;
  end if;

  -- dominios y forma: cada (unidad, rol, sexo, tramo) exactamente una vez; 22 tramos por (unidad, rol, sexo)
  if exists (select 1 from salud_restringido.isapre_stage where snapshot_n = v_n and (n < 0 or tramo not between 0 and 21 or rol not in ('cotizante', 'carga') or sexo not in ('F', 'M', 'SI'))) then
    raise exception 'valores fuera de dominio en la zona de paso (n, tramo, rol o sexo)';
  end if;
  if exists (select 1 from salud_restringido.isapre_stage where snapshot_n = v_n group by unit, rol, sexo, tramo having count(*) > 1) then
    raise exception 'celda repetida en la zona de paso';
  end if;
  if exists (select 1 from salud_restringido.isapre_stage where snapshot_n = v_n group by unit, rol, sexo having count(*) <> 22) then
    raise exception 'cada (unidad, rol, sexo) debe traer exactamente 22 tramos';
  end if;
  if exists (select 1 from (select unit from salud_restringido.isapre_stage where snapshot_n = v_n group by unit having count(*) <> 22 * 2 * 3) x) then
    raise exception 'cada unidad debe traer los 2 roles x 3 sexos';
  end if;
  select string_agg(distinct s.comuna_cut, ', ') into v_bad from salud_restringido.isapre_stage s
    left join public.comunas c on c.cut = s.comuna_cut where s.snapshot_n = v_n and s.comuna_cut is not null and c.cut is null;
  if v_bad is not null then raise exception 'CUT que no existen en comunas: %', v_bad; end if;

  -- CUADRE CON LOS TOTALES DEL ARCHIVO (datos completos, antes de suprimir)
  v_rep := v_snap.validation_report;
  if v_rep -> 'pais_totals' is null or v_rep -> 'region_totals' is null then
    raise exception 'falta pais_totals / region_totals en el reporte del snapshot (el cuadre es obligatorio)';
  end if;
  for v_old in select rol, sum(n)::numeric as got from salud_restringido.isapre_stage where snapshot_n = v_n group by rol loop
    v_exp := (v_rep -> 'pais_totals' ->> v_old.rol)::numeric;
    if v_exp is distinct from v_old.got then raise exception 'cuadre con el Total País del archivo (%): publicado %, cargado %', v_old.rol, v_exp, v_old.got; end if;
  end loop;
  for v_old in
    select s.region_cut, s.rol, sum(s.n)::numeric as got from salud_restringido.isapre_stage s
     where s.snapshot_n = v_n and s.region_cut is not null group by s.region_cut, s.rol
  loop
    v_exp := (v_rep -> 'region_totals' ->> (v_old.region_cut || ':' || v_old.rol))::numeric;
    if v_exp is distinct from v_old.got then
      raise exception 'cuadre con el subtotal regional del archivo (% %): publicado %, cargado %', v_old.region_cut, v_old.rol, v_exp, v_old.got;
    end if;
  end loop;

  -- ---- conteos completos (esquema restringido) ----
  insert into salud_restringido.isapre_unidad (snapshot_n, unit, kind, region_cut, comuna_cut, name)
    select distinct snapshot_n, unit, unit_kind, region_cut, comuna_cut, unit_name from salud_restringido.isapre_stage where snapshot_n = v_n;
  insert into salud_restringido.isapre_cartera (snapshot_n, unit, rol, sexo, tramo, n)
    select snapshot_n, unit, rol, sexo, tramo, n from salud_restringido.isapre_stage where snapshot_n = v_n and n > 0;
  insert into public.isapre_cartera_unidad (snapshot_n, unit, kind, region_cut, comuna_cut, name)
    select snapshot_n, unit, kind, region_cut, comuna_cut, name from salud_restringido.isapre_unidad where snapshot_n = v_n;

  -- ---- SUPRESIÓN (DISENO §3.3): primaria, total del grupo y complementaria ----
  drop table if exists pg_temp._isa_cell;
  create temp table _isa_cell on commit drop as
    select u.unit, x.sexo, t.tramo, coalesce(sum(c.n), 0)::int as n
      from salud_restringido.isapre_unidad u
      cross join (values ('F'), ('M'), ('SI')) as x(sexo)
      cross join generate_series(0, 21) as t(tramo)
      left join salud_restringido.isapre_cartera c on c.snapshot_n = u.snapshot_n and c.unit = u.unit and c.sexo = x.sexo and c.tramo = t.tramo
     where u.snapshot_n = v_n
     group by u.unit, x.sexo, t.tramo;
  alter table _isa_cell add column supp boolean not null default false, add column kind text, add column lo int, add column hi int;
  create index on _isa_cell (unit, sexo);

  drop table if exists pg_temp._isa_grp;
  create temp table _isa_grp on commit drop as
    select unit, sexo, sum(n)::int as total from _isa_cell group by unit, sexo;
  alter table _isa_grp add column total_pub int, add column k int, add column pub_sum int, add column residual int, add column lo_sum int, add column ok boolean;
  update _isa_grp set total_pub = case when total between 1 and v_thr - 1 then null else total end;

  -- primaria: valores 1 .. umbral−1
  update _isa_cell set supp = true, kind = 'primary' where n between 1 and v_thr - 1;
  -- complementaria: grupos con total publicado y EXACTAMENTE una suprimida → la menor celda publicada con valor >= umbral (empate: menor tramo)
  with one as (
    select g.unit, g.sexo from _isa_grp g
     where g.total_pub is not null and (select count(*) from _isa_cell c where c.unit = g.unit and c.sexo = g.sexo and c.supp) = 1),
  pick as (
    select distinct on (c.unit, c.sexo) c.unit, c.sexo, c.tramo
      from _isa_cell c join one o on o.unit = c.unit and o.sexo = c.sexo
     where not c.supp
     order by c.unit, c.sexo, (case when c.n >= v_thr then 0 else 1 end), c.n, c.tramo)
  update _isa_cell c set supp = true, kind = 'complementary'
    from pick p where c.unit = p.unit and c.sexo = p.sexo and c.tramo = p.tramo;

  -- cotas: primaria [1, umbral−1]; complementaria [umbral, …] (0 solo en el caso límite de una celda en 0)
  update _isa_cell set lo = case when kind = 'primary' then 1 when n >= v_thr then v_thr else 0 end where supp;
  update _isa_grp g set k = s.k, pub_sum = s.pub_sum, lo_sum = s.lo_sum
    from (select unit, sexo, count(*) filter (where supp) as k, coalesce(sum(n) filter (where not supp), 0) as pub_sum, coalesce(sum(lo) filter (where supp), 0) as lo_sum
            from _isa_cell group by unit, sexo) s
   where g.unit = s.unit and g.sexo = s.sexo;
  update _isa_grp set residual = total - pub_sum where total_pub is not null;
  update _isa_cell c set hi = case when g.residual is not null then least(case when c.kind = 'primary' then v_thr - 1 else g.residual end, g.residual - (g.lo_sum - c.lo))
                                   else v_thr - 1 end
    from _isa_grp g where c.supp and g.unit = c.unit and g.sexo = c.sexo;
  update _isa_grp g set ok = case
      when g.residual is not null then g.lo_sum <= g.residual
           and (exists (select 1 from _isa_cell c where c.unit = g.unit and c.sexo = g.sexo and c.kind = 'complementary') or g.residual <= (v_thr - 1) * g.k)
      else g.total <= (v_thr - 1) * g.k end;

  insert into public.isapre_cartera_celda (snapshot_n, unit, sexo, tramo, n_pub, suppressed, kind, lo, hi)
    select v_n, unit, sexo, tramo, case when supp then null else n end, supp, kind, lo, hi from _isa_cell;
  insert into public.isapre_cartera_grupo (snapshot_n, unit, sexo, total_pub, published_sum, suppressed_cells, residual, lo_sum, cuadre_ok)
    select v_n, unit, sexo, total_pub, pub_sum, k, residual, lo_sum, ok from _isa_grp;

  -- totales por región y rol (siempre grandes; un valor 1–4 aquí exigiría extender el algoritmo).
  -- FUGA POR RESTA REGIONAL: Σ de los dos totales regionales − Σ de los totales de grupo publicados de la región = Σ de los totales de grupo SUPRIMIDOS de esa región.
  -- Con EXACTAMENTE un grupo suprimido eso despeja su total (1 a 4). Misma regla que en las celdas (una sola suprimida se despeja por resta): el total regional NO se publica
  -- en esas regiones (total NULL con su nota). Con 2 o más grupos suprimidos queda la cota del residuo «<5 agrupado», como en las celdas.
  drop table if exists pg_temp._isa_reg_withheld;
  create temp table _isa_reg_withheld on commit drop as
    select u.region_cut from public.isapre_cartera_grupo g join public.isapre_cartera_unidad u on u.snapshot_n = g.snapshot_n and u.unit = g.unit
     where g.snapshot_n = v_n and u.region_cut is not null
     group by u.region_cut having count(*) filter (where g.total_pub is null) = 1;
  insert into public.isapre_cartera_region (snapshot_n, region_cut, rol, total, note)
    select v_n, s.region_cut, s.rol, case when w.region_cut is null then sum(s.n)::int end,
           case when w.region_cut is not null then 'total regional no publicado: restado de los totales de grupo despejaría el total de un único grupo suprimido' end
      from salud_restringido.isapre_stage s left join _isa_reg_withheld w on w.region_cut = s.region_cut
     where s.snapshot_n = v_n and s.region_cut is not null group by s.region_cut, s.rol, w.region_cut;

  -- ---- POSTCONDICIONES: la base re-valida lo que acaba de publicar ----
  if exists (select 1 from public.isapre_cartera_celda where snapshot_n = v_n and n_pub between 1 and v_thr - 1) then
    raise exception 'postcondición: hay un valor entre 1 y % publicado', v_thr - 1;
  end if;
  if exists (select 1 from public.isapre_cartera_grupo where snapshot_n = v_n and total_pub is not null and suppressed_cells = 1) then
    raise exception 'postcondición: un grupo con total publicado quedó con exactamente 1 celda suprimida (se despejaría por resta)';
  end if;
  if exists (select 1 from public.isapre_cartera_grupo where snapshot_n = v_n and not cuadre_ok) then
    raise exception 'postcondición: falló el cuadre por cotas en algún grupo';
  end if;
  if exists (select 1 from public.isapre_cartera_grupo g where g.snapshot_n = v_n and g.total_pub is not null and g.total_pub <> g.published_sum + g.residual) then
    raise exception 'postcondición: total ≠ Σ publicadas + residuo';
  end if;
  if exists (select 1 from public.isapre_cartera_celda p join _isa_cell c on c.unit = p.unit and c.sexo = p.sexo and c.tramo = p.tramo
              where p.snapshot_n = v_n and not p.suppressed and p.n_pub <> c.n) then
    raise exception 'postcondición: una celda publicada difiere del conteo completo';
  end if;
  if exists (select 1 from public.isapre_cartera_celda p join _isa_cell c on c.unit = p.unit and c.sexo = p.sexo and c.tramo = p.tramo
              where p.snapshot_n = v_n and p.suppressed and c.n > 0 and (c.n < p.lo or c.n > p.hi)) then
    raise exception 'postcondición: el valor real de una celda suprimida cae fuera de sus cotas';
  end if;
  if exists (select 1 from public.isapre_cartera_region where snapshot_n = v_n and total between 1 and v_thr - 1) then
    raise exception 'un total regional es menor que el umbral: extender el algoritmo de supresión a las regiones';
  end if;
  if exists (select 1 from public.isapre_cartera_region r join public.isapre_cartera_unidad u on u.snapshot_n = r.snapshot_n and u.region_cut = r.region_cut
              join public.isapre_cartera_grupo g on g.snapshot_n = u.snapshot_n and g.unit = u.unit
              where r.snapshot_n = v_n and r.total is not null group by r.region_cut having count(distinct g.unit || g.sexo) filter (where g.total_pub is null) = 1) then
    raise exception 'postcondición: un total regional publicado despejaría por resta el total de un único grupo suprimido';
  end if;

  update public.source_snapshots set status = 'superseded' where source_id = v_snap.source_id and status = 'loaded' and id <> p_snapshot_id;
  update public.source_snapshots set status = 'loaded', loaded_at = now() where id = p_snapshot_id;

  v_keep := greatest(public.pipeline_setting('retention.keep_isapre_snapshots')::int, 1);
  for v_old in
    select s.n from public.source_snapshots s where s.source_id = v_snap.source_id and s.status in ('loaded', 'superseded') order by s.period_end desc, s.n desc offset v_keep
  loop
    delete from public.isapre_cartera_region where snapshot_n = v_old.n;
    delete from public.isapre_cartera_unidad where snapshot_n = v_old.n;                       -- cascada a celda y grupo
    delete from salud_restringido.isapre_unidad where snapshot_n = v_old.n;                    -- cascada a isapre_cartera
    v_removed := v_removed + 1;
  end loop;
  if exists (select 1 from salud_restringido.isapre_stage where snapshot_n <> v_n) then
    delete from salud_restringido.isapre_stage where snapshot_n = v_n;
  else
    truncate salud_restringido.isapre_stage;
  end if;

  v_report := jsonb_build_object(
    'units', v_units, 'rejected', v_snap.rejected_count, 'old_snapshots_cleared', v_removed, 'suppress_below', v_thr,
    'cells', (select count(*) from public.isapre_cartera_celda where snapshot_n = v_n),
    'zeros_published', (select count(*) from public.isapre_cartera_celda where snapshot_n = v_n and n_pub = 0),
    'suppressed_primary', (select count(*) from public.isapre_cartera_celda where snapshot_n = v_n and kind = 'primary'),
    'suppressed_complementary', (select count(*) from public.isapre_cartera_celda where snapshot_n = v_n and kind = 'complementary'),
    'groups', (select count(*) from public.isapre_cartera_grupo where snapshot_n = v_n),
    'groups_total_suppressed', (select count(*) from public.isapre_cartera_grupo where snapshot_n = v_n and total_pub is null),
    'groups_with_complementary', (select count(distinct (unit, sexo)) from public.isapre_cartera_celda where snapshot_n = v_n and kind = 'complementary'),
    'groups_cuadre_failed', (select count(*) from public.isapre_cartera_grupo where snapshot_n = v_n and not cuadre_ok),
    'regions_total_withheld', (select count(distinct region_cut) from public.isapre_cartera_region where snapshot_n = v_n and total is null),
    'benef_total', (select sum(n) from salud_restringido.isapre_cartera where snapshot_n = v_n));
  update public.source_snapshots set validation_report = validation_report || jsonb_build_object('publish', v_report) where id = p_snapshot_id;
  return v_report;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Lectura (SECURITY INVOKER sobre lo publicado; solo 1b-1 usa datos completos, SECURITY DEFINER)
-- -----------------------------------------------------------------------------
create or replace function public._isapre_current_snapshot()
returns table (snapshot_n integer, snapshot_id uuid, period_start date, period_end date, declared_date date, captured_at timestamptz)
language sql stable set search_path = public as $$
  select s.n, s.id, s.period_start, s.period_end, s.declared_date, s.captured_at
    from public.source_snapshots s join public.data_sources d on d.id = s.source_id
   where d.source_key = 'superdesalud_isapre_cartera_comunal' and s.status = 'loaded'
   order by s.period_end desc, s.n desc limit 1
$$;

-- Comunas sin ningún establecimiento de alta complejidad VIGENTE según D1 (p_alta: 'hospital' | 'ampliada'), de la captura vigente del registro.
create or replace function public._health_comunas_sin_alta(p_alta text)
returns table (cut char(5))
language plpgsql stable security invoker set search_path = public as $$
begin
  if p_alta is null or p_alta not in ('hospital', 'ampliada') then
    raise exception 'p_alta debe ser hospital o ampliada' using errcode = '22023';
  end if;
  -- sin captura del registro de establecimientos NINGUNA comuna «tiene» alta complejidad y la consulta devolvería las 346: se niega en vez de contestar algo falso
  if (select cs.snapshot_n from public._health_current_snapshot() cs) is null then
    raise exception 'no hay una captura publicada del registro de establecimientos (Fase 1a): no se puede saber qué comunas carecen de alta complejidad' using errcode = '55000';
  end if;
  return query
  select c.cut from public.comunas c
   where not exists (
     select 1 from public._health_current_snapshot() cs
       join public.health_establishments e on e.snapshot_n = cs.snapshot_n
      where e.comuna_cut = c.cut and e.estado = 'vigente'
        and ((p_alta = 'hospital' and e.alta_hospital) or (p_alta = 'ampliada' and e.alta_ampliada)));
end $$;

-- Valor por UNIDAD según lo PUBLICADO (celdas, totales de grupo y residuo), con filtros de sexo y edad mínima. Solo lee tablas publicadas.
-- p_min_tramo: 0 = todas las edades (incluye edad S/I) · 12 = 60 años o más (tramos 12..20, SIN edad S/I). Por grupo (unidad × sexo):
--   P = Σ celdas publicadas dentro del filtro; X = Σ celdas suprimidas dentro del filtro, acotada por (a) las cotas de cada celda, (b) el residuo publicado del grupo
--   (X + suprimidas fuera del filtro = residuo) y (c) si el total del grupo es «<5», X + suprimidas fuera ≤ umbral−1 (y X ≥ Σ cotas inferiores).
--   Con todas las edades y el total del grupo publicado, X = residuo y el valor del grupo es EXACTAMENTE el total publicado.
-- Todo sale de datos ya publicados (get_isapre_celdas devuelve los mismos totales y residuos): no revela nada que no estuviera público.
create or replace function public._isapre_comuna_rango(p_snapshot_n integer, p_sexo text, p_min_tramo integer)
returns table (unit text, n_lo bigint, n_hi bigint, suppressed_cells bigint)
language sql stable security invoker set search_path = public as $$
  with c as (
    select k.unit, k.sexo, k.n_pub, k.suppressed, k.lo, k.hi, (p_min_tramo = 0 or k.tramo between p_min_tramo and 20) as inr
      from public.isapre_cartera_celda k where k.snapshot_n = p_snapshot_n and (p_sexo is null or k.sexo = p_sexo)),
  g as (
    select gr.unit, gr.sexo, gr.residual,
           coalesce(sum(c.n_pub) filter (where c.inr), 0) as p,
           coalesce(sum(c.lo) filter (where c.inr and c.suppressed), 0) as lo_in,
           coalesce(sum(c.hi) filter (where c.inr and c.suppressed), 0) as hi_in,
           coalesce(sum(c.lo) filter (where not c.inr and c.suppressed), 0) as lo_out,
           coalesce(sum(c.hi) filter (where not c.inr and c.suppressed), 0) as hi_out,
           count(*) filter (where c.inr and c.suppressed) as k_in
      from public.isapre_cartera_grupo gr join c on c.unit = gr.unit and c.sexo = gr.sexo
     where gr.snapshot_n = p_snapshot_n
     group by gr.unit, gr.sexo, gr.residual)
  select g.unit,
         sum(g.p + case when g.residual is not null then greatest(g.lo_in, g.residual - g.hi_out) else g.lo_in end)::bigint,
         sum(g.p + case when g.residual is not null then least(g.hi_in, g.residual - g.lo_out)
                        else least(g.hi_in, public.pipeline_setting('salud.suppress_below')::int - 1 - g.lo_out) end)::bigint,
         sum(g.k_in)::bigint
    from g group by g.unit
$$;

-- Beneficiarios Isapre por COMUNA según lo PUBLICADO. p_sexo: null | 'F' | 'M' | 'SI'. p_min_tramo: 0 = todas las edades (incluye edad S/I); 12 = 60 años o más
-- (tramos 12..20: EXCLUYE la edad sin información e INCLUYE el sexo sin información). El valor es EXACTO (n_lo = n_hi) cuando lo publicado lo determina y un RANGO [n_lo, n_hi] si no.
-- suppressed_cells = celdas suprimidas dentro del filtro.
create or replace function public.get_isapre_comuna(p_sexo text default null, p_min_tramo integer default 0, p_sin_alta text default null)
returns table (
  cut char(5), name text, region_cut char(2), n_lo bigint, n_hi bigint, exact boolean, suppressed_cells bigint,
  snapshot_id uuid, period_end date)
language plpgsql stable security invoker set search_path = public as $$
begin
  if p_sexo is not null and p_sexo not in ('F', 'M', 'SI') then raise exception 'p_sexo inválido' using errcode = '22023'; end if;
  if p_min_tramo is null or p_min_tramo not between 0 and 20 then raise exception 'p_min_tramo debe estar entre 0 y 20' using errcode = '22023'; end if;
  if p_sin_alta is not null and p_sin_alta not in ('hospital', 'ampliada') then raise exception 'p_sin_alta inválido' using errcode = '22023'; end if;
  return query
  with cs as (select * from public._isapre_current_snapshot())
  select u.comuna_cut, c.name, c.region_cut, r.n_lo, r.n_hi, (r.n_lo = r.n_hi), r.suppressed_cells, cs.snapshot_id, cs.period_end
    from cs
    join public.isapre_cartera_unidad u on u.snapshot_n = cs.snapshot_n and u.kind = 'comuna'
    join public.comunas c on c.cut = u.comuna_cut
    join public._isapre_comuna_rango(cs.snapshot_n, p_sexo, p_min_tramo) r on r.unit = u.unit
   where p_sin_alta is null or c.cut in (select s.cut from public._health_comunas_sin_alta(p_sin_alta) s)
   order by 4 desc, 1;
end $$;

-- La pirámide PUBLICADA de una unidad (comuna o «sin dato»): celdas con su valor o «<5» y sus cotas, y el residuo de cada grupo.
create or replace function public.get_isapre_celdas(p_unit text)
returns table (unit text, sexo text, tramo smallint, n_pub integer, suppressed boolean, kind text, lo integer, hi integer,
               group_total integer, group_residual integer, group_suppressed_cells smallint, group_cuadre_ok boolean)
language sql stable security invoker set search_path = public as $$
  select k.unit, k.sexo, k.tramo, k.n_pub, k.suppressed, k.kind, k.lo, k.hi, g.total_pub, g.residual, g.suppressed_cells, g.cuadre_ok
    from public._isapre_current_snapshot() cs
    join public.isapre_cartera_celda k on k.snapshot_n = cs.snapshot_n and k.unit = p_unit
    join public.isapre_cartera_grupo g on g.snapshot_n = k.snapshot_n and g.unit = k.unit and g.sexo = k.sexo
   order by k.sexo, k.tramo
$$;

create or replace function public.get_isapre_region()
returns table (region_cut char(2), rol text, total integer, snapshot_id uuid, period_end date)
language sql stable security invoker set search_path = public as $$
  select r.region_cut, r.rol, r.total, cs.snapshot_id, cs.period_end
    from public._isapre_current_snapshot() cs join public.isapre_cartera_region r on r.snapshot_n = cs.snapshot_n
   order by r.region_cut, r.rol
$$;

-- Captura vigente (período, publicación, extracción) y estadísticas de supresión, para la ficha.
create or replace function public.get_isapre_resumen()
returns table (snapshot_id uuid, period_start date, period_end date, declared_date date, extraction_date date, suppress_below integer,
               cells bigint, zeros_published bigint, suppressed_primary bigint, suppressed_complementary bigint, groups bigint, groups_total_suppressed bigint)
language sql stable security invoker set search_path = public as $$
  select cs.snapshot_id, cs.period_start, cs.period_end, cs.declared_date,
         nullif(s.validation_report -> 'file' ->> 'extraction_date', '')::date,
         (s.validation_report -> 'publish' ->> 'suppress_below')::int,
         (s.validation_report -> 'publish' ->> 'cells')::bigint, (s.validation_report -> 'publish' ->> 'zeros_published')::bigint,
         (s.validation_report -> 'publish' ->> 'suppressed_primary')::bigint, (s.validation_report -> 'publish' ->> 'suppressed_complementary')::bigint,
         (s.validation_report -> 'publish' ->> 'groups')::bigint, (s.validation_report -> 'publish' ->> 'groups_total_suppressed')::bigint
    from public._isapre_current_snapshot() cs join public.source_snapshots s on s.id = cs.snapshot_id
$$;

-- 1b-1: beneficiarios Isapre de 60 años o más en comunas SIN establecimiento de alta complejidad EN la comuna (D1: p_alta).
-- Se calcula con los CONTEOS COMPLETOS (regla 5: las métricas derivadas usan datos completos) y SOLO devuelve el agregado de un conjunto de comunas de al menos
-- salud.min_aggregate_comunas. Se entrega junto al RANGO que sale de lo publicado (mismo cálculo que get_isapre_comuna): el agregado debe caer dentro.
-- LÍMITES, dichos sin rodeos (DISENO §3.3 punto 6):
--  · p_min_tramo SOLO admite 12 (60+). Con cualquier corte la resta entre dos consultas aísla un tramo individual (60+ − 65+ = 60-64) y, con el sexo y la edad sin
--    información, celdas pequeñas. Con un único corte no hay tramos que restar.
--  · El mínimo de comunas NO resiste la diferencia entre consultas: el conjunto de la definición ampliada está dentro del de hospitales, así que
--    (hospitales − ampliada) da el agregado EXACTO de las comunas que las separan, aunque sean menos de salud.min_aggregate_comunas. Es una barrera de presentación,
--    no una protección: la cartera completa por comuna, edad y sexo ya es pública en el XLSX de la Superintendencia (regla 5, «política de presentación»).
--  · Devuelve el total del grupo (60+ en las 346 comunas con fila) como contexto, SIN las unidades «sin dato de comuna» ni «sin dato de región».
-- Quién puede llamarla lo decide el GRANT (authenticated y service_role; anon no): como SECURITY DEFINER lee el esquema restringido en nombre del llamador.
create or replace function public.get_isapre_resumen_sin_alta(p_alta text, p_min_tramo integer default 12)
returns table (
  comunas_sin_alta integer, comunas_con_dato integer, benef_exacto bigint, benef_pub_lo bigint, benef_pub_hi bigint, consistente boolean,
  benef_total_comunas bigint, snapshot_id uuid, period_end date, health_snapshot_id uuid)
language plpgsql stable security definer set search_path = public, salud_restringido as $$
declare
  v_cs record; v_hs record; v_ids char(5)[]; v_min int; v_sin int; v_exact bigint; v_lo bigint; v_hi bigint; v_tot bigint;
begin
  if p_alta is null or p_alta not in ('hospital', 'ampliada') then raise exception 'p_alta debe ser hospital o ampliada' using errcode = '22023'; end if;
  if p_min_tramo is distinct from 12 then
    raise exception 'p_min_tramo solo admite 12 (60 años o más): otros cortes permitirían aislar un tramo por resta entre consultas' using errcode = '22023';
  end if;
  select * into v_cs from public._isapre_current_snapshot();
  if v_cs.snapshot_n is null then raise exception 'no hay una captura publicada de la cartera Isapre'; end if;
  select * into v_hs from public._health_current_snapshot();
  if v_hs.snapshot_n is null then raise exception 'no hay una captura publicada del registro de establecimientos'; end if;
  v_min := public.pipeline_setting('salud.min_aggregate_comunas')::int;

  select count(*)::int into v_sin from public._health_comunas_sin_alta(p_alta);
  select array_agg(c.cut) into v_ids from public._health_comunas_sin_alta(p_alta) c
   where exists (select 1 from salud_restringido.isapre_unidad u where u.snapshot_n = v_cs.snapshot_n and u.comuna_cut = c.cut);
  if coalesce(cardinality(v_ids), 0) < v_min then
    raise exception 'el conjunto cubre % comunas (< %): no se entrega un agregado tan acotado', coalesce(cardinality(v_ids), 0), v_min using errcode = '22023';
  end if;
  select coalesce(sum(c.n), 0) into v_exact from salud_restringido.isapre_cartera c
   where c.snapshot_n = v_cs.snapshot_n and c.unit = any (v_ids) and c.tramo between p_min_tramo and 20;
  select coalesce(sum(r.n_lo), 0), coalesce(sum(r.n_hi), 0) into v_lo, v_hi from public._isapre_comuna_rango(v_cs.snapshot_n, null, p_min_tramo) r where r.unit = any (v_ids);
  select coalesce(sum(c.n), 0) into v_tot from salud_restringido.isapre_cartera c join salud_restringido.isapre_unidad u on u.snapshot_n = c.snapshot_n and u.unit = c.unit
   where c.snapshot_n = v_cs.snapshot_n and u.kind = 'comuna' and c.tramo between p_min_tramo and 20;
  return query select v_sin, cardinality(v_ids), v_exact, v_lo, v_hi, (v_exact between v_lo and v_hi), v_tot, v_cs.snapshot_id, v_cs.period_end, v_hs.snapshot_id;
end $$;

-- -----------------------------------------------------------------------------
-- 6. RLS y permisos
-- -----------------------------------------------------------------------------
alter table salud_restringido.isapre_unidad  enable row level security;
alter table salud_restringido.isapre_cartera enable row level security;
alter table salud_restringido.isapre_stage   enable row level security;
alter table public.isapre_cartera_unidad     enable row level security;
alter table public.isapre_cartera_celda      enable row level security;
alter table public.isapre_cartera_grupo      enable row level security;
alter table public.isapre_cartera_region     enable row level security;

-- Política solo-admin en el esquema restringido: SIN EFECTO mientras nadie conceda SELECT a authenticated (REVOKE de arriba). Defensa en profundidad.
drop policy if exists isapre_unidad_admin on salud_restringido.isapre_unidad;
create policy isapre_unidad_admin on salud_restringido.isapre_unidad for select to authenticated using (public.has_role(auth.uid(), 'admin'));
drop policy if exists isapre_cartera_admin on salud_restringido.isapre_cartera;
create policy isapre_cartera_admin on salud_restringido.isapre_cartera for select to authenticated using (public.has_role(auth.uid(), 'admin'));
-- isapre_stage no tiene política: solo el ETL (service_role) la ve.

drop policy if exists isapre_unidad_pub_read on public.isapre_cartera_unidad;
create policy isapre_unidad_pub_read on public.isapre_cartera_unidad for select to authenticated using (true);
drop policy if exists isapre_celda_read on public.isapre_cartera_celda;
create policy isapre_celda_read on public.isapre_cartera_celda for select to authenticated using (true);
drop policy if exists isapre_grupo_read on public.isapre_cartera_grupo;
create policy isapre_grupo_read on public.isapre_cartera_grupo for select to authenticated using (true);
drop policy if exists isapre_region_read on public.isapre_cartera_region;
create policy isapre_region_read on public.isapre_cartera_region for select to authenticated using (true);

revoke all on all tables in schema salud_restringido from public, anon, authenticated;
grant select, insert, update, delete, truncate on all tables in schema salud_restringido to service_role;
revoke all on public.isapre_cartera_unidad, public.isapre_cartera_celda, public.isapre_cartera_grupo, public.isapre_cartera_region from anon;
revoke insert, update, delete, truncate on public.isapre_cartera_unidad, public.isapre_cartera_celda, public.isapre_cartera_grupo, public.isapre_cartera_region from authenticated;

revoke all on function public.publish_isapre_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.publish_isapre_snapshot(uuid) to service_role;
revoke all on function public._isapre_comuna_rango(integer, text, integer) from public, anon;
grant execute on function public._isapre_comuna_rango(integer, text, integer) to authenticated, service_role;
revoke all on function public._isapre_current_snapshot(), public._health_comunas_sin_alta(text),
  public.get_isapre_comuna(text, integer, text), public.get_isapre_celdas(text), public.get_isapre_region(), public.get_isapre_resumen(),
  public.get_isapre_resumen_sin_alta(text, integer) from public, anon;
grant execute on function public._isapre_current_snapshot(), public._health_comunas_sin_alta(text),
  public.get_isapre_comuna(text, integer, text), public.get_isapre_celdas(text), public.get_isapre_region(), public.get_isapre_resumen(),
  public.get_isapre_resumen_sin_alta(text, integer) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 7. Auditoría final: nada previo cambió (salvo +1 fuente sembrada)
-- -----------------------------------------------------------------------------
do $$
declare v_bad text;
begin
  select string_agg(b.t || ': ' || b.n || ' -> ' || a.n, ', ') into v_bad
    from _isapre_counts_before b
    join (
      select 'layer_nodes'::text as t, count(*)::bigint as n from public.layer_nodes
      union all select 'territorial_layers', count(*) from public.territorial_layers
      union all select 'territorial_features', count(*) from public.territorial_features
      union all select 'comunas', count(*) from public.comunas
      union all select 'source_snapshots', count(*) from public.source_snapshots
      union all select 'data_sources_other', count(*) from public.data_sources where source_key <> 'superdesalud_isapre_cartera_comunal'
    ) a using (t)
   where a.n <> b.n;
  if v_bad is not null then raise exception 'Guardrail: cambiaron conteos de tablas existentes (%)', v_bad; end if;
end $$;

insert into public._migration_log (sprint, notes) values ('isapre_cartera_v1', 'done');
