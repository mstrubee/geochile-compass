-- =============================================================================
-- PROPUESTA (NO APLICADA) — Salud, Fase 1b-2: penetración Isapre comunal = beneficiarios Isapre / población censada 2024 (INE)
-- =============================================================================
-- Diseño: docs/salud/DISENO.md §3 (pregunta 1b-2). Une DOS capturas ya en producción: la cartera Isapre (20261103000000, vigente a dic-2025) y la población
-- censada del Censo 2024 (20261104000000, año 2024). SOLO ADITIVA: dos funciones, ninguna tabla, ninguna fila.
--
--   get_isapre_penetracion(p_sexo, p_min_tramo)   por comuna: n_lo, n_hi (EXACTO o RANGO, mismo cálculo que get_isapre_comuna), población censada del MISMO sexo y de
--                                                 la MISMA edad, pct_lo, pct_hi y la procedencia de ambas capturas. Lectura: authenticated y service_role; anon nada.
--   _penetracion_denominador()                    auxiliar: población censada por comuna según sexo y corte de edad.
--
-- REGLAS (no negociables):
--  · NUMERADOR = SOLO lo PUBLICADO. Sale de get_isapre_comuna() (celdas publicadas, totales de grupo y residuo), nunca de salud_restringido: un % con su población
--    (pública) no revela nada que el rango publicado no revele ya. La función es SECURITY INVOKER y no tiene acceso al esquema restringido (prueba SQL lo fija).
--  · DENOMINADOR = el Censo con el MISMO filtro. Ambos sexos → total censado; 'F' → mujeres; 'M' → hombres. 'SI' (sexo sin información) se RECHAZA: el Censo no tiene ese grupo.
--  · EDAD: SOLO se admiten 0 (todas las edades) y 12 (60 años o más: Isapre 60-64 a «100 o más»; Censo «60 a 64» a «85 o más»). Cualquier otro valor se RECHAZA con 22023.
--    Los cortes 1..17 SÍ calzan con el Censo (el tramo k de Isapre = 5k a 5k+4 años coincide con el grupo k del Censo; k = 17: «85 o más» = tramos 17..20; los cortes 18, 19 y 20
--    no tienen grupo equivalente), pero NO se abren: con dos cortes consecutivos la resta aísla un TRAMO del numerador (regla 5: un corte único evita aislar tramos restando). Medido con
--    la captura real (dic-2025): de 16.608 intervalos de tramo obtenidos por resta, 104 (0,6 %) quedan más estrechos que las cotas por celda (aprovechan el residuo publicado del grupo);
--    ninguna celda suprimida queda exacta. No filtra nada que no esté publicado, pero la penetración no necesita ese detalle. NOTA: get_isapre_comuna (1b, ya en producción) admite
--    todos los cortes 0..20; esta migración no lo cambia (decisión del dueño, ver HALLAZGOS_FASE1B).
--  · ASIMETRÍA DEL NUMERADOR (declarada, no corregible con lo publicado): con TODAS las edades (0) el numerador incluye la edad SIN información (tramo 21) y, con ambos
--    sexos, el sexo SIN información; con cualquier corte ≥ 1 (p. ej. 60+) EXCLUYE la edad sin información e INCLUYE el sexo sin información (con ambos sexos). El Censo no
--    tiene «sin información»: el denominador es la población con edad y sexo conocidos.
--  · SIN RECORTE: un % sobre 100 se devuelve tal cual (domicilio Isapre [NO COMPROBADO] frente a residencia censal; capturas de fechas distintas: dic-2025 frente a 2024).
--  · SIN DATO (null, nunca una cifra de respaldo): comuna sin fila Isapre; sin población censada (o población 0 para ese filtro) ⇒ pct null; sin captura vigente de alguna
--    de las dos fuentes. Siempre 346 filas (las de public.comunas).
--  · REGLA 8: ni Fonasa, ni restas, ni residuo «sin previsión» o «resto». Isapre y Censo no se suman ni se restan: solo se dividen, con el filtro declarado.
--
-- Requiere 20261103000000_isapre_cartera y 20261104000000_censo_poblacion.
-- Rollback: supabase/rollbacks/20261105000000_isapre_penetracion_down.sql
-- =============================================================================

