# Runbook de la Fase 1b — aplicar, cargar, desplegar, revisar (previsión)

Lo ejecuta **el dueño** (el agente no aplica migraciones ni despliega). **Requiere la Fase 1a ya aplicada y cargada** (`RUNBOOK_1A.md` pasos 0–4): la pregunta 1b-1 cruza con la captura de establecimientos y la migración 3 necesita la carpeta «Salud» y `thematic_layers.client_ready`.
`$PROD` = conexión directa a Postgres del proyecto (no se guarda en el repo). Si un paso falla, **detenerse** y revertir con §6.
**Las tres migraciones se corren SIEMPRE con `psql -1 -v ON_ERROR_STOP=1 -f …`** (una sola transacción: usan tablas temporales `ON COMMIT DROP`, advisory lock y `SET LOCAL`). Sin `-1` el *guardrail* del inicio las detiene de inmediato con «debe correr dentro de UNA transacción» y no toca nada.

## Paso 0 — Respaldo
Igual que 1a (paso 0), más las tablas que toca 1b: `pipeline_settings`, `data_sources`, `source_snapshots`, `thematic_layers`, `layer_nodes`, `territorial_layers`.
```bash
pg_dump "$PROD" -Fc -f respaldo_pre_1b.dump -t public.pipeline_settings -t public.data_sources -t public.source_snapshots \
  -t public.thematic_layers -t public.layer_nodes -t public.territorial_layers
pg_restore --list respaldo_pre_1b.dump | head
```
Conteos previos: los mismos de 1a paso 0.3.

## Paso 1 — Migración 1: Isapre (`20261103000000_isapre_cartera.sql`)
```bash
psql "$PROD" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/20261103000000_isapre_cartera.sql
```
**Verificar:**
- Sin error. `select key, value from public.pipeline_settings where key like 'salud.%';` → `suppress_below 5`, `min_aggregate_comunas 10`, `retention.keep_isapre_snapshots`.
- `select source_key, verification_status, license_label from public.data_sources where source_key = 'superdesalud_isapre_cartera_comunal';` → `comprobado`, **licencia `null`** (por confirmar).
- Permisos (el esquema restringido no es legible por la API): `select has_schema_privilege('anon','salud_restringido','usage'), has_schema_privilege('authenticated','salud_restringido','usage');` → `false, false`; `select has_function_privilege('anon','public.get_isapre_comuna(text,integer,text)','execute'), has_function_privilege('authenticated','public.get_isapre_comuna(text,integer,text)','execute'), has_function_privilege('authenticated','public.publish_isapre_snapshot(uuid)','execute');` → `false, true, false`.
- Los conteos del paso 0 no cambiaron (salvo `data_sources` +1 y `pipeline_settings` +3).
- Verificaciones de seguridad (todas deben dar lo indicado):
  ```sql
  select has_function_privilege('anon', 'public.get_isapre_resumen_sin_alta(text,integer)', 'execute');      -- false
  select has_function_privilege('authenticated', 'public.get_isapre_resumen_sin_alta(text,integer)', 'execute');  -- true
  select has_table_privilege('authenticated', 'public.isapre_cartera_celda', 'insert'),
         has_table_privilege('authenticated', 'public.isapre_cartera_celda', 'update'),
         has_table_privilege('authenticated', 'public.isapre_cartera_celda', 'delete');                      -- false, false, false
  select proname, proconfig from pg_proc where pronamespace = 'public'::regnamespace and prosecdef and proname like '%isapre%';
  -- 2 filas (publish_isapre_snapshot y get_isapre_resumen_sin_alta), cada una con proconfig = {search_path=public, salud_restringido}
  ```

## Paso 2 — Migración 2: CASEN regional (`20261103000100_casen_prevision.sql`)
```bash
psql "$PROD" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/20261103000100_casen_prevision.sql
```
**Verificar:** sin error; `select key, value from public.pipeline_settings where key like 'casen.%';` → `min_cases 60` (valor oficial), `min_df 30`, `max_diff_official 0.001` (se aplica a la estimación **y al error estándar**); `data_sources` +1 (`mds_casen_2024_nacional`, licencia `null`).
`select has_function_privilege('anon', 'public.get_casen_prevision_region()', 'execute'), has_function_privilege('authenticated', 'public.publish_casen_snapshot(uuid)', 'execute');` → `false, false`.

