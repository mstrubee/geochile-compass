# Fixtures de etl/proyectos/tests

**Datos REALES** de los servicios del INE (`CRF_PE_v2`, capas 1 y 2) y del SEA (`ProyectosSEIA`, capas 1 y 2), recortados del sondeo del 2026-10-17
(`python etl/proyectos_probe.py`, corrido por el usuario). No están modificados; se recortan por cupo de filas con
`python etl/proyectos/tests/make_fixtures.py <carpeta_del_sondeo>`.

| Archivo | Contenido |
|---|---|
| `ine_pe.geojson` | 300 permisos (años 2012, 2019, 2021-2025; precisiones ALTA, MODERADA, BAJA y nula) |
| `ine_crf.geojson` | 186 recepciones finales (polígonos; CUT de 4 dígitos en regiones 1-9) |
| `seia_eia.geojson` | 130 proyectos EIA (32 inmobiliarios + otros: minería, energía…) |
| `seia_dia.geojson` | 140 proyectos DIA (100 inmobiliarios, incluye *Praderas La Dehesa*, expediente 2147600353) |
| `meta_*.json` | metadatos reales de cada capa (campos, `editingInfo`, `maxRecordCount`) |

El servidor ArcGIS de `conftest.py` es simulado (incluidos sus fallos: conteo que cambia, OBJECTID repetido, 500 transitorios); los datos que sirve son los de arriba.
