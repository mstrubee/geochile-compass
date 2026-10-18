# Runbook — Población censada 2024 (INE): aplicar, cargar, desplegar, revertir

Lo ejecuta **el dueño** (el agente no aplica migraciones, no carga producción ni despliega). `$PROD` = conexión directa a Postgres del proyecto (no se guarda en el repo).
**La migración se corre SIEMPRE con `psql -1 -v ON_ERROR_STOP=1 -f …`** (una sola transacción: usa tablas temporales `ON COMMIT DROP`, advisory lock y `SET LOCAL`). Sin `-1` el guardrail transaccional falla a propósito.
Si un paso no da lo indicado, **detenerse** y revertir con §7. **Orden obligatorio: migración → carga → verificación → recién entonces desplegar el front.** Con el front nuevo y sin datos, todas las capas dicen «sin dato» (a propósito: no hay cifra de respaldo).

Esta migración (`20261104000000`) va **antes** de cualquier otra pendiente (p. ej. geo-overrides de salud, que pasa a `20261105000000` o posterior). Requiere aplicadas las migraciones de permisos/proyectos (`data_sources`, `source_snapshots`, `pipeline_settings`, `comunas`); **no** requiere las de salud.

## Paso 0 — Antes de tocar nada
```bash
# 0.1 Respaldo de lo que la migración toca (solo lo que toca: las tablas nuevas no existen todavía)
pg_dump "$PROD" -Fc -f respaldo_pre_censo2024.dump -t public.pipeline_settings -t public.data_sources -t public.source_snapshots -t public._migration_log
pg_restore --list respaldo_pre_censo2024.dump | head
# 0.2 La base tiene las 346 comunas (la publicación las exige por FK)
psql "$PROD" -Atc "select count(*) from public.comunas"            # 346
# 0.3 Conteos ANTES (anotarlos)
psql "$PROD" -Atc "select 'data_sources', count(*) from public.data_sources union all select 'pipeline_settings', count(*) from public.pipeline_settings union all select 'source_snapshots', count(*) from public.source_snapshots"
# 0.4 La migración no se aplicó antes
psql "$PROD" -Atc "select to_regclass('public.poblacion_comunal') is null"   # t
```
Opcional pero recomendado: valor **real** del umbral de comuna pequeña por carpeta (ver «Impacto» en `HALLAZGOS_POBLACION.md`):
```sql
select folder_id, small_commune_pop_threshold, iso_minutes_small_commune from public.analysis_settings where small_commune_pop_threshold > 0;
```

## Paso 1 — Migración
```bash
psql "$PROD" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/20261104000000_censo_poblacion.sql
```
**Verificar (todo debe dar lo indicado):**
```sql
-- conteos: data_sources +1 y pipeline_settings +1; nada más cambió
select 'data_sources', count(*) from public.data_sources union all select 'pipeline_settings', count(*) from public.pipeline_settings;
select source_key, dataset, verification_status, license_label, license_url from public.data_sources where source_key = 'ine_censo2024_poblacion_comunal';
  -- licencia: «Creative Commons Reconocimiento-CompartirIgual 4.0 Internacional (CC BY-SA 4.0)»; la nota de verificación dice qué NO está comprobado
select key, value from public.pipeline_settings where key = 'retention.keep_censo_snapshots';    -- 2
-- tablas vacías (aún no hay carga)
select (select count(*) from public.poblacion_comunal), (select count(*) from public.poblacion_comunal_edad);   -- 0, 0
select count(*) from public.get_poblacion_comunal();                                                         -- 0  (sin captura vigente → el front dirá «sin dato»)
-- permisos
select has_function_privilege('anon',          'public.get_poblacion_comunal()', 'execute');                 -- false
select has_function_privilege('authenticated', 'public.get_poblacion_comunal()', 'execute');                 -- true
select has_function_privilege('anon',          'public.get_poblacion_comunal_edad(text)', 'execute');        -- false
select has_function_privilege('authenticated', 'public.publish_poblacion_snapshot(uuid)', 'execute');        -- false  (solo service_role)
select has_table_privilege('authenticated', 'public.poblacion_comunal', 'insert'),
       has_table_privilege('authenticated', 'public.poblacion_comunal', 'update'),
       has_table_privilege('authenticated', 'public.poblacion_comunal', 'delete');                           -- false, false, false
select has_table_privilege('anon', 'public.poblacion_comunal', 'select');                                    -- false
select proname, proconfig from pg_proc where pronamespace = 'public'::regnamespace and prosecdef and proname like '%poblacion%';
  -- 1 fila (publish_poblacion_snapshot) con proconfig = {search_path=public}
```