## Paso 3 — Cargas con el ETL
```bash
export SUPABASE_DB_URL=...   SUPABASE_URL=...   SUPABASE_SERVICE_ROLE_KEY=...   # no se guardan en el repo
# Isapre (XLSX de la Superintendencia de Salud, dic-2025)
python etl/salud_isapre.py --dry-run --db --file cartera2025.xlsx --origin-url <URL de descarga> --declared-date 2026-01-28
python etl/salud_isapre.py --file cartera2025.xlsx --origin-url <URL de descarga> --declared-date 2026-01-28
# CASEN 2024 (base .sav + tabulado oficial); pesa ~750 MB, necesita pyreadstat (etl/requirements.txt)
python etl/salud_casen.py --dry-run --sav casen_2024.sav --tabulado Salud_Casen_2024.xlsx --origin-url <URL de la base> --declared-date 2026-06-10
python etl/salud_casen.py --sav casen_2024.sav --tabulado Salud_Casen_2024.xlsx --origin-url <URL de la base> --declared-date 2026-06-10
```
Las URL de origen verificadas están en `data_sources.data_url`. `--declared-date` es la fecha de **publicación** (distinta del período).
**Verificar:**
- Isapre: el `--dry-run` imprime `unidades del archivo 363 = cargadas 363 + rechazadas 0 ✔ cuadra`, los diez cuadres con los totales del archivo ✔ y `VEREDICTO: LISTO para cargar` (si dice `NO SE CARGA`, no seguir). Con el archivo de dic-2025: **2.517.305** beneficiarios; 23.958 celdas; 12.090 ceros; suprimidas 2.783 primarias + 144 complementarias; **`groups_total_withheld = 40`** (totales de grupo retenidos), `groups_total_lt5 = 65` y **`regions_total_withheld = 5`** (las regiones 01, 02, 06, 11 y 16 no publican su total regional).
- CASEN: `estimación propia vs oficial: diferencia máxima ≈ 3·10⁻⁶ pp` (y error estándar ≈ 3·10⁻⁸ pp), `estratos con un solo conglomerado 0`, `96 estimaciones · 67 publicables · 29 no publicables`, `LISTO para cargar`. Si el contraste falla o aparece un estrato con un solo conglomerado (exit 5), no se carga.
- `select * from public.get_isapre_resumen();` → período 2025-12, publicación 2026-01-28, extracción 2026-01-22. `select count(*) from public.get_casen_prevision_region();` → 96.
- `select * from public.get_isapre_resumen_sin_alta('hospital', 12);` → `292 | 292 | 116128 | 115614 | 117442 | t` (comunas sin alta, con dato, agregado exacto, rango publicado, consistente; con la captura de establecimientos del 2026-10-14). Con `'ampliada'`: `288 | 288 | 93058 | 92547 | 94353 | t`. Con `p_min_tramo` distinto de 12 la función **debe fallar** («solo admite 12»).
- Retención del residuo (regla general, DISENO §3.3 punto 5b). Regiones sin total publicado: `select distinct region_cut from public.isapre_cartera_region where total is null order by 1;` → **01, 02, 06, 11, 16**. Grupos con total retenido: `select count(*) from public.isapre_cartera_grupo where total_withheld;` → **40** (y `total_pub` y `residual` NULL en todos).
  Controles de la invariante (ambos deben devolver **0 filas**): ningún grupo con residuo o total «<5» publicado que determine exactamente sus suprimidas, y ninguna región con total publicado con un solo grupo sin total:
  ```sql
  select unit, sexo from public.isapre_cartera_grupo g
   where g.snapshot_n = (select snapshot_n from public._isapre_current_snapshot()) and not g.total_withheld and g.suppressed_cells > 0
     and ((g.total_pub is not null and (g.residual = g.lo_sum
            or (g.residual = 4 * g.suppressed_cells and not exists (select 1 from public.isapre_cartera_celda c
                  where c.snapshot_n = g.snapshot_n and c.unit = g.unit and c.sexo = g.sexo and c.kind = 'complementary'))))
          or (g.total_pub is null and g.lo_sum >= 4));
  select u.region_cut from public.isapre_cartera_grupo g join public.isapre_cartera_unidad u using (snapshot_n, unit)
   where g.snapshot_n = (select snapshot_n from public._isapre_current_snapshot()) and u.region_cut is not null
     and u.region_cut not in (select region_cut from public.isapre_cartera_region where total is null)
   group by 1 having count(*) filter (where g.total_pub is null) = 1;
  ```
