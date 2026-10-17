# Parte 4 — de la comuna al proyecto (INE permisos y CRF, SEIA)

Estado: **paso 0, sondeo de las fuentes.** Todavía no hay migraciones ni ETL de carga; se construyen sobre lo que este sondeo
compruebe (campos reales, conteos, cobertura, licencia), no sobre supuestos.

## Sondeo (solo lectura, corre en tu máquina)

```bash
source .venv-etl/bin/activate            # el mismo entorno del ETL de permisos
python etl/proyectos_probe.py --zip
```

Hace solo `GET` a los servicios públicos (no escribe en ninguna base, no usa credenciales) y deja en
`etl/output/proyectos_probe/<fecha>/` (y un `.zip` con `--zip`):

| Archivo | Para qué |
|---|---|
| `resumen.md` | conteos, campos, permisos por año, comunas con datos por año, licencia encontrada |
| `probe.json` | todo lo anterior en bruto (metadatos de cada capa, estadísticas agrupadas, registro de peticiones) |
| `sample_*.geojson` | recortes **reales** para los fixtures (años 2012/2019/2021/2024, precisión BAJA y nula, CRF, SEIA inmobiliarios) |
| `ine_item_metadata.xml` | metadatos del ítem de ArcGIS del INE, si existen (licencia/términos) |

Las capas sondeadas: INE `CRF_PE_v2` capas 0, 1 (PE_NACIONAL) y 2 (CRF_NACIONAL); SEIA `ProyectosSEIA` capas 1 (EIA) y 2 (DIA).
Si una consulta falla, el sondeo sigue y anota el motivo en `_errores`.

`python -m pytest etl/proyectos/tests -q` prueba la **mecánica** del sondeo contra un servidor ArcGIS falso y local; esos datos son
sintéticos y no representan ningún dato del INE ni del SEA.