-- Guardrail de transacción: UNA sola transacción (psql -1 -v ON_ERROR_STOP=1 -f …); sin -1 la tabla temporal ON COMMIT DROP se pierde y esto falla de inmediato.
drop table if exists pg_temp._tx_probe;
create temp table _tx_probe (x int) on commit drop;
do $$
begin
  if to_regclass('pg_temp._tx_probe') is null then
    raise exception 'Guardrail: esta migración debe correr dentro de UNA transacción (psql -1 -v ON_ERROR_STOP=1 -f …); sin -1 las tablas temporales ON COMMIT DROP se pierden y el guardrail final no puede comparar los conteos';
  end if;
end $$;

select pg_advisory_xact_lock(hashtext('isapre_penetracion_v1'));
set local statement_timeout = '5min';

insert into public._migration_log (sprint, notes) values ('isapre_penetracion_v1', 'start');

do $$
begin
  -- 20261103000000_isapre_cartera
  if to_regclass('public.isapre_cartera_celda') is null or to_regclass('public.isapre_cartera_grupo') is null
     or to_regprocedure('public.get_isapre_comuna(text,integer,text)') is null or to_regprocedure('public._isapre_current_snapshot()') is null
     or not exists (select 1 from public._migration_log where sprint = 'isapre_cartera_v1' and notes = 'done') then
    raise exception 'Guardrail: falta 20261103000000_isapre_cartera (tablas publicadas, get_isapre_comuna y su registro «done» en _migration_log); aplicarla primero';
  end if;
  -- 20261104000000_censo_poblacion
  if to_regclass('public.poblacion_comunal') is null or to_regclass('public.poblacion_comunal_edad') is null
     or to_regprocedure('public._poblacion_current_snapshot()') is null or to_regprocedure('public.get_poblacion_comunal()') is null
     or not exists (select 1 from public._migration_log where sprint = 'censo_poblacion_v1' and notes = 'done') then
    raise exception 'Guardrail: falta 20261104000000_censo_poblacion (tablas publicadas, _poblacion_current_snapshot y su registro «done» en _migration_log); aplicarla primero';
  end if;
  if to_regclass('public.comunas') is null then
    raise exception 'Guardrail: falta public.comunas';
  end if;
end $$;

drop table if exists pg_temp._pen_counts_before;
create temp table _pen_counts_before on commit drop as
  select 'layer_nodes'::text as t, count(*)::bigint as n from public.layer_nodes
  union all select 'territorial_layers', count(*) from public.territorial_layers
  union all select 'territorial_features', count(*) from public.territorial_features
  union all select 'thematic_layers', count(*) from public.thematic_layers
  union all select 'comunas', count(*) from public.comunas
  union all select 'source_snapshots', count(*) from public.source_snapshots
  union all select 'data_sources', count(*) from public.data_sources
  union all select 'pipeline_settings', count(*) from public.pipeline_settings
  union all select 'isapre_cartera_celda', count(*) from public.isapre_cartera_celda
  union all select 'poblacion_comunal', count(*) from public.poblacion_comunal
  union all select 'poblacion_comunal_edad', count(*) from public.poblacion_comunal_edad;

-- -----------------------------------------------------------------------------
-- 1. Denominador: población censada por comuna con el MISMO sexo y corte de edad
-- -----------------------------------------------------------------------------
-- p_min_tramo = 0 → todas las edades (hoja «comuna»); k = 1..17 → grupos del Censo con grupo_orden >= k (suma de hombres, mujeres o total); 12 = 60+. Un corte sin contraparte (> 17)
-- devuelve 0 filas. La RPC pública solo usa 0 y 12; la función admite 1..17 para que la equivalencia tramo ↔ grupo quede probada.
create or replace function public._penetracion_denominador(p_snapshot_n integer, p_sexo text, p_min_tramo integer)
returns table (cut char(5), poblacion bigint)
language sql stable security invoker set search_path = public as $$
  select p.cut, (case p_sexo when 'F' then p.mujeres when 'M' then p.hombres else p.total end)::bigint
    from public.poblacion_comunal p
   where p.snapshot_n = p_snapshot_n and p_min_tramo = 0
  union all
  select e.cut, sum(case p_sexo when 'F' then e.mujeres when 'M' then e.hombres else e.total end)::bigint
    from public.poblacion_comunal_edad e
   where e.snapshot_n = p_snapshot_n and p_min_tramo between 1 and 17 and e.grupo_orden >= p_min_tramo
   group by e.cut
$$;

