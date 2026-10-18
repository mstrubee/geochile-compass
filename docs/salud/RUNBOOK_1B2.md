# Runbook de la Fase 1b-2 — aplicar, verificar, desplegar, revertir (penetración Isapre sobre el Censo 2024)

Lo ejecuta **el dueño** (el agente no aplica migraciones ni despliega). `$PROD` = conexión directa a Postgres del proyecto (no se guarda en el repo).
**La migración se corre SIEMPRE con `psql -1 -v ON_ERROR_STOP=1 -f …`** (una sola transacción: usa una tabla temporal `ON COMMIT DROP`, advisory lock y `SET LOCAL`; sin `-1` el guardrail falla a propósito).
Es **solo aditiva**: dos funciones (`get_isapre_penetracion`, `_penetracion_denominador`); ninguna tabla ni fila. Si un paso no da lo indicado, **detenerse** y revertir con §6.
**Requiere** `20261103000000_isapre_cartera` (captura Isapre vigente) y `20261104000000_censo_poblacion` (captura del Censo vigente): la migración lo exige y falla si falta alguna (también comprueba que `_migration_log` tenga su `done`). **Orden: migración → verificación → desplegar el front.** Con el front nuevo y sin la migración, la métrica «Penetración» muestra el error de la RPC (no una cifra de respaldo).
Esta migración (`20261105000000`) va **antes** de geo-overrides de salud (`20261106000000` o posterior).

## Paso 0 — Antes de tocar nada
```bash
# 0.1 Respaldo (la migración solo agrega funciones; se respalda lo que audita y el registro)
pg_dump "$PROD" -Fc -f ~/respaldos/respaldo_pre_1b2.dump -t public._migration_log -t public.pipeline_settings -t public.data_sources -t public.source_snapshots
pg_restore --list ~/respaldos/respaldo_pre_1b2.dump | head
# 0.2 Las dos capturas están vigentes y la migración no se aplicó antes
psql "$PROD" -Atc "select period_end from public._isapre_current_snapshot()"                          # 2025-12-31
psql "$PROD" -Atc "select period_end from public._poblacion_current_snapshot()"                       # 2024-12-31
psql "$PROD" -Atc "select to_regprocedure('public.get_isapre_penetracion(text,integer)') is null"     # t
psql "$PROD" -Atc "select sprint, notes from public._migration_log where sprint in ('isapre_cartera_v1','censo_poblacion_v1') and notes = 'done' order by 1"   # una fila de cada uno
# 0.3 Conteos ANTES (anotarlos; deben quedar IGUALES después)
psql "$PROD" -Atc "select 'data_sources', count(*) from public.data_sources union all select 'pipeline_settings', count(*) from public.pipeline_settings union all select 'source_snapshots', count(*) from public.source_snapshots union all select 'isapre_cartera_celda', count(*) from public.isapre_cartera_celda union all select 'poblacion_comunal', count(*) from public.poblacion_comunal union all select 'poblacion_comunal_edad', count(*) from public.poblacion_comunal_edad"
```

## Paso 1 — Migración
```bash
psql "$PROD" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/20261105000000_isapre_penetracion.sql
```
Los avisos `NOTICE` (tablas temporales, `drop … if exists`) son normales.