## Paso 2 — Ensayo (no escribe nada)
```bash
export SUPABASE_DB_URL=...    # solo lectura en --dry-run (transacción READ ONLY)
curl -fsSLO https://censo2024.ine.gob.cl/wp-content/uploads/2025/03/D1_Poblacion-censada-por-sexo-y-edad-en-grupos-quinquenales.xlsx
sha256sum D1_Poblacion-censada-por-sexo-y-edad-en-grupos-quinquenales.xlsx   # 1f3a9c97a1b3defa47a2fc3b8495688c4e08f164063cab704e7a18c41239e009 (505.437 bytes)
python etl/censo_poblacion.py --dry-run --db --file D1_Poblacion-censada-por-sexo-y-edad-en-grupos-quinquenales.xlsx \
  --origin-url https://censo2024.ine.gob.cl/wp-content/uploads/2025/03/D1_Poblacion-censada-por-sexo-y-edad-en-grupos-quinquenales.xlsx --declared-date 2025-12-04
```
(`--declared-date` es solo la fecha de la **copia**, p. ej. el `Last-Modified` 2025-12-04; la fecha de **publicación** que se guarda es la del propio archivo, hoja *Nota*: 27-03-2025.)
**Esperado:** `SHA-256 … ✔ coincide con el verificado`, los 12 cuadres con ✔ (346 comunas; Σ = 18.480.432; hombres + mujeres = total; Σ por región = hoja 1; 18 grupos × 346 = 6.228 filas; Σ edades = hoja 2; códigos 1:1 con `public/codigos_territoriales.csv`; polígonos de `comunas.geojson` ⊆ Censo) y `VEREDICTO: LISTO para cargar`. Si dice `NO SE CARGA`, no seguir y reportar (el archivo cambió o la estructura es otra). Código de salida: 0 ok · 2 estructura/cuadre · 3 la fuente falló · 4 base/Storage.

## Paso 3 — Carga
```bash
export SUPABASE_DB_URL=...  SUPABASE_URL=https://xxxx.supabase.co  SUPABASE_SERVICE_ROLE_KEY=...      # no se guardan en el repo
python etl/censo_poblacion.py --file D1_Poblacion-censada-por-sexo-y-edad-en-grupos-quinquenales.xlsx \
  --origin-url https://censo2024.ine.gob.cl/wp-content/uploads/2025/03/D1_Poblacion-censada-por-sexo-y-edad-en-grupos-quinquenales.xlsx --declared-date 2025-12-04
```
El XLSX **original** sube a Storage (`source-snapshots`) con su hash y copia local en `etl/output/censo/`; los datos pasan por la zona de paso y **solo** `publish_poblacion_snapshot()` (que re-valida en la base: 346 CUT, 6.228 filas de edad, h + m = total, FK a `comunas`) los vuelve vigentes — todo o nada. Re-ejecutar con el mismo archivo es inocuo (`already_loaded`).

