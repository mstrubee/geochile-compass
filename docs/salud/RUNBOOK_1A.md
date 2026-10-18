# Runbook de la Fase 1a — aplicar, cargar, desplegar, revisar

Lo ejecuta **el dueño** (el agente no aplica migraciones ni despliega). Cada paso dice **cómo verificarlo** antes de pasar al siguiente. Si un paso falla, **detenerse** y revertir con §6.
`$PROD` = conexión directa a Postgres del proyecto (no se guarda en el repo). Las cifras esperadas son las del archivo `establecimientos_20261014.csv`; con un archivo más nuevo se comparan contra el reporte del `--dry-run`, no contra estas.

## Paso 0 — Respaldo (antes de la migración 1)
Las dos migraciones son aditivas, pero tocan filas de tablas compartidas (`pipeline_settings`, `data_sources`) y, la 2, `thematic_layers` y el árbol de capas.

1. **Respaldo de Supabase** (el que corresponda al plan: *Database → Backups* / PITR). Anotar la hora.
2. **Respaldo propio** de lo que se toca, en un directorio fuera del repo:
   ```bash
   pg_dump "$PROD" -Fc -f respaldo_pre_1a.dump \
     -t public.pipeline_settings -t public.data_sources -t public.source_snapshots -t public.source_checks \
     -t public.geo_rejected_rows -t public.thematic_layers -t public.layer_nodes -t public.territorial_layers
   pg_restore --list respaldo_pre_1a.dump | head      # verifica que el dump se lee
   ls -l respaldo_pre_1a.dump                         # tamaño > 0
   ```
3. **Conteos previos** (se comparan al final de cada paso; la migración los vuelve a comprobar por dentro):
   ```sql
   select 'layer_nodes', count(*) from public.layer_nodes union all select 'territorial_layers', count(*) from public.territorial_layers
   union all select 'territorial_features', count(*) from public.territorial_features union all select 'thematic_layers', count(*) from public.thematic_layers
   union all select 'data_sources', count(*) from public.data_sources union all select 'pipeline_settings', count(*) from public.pipeline_settings;
   ```
4. **Requisitos:** `select to_regclass('public.geo_rejected_rows'), to_regclass('public.thematic_layers');` → ambos no nulos (migraciones de permisos/proyectos aplicadas). Si falta alguno, la migración se detiene sola con un *Guardrail*.

## Paso 1 — Migración 1 (`20261102000000_health_establishments.sql`)
```bash
psql "$PROD" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/20261102000000_health_establishments.sql
```
**Verificar:**
- Termina sin error (si falla, `-1` deja la base intacta).
- `select count(*) from public.health_tipo_clasificacion;` → **29**.
- `select source_key, verification_status, license_label from public.data_sources where source_key = 'deis_establecimientos';` → 1 fila, `comprobado`, CC0.
- `select key, value from public.pipeline_settings where key like 'health.%';` → `near_border_m 500`, `coast_buffer_m 2000`.
- Permisos: `select has_function_privilege('anon','public.get_health_summary()','execute'), has_function_privilege('authenticated','public.get_health_summary()','execute'), has_function_privilege('authenticated','public.publish_health_establishments(uuid)','execute');` → `false, true, false`.
- Los conteos del paso 0.3 **no cambiaron** (salvo `data_sources` +1 y `pipeline_settings` +2).

## Paso 2 — Carga con el ETL
```bash
export SUPABASE_DB_URL=...   SUPABASE_URL=...   SUPABASE_SERVICE_ROLE_KEY=...   # no se guardan en el repo
python etl/salud_establecimientos.py --dry-run --db --file establecimientos_AAAAMMDD.csv   # solo lectura
python etl/salud_establecimientos.py --file establecimientos_AAAAMMDD.csv --origin-url <URL de descarga>
```
**Verificar:**
- El `--dry-run` imprime `filas = cargadas + rechazadas ✔ cuadra` y `VEREDICTO: LISTO para cargar` (si dice `NO SE CARGA`, no seguir).
- Con el archivo `20261014`: 5.782 = 5.782 + 0; 5.354 vigentes + 428 cerrados; geografía 5.379 / 9 / 0 / 24 / 370.
- `select status, row_count_raw, rejected_count, sha256 from public.source_snapshots order by n desc limit 1;` → `loaded`, `5782`, `0`, hash = el del reporte.
- `select * from public.get_health_summary() where dimension in ('total','estado');` → 5.782 · 5.354 · 428.
- `select freshness_status, license_label from public.get_layer_provenance('health_establishments');` → `fresh`, CC0.
- **Storage:** el original quedó en el bucket `source-snapshots` (`deis_establecimientos/<año>/<sha>.csv.gz`). Si se usó `--no-storage`, subir la copia local y borrar la nota del snapshot.
- Repetir el mismo comando → `already_loaded` (idempotente).

