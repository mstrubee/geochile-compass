# Runbook — Capacidad de hospitales (camas de dotación y ocupación): aplicar, cargar, desplegar, revertir

Lo ejecuta **el dueño** (el agente no aplica migraciones, no carga producción ni despliega). `$PROD` = conexión directa a Postgres del proyecto (no se guarda en el repo).
**La migración se corre SIEMPRE con `psql -1 -v ON_ERROR_STOP=1 -f …`**: una sola transacción (usa tablas temporales `ON COMMIT DROP`, advisory lock y `SET LOCAL`). Sin `-1` el guardrail transaccional falla a propósito.
Cada bloque de abajo es corto y se pega solo: **no hay líneas que empiecen con `#`** (ni comentarios dentro de los bloques). Lo que hay que mirar está en el texto entre bloques.
Si un paso no da lo indicado, **detenerse** y revertir con el Paso 6. **Orden obligatorio: migración → ensayo → carga → verificación → recién entonces desplegar el front.** Con el front nuevo y sin datos, el popup de cada hospital dice «sin dato» (a propósito: no hay cifra de respaldo).

Esta migración es `20261108000000`. Los números `20261106000000` y `20261107000000` quedan **libres** (p. ej. para geo-overrides de salud). Requiere las migraciones de permisos/proyectos (`data_sources`, `source_snapshots`, `pipeline_settings`) y la de **establecimientos de Fase 1a** (`health_establishments`) con una captura vigente cargada.
**Pabellones (REM A21) NO están en este PR:** no existe `health_theatres_month` ni campo de pabellones en la ficha. Van en un PR aparte cuando exista la fuente.
**Licencia de la dotación: [NO COMPROBADO].** La consulta al DEIS la envía el dueño; mientras tanto el campo queda con `client_ready = false` (REM 20 es CC0, pero el campo de ocupación también nace en `false` hasta que usted lo apruebe).

## Paso 0 — Antes de tocar nada

Respaldo de lo que la migración toca (las tablas nuevas no existen todavía):

```bash
pg_dump "$PROD" -Fc -f respaldo_pre_capacidad.dump -t public.pipeline_settings -t public.data_sources -t public.source_snapshots -t public._migration_log
```

```bash
pg_restore --list respaldo_pre_capacidad.dump | head
```

La base tiene las 346 comunas y una captura vigente de establecimientos (la publicación empalma cada código con ella):

```bash
psql "$PROD" -Atc "select count(*) from public.comunas"
```

Esperado: `346`.

```bash
psql "$PROD" -Atc "select snapshot_n from public._health_current_snapshot()"
```

Esperado: un número (la captura vigente). Si no devuelve nada, cargar antes los establecimientos con `docs/salud/RUNBOOK_1A.md`.

```bash
psql "$PROD" -Atc "select count(*) from public.health_establishments where snapshot_n = (select snapshot_n from public._health_current_snapshot())"
```

Anótelo (en la captura verificada del 14-oct-2026 son 5.782).

Conteos ANTES (anótelos):

```bash
psql "$PROD" -Atc "select 'data_sources', count(*) from public.data_sources union all select 'pipeline_settings', count(*) from public.pipeline_settings union all select 'source_snapshots', count(*) from public.source_snapshots"
```

La migración no se aplicó antes:

```bash
psql "$PROD" -Atc "select to_regclass('public.health_rem20_month') is null"
```

Esperado: `t`.

## Paso 1 — Migración

```bash
psql "$PROD" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/20261108000000_health_capacity.sql
```

Verificar, en tandas. Conteos: `data_sources` **+2** y `pipeline_settings` **+1**; `source_snapshots` no cambia:

```bash
psql "$PROD" -Atc "select 'data_sources', count(*) from public.data_sources union all select 'pipeline_settings', count(*) from public.pipeline_settings union all select 'source_snapshots', count(*) from public.source_snapshots"
```

Las dos fuentes, con su licencia (REM 20 = CC0; dotación = `[NO COMPROBADO]`) y comprobadas:

```bash
psql "$PROD" -Atc "select source_key, verification_status, license_label from public.data_sources where source_key in ('deis_rem20_hospitalizacion','deis_dotacion_camas') order by 1"
```

Esperado: `deis_dotacion_camas|comprobado|[NO COMPROBADO] el archivo no declara licencia ni condiciones de uso` y `deis_rem20_hospitalizacion|comprobado|Creative Commons CCZero (CC0)`.