## Paso 4 — Verificaciones SQL (valores esperados)
```sql
select count(*) from public.get_poblacion_comunal();                                         -- 346
select sum(total), sum(hombres), sum(mujeres) from public.get_poblacion_comunal();            -- 18480432 | 8967033 | 9513399
select comuna, total from public.get_poblacion_comunal() where cut in ('13101','13201','15102') order by cut;
  -- Santiago 438856 · Puente Alto 568086 · Camarones 861
select count(*), count(distinct cut) from public.get_poblacion_comunal_edad();                -- 6228 | 346
select sum(total) from public.get_poblacion_comunal_edad('13101');                            -- 438856
select period_start, period_end, declared_date from (select * from public.get_poblacion_comunal() limit 1) x;   -- 2024-01-01 | 2024-12-31 | 2025-03-27
select source_key, license_label, verification_status, period_start, period_end, declared_date, sha256
  from public.get_layer_provenance('poblacion_censo2024');                                    -- 1 fila; sha256 = 1f3a9c97…e009
select status, rejected_count, row_count_raw from public.source_snapshots s join public.data_sources d on d.id = s.source_id
 where d.source_key = 'ine_censo2024_poblacion_comunal';                                      -- loaded | 0 | 346
-- conteos: los del paso 0, más data_sources +1, pipeline_settings +1, source_snapshots +1
```

## Paso 5 — Desplegar el front (solo con el paso 4 correcto)
Desplegar la rama mergeada como de costumbre. Después, **comprobar en el navegador con un usuario autenticado:**
1. Capa «Comunas»: popup de Puente Alto → **«Población censada 2024 (INE)» 568.086**; una comuna cualquiera dice la misma cifra en el buscador, en el comparador y en la exportación a Excel.
2. Capas de tráfico y GSE: mismo rótulo y cifras.
3. Isócronas: el informe y el panel dicen la **fuente exacta** de la población (manzanas GSE 2024 / manzanas Censo 2017 / población censada por comuna).
4. Sin sesión (anon) la RPC no responde: el front muestra «sin dato», nunca una cifra de respaldo.
5. Si algo muestra «sin dato» en todas las comunas: la RPC falló o no hay captura vigente; ver consola (`[poblacion] no se pudo leer…`) y repetir el paso 4.

## Paso 6 — Después del despliegue (decisiones del dueño, no automáticas)
- **Cachés que congelaron población** (no se recalculan solos): ver «Análisis y reportes con población congelada» en `HALLAZGOS_POBLACION.md` (`poi_features_cache` con `cells_count = 1`, láminas de informes de isócronas, exportaciones ya enviadas).
- **Licencia CC BY-SA 4.0 (CompartirIgual):** atribuir al INE, indicar los cambios y no sugerir respaldo del INE. Si hay informes a clientes con estas cifras, confirmar con asesoría el alcance de CompartirIgual (marcado [NO COMPROBADO] en `data_sources.verification_note`).

## 7 — Reversa
Antes de recargar tras una reversa, **marcar las capturas como rechazadas**, o el ETL contestará `already_loaded` con las tablas vacías:
```sql
update public.source_snapshots set status = 'rejected'
 where source_id = (select id from public.data_sources where source_key = 'ine_censo2024_poblacion_comunal');
```
- **Solo el front:** revertir el despliegue. El front anterior lee `ine_communes.csv`/`COMMUNES` del bundle anterior (población sin fuente), así que la reversa del front restituye también esas cifras.
- **Base:** `psql "$PROD" -1 -v ON_ERROR_STOP=1 -f supabase/rollbacks/20261104000000_censo_poblacion_down.sql` — borra tablas, funciones y la clave de retención; borra la fuente **solo si no tiene capturas** (si las tiene, la conserva y avisa). Se pierde la población cargada (se recarga con el ETL; el original queda en Storage con su hash).
- Verificar tras la reversa: `select to_regclass('public.poblacion_comunal') is null;` → `t`; conteos de `data_sources`/`pipeline_settings` = los del paso 0.3 (o +0 / +0 si la fuente no tenía capturas).

## Pruebas locales (referencia)
`bash etl/salud/dev_env.sh --reset-dbs` reconstruye las bases de prueba y compara con la línea base (SQL `censo_poblacion` 27 aserciones, rollback 3, pytest `etl/censo` 18 + 1 omitida —la del archivo real, con `CENSO_D1_XLSX=<ruta>` también corre—, Vitest, build).