## Paso 3 — Desplegar el front
Desplegar la rama mergeada como de costumbre. **Verificar** (antes de la migración 2): el mapa carga, las capas de permisos y de proyectos funcionan igual que antes, y la consola no muestra errores nuevos. (Mientras la columna `client_ready` no exista, el front reintenta la consulta anterior **solo** ante el error `42703`; cualquier otro error de `thematic_layers` se registra y no se oculta.)

## Paso 4 — Migración 2 (`20261102000100_health_layer_nodes.sql`)
```bash
psql "$PROD" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/20261102000100_health_layer_nodes.sql
```
**Verificar:**
- `select renderer, dataset, client_ready, left(client_ready_note, 30) from public.thematic_layers where dataset = 'health_establishments';` → 2 filas, `client_ready = false`.
- `select count(*) from public.thematic_layers where client_ready is not null and dataset <> 'health_establishments';` → **0** (las capas que existían no cambian).
- En el árbol aparece la carpeta **Salud** con las dos capas; las capas de permisos/proyectos siguen donde estaban.
- Conteos del paso 0.3: `layer_nodes` +3, `territorial_layers` +2, `thematic_layers` +2, `territorial_features` igual.

## Paso 5 — Revisión y `client_ready` (manual, **no se automatiza**)
Las dos capas siguen en `false` (no entran a informes ni exportaciones y el panel lo avisa) hasta que se cumplan **las tres** condiciones:
1. **(a)** Resuelta la anomalía del ranking: el panel dice qué se cuenta, ofrece el filtro por tipo y advierte la heterogeneidad entre regiones (`HALLAZGOS_FASE1A.md` §7).
2. **(b)** El dueño las revisa **en un navegador contra Supabase real** después de aplicar. Mínimo a revisar: puntos y popups; coropleta; ranking y desglose de una comuna; filtros de alta complejidad (las dos definiciones), dependencia y tipo; cerrados ocultos por defecto; la ficha (tabla de clasificación y advertencias); procedencia y licencia; captura de mapa de un informe sin la capa mientras esté en `false`; y que la ficha diga que la causa de la heterogeneidad entre regiones es **[NO COMPROBADO]** mientras no responda la SEREMI/DEIS (solicitud R5, `solicitudes/LISTA_1C.md`).
   Con la capa en `true` rige la regla de DISENO §2.8: en informes para clientes **no** se publica el ranking nacional o interregional de «todos los establecimientos»; solo cortes asistenciales comparables o comparaciones dentro de una región.
3. **(c)** Se pasan a `true` con un `UPDATE` explícito que **registra en `client_ready_note` la fecha, quién revisó y qué se revisó**:
   ```sql
   update public.thematic_layers
      set client_ready = true,
          client_ready_note = 'Revisada el AAAA-MM-DD por <nombre>. Revisado: <puntos, popups, coropleta, ranking, filtros, ficha, procedencia, captura de informe>. Límites conocidos: <…>.'
    where dataset = 'health_establishments' and renderer = 'points_health';   -- repetir con 'choropleth_health'
   ```
   Una capa a la vez. Para volver a `false`, el mismo `UPDATE` con la nota del motivo. `client_ready` **no es un control de seguridad** (el acceso directo a tablas lo cubre solo RLS).

## 6. Reversión
Orden inverso, un archivo a la vez, con `psql "$PROD" -1 -v ON_ERROR_STOP=1 -f …`:
1. `supabase/rollbacks/20261102000100_health_layer_nodes_down.sql` (borra las dos hojas y la carpeta «Salud» si quedó vacía; restaura el CHECK de renderers; quita `client_ready*` si ninguna capa lo usa).
2. `supabase/rollbacks/20261102000000_health_establishments_down.sql` (borra tablas, funciones y umbrales; **conserva** la fuente si ya tiene capturas y lo avisa).

**Verificar:** conteos iguales a los del paso 0.3 (salvo la fuente conservada). Los archivos originales siguen en Storage. Si algo salió mal más allá de esto, restaurar desde `respaldo_pre_1a.dump` (`pg_restore --data-only` de las tablas afectadas) o desde el respaldo de Supabase.
