# Permisos de edificación y expansión urbana — Diseño (Parte 2)

**Fecha:** 2026-10-16 · **Repo revisado:** `mstrubee/geochile-compass` @ `1146a76` (PR #9, 2026-10-15)
**Estado:** propuesta **revisada tras la aprobación con ajustes (2026-10-16) y tras recibir los XLSX reales de MINVU**. Nada está aplicado
al proyecto Supabase real. Las migraciones se entregan en un parche **separado** del ETL y el front (§10).

Etiquetas: **[COMPROBADO]** lo abrí/ejecuté yo en esta sesión · **[COMPROBADO·usuario]** lo comprobó el usuario el 2026-10-16
desde otro entorno y esta sesión no puede repetirlo (el proxy bloquea el host) · **[DOCUMENTADO]** está en documentación pero
nadie lo probó · **[HIPÓTESIS]** · **[NO DISPONIBLE]**.

---

## 0. Resumen

1. El modelo separa **qué dice la fuente** (`data_sources`), **cada captura** (`source_snapshots`: hash, URL exacta, fecha de captura,
   fecha declarada, período contenido, archivo original en Storage) y **los valores** (`building_permit_statistics`, cada fila con su
   snapshot y la celda de origen). El destino **declarado por la fuente** se guarda aparte de la clasificación normalizada.
2. Nada se muestra como vigente sin pasar por `publish_permit_snapshot()`, que re-verifica en la base: 346 comunas, totales de control,
   tasa de rechazo, series de la fuente correcta. Un valor publicado es **inmutable**.
3. La frescura se calcula (último período + cadencia + rezago + holgura) **y** se registra cada revisión, así que "la URL responde pero
   no hay período nuevo" queda visible y genera alerta.
4. En el mapa, **un dato faltante es `NULL`, nunca 0**; la variación interanual solo existe si ambos períodos están completos; y toda
   fuente que no esté `comprobado` se rotula "no verificada" en la leyenda.
5. Las migraciones se **ejecutaron** (no solo se parsearon) en PostgreSQL 16 + PostGIS 3 con las 346 comunas reales del repo y
   **con los dos XLSX reales cargados**: 92 + 16 aserciones SQL OK, idempotencia, rollback en cadena, ETL extremo a extremo (§12). Esto es
   contra un esquema mínimo que imita al del repo, **no** contra el proyecto Supabase real (§13).
6. **P1 queda cerrado; P5 NO** (los archivos no traen licencia; ver §1.3). **INE no se carga.**
7. **Tamaño medido con datos reales:** hechos + índices = **17 MB** (174.384 filas), `comunas` con geometrías = **8,7 MB** → **≈ 26 MB**
   (meta < 30 MB). Desglose y por qué crece en §3.4.

---

## 1. Verificación: qué es COMPROBADO y qué falta

### 1.1 Incorporado del usuario (2026-10-16, otro entorno)

| # | Afirmación | Estado | Efecto en el diseño |
|---|---|---|---|
| 1 | SEIA tiene servicio ArcGIS REST público `…/WEBServices/ProyectosSEIA/MapServer`; capa 1 = EIA (1.594), capa 2 = DIA (28.408); JSON/geoJSON/PBF; `maxRecordCount` 2000 con `resultOffset`/`resultRecordCount`; campos listados | **[COMPROBADO·usuario]** | Es la fuente de proyectos individuales (reemplaza raspar el buscador). §8 y migración 4 |
| 1b | El punto de "Praderas La Dehesa" (Lo Barnechea) cae en lat -33,80, fuera de su comuna | **[COMPROBADO·usuario]** | Validación punto-en-polígono que **marca** y nunca corrige en silencio |
| 2 | `catalogo.minvu.cl` corta TLS (unexpected eof) también desde otra nube; coincide con lo que documenta chile-hub | **[COMPROBADO·usuario]** + **[COMPROBADO]** que el código de chile-hub lo documenta (medido 2026-09-25) | MINVU es **ingesta manual / IP chilena**; la descarga automática es opcional |
| 3 | MapBiomas Chile Colección 2: anual 1999–2024, 30 m, CC-BY 4.0 según sus términos; clase "Infraestructura" con ATBD propio | **[COMPROBADO·usuario]** | Fuente futura de crecimiento físico (§9), fuera del MVP |
| 4 | Ley 21.718 / art. 116 bis C LGUC: cada municipio publica a más tardar el 5.º día hábil un listado de permisos; SEREMI informa cumplimiento entre el 10.º y 15.º hábil | **[COMPROBADO·usuario]** | Fuente futura por comuna (PDF heterogéneo), fuera del MVP (§9) |

### 1.2 Lo que esta sesión comprobó directamente

| Hecho | Cómo |
|---|---|
| El repo **no tiene tabla `comunas`** en la base. Las comunas viven en `public/codigos_territoriales.csv` (346 filas, `commune_id` texto de 5 dígitos) y `public/comunas.geojson` | Leí ambos archivos del clon |
| `comunas.geojson` trae **345** polígonos: **falta `12202` Antártica** (está en el CSV) | Diferencia de conjuntos con Python |
| **2 de los 345 polígonos son inválidos** (auto-intersección): `13110` La Florida y `06204` Marchihue. `ST_MakeValid` los repara sin cambiar el área (70,9 y 657,5 km²) | `ST_IsValid` en PostGIS 3 |
| Las capas del árbol son hojas de `layer_nodes`; `territorial_layers` es la tabla de detalle y su trigger legacy crea el nodo | Leí `…layer_nodes_schema.sql`, `…backfill.sql`, `…retire_legacy…sql` |
| Patrones obligatorios: `pg_advisory_xact_lock` + `_migration_log` start/done, RLS "autenticado lee / admin escribe", `revoke … from anon`, rollbacks en `supabase/rollbacks/`, cron diario | Leí las migraciones recientes y `SQL_MIGRATION_GUARDRAILS.md` |
| `etl/` ya usa `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` (`comercio_osm/run_sync.py`) y un workflow con `workflow_dispatch` | Leí `etl/` y `.github/workflows/` |

### 1.3 Registro de pendientes de comprobación (todo lo que sigue en [DOCUMENTADO]/[HIPÓTESIS])

| ID | Pendiente | Cómo se cierra | Bloquea |
|---|---|---|---|
| P1 | ~~MINVU anual: hojas, destinos, CUT, total país, marcas~~ **CERRADO [COMPROBADO]** con los XLSX reales (SHA-256 en `data_sources.verification_note`): 6 hojas; encabezado fila 6, meses fila 7, «Total País » fila 8; **sin CUT** (solo nombre → alias explícitos); 367 filas de comuna = 346 + 21 de Ñuble duplicadas; calidad por el *texto* de las notas («datos hasta 2024 son definitivos»), no por el símbolo (inconsistente entre archivos); Antártica sí viene (por nombre). La URL exacta de descarga la entrega quien baja el archivo (`--origin-url`, obligatorio) | — | — |
| P2 | ~~MINVU mensual~~ **CERRADO [COMPROBADO]**: mismo diseño; el año va en la fila 6 (primera columna de cada bloque) y los meses en la fila 7; la hoja `m2_casas` declara 65.536 filas (no se confía en `max_row`). El anual trae 2026 por mes (ene–jul) idéntico al mensual: se usa solo como control cruzado | — | — |
| P3 | **INE:** archivo exacto, campos, si desglosa comercio/oficinas/industria/equipamiento y a qué escala, último período, licencia | Muestra del archivo INE | Carga INE (hoy **no** hay serie INE comprobada) |
| P4 | Comparación MINVU vs INE para una misma comuna y año; diferencias (obra nueva vs ampliación, fecha de corte) | P1 + P3 | Informe de calidad |
| P5 | Texto exacto de licencia/atribución de MINVU CEDOC | **ABIERTO.** Los XLSX **no traen licencia** (comprobado en ambos); chile-hub solo dice «uso autorizado con cita». Hasta leerlo en el sitio oficial, `license_label` sigue «por confirmar» y la leyenda muestra solo la atribución | Leyenda definitiva |
| P6 | Cadencia y rezago reales (hoy hipótesis: MINVU 75 d, INE 45 d, deducidas de "datos a julio / agosto vistos el 16-oct") | Registrar `source_checks` 3+ meses | Umbrales de alerta |
| P7 | **SEIA:** formato de `COMUNAS` (¿separador?, ¿varias comunas?), CRS de `X/Y/NUEVO_X/NUEVO_Y` frente a la geometría de `f=geojson`, formato exacto de las fechas epoch, unicidad de `ID_EXPEDIENTE`, términos de uso del servicio, `editingInfo.lastEditDate` | Una consulta real desde un entorno con red | Carga SEIA |
| P8 | Origen y generalización de `public/comunas.geojson`; la tolerancia de 500 m es hipótesis | Documentar su origen; medir distancias de puntos válidos al borde | Umbral `near_border` |
| P9 | Cómo monta capas `MapaComunas.tsx` y si el front tolera una capa con `feature_count = 0` | Prueba en rama del front | Migración 3 |
| P10 | Las migraciones no se probaron contra el proyecto Supabase real (grants de `has_role`, `layer_nodes_guard`, `pg_cron` reales) | Probar en rama/copia (checklist de guardrails) | Aplicar |

---

## 2. Cómo encaja en el repo (sin reescribirlo)

* **Comunas — `comunas` es la ÚNICA fuente de CUT en la base** (ajuste 3). Se siembra desde `public/codigos_territoriales.csv` +
  `public/comunas.geojson` con `python etl/permisos_comunas.py seed`. Las geometrías entran **solo** por `set_comuna_geometry()`
  (ver §3.6): nunca se rechaza una comuna por geometría inválida. `12202` queda sin geometría pero con sus datos.
  Relación con lo existente, para que **no haya dos geometrías comunales divergentes**:
  * `layer_nodes` **no tiene geometría ni CUT** (es el árbol); no compite.
  * `territorial_features` guarda geometrías **importadas por usuarios** (capas propias), no es la fuente de límites comunales. Ninguna
    capa temática copia polígonos comunales ahí: se pinta desde una RPC que devuelve valores por CUT.
  * `public/comunas.geojson` y `codigos_territoriales.csv` son la **semilla** y los archivos que el front sigue leyendo; el front une por
    `codigo_comuna` (texto). `python etl/permisos_comunas.py check` compara base ↔ archivos (CUT, nombres, geometría exacta con
    `ST_OrderingEquals`) y sale con código 1 si divergen. Quien cambie uno debe sembrar o correr el `check`.
  * Otras tablas existentes (`comercio_poi`, `street_catalog`…) guardan la comuna como **nombre**, no CUT; migrarlas a `comuna_cut` con FK es
    un trabajo futuro, **no** se hizo aquí.
* **Árbol:** carpeta raíz *Edificación y expansión urbana* (por `slug`, no por nombre) y hoja *Permisos de edificación*. La hoja nace
  insertando en `territorial_layers` (el trigger legacy crea el nodo, igual que hoy el importador). Una tabla `thematic_layers` marca
  esa hoja como **temática**: se pinta desde una RPC, sin copiar 345 polígonos a `territorial_features` por cada capa coroplética.
* **Geometrías de comunas en el front:** se reutiliza `public/comunas.geojson` y su propiedad `codigo_comuna` (texto), como ya hace
  `ChileCommunesLayer.tsx`.
* **ETL:** carpeta nueva `etl/permisos/`, mismo estilo que `etl/comercio_osm/` (módulos + `run_*.py`).

---

## 3. Modelo de datos

### 3.1 Diagrama

```
data_sources ──< source_snapshots ──< building_permit_statistics >── permit_series >── data_sources
     │                  │                     │ (comuna_cut)
     │                  ├──< permit_rejected_rows
     │                  ├──< snapshot_control_totals >── permit_series
     │                  └──< building_projects (SEIA, fase 2) >──< building_project_geo_reviews
     ├──< source_checks         comunas ──< building_permit_statistics
     ├──< source_alerts         comunas ──< comuna_name_aliases >── data_sources
     └──< permit_destination_map
territorial_layers ──1:1── thematic_layers          source_freshness_v (vista)
```

### 3.2 Tablas

| Tabla | Para qué | Claves y restricciones destacadas |
|---|---|---|
| `pipeline_settings` | Umbrales **configurables** (nada está fijo en el código): `publish.max_reject_ratio` 0,005 · `projects.near_border_m` 500 · `comunas.geom_repair_max_area_diff_pct` 1 · `retention.keep_snapshots` 2 · `etl.monthly_keep_years` 5 · `etl.annual_from_year` 2002 | `pipeline_setting(key)` las lee; solo `admin` escribe |
| `data_sources` | Catálogo: URL oficial, licencia, atribución, `access_mode`, cadencia, rezago, holgura, **`verification_status`**, alcance | `source_key` único; `comprobado` exige `verified_at` |
| `source_snapshots` | Cada captura: `origin_url` exacta, `captured_at`, `declared_date` (NULL = el origen no la declara), período, `load_from`, `scope`, `sha256`, `storage_path`, `layout` (dónde está cada comuna/columna en el archivo), `validation_report` | `UNIQUE(source_id, sha256)` → recargar el mismo archivo es idempotente |
| `source_checks` / `source_alerts` | Cada revisión (aunque no traiga nada) y las alertas de frescura | Una alerta abierta por (fuente, tipo) |
| `comunas` | **Única fuente de CUT** (texto de 5 dígitos, `CHECK` de formato y prefijo región/provincia). `geom` MultiPolygon **válida** (`CHECK`), `geom_original` solo si se reparó, `geom_status` = `ok`/`repaired`/`needs_review`/`absent` | PK `cut`; `UNIQUE(region_cut, name_norm)`; GIST en `geom` |
| `comuna_geom_repairs` | Registro de cada reparación: método, áreas antes/después, diferencia %, si pasó a revisión manual | append-only |
| `comuna_name_aliases` | Cruce nombre→CUT **explícito y con motivo** (por fuente) | Lo que no calce **detiene la carga**; no hay coincidencia aproximada |
| `permit_series` | Dimensión (≈ 12 filas): fuente, métrica (`units`/`area_m2`), granularidad, **destino declarado**, tipo de obra declarado, hoja de origen + clases normalizadas | `UNIQUE` por fuente/métrica/destino/obra |
| `permit_destination_map` | Reglas de normalización como **datos** | — |
| `building_permit_statistics` | Hechos con **rango de vigencia**: `series_id smallint`, `comuna_cut char(5)`, `period date`, `value integer`, `is_provisional`, `from_snapshot`, `to_snapshot` (NULL = vigente) | **Sin PK a propósito** (ahorra 6 MB); único parcial `(series_id, period, comuna_cut) where to_snapshot is null`; trigger de inmutabilidad (solo `to_snapshot` NULL→n, una vez) |
| `permit_stage` | Zona de paso del snapshot en curso; se vacía tras publicar | — |
| `permit_rejected_rows`, `snapshot_control_totals` | Cada celda rechazada con motivo; total nacional **publicado** vs suma de comunas | `publish` rechaza si algún control no cuadra |
| `thematic_layers` | Marca una hoja del árbol como capa temática | PK = `territorial_layers.id` |
| `building_projects`, `building_project_geo_reviews` (fase 2) | Proyectos SEIA + revisión humana append-only | migración 4, opcional |

### 3.3 Índices y RLS

* **Índices:** `bps_one_current_idx` (único parcial de los vigentes; sirve también a la coroplética), GIST en `comunas.geom`, y los únicos
  de las tablas pequeñas. Se **eliminó** el índice de mapa aparte y la PK de hechos: eran redundantes (§3.4).
* **RLS** (coherente con `layer_nodes`/`territorial_*`): `authenticated` lee; escribe solo `admin`. `building_permit_statistics` **no tiene
  política de escritura**: solo `publish_permit_snapshot()` (`service_role`). `anon` sin acceso. El bucket `source-snapshots` es privado y
  sin UPDATE/DELETE: el original capturado no se reescribe.

### 3.4 Espacio — medido, con desglose y por qué crece

**Qué multiplica el tamaño.** Filas de hechos = **comunas (346) × períodos × series (6) × versiones guardadas**. Con los archivos reales:
anual = 346 × 24 años × 6 = **49.824** filas; mensual (últimos 5 años) = 346 × 60 × 6 = **124.560**; total vigente **174.384**. Cada
**versión nueva con cambios** suma solo las celdas que cambiaron (rangos de vigencia), no un archivo entero.

| Diseño (medido en PostgreSQL 16) | Hechos + índices | Observación |
|---|---|---|
| 1. Plano, textos repetidos por fila, mensual completo | 307 MB | descartado |
| 2. Dimensión `permit_series`, PK compuesta, 2.º índice (heap 49 + PK 61 + único vigente 41 + mapa 6 MB) | 158 MB | descartado: **un snapshot entero por carga** |
| 3. **Actual**: rangos de vigencia, sin PK, `smallint`/`char(5)`/`integer`, sin JSONB por fila | **17 MB** | datos reales |

Desglose del diseño actual, **datos reales** (ambos XLSX cargados, medido con `pg_total_relation_size`):

| Objeto | Tamaño |
|---|---|
| `building_permit_statistics` (heap, 174.384 filas ≈ 51 B/fila) | 8,9 MB |
| `bps_one_current_idx` (único parcial de vigentes) | 8,6 MB |
| **Hechos + índices** | **17 MB** |
| `comunas` (tabla 2,2 MB + geometrías en TOAST ≈ 6,5 MB; GIST 48 kB) | 8,7 MB |
| Resto (catálogos, snapshots, series, controles: 504 totales) | < 0,5 MB |
| **Total con datos reales** | **≈ 26 MB** (meta < 30 MB ✔) |

Escenarios (hechos + índices; sumar 8,7 MB de `comunas`): carga inicial 17 MB · con una revisión realista de la fuente (cambian pocas celdas,
2 snapshots) 20 MB · techo en régimen permanente con `keep = 2` tras purgar 21 MB · **pico transitorio 34 MB** si no se purga (por eso
`purge_superseded_permit_rows` corre al terminar cada carga). Crecimiento: la ventana mensual de 5 años **se desliza pero no borra** lo ya cargado
(≈ +2,4 MB/año de hechos); si molesta, se poda con un `delete` de `to_snapshot is null and period < …` (no implementado; decisión abierta, §13).

Revisión de tipos e índices (ajuste 2): `series_id smallint` (12 valores), `comuna_cut char(5)` (texto de ancho fijo, conserva ceros), `value integer`
(MINVU entrega enteros al 100 %; verificado), `period date`. No hay JSONB por fila (`layout` vive **una vez** en el snapshot y da la celda
de origen a pedido), ni columnas de texto repetidas. Los «tramos de superficie» **no existen** en los archivos MINVU (solo unidades y m² por destino);
si el INE los trae, irán a una tabla **fría** aparte, no a esta.

### 3.5 Decisiones de modelado y alternativas descartadas

* **Formato largo, no ancho:** una columna por año/métrica obliga a migrar cada vez que aparece un destino o un período.
* **Rangos de vigencia (`from_snapshot`/`to_snapshot`) en vez de `is_current` + copia completa por snapshot:** una revisión cuesta lo que cambia, y el
  historial de cada celda es reconstruible. `publish` aplica la **diferencia**: sin cambio → no escribe; cambió → cierra y abre; ausente en
  un snapshot completo dentro de su ventana → se retira (con registro).
* **Dos snapshots con filas** (ajuste 4): `purge_superseded_permit_rows` conserva reconstruibles los últimos K (K = `retention.keep_snapshots`); **nunca**
  toca filas vigentes ni los originales en Storage (siempre con hash).
* **Mensual solo los últimos 5 años; anual completo desde 2002** (`etl.monthly_keep_years`, `etl.annual_from_year`).
* **Un snapshot parcial no borra períodos antiguos.**
* **Estadística y proyectos en tablas distintas.** **No se copian polígonos por capa:** `thematic_layers` + RPC.
* **Alias de comuna como tabla, no como `if` en el ETL.**

### 3.6 Geometrías comunales: reparación, no rechazo (ajuste 1)

`set_comuna_geometry(cut, geom, origen)` es la **única** vía de escritura de `comunas.geom`:

1. Válida → se guarda tal cual (`ok`).
2. Inválida → `ST_MakeValid` + `ST_CollectionExtract(…, 3)` + `ST_Multi`; la **original** queda en `geom_original`, hay fila en `comuna_geom_repairs`, estado `repaired`.
3. Si el área reparada difiere más de `comunas.geom_repair_max_area_diff_pct` (1 %), o la original es de área incalculable, o la válida tiene área 0 → `needs_review` (vista `comunas_geom_review_v`).
4. Hoy: **13110 La Florida** y **06204 Marchihue** quedan `repaired` (diferencia de área ≈ 0, por debajo del umbral); **12202 Antártica** queda `absent` **con** sus datos de permisos.

---

## 4. Pipeline de ingesta

```
 1 ADQUIRIR      manual (MINVU, INE) | API paginada (SEIA) | descarga automática opcional
 2 ARCHIVAR      sha256 → Storage `source-snapshots/<source_key>/<yyyy>/<sha256>-<archivo>`   (original sin tocar)
 3 REGISTRAR     INSERT source_snapshots (status=received); si el hash ya existe → "ya cargado", no duplica
 4 PARSEAR       lee el original; nunca lo modifica
 5 NORMALIZAR    nombre→CUT (comunas + aliases), destino→clase (permit_destination_map), período→fecha
 6 VALIDAR       §4.2; lo inválido va a permit_rejected_rows con motivo
 7 CARGAR        filas a permit_stage; status=validated
 8 PUBLICAR      publish_permit_snapshot(): re-valida en la base y aplica solo la DIFERENCIA (rangos de vigencia)
 9 PURGAR        purge_superseded_permit_rows (conserva los últimos K snapshots reconstruibles; nunca toca Storage)
10 REGISTRAR     source_checks (ok_new_data | ok_no_new_period | …)
```

### 4.1 Por fuente

* **MINVU CEDOC (manual, parser ya implementado y probado con los XLSX reales):** descarga **manual o desde IP chilena**; el ETL corre **en la máquina
  del usuario** (`python etl/permisos_minvu.py --file <xlsx> --dry-run`, luego sin `--dry-run` y con `--origin-url`); el original se archiva con hash en Storage. La descarga automática es **opcional**, con reintentos y alerta de frescura, y debe asumir que fallará
  (TLS cortado, **[COMPROBADO·usuario]**). Reutilizar el extractor MIT de `chile-hub` (`permisos_edificacion_extractor.py`, 654 líneas,
  hojas `número/m2 × total/casas/departamentos`) como **referencia del parser**, citando su licencia; no su capa de descarga.
* **INE:** parser **no diseñable todavía** (P3). Hay slot en el modelo (`ine_permisos_superficie`, sin series ni mapa de destinos) pero
  **no se carga nada hasta tener una muestra comprobada**.
* **SEIA (API):** `returnCountOnly` por capa → paginar con `orderByFields=OBJECTID`, `resultOffset += 2000`, `outSR=4326`,
  `f=geojson` → exigir `cargadas + rechazadas = conteo del servicio` (lo hace `publish_project_snapshot`; una paginación cortada
  **se rechaza**). Guardar las páginas crudas comprimidas como el "archivo original" del snapshot. Capa 2 (DIA) = 15 páginas.

### 4.2 Validaciones (todas exigidas antes de publicar)

| # | Regla | Dónde se hace cumplir |
|---|---|---|
| 1 | La referencia tiene **346** comunas; CUT = texto de 5 dígitos | `CHECK` + `publish` |
| 2 | Sin duplicados dentro del snapshot | el parser rechaza duplicados (`duplicate_key`) y el único parcial de vigentes los impide; nunca se deduplica callado |
| 3 | Toda comuna presente o **declarada ausente con motivo** (`validation_report.comunas_absent_declared`; hoy `12202`) | `publish` |
| 4 | Totales comunales = total nacional publicado por la fuente | `snapshot_control_totals` + `publish` |
| 5 | Tasa de rechazo ≤ 0,5 % (parámetro) | `publish` |
| 6 | Destino sin mapeo → **rechazo**, no clasificación por defecto | ETL + `permit_destination_map` |
| 7 | Valores ≥ 0, período bien formado, CUT existente | `CHECK` / FK |
| 8 | Series de la misma fuente que el snapshot | `publish` |
| 9 | Hash ya cargado → no recarga | `UNIQUE(source_id, sha256)` |

Cada corrida imprime (o con `--json` entrega) conteos, rechazos y el cuadre con el total nacional; **`--dry-run` no escribe nada** (ni base, ni Storage, ni disco). Los rechazos de una carga real quedan en `permit_rejected_rows` y el informe en `source_snapshots.validation_report`.
Códigos de salida del CLI: 0 ok · 2 estructura/nombres/falta `--origin-url` · 3 cuadre no coincide · 4 error de base o Storage · 5 celdas rechazadas.

**Verificado con los archivos reales [COMPROBADO]:** Σ comunas = «Total País» en las 504 columnas×hojas (anual 2017 = 133.914, 2018 = 150.491, 2025 = 66.947; 2026 ene–jul = 5.981, 5.961, 6.752, 6.298, 5.917, 4.811, 6.482 = 42.202); total = casas + departamentos en toda comuna y período;
anual = Σ meses; Ñuble se fusiona por período (Chillán 16101: 899 en 2002, 1.473 en 2017 con la fila «Ñuble (ex-Biobío)», 1.850 en 2018 con «Ñuble»). Cuatro alias explícitos: Coyhaique → 11101, Aysén → 11201, O’Higgins → 11302, Cabo de Hornos (Ex - Navarino) → 12201.

> **Nota sobre "346 comunas":** hay 346 en la referencia pero **345 con geometría**. La capa pinta 345 polígonos; `12202` Antártica **sí viene** en los XLSX y se carga (no depende del polígono); el panel la lista como «sin polígono en el mapa».

---

## 5. Frescura

* **Atraso esperado** = `último period_end` + `cadence_days` + `publication_lag_days` + `grace_days`. Pasada esa fecha la fuente es
  `stale` aunque su URL responda. `source_freshness_v` lo calcula; `raise_freshness_alerts()` (pg_cron diario 06:41 UTC) abre/cierra alertas.
* **Cada revisión se registra** (`source_checks`), con resultado `ok_no_new_period` cuando la URL funciona pero no hay período nuevo.
  Sin revisión en `2 × check_every_days` → alerta `check_overdue`.
* **En el SIG** (§7): cada capa muestra fuente, último período, fecha de captura, fecha declarada, estado de verificación y semáforo de frescura.
* Umbrales iniciales (**[HIPÓTESIS]**, P6): MINVU 30 + 75 + 15 d; INE 30 + 45 + 15 d; SEIA 7 + 0 + 7 d.

---

## 6. Frecuencia realista y procedimiento manual

| Fuente | Acceso | Cadencia de revisión | Qué se espera |
|---|---|---|---|
| MINVU CEDOC anual / mensual | **manual** (TLS bloqueado desde nubes) | revisar cada 7 días, 1 período nuevo ≈ cada 30 d con ~75 d de rezago **[HIPÓTESIS]** | alerta si pasa el atraso esperado |
| INE permisos | manual (hasta comprobar) | idem; rezago ~45 d **[HIPÓTESIS]** | — |
| SEIA (API) | automático, semanal | foto completa cada 7 d | alerta si falla 2 semanas |
| Comunas / geometrías | manual, rara vez | solo al cambiar la DPA | — |

### 6.1 Cuándo NO automatizar
MINVU: el filtrado es por IP de origen (**[COMPROBADO·usuario]**); un workflow de GitHub Actions fallará. No se intenta eludirlo.

### 6.2 Procedimiento manual MINVU (implementado: ver `etl/permisos/README.md`)
1. Desde una IP chilena, abrir la página CEDOC y descargar «Viviendas, unidades y superficie según año y comuna» (anual) y el mensual. Guardar **sin abrir/re-guardar en Excel** (cambia los bytes y el hash).
2. Anotar la **URL exacta** del enlace de descarga y cualquier **fecha que declare** la página o el archivo.
3. Ensayo, sin escribir nada: `python etl/permisos_minvu.py --file <xlsx> --dry-run` (opcional `--compare-with <el otro xlsx>`). **Revisar el reporte** (conteos, rechazos, cuadre con «Total País»).
4. Carga: la misma línea sin `--dry-run` y con `--origin-url '<url exacta>'` (y `--declared-date AAAA-MM-DD` si el origen declara una). Calcula el hash, sube el original a Storage, registra el snapshot, valida en la base y publica solo la diferencia. Si el hash ya estaba cargado, lo dice y termina.
5. Repetir con el otro archivo. Si se revisó la página y **no había período nuevo**, queda como revisión (`source_checks`, `ok_no_new_period`).

---

## 7. Integración en el SIG

**Capa:** *Edificación y expansión urbana ▸ Permisos de edificación* (hoja temática, `renderer = choropleth_comuna`).

* **Controles:** **período** (año · acumulado del año · mes), año y mes (solo los realmente publicados; el año parcial no se ofrece como «año»), **métrica** (unidades · m² · variación interanual) y **tipo de vivienda** (total/casas/departamentos). La fuente la decide el período (anual o mensual) y se muestra siempre.
* **Mapa:** polígonos de `public/comunas.geojson` unidos por `codigo_comuna` (texto) a `get_permit_choropleth()`. Escala secuencial para valores y divergente para variación. **"Sin dato" con relleno distinto al 0**, nunca el color del 0.
* **Leyenda (obligatoria):** nombre de la fuente, **último período**, **fecha de captura**, **fecha declarada** (o "no declarada"), semáforo de frescura, y badge **"Fuente no verificada"** si `verification_status <> 'comprobado'` (MINVU quedó `comprobado` en estructura y hash; la licencia sigue abierta — P5 —; INE no se carga). Alcance explícito: "solo vivienda". Enlace a la fuente oficial.
* **Ficha de comuna** (`get_permit_series()`): serie temporal; cada punto con enlace al **snapshot** (URL de origen + página oficial), destino **original** declarado, hoja/fila/columna de origen y marca de provisional.
* **Variación interanual honesta:** solo si ambos lados están completos. Un año parcial (p. ej. 2026 a julio) **no** se presenta como anual ni se compara contra un año entero; para eso existe `ytd` (enero–mes vs. mismo rango del año anterior). Probado.
* **Componentes (implementados):** `PermitsHost` (se monta dentro de `TerritorialLayersHost` de `MapView.tsx`, así `Index.tsx` no se toca; las capas temáticas se excluyen de `TerritorialLayersLayer`), `PermitsChoroplethLayer`, `PermitsPanel` (controles + leyenda + fuente), `PermitsFichaDialog`; hooks `usePermits`, servicio `permitsService` (RPC con cast localizado porque `integrations/supabase/types.ts` es generado: regenerarlo al aplicar las migraciones). La capa nace **apagada**.
* **P9 (resuelto en código):** una capa territorial con 0 features es inofensiva y, de todos modos, las capas temáticas se excluyen del renderer de polígonos; si `thematic_layers` aún no existe el servicio devuelve `[]` y el mapa no se rompe.
* **Orden de despliegue:** la migración 3 (nodo en el árbol) va **después** de desplegar el front que sabe pintar capas temáticas (mismo criterio que `retire_legacy_layer_tables`).

---

## 8. Proyectos individuales: SEIA (fase 2)

* **Qué es y qué no:** solo proyectos que **ingresan al SEIA**. `FECHA_CALIFICACION` **no** es permiso ni inicio de obras; `INVERSION_US` es **declarada**. Los `COMMENT ON COLUMN` y el texto de la ficha lo dicen.
* **Tabla** `building_projects`: campos del servicio + `raw jsonb` (incluye `X, Y, NUEVO_X, NUEVO_Y, MODIFICADO, OBJECTID`) + `comuna_cuts` resueltos por el ETL (vacío = no cruzó) + estado de validación geográfica.
* **Validación punto-en-polígono** (`check_project_geometry`) contra la(s) comuna(s) que **declara el propio expediente**:

| Estado | Significado |
|---|---|
| `inside` | el punto cae dentro de una comuna declarada |
| `near_border` | fuera, a ≤ tolerancia (500 m, **[HIPÓTESIS]**: la geometría comunal puede estar generalizada) |
| `outside_declared` | fuera y a más de la tolerancia → **se marca, no se mueve** |
| `comuna_unmatched` | no se pudo traducir `COMUNAS` a CUT |
| `no_geometry` | el servicio no trajo punto |

  El caso reportado (Lo Barnechea con punto en lat -33,80) se reprodujo con coordenadas construidas desde la geometría real y queda `outside_declared` con la distancia registrada. **La geometría original no se modifica nunca** (trigger); una corrección es una fila en `building_project_geo_reviews` (quién, cuándo, por qué) y el mapa muestra el punto original con la corrección **propuesta** aparte.
* **Cierre de carga:** `publish_project_snapshot` exige que `cargadas + rechazadas = conteo del servicio` y que no queden proyectos sin validar.
* **Pendiente:** RPC de lectura por bbox/filtros (usará el GIST) y decisión de si se espeja a `territorial_features`; lo recomendable es una RPC dedicada.

---

## 9. Fuentes futuras (fuera del MVP, el modelo ya las admite)

* **DOM municipales (Ley 21.718, art. 116 bis C LGUC):** listado mensual de permisos por comuna (5.º día hábil), PDF heterogéneo. Se trata como fuente **por comuna**: cada feed sería un `data_source`/snapshot con su propio hash y el informe SEREMI (10.º–15.º hábil) alimentaría `source_checks` de cumplimiento por comuna. No entra al MVP: cada comuna requiere su parser.
* **MapBiomas Chile Colección 2 (crecimiento físico):** anual 1999–2024, 30 m, CC-BY 4.0 según sus términos. Se calcularían estadísticas zonales por comuna y año (tabla análoga con la misma procedencia). **Etiquetar la clase como "Infraestructura urbana (MapBiomas)", no como "superficie edificada"**: es cobertura urbanizada, no huella de edificios. Consultar su ATBD antes de mapear la clase.

---

## 10. Entrega y orden

Dos conjuntos de parches **separados** (`git format-patch`), más un zip con la estructura del repo:

1. **`01-migraciones/`** — `supabase/migrations/*` (1, 2, 3 y 4 opcional), `supabase/rollbacks/*`, `supabase/tests/*` y este documento. Probar en una rama/copia de Supabase antes de producción (P10).
2. **`02-etl-front/`** — `etl/permisos/`, `etl/permisos_minvu.py`, `etl/permisos_comunas.py`, `etl/requirements.txt`, front (`src/…/Permits*`, servicio, hooks, utils, tests).

Orden de aplicación: migración 1 → migración 2 → `permisos_comunas.py seed` → carga de los 2 XLSX → desplegar el front → **migración 3** (nodo en el árbol; el front tolera que aún no exista `thematic_layers`) → fase 2 (migración 4) cuando se quiera.

**Lo que no se pudo hacer desde esta sesión:** alcanzar Postgres/Storage reales (el proxy no admite TCP crudo ni los hosts gov), así que la **carga real a Supabase la corres tú** con `SUPABASE_DB_URL`; el ETL ya se ejecutó extremo a extremo contra PostgreSQL local.

---

## 11. Criterios de aceptación

Estado: ✔ = comprobado en esta sesión (PostgreSQL local / vitest) · ◻ = pendiente de comprobar en el entorno real.

**Procedencia y confiabilidad**
- [x] A1. Toda fila de hechos tiene `from_snapshot` y serie; todo snapshot tiene `origin_url`, `captured_at`, `sha256` y período. ✔
- [x] A2. Cada valor de la ficha se rastrea a URL de origen, página oficial, snapshot y **celda del archivo** (`cell_ref`, p. ej. `número_total!R245`, con la fila correcta de Ñuble). ✔ (RPC + UI con tests; UI no vista en navegador)
- [x] A3. El destino declarado se conserva junto a la clase normalizada. ✔
- [x] A4. Un valor publicado es inmutable; un snapshot nuevo cierra/abre solo lo que cambió. ✔
- [x] A5. Fuente no comprobada ⇒ badge «Fuente no verificada» (panel y ficha). ✔ (tests)

**Carga y validación**
- [x] B1. El ETL se detiene con comuna sin match/ambigua/de otra región, y rechaza celdas negativas, vacías o no numéricas con motivo. ✔
- [x] B2. No se publica con ≠ 346 comunas (salvo ausentes declaradas), con controles que no cuadran, o con rechazo > umbral configurable. ✔
- [x] B3. Recargar el mismo archivo no duplica nada (`already_loaded`). ✔
- [x] B4. CUT siempre texto de 5 dígitos. ✔
- [x] B5. `--dry-run` no escribe nada y muestra conteos, rechazos y cuadre con el total nacional. ✔
- [x] B6. Los totales reales cuadran (§4.2). ✔

**Frescura**
- [x] C1. Una fuente sin período nuevo pasado el atraso esperado figura `stale` y genera alerta única. ✔ (SQL) · badge en panel ✔
- [x] C2. La capa muestra fuente, último período, captura, fecha declarada. ✔

**Mapa**
- [x] D1. Sin dato ≠ 0; variación solo con ambos períodos completos; año parcial no es elegible. ✔
- [x] D2. Selector de período (año / acumulado / mes), métrica (unidades, m², variación) y tipo de vivienda; leyenda con fuente y verificación. ✔ (vitest; **no se vio en un navegador real**)
- [x] D3. Coroplética < 1 s. ✔ 6–12 ms con 610 mil filas sintéticas (medida previa) — ◻ repetir en Supabase real.

**Seguridad y operación**
- [x] E1. RLS: `authenticated` lee, solo `admin` escribe catálogo; nadie escribe estadísticas por la API; `anon` sin acceso. ✔
- [x] E2. Cada migración: lock + `_migration_log`, idempotente, conteos antes/después, rollback probado. ✔
- [ ] E3. Probado en rama/copia del proyecto real. ◻ **pendiente** (P10)
- [x] E4. Espacio < 30 MB con datos reales (≈ 26 MB) y purga de historial. ✔

**Comunas**
- [x] G1. 13110 y 06204 se reparan (no se rechazan), con original, registro y marca de revisión si el área difiere > 1 %. ✔
- [x] G2. 12202 sin geometría y con datos. ✔
- [x] G3. `comunas` única fuente de CUT; `check` detecta divergencia con los archivos del repo. ✔

**SEIA (fase 2)**
- [x] F1. Punto fuera de su comuna ⇒ `outside_declared`, sin mover el original. ✔
- [x] F2. Carga incompleta rechazada. ✔
- [ ] F3. La ficha dice «no es permiso de edificación» y «inversión declarada». ◻ (UI de fase 2 no construida)

---

## 12. Pruebas ejecutadas (evidencia)

* **SQL:** PostgreSQL 16 + PostGIS 3 local, esquema mínimo que imita al del repo (`supabase/tests/permits_stub_esquema_minimo.sql`) y las **346 comunas reales**. `permits_stats.test.sql` = **92 aserciones OK**; `building_projects.test.sql` = **16 OK**; migraciones aplicadas 2–3 veces sin error; rollback 4→3→2→1 en cadena; la 1 se niega a revertirse mientras existan las otras.
* **ETL (pytest, 47 pasan):** 37 de parser/CLI sobre **fixtures reales recortados** de los XLSX MINVU (sin datos sintéticos), 6 de base de datos extremo a extremo (`TEST_DATABASE_URL`) y 4 contra los archivos completos (`MINVU_ANUAL`, `MINVU_MENSUAL`).
* **Carga real local:** seed idempotente; anual 49.824 + mensual 124.560 filas publicadas; recarga = `already_loaded`; sumas en la base = 133.914 / 150.491 / 66.947 / 42.202; 504 controles guardados, todos OK; 0 rechazos.
* **Front (vitest):** 23 pruebas nuevas (períodos, escala, servicio, panel, y un humo de `PermitsHost` en un `MapContainer`); `tsc` y `eslint` sin errores nuevos. En jsdom no hay SVG/canvas, así que el dibujo de polígonos de la coroplética **no se probó**.
* **Qué NO se probó:** el proyecto Supabase real; la subida a Storage real; el front en un navegador; la descarga de cualquier fuente; ninguna cifra INE (no se cargó).
* **Hallazgos que salieron de ejecutar (y se corrigieron):** 2 polígonos inválidos en `comunas.geojson` (ahora se reparan con auditoría); polígono válido de área 0 (ahora `needs_review`); consumo de espacio 2× el necesario (rediseño, §3.4); un `sum(integer)` que devolvía `bigint` y rompía la RPC (cast); varios supuestos erróneos míos en los tests (RLS sin política UPDATE afecta 0 filas sin error; `now()` es constante en la transacción).
* **Estado previo del repo (no es de este trabajo):** en `main`, `npm ci` falla por `package-lock.json` desincronizado (falta `esbuild@0.28.2`); 3 archivos de vitest fallan (`ImportWizard.test.tsx`, `layerTreeExport.test.ts`, `nearbyStores.test.ts`) y `tsc` reporta 22 errores en 8 archivos ajenos. Sigue igual tras estos cambios.

---

## 13. Riesgos y decisiones abiertas

1. **Probar en una copia del proyecto real** (E3/P10): `has_role` aparece revocada de `authenticated` en una migración antigua y las políticas recientes la usan igual; las políticas de Storage usan `private.has_role`. Copié cada patrón donde lo vi, pero solo la copia real lo confirma.
2. **Licencia MINVU (P5) sigue abierta.** Hasta leerla en el sitio oficial, la leyenda muestra solo la atribución.
3. **Historial:** `keep = 2` (configurable). Costo en régimen ≈ 21 MB de hechos; sin purga, pico de 34 MB.
4. **Ventana mensual:** se desliza pero no borra meses ya cargados (+≈ 2,4 MB/año). ¿Podar a 5 años exactos?
5. **Umbrales** (rechazo 0,5 %, borde 500 m, reparación 1 %): son valores **iniciales y configurables** (`pipeline_settings`); calibrar con datos reales (P8).
6. **Cadencia/rezago** de MINVU (30 + 75 + 15 días) es **[HIPÓTESIS]** hasta registrar 3+ meses de `source_checks` (P6).
7. **INE:** no se cargó nada; sin muestra comprobada no hay parser ni serie (P3/P4).
8. **Normalización per cápita:** `public/ine_communes.csv` existe pero su año/fuente no están comprobados; no se usa.
9. **Tablas existentes con comuna como nombre** (no CUT): migrarlas a `comuna_cut` con FK es trabajo futuro.
10. **Nombres y timestamps** de las migraciones son provisorios; se renumeran al aplicarlas (deben ser posteriores a `20261015130000`).