Retención y banderas `client_ready` (ambas en `f`):

```bash
psql "$PROD" -Atc "select key, value from public.pipeline_settings where key = 'retention.keep_capacidad_snapshots'"
```

Esperado: `retention.keep_capacidad_snapshots|2`.

```bash
psql "$PROD" -Atc "select field_key, client_ready from public.health_capacity_fields order by 1"
```

Esperado: `dotacion|f` y `ocupacion|f`.

Tablas vacías, 30 áreas funcionales y **sin** tabla de pabellones:

```bash
psql "$PROD" -Atc "select (select count(*) from public.health_rem20_month), (select count(*) from public.health_beds_dotacion), (select count(*) from public.health_areas_funcionales), to_regclass('public.health_theatres_month') is null"
```

Esperado: `0|0|30|t`.

Sin captura vigente la lectura devuelve todo vacío (el popup dirá «sin dato»):

```bash
psql "$PROD" -Atc "select get_health_capacity('112101')->'dotacion', get_health_capacity('112101')->'fuentes'->'rem20'"
```

Esperado: `null|null`.

Permisos:

```bash
psql "$PROD" -Atc "select has_function_privilege('anon','public.get_health_capacity(text)','execute'), has_function_privilege('authenticated','public.get_health_capacity(text)','execute'), has_function_privilege('authenticated','public.publish_health_rem20_snapshot(uuid)','execute')"
```

Esperado: `f|t|f`.

```bash
psql "$PROD" -Atc "select has_table_privilege('authenticated','public.health_rem20_month','insert'), has_table_privilege('authenticated','public.health_beds_dotacion','delete'), has_table_privilege('anon','public.health_rem20_month','select')"
```

Esperado: `f|f|f`.

Las dos funciones de publicación son `SECURITY DEFINER` con `search_path` fijo:

```bash
psql "$PROD" -Atc "select proname, proconfig from pg_proc where pronamespace = 'public'::regnamespace and prosecdef and (proname like 'publish_health_rem20%' or proname like 'publish_health_dotacion%') order by 1"
```

Esperado: dos filas con `{search_path=public}`.

## Paso 2 — Ensayo (no escribe nada)

Variables (solo lectura en `--dry-run`). El ETL usa el entorno de Python del repo (`etl/requirements.txt`):

```bash
export SUPABASE_DB_URL="$PROD"
```

**Opción automática (recomendada).** REM 20 se resuelve por CKAN (la URL del recurso lleva la fecha de publicación y cambia) y la dotación busca el archivo `Dotación de camas 2010-<año>` más nuevo que exista. El ETL registra la URL efectiva:

```bash
python etl/salud_capacidad.py --dry-run --db
```

**Opción manual** (si prefiere descargar usted; las URLs de abajo son las verificadas el 20-oct-2026):

```bash
curl -fsSL -o Indicadores_REM20.csv "https://datos.gob.cl/dataset/a756323f-85ba-4759-87dc-f5d5e63868cc/resource/657cc933-eac8-4bfc-b004-c4d6dcd988a8/download/indicadores_rem20_20260925.csv"
```

```bash
curl -fsSL -o dotacion_2010-2025.xlsx "https://repositoriodeis.minsal.cl/ContenidoSitioWeb2020/Estadisticas/DOTACION_CAMAS/Dotaci%C3%B3n%20de%20camas%202010-2025%20Establecimientos%20Pertenecientes%20al%20SNSS.xlsx"
```

```bash
sha256sum Indicadores_REM20.csv dotacion_2010-2025.xlsx
```

Esperado (archivos verificados): REM 20 `5085664576302b361f9207ce13b96acacd4a29da16477ebf2cccbce487571559` (27.248.718 bytes) y dotación `ef5ca45f30c1e3937621e489826766cb9844c5bca0253a375be4851f28ba078f` (179.412 bytes).
**Si el hash es otro** no es un error: REM 20 se actualiza cada mes y la dotación una vez al año. El ensayo solo compara con lo verificado cuando el hash coincide; en cualquier caso **todos los cuadres deben salir con ✔** y la dotación 2025 de Tisné y Buin debe seguir siendo 280 y 100.