- Rangos por comuna: `select count(*), count(*) filter (where not exact), sum(n_lo), sum(n_hi) from public.get_isapre_comuna(null, 0, null);` → `346 | 88 | 2517228 | 2517830`; con `(null, 12, 'hospital')` → `292 | 158 | 115614 | 117442`.

## Paso 4 — Desplegar el front
Como siempre. **Verificar** antes de la migración 3: el mapa carga y las capas de permisos, proyectos y salud 1a funcionan igual que antes; sin errores nuevos en consola.

## Paso 5 — Migración 3: hojas del árbol (`20261103000200_prevision_layer_nodes.sql`)
```bash
psql "$PROD" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/20261103000200_prevision_layer_nodes.sql
```
**Verificar:** `select renderer, dataset, client_ready from public.thematic_layers where renderer in ('choropleth_isapre','panel_casen_region');` → 2 filas, `client_ready = false`; las capas anteriores no cambian; la carpeta **Salud** muestra las dos hojas nuevas.

## Paso 6 — Revisión y `client_ready` (manual, **no se automatiza**)
Las dos capas siguen en `false` hasta que se cumplan **todas**:
1. **Licencias** confirmadas (cartera Isapre y base CASEN) y registradas en `data_sources.license_label`.
2. El dueño las revisa **en un navegador contra Supabase real**. Mínimo: Isapre (rango en el popup, filtros de edad/sexo y «sin alta», 1b-1 con las dos definiciones y su rango publicado, ficha con período/publicación/extracción, advertencias, procedencia); CASEN (rangos con IC, estimaciones sin valor con su motivo, nunca pintado por comuna); captura de mapa de un informe sin las capas mientras estén en `false`.
3. `UPDATE` explícito, una capa a la vez, con `client_ready_note` que registre fecha, quién y qué se revisó (mismo formato que 1a §5).
Reglas de informes: el agregado 1b-1 y los rangos CASEN se citan **con su nivel y su rango**; nunca se suma Isapre con Fonasa ni con el Censo, ni se reparte la proporción regional entre comunas.

## 6. Reversión
Orden inverso, un archivo a la vez, con `psql "$PROD" -1 -v ON_ERROR_STOP=1 -f …`:
1. `supabase/rollbacks/20261103000200_prevision_layer_nodes_down.sql` (borra las dos hojas y **restaura el CHECK de `thematic_layers.renderer` a los 6 renderers** de 1a)
2. `supabase/rollbacks/20261103000100_casen_prevision_down.sql`
3. `supabase/rollbacks/20261103000000_isapre_cartera_down.sql` (borra el esquema restringido; **conserva** la fuente si ya tiene capturas y lo avisa)

**Verificar:** conteos iguales a los de 1a. Los originales siguen en Storage; restaurar desde `respaldo_pre_1b.dump` si algo salió mal más allá de esto.

**Antes de volver a cargar después de un rollback** (esto es obligatorio): los `down` borran las tablas pero **no** las filas de `source_snapshots`; el ETL las ve como `loaded` y responde `already_loaded` con las tablas vacías. Marcarlas como rechazadas:
```sql
update public.source_snapshots set status = 'rejected'
 where status in ('loaded', 'validated', 'superseded')
   and source_id in (select id from public.data_sources where source_key in ('superdesalud_isapre_cartera_comunal', 'mds_casen_2024_nacional'));
```
(Verificado con la captura real: sin esta sentencia el ETL contesta `already_loaded`; con ella carga de nuevo y deja las mismas cifras.) Después, repetir los pasos 1, 2 y 3.
