# Parte 4 — de la comuna al proyecto (INE permisos y CRF, SEIA)

Diseño y decisiones: [`docs/permisos-edificacion/DISENO.md`](../../docs/permisos-edificacion/DISENO.md) (§Parte 4) · hallazgos del sondeo real:
[`docs/proyectos-parte4/HALLAZGOS_SONDEO.md`](../../docs/proyectos-parte4/HALLAZGOS_SONDEO.md).

> **Corre en tu máquina.** La sesión de desarrollo no alcanza los servicios del INE ni del SEA; todo lo de abajo se probó contra un servidor
> ArcGIS falso y local que sirve **recortes reales** (sondeo del 2026-10-17), y contra una base PostgreSQL de prueba.

## Requisitos
```bash
pip install -r etl/requirements.txt                 # incluye psycopg, shapely, requests
export SUPABASE_DB_URL='postgresql://…'             # solo para la carga real (o --db en el ensayo)
export SUPABASE_URL='https://xxxx.supabase.co'      # solo para subir el GeoJSON normalizado a Storage
export SUPABASE_SERVICE_ROLE_KEY='…'                #   (idem)
```
Migraciones aplicadas, en orden: `20261021120000` (INE permisos) → `20261021120100` (CRF) → `20261021120200` (SEIA); la `20261021120300` (capas en el árbol) va **después** de desplegar el front.

## Comandos
```bash
# 1) ENSAYO (no escribe NADA). Descarga, valida y reporta conteos, rechazos, validación geográfica, calidad y cuadre con MINVU.
python etl/proyectos_ine.py  --dry-run --minvu-file ./PE…anual….xlsx        # o --db para tomar MINVU de la base (solo lectura)
python etl/proyectos_seia.py --dry-run [--db]

# 2) CARGA (la misma línea sin --dry-run)
python etl/proyectos_ine.py
python etl/proyectos_seia.py
```
Opciones comunes: `--layer`, `--stage-only` (no publica), `--no-storage`, `--no-geocheck`, `--json`.
Códigos de salida: **0** ok · **2** campos esperados ausentes o capa vacía · **3** el conteo del servidor cambió durante la descarga / no cuadra, o la fuente no responde ·
**4** error de base de datos o Storage (no queda nada vigente) · **5** rechazos sobre el máximo (`publish.max_reject_ratio`).

## Qué garantiza
* **Conteo del servidor** (`returnCountOnly`) **antes y después** de la descarga y frente a lo descargado; si no coincide, falla. La base lo vuelve a exigir al publicar.
* **Hash del GeoJSON normalizado** (orden por OBJECTID, JSON canónico): si la capa no cambió, la carga termina con `already_loaded` sin tocar nada.
* El **original** es ese GeoJSON normalizado (`.geojson.gz`): siempre queda copia local en `etl/output/proyectos/` y, salvo `--no-storage`, en Storage `source-snapshots/<fuente>/<año>/<sha>.geojson.gz`.
  Con `--no-storage` el snapshot lleva una **nota** que lo dice (no se finge que se subió).
* Cada fila: CUT normalizado a 5 dígitos y validado contra `comunas`; rechazos con motivo (`geo_rejected_rows`); **nada se corrige en silencio**; los puntos fuera de su comuna se marcan, no se mueven.
* SEIA: filtro por **letra** de tipología (tabla `seia_typology_rules`, editable); el nombre de comuna que no cruza **no** detiene la carga (queda `comuna_unmatched`): agregue un alias en `etl/proyectos/aliases_seia.json`.
* Licencia: **por confirmar** (los servicios no la declaran). La capa lo muestra.

## Tests
```bash
python -m pytest etl/proyectos/tests -q                                          # arcgis, transformaciones, CLI (servidor falso, recortes reales)
TEST_DATABASE_URL=postgresql://…/mi_base_test python -m pytest etl/proyectos/tests/test_db.py   # carga real extremo a extremo (la base debe llamarse *test*)
python etl/proyectos_probe.py --zip                                              # sondeo de solo lectura de las 5 capas (genera los fixtures)
```
Los fixtures son **recortes reales** (ver `tests/fixtures/README.md`); lo sintético está rotulado en cada prueba.