```bash
python etl/salud_capacidad.py --dry-run --db --rem20-file Indicadores_REM20.csv --rem20-declared-date 2026-09-25 --dotacion-file dotacion_2010-2025.xlsx --dotacion-declared-date 2025-10-20
```

(Con `--rem20-file` conviene agregar `--rem20-origin-url` con la URL de la que descargó, y con `--dotacion-file` `--dotacion-origin-url`; si faltan, se registra la página de la fuente y la nota lo dice. `--declared-date` es la fecha de modificación del archivo.)

**Esperado del ensayo con los archivos verificados** (`VEREDICTO: LISTO para cargar`, todos los cuadres con ✔):

- REM 20: `168.474` filas → `168.471` claves (`3` duplicadas sumadas), `208` establecimientos, período `2014-01 a 2026-08`, último año completo `2025`; índice publicado = fórmula oficial en las `165.293` filas con disponibles > 0; `3.181` filas con disponibles = 0; todos los meses presentes; `208 de 208` códigos empalman con los establecimientos.
- Dotación: `19.949` cifras, `196` establecimientos, `197` bloques «Total» (`114104` en dos bloques), años `2010 a 2025`; «Total País» 2025 = `26.738` y cuadra en los 16 años; `3` celdas de texto (Hospital Dr. Florencio Vargas, `104102`, 2023-2025) = sin dato; `196 de 196` códigos empalman.
- Controles: Hospital Dr. Luis Tisné B. (`112101`): dotación 2023 / 2024 / 2025 = **303 / 296 / 280**; ocupación 2025 = **87.230 de 102.835 → 84,83 %** (12 meses); 2026-08 = **7.791 de 8.897 → 87,57 %**. Hospital San Luis (Buin) (`113150`): dotación **100 / 100 / 100**; ocupación 2025 = **27.370 de 35.836 → 76,38 %**; 2026-08 = **2.383 de 3.059 → 77,90 %**.

Si el veredicto dice `NO SE CARGA`, no seguir y reportar. Códigos de salida: 0 ok · 2 estructura o cuadre · 3 la fuente falló · 4 base de datos o Storage.

## Paso 3 — Carga

```bash
export SUPABASE_URL="https://xxxx.supabase.co"
```

```bash
export SUPABASE_SERVICE_ROLE_KEY="..."
```

Carga real de las dos fuentes (cada una es **todo o nada** por separado: pasa por la zona de paso y solo `publish_health_rem20_snapshot()` / `publish_health_dotacion_snapshot()` la vuelven vigente, re-validando en la base los cuadres y que cada código exista en la captura vigente de establecimientos):

```bash
python etl/salud_capacidad.py
```

(Con archivos locales: los mismos `--rem20-file`, `--dotacion-file` y fechas del Paso 2.) Los archivos **originales** suben a Storage (`source-snapshots`) con su hash y quedan copias locales en `etl/output/salud/`. Repetir con los mismos archivos es inocuo (`already_loaded`). Para cargar solo una fuente: `--source rem20` o `--source dotacion`.

## Paso 4 — Verificaciones SQL (valores esperados con los archivos verificados)

Snapshots, con URL efectiva, hash y fecha de modificación:

```bash
psql "$PROD" -Atc "select d.source_key, s.status, s.granularity, s.period_start, s.period_end, s.declared_date, left(s.sha256, 12), s.row_count_raw from public.source_snapshots s join public.data_sources d on d.id = s.source_id where d.source_key in ('deis_rem20_hospitalizacion','deis_dotacion_camas') order by 1"
```

Esperado: `deis_dotacion_camas|loaded|year|2010-01-01|2025-12-31|2025-10-20|ef5ca45f30c1|19949` y `deis_rem20_hospitalizacion|loaded|month|2014-01-01|2026-08-31|2026-09-25|508566457630|168474`.

```bash
psql "$PROD" -Atc "select d.source_key, s.origin_url from public.source_snapshots s join public.data_sources d on d.id = s.source_id where d.source_key in ('deis_rem20_hospitalizacion','deis_dotacion_camas') order by 1"
```

Esperado: las URL efectivas de descarga (REM 20 con `indicadores_rem20_AAAAMMDD.csv`; dotación con `2010-2025`).

Filas publicadas y sumas:

```bash
psql "$PROD" -Atc "select count(*), count(distinct code), min(period), max(period), sum(dias_cama_ocupados), sum(dias_cama_disponibles), count(*) filter (where filas > 1) from public.health_rem20_month"
```