## Paso 2 — Verificaciones SQL (valores esperados, calculados con las capturas reales en local)
```sql
-- 2.1 conteos: IDÉNTICOS a los del paso 0.3 (la migración no agrega filas); el registro agrega start y done
select sprint, notes from public._migration_log where sprint = 'isapre_penetracion_v1' order by id;                         -- start, done

-- 2.2 permisos
select has_function_privilege('anon',          'public.get_isapre_penetracion(text,integer)', 'execute');                   -- false
select has_function_privilege('authenticated', 'public.get_isapre_penetracion(text,integer)', 'execute');                   -- true
select has_function_privilege('anon',          'public._penetracion_denominador(integer,text,integer)', 'execute');         -- false
select proname, prosecdef, proconfig from pg_proc where pronamespace = 'public'::regnamespace and proname in ('get_isapre_penetracion', '_penetracion_denominador');
  -- 2 filas: prosecdef = false (SECURITY INVOKER) y proconfig = {search_path=public}
select pg_get_functiondef('public.get_isapre_penetracion(text,integer)'::regprocedure) ilike '%salud_restringido%';          -- false (el numerador no toca los conteos completos)

-- 2.3 todas las edades, ambos sexos
select count(*), count(pct_lo), count(*) filter (where not exact) from public.get_isapre_penetracion();                       -- 346 | 346 | 88
select sum(poblacion), sum(n_lo), sum(n_hi) from public.get_isapre_penetracion();                                            -- 18480432 | 2517228 | 2517830
select name, n_lo, n_hi, poblacion, round(pct_lo, 2), round(pct_hi, 2) from public.get_isapre_penetracion() where cut in ('13132','13101','13201','15102') order by cut;
  -- Santiago 95594 | 95594 | 438856 | 21,78 | 21,78 · Puente Alto 71940 | 71959 | 568086 | 12,66 | 12,67 · Vitacura 77372 | 77372 | 86420 | 89,53 | 89,53 · Camarones 2 | 4 | 861 | 0,23 | 0,46
select round(min((pct_lo+pct_hi)/2), 2), round(percentile_cont(0.5) within group (order by (pct_lo+pct_hi)/2)::numeric, 2), round(max((pct_lo+pct_hi)/2), 2), count(*) filter (where pct_hi > 100) from public.get_isapre_penetracion();
  -- 0,35 | 3,82 | 89,53 | 0

-- 2.4 60 años o más
select count(*), count(pct_lo), count(*) filter (where not exact) from public.get_isapre_penetracion(null, 12);                -- 346 | 345 | 171   (Antártica: población 60+ = 0 → sin dato)
select sum(poblacion), sum(n_lo), sum(n_hi) from public.get_isapre_penetracion(null, 12);                                     -- 3665028 | 394750 | 396700
select name, n_lo, n_hi, poblacion, round(pct_lo, 2), round(pct_hi, 2) from public.get_isapre_penetracion(null, 12) where cut = '13132';   -- Vitacura 17393 | 17396 | 21269 | 81,78 | 81,79

-- 2.5 sexo: el denominador es el del sexo
select sum(poblacion) from public.get_isapre_penetracion('F', 0);                                                             -- 9513399   (mujeres censadas)
select sum(poblacion) from public.get_isapre_penetracion('M', 0);                                                             -- 8967033   (hombres censados)
select sum(poblacion) from public.get_isapre_penetracion('F', 12);                                                            -- 2036940
select sum(poblacion) from public.get_isapre_penetracion('M', 12);                                                            -- 1628088
select name, n_lo, poblacion, round(pct_lo, 2) from public.get_isapre_penetracion('F', 0) where cut = '12202';                -- Antártica 5 | 4 | 125,00  (único caso > 100 %: se muestra tal cual)

-- 2.6 procedencia de las dos capturas en cada fila
select isapre_period_end, censo_period_end, count(*) from public.get_isapre_penetracion() group by 1, 2;                      -- 2025-12-31 | 2024-12-31 | 346

-- 2.7 rechazos (cada uno debe fallar con SQLSTATE 22023)
select * from public.get_isapre_penetracion('SI', 0);       -- ERROR 22023: el Censo no tiene «sexo sin información»
select * from public.get_isapre_penetracion(null, 5);       -- ERROR 22023: solo 0 y 12
select * from public.get_isapre_penetracion(null, 18);      -- ERROR 22023
```
Verificación como `anon` (sin sesión): `curl -s "$SUPABASE_URL/rest/v1/rpc/get_isapre_penetracion" -H "apikey: $ANON_KEY" -H "Content-Type: application/json" -d '{}'` → error de permiso (`42501`/401), nunca datos.

## Paso 3 — Desplegar el front (solo con el paso 2 correcto)
Desplegar la rama mergeada como de costumbre. Después, **con un usuario autenticado**:
1. Capa «Isapre: beneficiarios por comuna»: el selector «Métrica» ofrece «Beneficiarios (n.º)» y «Penetración (% de la población censada 2024)».
2. Con «Penetración»: 7 clases viridis (0–2, 2–5, 5–10, 10–20, 20–35, 35–50 y ≥ 50 %), relleno 0,7, leyenda con una fila por clase y su número de comunas (todas las edades y ambos sexos: 85 · 122 · 75 · 46 · 12 · 0 · 6); sin dato en gris punteado.
3. Popup de Vitacura: bloque «Previsión de salud» → Beneficiarios Isapre 77.372 · Población censada 2024 (INE) 86.420 · Penetración 89,5 % · «Fonasa: pendiente (fase C)» (sin cifra) · «Sello: Oficial con advertencia» con las dos fuentes, períodos (2025-12-31 / 2024-12-31) y fechas de publicación (2026-01-28 / 2025-03-27).
4. Popup de Camarones: «entre 2 y 4» y «entre 0,2 % y 0,5 %». Con «Mujeres» + «Todas las edades», Antártica: 125,0 % con la advertencia «Supera 100 %».
5. Con «Penetración», «Sexo sin información» aparece deshabilitado; edad solo «Todas las edades» y «60 años o más».
6. Si algo dice «No se pudo leer la penetración: …», la migración no está aplicada o falta una captura: repetir el paso 2.

## 5 — Después del despliegue (decisiones del dueño, no automáticas)
- `get_isapre_comuna` (1b) admite los cortes de edad 0..20 y `get_isapre_celdas` publica las celdas: ver `HALLAZGOS_FASE1B.md` §8.4. Esta fase no lo cambia.
- Licencias: Isapre sigue «por confirmar»; el Censo es CC BY-SA 4.0 (atribuir, indicar cambios). Antes de usar la penetración en informes a clientes, confirmarlo.

## 6 — Reversión
- **Solo el front:** revertir el despliegue (el front anterior no usa la RPC nueva).
- **Base:** `psql "$PROD" -1 -v ON_ERROR_STOP=1 -f supabase/rollbacks/20261105000000_isapre_penetracion_down.sql` — borra las dos funciones. **No se pierde ningún dato** (las capturas Isapre y Censo, sus tablas y RPC no se tocan) y el historial de `_migration_log` se conserva. Revertir el front **antes** si ya se desplegó (si no, la métrica «Penetración» mostrará el error de la RPC).
- Verificar: `select to_regprocedure('public.get_isapre_penetracion(text,integer)') is null;` → `t`; conteos = los del paso 0.3.

## Pruebas locales (referencia)
`bash etl/salud/dev_env.sh --reset-dbs`: SQL `isapre_penetracion` 27 aserciones, rollback 4, Vitest 639, build y la línea base completa.
