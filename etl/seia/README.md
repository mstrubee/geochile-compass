# ETL del SEIA (proyectos puntuales)

Carga a Supabase los proyectos que ingresan al **SEIA**, desde el servicio ArcGIS REST público del SEA
(`…/WEBServices/ProyectosSEIA/MapServer`: capa 1 = EIA, capa 2 = DIA). Diseño completo y decisiones:
[`docs/permisos-edificacion/DISENO.md`](../../docs/permisos-edificacion/DISENO.md), sección **Parte 4 – SEIA**.

> **Qué es y qué no.** Solo proyectos que **ingresan al SEIA**; no es un catastro de edificación. `FECHA_CALIFICACION` **no** es
> permiso ni inicio de obras, e `INVERSION_US` es **declarada**. El servicio **no se pudo alcanzar** desde la sesión que escribió
> esto (el host está bloqueado): la paginación se probó contra un servidor local que la imita, **no contra el servicio real**.

## Requisitos

```bash
pip install -r etl/requirements.txt          # requests, psycopg[binary], pytest…
export SUPABASE_DB_URL='postgresql://postgres:…@db.xxxx.supabase.co:5432/postgres'   # conexión directa a Postgres
export SUPABASE_URL='https://xxxx.supabase.co'                                       # solo para subir el original a Storage
export SUPABASE_SERVICE_ROLE_KEY='…'                                                 # (idem)
```

Migraciones: las de **permisos 1** (`data_sources`, `source_snapshots`, `comunas`…) y las dos primeras del SEIA
(`20261021120000_seia_projects.sql`, `20261021120100_seia_projects_read.sql`). La hoja del árbol (`…120200`) va **después** de
desplegar el front. `comunas` debe estar sembrada (`python etl/permisos_comunas.py seed`).

## Comando único

```bash
# 1) ENSAYO: pagina el servicio y valida; NO escribe en la base ni en Storage (ni disco, salvo --save-dir).
python etl/seia_proyectos.py --dry-run
python etl/seia_proyectos.py --dry-run --save-dir ./seia_originales      # además guarda el original (.seia.gz) para revisarlo o enviarlo

# 2) CARGA (las dos capas; una foto COMPLETA de cada una)
python etl/seia_proyectos.py
```

Otras opciones: `--layer eia|dia`, `--from-archive FILE` (reproduce una captura guardada **sin red**), `--db` (con `--dry-run`,
lee comunas y alias de la base en solo lectura), `--no-storage`, `--stage-only` (carga y valida pero no publica), `--json`.
Códigos de salida: **0** ok · **2** argumentos/archivo · **3** no cuadra con el servicio · **4** red, base o Storage ·
**5** hay expedientes rechazados (se carga igual si están bajo el umbral).

## Qué hace (en orden; todo-o-nada al publicar)

1. Pide el **conteo** (`returnCountOnly`), pagina con `orderByFields=OBJECTID` y `resultOffset += lo recibido` hasta una página vacía,
   y vuelve a pedir el conteo. **Exige**: recibidos = conteo = conteo final, y cargables + rechazados = conteo. Si no, **no carga**
   (paginación cortada, o el servicio cambió mientras se paginaba).
2. Guarda las páginas **tal como llegaron** en un archivo `.seia.gz` (Storage `source-snapshots/<fuente>/<año>/<sha>.seia.gz`). El
   SHA-256 del snapshot es el de las **páginas**, no el del archivo (que lleva metadatos de captura): recargar lo mismo es idempotente.
3. Normaliza (`normalize.py`): comunas por **nombre exacto** (+ alias de la fuente en `comuna_name_aliases`), fechas, inversión y punto.
   **Nada se corrige en silencio**: lo dudoso se cuenta en `AVISOS` del reporte. Un `ID_EXPEDIENTE` ausente o repetido **rechaza** la fila.
4. Inserta en `seia_projects` (COPY), valida la geografía en la base (`seia_check_geometry`: `inside` / `near_border` /
   `outside_declared` / `comuna_unmatched` / `no_geometry`; **nunca se mueve el punto original**) y publica (`seia_publish_snapshot`):
   mueve el **puntero** de la foto vigente. Después purga las filas de fotos viejas (`seia_purge_superseded`, K = `retention.keep_snapshots`).
5. Registra la revisión en `source_checks` (`ok_new_data`, `ok_same_content` o `unreachable`) para la alerta de frescura.

## Qué hacer con el reporte

* **Textos de comuna sin resolver**: si son variantes de una comuna real, agregar un alias para la fuente y volver a correr:
  `insert into comuna_name_aliases (source_id, raw_region_norm, raw_name_norm, cut, reason) …` (el nombre va normalizado: minúsculas, sin tildes).
* **AVISOS `date_utc_midnight` / `date_with_time`**: responden cómo guarda las fechas el servicio (pendiente P7). Si hay `bad_date:*`,
  hay un formato que el ETL no leyó: **no ignorar**.
* **TIPOLOGÍAS**: los valores reales de `LETRA_TIPOLOGIA` / `NOMBRE_TIPOLOGIA`. La capa del mapa nace filtrada por las letras de
  `thematic_layers.default_params.typology` (hipótesis `g`, `h`): **confirmarlas con esta lista**.

## Pruebas

```bash
python -m pytest etl/seia/tests -q                               # 60: mecánica (servidor ArcGIS falso local), sin base
TEST_DATABASE_URL=postgresql://postgres:…@127.0.0.1/seia_test python -m pytest etl/seia/tests -q    # +10 extremo a extremo
```

La base de prueba debe tener las migraciones de permisos 1–3 y del SEIA aplicadas y `comunas` sembrada; el nombre debe contener `test`
(las pruebas truncan las tablas del SEIA). **Todos los expedientes de las pruebas son sintéticos.**