Esperado: `168471|208|2014-01-01|2026-08-01|93486782|118948275|3`.

```bash
psql "$PROD" -Atc "select count(*), count(distinct code), min(year), max(year) from public.health_beds_dotacion"
```

Esperado: `19949|196|2010|2025`.

```bash
psql "$PROD" -Atc "select year, sum(beds) from public.health_beds_dotacion where area = 100 and year in (2023, 2025) group by year order by year"
```

Esperado: `2023|26220` y `2025|26738` (el «Total País» del archivo).

Zonas de paso vacías:

```bash
psql "$PROD" -Atc "select (select count(*) from public.health_rem20_month_stage), (select count(*) from public.health_beds_dotacion_stage)"
```

Esperado: `0|0`.

**Controles: Hospital Dr. Luis Tisné B. (`112101`):**

```bash
psql "$PROD" -Atc "select r->'dotacion'->>'year', r->'dotacion'->>'total', r->'ocupacion_anual'->>'year', r->'ocupacion_anual'->>'months', r->'ocupacion_anual'->>'ocupados', r->'ocupacion_anual'->>'disponibles', r->'ocupacion_anual'->>'indice' from (select public.get_health_capacity('112101') r) x"
```

Esperado: `2025|280|2025|12|87230|102835|84.83`.

```bash
psql "$PROD" -Atc "select r->'ocupacion_mes'->>'period', r->'ocupacion_mes'->>'ocupados', r->'ocupacion_mes'->>'disponibles', r->'ocupacion_mes'->>'indice', jsonb_array_length(r->'ocupacion_mes'->'areas') from (select public.get_health_capacity('112101') r) x"
```

Esperado: `2026-08|7791|8897|87.57|10` (diez áreas: incluye Pensionado, neonatología y obstetricia).

```bash
psql "$PROD" -Atc "select year, beds from public.health_beds_dotacion where code = '112101' and area = 100 and year >= 2023 order by year"
```

Esperado: `2023|303`, `2024|296`, `2025|280`.

**Controles: Hospital San Luis (Buin) (`113150`):**

```bash
psql "$PROD" -Atc "select r->'dotacion'->>'total', r->'ocupacion_anual'->>'ocupados', r->'ocupacion_anual'->>'disponibles', r->'ocupacion_anual'->>'indice', r->'ocupacion_mes'->>'period', r->'ocupacion_mes'->>'ocupados', r->'ocupacion_mes'->>'disponibles', r->'ocupacion_mes'->>'indice' from (select public.get_health_capacity('113150') r) x"
```

Esperado: `100|27370|35836|76.38|2026-08|2383|3059|77.90`.

```bash
psql "$PROD" -Atc "select year, beds from public.health_beds_dotacion where code = '113150' and area = 100 and year >= 2023 order by year"
```

Esperado: `2023|100`, `2024|100`, `2025|100`.

El índice es **Σ ocupados ÷ Σ disponibles × 100 de todas las áreas**, no el promedio de los índices por área. Comprobación con las filas crudas:

```bash
psql "$PROD" -Atc "select sum(dias_cama_ocupados), sum(dias_cama_disponibles), round(100.0 * sum(dias_cama_ocupados) / sum(dias_cama_disponibles), 2) from public.health_rem20_month where code = '112101' and period between date '2025-01-01' and date '2025-12-01'"
```

Esperado: `87230|102835|84.83`.

**Privados y FF.AA.: todo «sin dato».** Clínica de Puerto Varas SpA (`124210`, privada; solo figuró en 2014-2015) y Hospital de Carabineros (`112240`):

```bash
psql "$PROD" -Atc "select r->>'snss', r->>'dependencia_norm', r->'dotacion', r->'ocupacion_anual', r->'ocupacion_mes' from (select public.get_health_capacity('124210') r) x"
```

Esperado: `false|privado|null|null|null`.

```bash
psql "$PROD" -Atc "select r->>'snss', r->>'dependencia_norm', r->'dotacion', r->'ocupacion_anual', r->'ocupacion_mes' from (select public.get_health_capacity('112240') r) x"
```

Esperado: `false|carabineros|null|null|null`.

Un hospital público sin dotación de 2025 ni REM 20 de 2025 (Hospital de Licantén, `116104`, «en reparaciones» según la nota del archivo): también `null` en todo, y `snss` verdadero (el popup solo dice «sin dato», sin la nota de red pública):

