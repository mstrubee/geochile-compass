# ETL de permisos de edificación (MINVU CEDOC)

Carga a Supabase los dos XLSX de **MINVU CEDOC** — *viviendas, unidades y superficie, por comuna* (anual y mensual).
Diseño completo: [`docs/permisos-edificacion/DISENO.md`](../../docs/permisos-edificacion/DISENO.md).

> **Corre en tu máquina.** `catalogo.minvu.cl` corta el TLS desde nubes (verificado), así que el archivo se descarga a mano
> (o desde una IP chilena) y este ETL procesa **ese archivo**. No hay descarga automática.
> **INE no se carga** (decisión del 2026-10-16).

## Requisitos

```bash
pip install -r etl/requirements.txt          # openpyxl, psycopg[binary], pytest…
export SUPABASE_DB_URL='postgresql://postgres:…@db.xxxx.supabase.co:5432/postgres'   # conexión directa a Postgres
export SUPABASE_URL='https://xxxx.supabase.co'                                       # solo para subir el original a Storage
export SUPABASE_SERVICE_ROLE_KEY='…'                                                 # (idem)
```

Las migraciones **1 y 2** de `supabase/migrations/` deben estar aplicadas (la 3 —el nodo en el árbol— va después de desplegar el front).

## Comando único

```bash
# 1) ENSAYO: no escribe nada (ni base, ni Storage, ni disco). Imprime conteos, rechazos y el cuadre con el total nacional.
python etl/permisos_minvu.py --file ./PE_Viviendas_..._año_y_comuna_2002_a_jul_2026.xlsx --dry-run

# 2) CARGA: la misma línea, sin --dry-run, más la URL EXACTA de la que descargaste el archivo.
python etl/permisos_minvu.py --file ./PE_Viviendas_..._año_y_comuna_2002_a_jul_2026.xlsx \
                             --origin-url 'https://catalogo.minvu.cl/…'
```

El tipo (anual / mensual) se detecta solo por la estructura del archivo. Hazlo una vez por cada archivo.
Para cruzar ambos en el ensayo: `--compare-with <el otro archivo>`.

**Qué se carga** (decisión del 2026-10-16, configurable en `pipeline_settings`):

| Archivo | Se almacena | No se almacena |
|---|---|---|
| Anual | **años** desde 2002 (`etl.annual_from_year`) | sus 7 meses de 2026: son idénticos a los del mensual (se usan como control cruzado) |
| Mensual | **meses** de los últimos 5 años (`etl.monthly_keep_years`) | los meses anteriores (el anual cubre el largo plazo) |

## Qué hace (en orden; si algo falla no queda nada vigente)

1. Calcula el **SHA-256** del archivo; si ya está cargado, termina sin tocar nada (idempotente).
2. Sube el **original sin modificar** a Storage (`source-snapshots/<fuente>/<año>/<sha256>.xlsx`).
3. Lee el XLSX por su **estructura** (fila de años / fila de meses / "Total País" / filas de comuna / notas), no por posiciones fijas, y se detiene en las notas.
4. Cruza **nombre → CUT**: alias explícito o nombre normalizado único; **sin coincidencia aproximada**. Cualquier nombre sin match, ambiguo o de otra región **detiene la carga**.
5. **Fusiona las 21 comunas de Ñuble** (367 filas → 346 comunas) eligiendo, por período, la fila de la región vigente (corte 2018, de la nota del archivo), y exige que la otra fila valga 0.
6. **Calidad** desde el *texto* de las notas ("datos hasta 2024 son definitivos"): 2025 en adelante queda `is_provisional`. Marcas y notas se guardan literales.
7. **Cuadres**: suma de comunas = "Total País" en cada hoja y columna; `total = casas + departamentos` por comuna y período; subtotales regionales (informativo); y con `--compare-with`, anual = Σ meses.
8. Registra el snapshot (URL de origen, fecha de captura, fecha declarada, período, layout de celdas), deja las filas en `permit_stage` y llama a `publish_permit_snapshot()`, que **re-valida en la base** (346 comunas, totales de control, tasa de rechazo, período) y aplica solo la diferencia.
9. Purga versiones viejas (retención configurable = 2 snapshots; el archivo original **nunca** se borra).

### Códigos de salida

| Código | Significado |
|---|---|
| 0 | OK |
| 2 | estructura no reconocida, nombre de comuna sin match, o falta `--origin-url` |
| 3 | el cuadre con "Total País" no se cumple |
| 4 | error de base de datos o de Storage (no queda nada vigente) |
| 5 | hay celdas rechazadas (negativas, vacías o no numéricas) |

## Comunas: la tabla `comunas` es la ÚNICA fuente de CUT

```bash
python etl/permisos_comunas.py seed     # crea/actualiza comunas, geometrías (con reparación auditada) y alias
python etl/permisos_comunas.py check    # exit 1 si la base y public/comunas.geojson / codigos_territoriales.csv divergen
```

* Se siembra desde `public/codigos_territoriales.csv` y `public/comunas.geojson`. Las geometrías inválidas (hoy **13110 La Florida** y **06204 Marchihue**) se **reparan** con `ST_MakeValid` (+ `ST_CollectionExtract` a polígonos); la **original se guarda aparte** (`geom_original`), queda registro en `comuna_geom_repairs` y, si el área reparada difiere más del umbral (1 %), la comuna queda `needs_review`. **12202 Antártica** queda sin geometría, pero con sus datos.
* Un nombre del archivo MINVU que no calce con la tabla CUT se resuelve agregando una entrada a [`aliases_minvu.json`](aliases_minvu.json) (con su motivo) y corriendo `seed`. Hoy son 4: `Coyhaique`, `Aysén`, `O’Higgins` (Aysén) y `Cabo de Hornos (Ex - Navarino)`.

## Tests

```bash
python -m pytest etl/permisos/tests -q                                   # parser y CLI sobre fixtures REALES recortados
TEST_DATABASE_URL=postgresql://…/mi_base_test python -m pytest etl/permisos/tests/test_db.py   # extremo a extremo (la base debe llamarse *test*)
MINVU_ANUAL=… MINVU_MENSUAL=… python -m pytest etl/permisos/tests/test_real_files.py          # contra los archivos completos
```

Los fixtures son valores **reales** de MINVU recortados por columnas ([`tests/fixtures/README.md`](tests/fixtures/README.md)); no hay datos sintéticos en estos tests.