-- -----------------------------------------------------------------------------
-- 2. Penetración Isapre por comuna
-- -----------------------------------------------------------------------------
create or replace function public.get_isapre_penetracion(p_sexo text default null, p_min_tramo integer default 0)
returns table (
  cut char(5), name text, region_cut char(2), n_lo bigint, n_hi bigint, exact boolean, poblacion bigint, pct_lo numeric, pct_hi numeric,
  isapre_snapshot_id uuid, isapre_period_end date, censo_snapshot_id uuid, censo_period_end date)
language plpgsql stable security invoker set search_path = public as $$
begin
  if p_sexo is not null and p_sexo not in ('F', 'M') then
    raise exception 'p_sexo debe ser null (ambos), F o M: el Censo no tiene el grupo «sexo sin información»' using errcode = '22023';
  end if;
  if p_min_tramo is null or p_min_tramo not in (0, 12) then
    raise exception 'p_min_tramo solo admite 0 (todas las edades) y 12 (60 años o más): un corte único evita aislar tramos por resta entre consultas (regla 5)' using errcode = '22023';
  end if;
  return query
  with ics as (select * from public._isapre_current_snapshot()),
       cs  as (select * from public._poblacion_current_snapshot()),
       num as (select * from public.get_isapre_comuna(p_sexo, p_min_tramo, null)),
       den as (select d.cut, d.poblacion from cs, public._penetracion_denominador(cs.snapshot_n, p_sexo, p_min_tramo) d)
  select c.cut, c.name, c.region_cut, num.n_lo, num.n_hi, (num.n_lo = num.n_hi), den.poblacion,
         case when den.poblacion > 0 then 100.0 * num.n_lo / den.poblacion end,
         case when den.poblacion > 0 then 100.0 * num.n_hi / den.poblacion end,
         ics.snapshot_id, ics.period_end, cs.snapshot_id, cs.period_end
    from public.comunas c
    left join num on num.cut = c.cut
    left join den on den.cut = c.cut
    left join ics on true
    left join cs on true
   order by c.cut;
end $$;

comment on function public.get_isapre_penetracion(text, integer) is
  'Penetración Isapre = beneficiarios Isapre (SOLO lo publicado, exacto o rango) / población censada 2024 (INE) con el mismo sexo y edad. p_sexo: null|F|M (SI se rechaza). p_min_tramo: solo 0 (todas las edades) o 12 (60+). Asimetría: con 0 el numerador incluye edad sin información; con ≥1 la excluye; con ambos sexos incluye siempre el sexo sin información. Sin recorte a 100 %. Sin dato = null. Sin Fonasa ni residuo.';

-- -----------------------------------------------------------------------------
-- 3. Permisos: authenticated y service_role; anon nada
-- -----------------------------------------------------------------------------
revoke all on function public._penetracion_denominador(integer, text, integer), public.get_isapre_penetracion(text, integer) from public, anon;
grant execute on function public._penetracion_denominador(integer, text, integer), public.get_isapre_penetracion(text, integer) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. Auditoría final: nada previo cambió (la migración solo agrega funciones)
-- -----------------------------------------------------------------------------
do $$
declare v_bad text;
begin
  select string_agg(b.t || ': ' || b.n || ' -> ' || a.n, ', ') into v_bad
    from _pen_counts_before b
    join (
      select 'layer_nodes'::text as t, count(*)::bigint as n from public.layer_nodes
      union all select 'territorial_layers', count(*) from public.territorial_layers
      union all select 'territorial_features', count(*) from public.territorial_features
      union all select 'thematic_layers', count(*) from public.thematic_layers
      union all select 'comunas', count(*) from public.comunas
      union all select 'source_snapshots', count(*) from public.source_snapshots
      union all select 'data_sources', count(*) from public.data_sources
      union all select 'pipeline_settings', count(*) from public.pipeline_settings
      union all select 'isapre_cartera_celda', count(*) from public.isapre_cartera_celda
      union all select 'poblacion_comunal', count(*) from public.poblacion_comunal
      union all select 'poblacion_comunal_edad', count(*) from public.poblacion_comunal_edad
    ) a using (t)
   where a.n <> b.n;
  if v_bad is not null then raise exception 'Guardrail: cambiaron conteos de tablas existentes (%)', v_bad; end if;
end $$;

insert into public._migration_log (sprint, notes) values ('isapre_penetracion_v1', 'done');