```bash
psql "$PROD" -Atc "select r->>'snss', r->'dotacion', r->'ocupacion_anual', r->'ocupacion_mes' from (select public.get_health_capacity('116104') r) x"
```

Esperado: `true|null|null|null`.

Cobertura sobre los hospitales públicos vigentes de la capa (198 en la captura verificada; 192 con REM 20 de diciembre de 2025):

```bash
psql "$PROD" -Atc "select count(*) from public.health_establishments e join public._health_current_snapshot() cs on cs.snapshot_n = e.snapshot_n where e.clase_servicio = 'hospitalario' and e.estado = 'vigente' and e.snss"
```

Esperado: `198`.

```bash
psql "$PROD" -Atc "select count(distinct e.code) from public.health_establishments e join public._health_current_snapshot() cs on cs.snapshot_n = e.snapshot_n join public.health_rem20_month m on m.code = e.code and m.period = date '2025-12-01' where e.clase_servicio = 'hospitalario' and e.estado = 'vigente'"
```

Esperado: `192`.

Procedencia que viaja al front (licencia de la dotación `[NO COMPROBADO]`, ambos campos con `client_ready = false`):

```bash
psql "$PROD" -Atc "select r->'fuentes'->'dotacion'->>'license_label', r->'client_ready' from (select public.get_health_capacity('112101') r) x"
```

Esperado: la licencia `[NO COMPROBADO] …` y `{"dotacion": {"note": …, "client_ready": false}, "ocupacion": {"note": …, "client_ready": false}}`.

## Paso 5 — Desplegar el front y revisar en Safari

Recién ahora se despliega el front. Abrir la capa «Establecimientos de salud», hacer clic en el punto de **Hospital Dr. Luis Tisné B.** y de **Hospital San Luis (Buin)**: el popup debe mostrar «Camas de dotación: 280 (2025)» / «100 (2025)», «Ocupación 2025 (ene–dic): 84,8 %» / «76,4 %» y «Último mes publicado (agosto 2026): 87,6 %» / «77,9 %», cada uno con «promedio del período, no en tiempo real», el desglose por área (con la nota de que incluye Pensionado, psiquiatría y sociosanitario) y las fuentes. Una clínica privada debe decir «sin dato» y la nota de que esas fuentes son de la red pública. **No debe aparecer ningún campo de pabellones.**

## Paso 6 — Revertir

Se pierde la capacidad cargada (se recarga con `etl/salud_capacidad.py`; los originales quedan en Storage con su hash). Las fuentes se borran solo si no tienen capturas (si las tienen se conservan y se avisa):

```bash
psql "$PROD" -1 -v ON_ERROR_STOP=1 -f supabase/rollbacks/20261108000000_health_capacity_down.sql
```

Verificar:

```bash
psql "$PROD" -Atc "select to_regclass('public.health_rem20_month') is null, to_regclass('public.health_beds_dotacion') is null, to_regclass('public.health_capacity_fields') is null"
```

Esperado: `t|t|t`.

Antes de volver a cargar tras una reversa, las filas de `source_snapshots` de estas dos fuentes quedan como `loaded`; márquelas `rejected` o el ETL contestará `already_loaded` con las tablas vacías:

```bash
psql "$PROD" -c "update public.source_snapshots set status = 'rejected' where source_id in (select id from public.data_sources where source_key in ('deis_rem20_hospitalizacion','deis_dotacion_camas'))"
```

## Mantención

- **REM 20** se actualiza cada mes (la URL cambia): repetir `python etl/salud_capacidad.py --source rem20` (resuelve la URL vigente por CKAN y falla si cambió la licencia o las columnas). La retención guarda las 2 últimas capturas.
- **Dotación** se publica una vez al año (`2010-<año>`): repetir `python etl/salud_capacidad.py --source dotacion`. Las cifras de 2011-2013 cambiaron entre versiones del archivo, por eso cada captura se guarda aparte y nunca se mezclan años de archivos distintos.
- Un **área funcional nueva** (código que no está en `health_areas_funcionales`) detiene la carga: agregar su fila con la glosa oficial antes de cargar.
- Un **código que no está en la captura vigente de establecimientos** también la detiene: actualizar antes los establecimientos (`RUNBOOK_1A.md`).
