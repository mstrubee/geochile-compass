# Fixtures de MINVU CEDOC (datos REALES recortados — no sintéticos)

Derivados de los dos XLSX que publicó MINVU CEDOC el **2026-09-11** (no están en el repo):

| Archivo original | SHA-256 |
|---|---|
| `PE Viviendas unidades y superficie según año y comuna 2002 a jul 2026.xlsx` | `158af0e4af401a909b6d30dfb4860b1f77c7a608c35c67d42a0bb2503b4705b7` |
| `PE Viviendas unidades y superficie según mes y comuna 2002 a jul 2026.xlsx` | `5f9a63ac993ea217aa4495224d54d29713dc5ebb787704fe211b7d575bd94e6c` |

Se generan con `python etl/permisos/tests/make_fixtures.py --annual <anual> --monthly <mensual>` (verifica el SHA-256 de entrada).

* **Se recorta por columnas, no por filas.** Se conservan las 6 hojas, la fila "Total País", los subtotales regionales, las **367 filas de comuna** y las notas al pie; así la suma de comunas sigue cuadrando con "Total País" en cada columna elegida.
* **Los valores son los originales, sin modificar.**
* `minvu_anual_recorte.xlsx`: años 2002, 2003, 2017, 2018, 2024, 2025 + los 7 meses de 2026.
* `minvu_mensual_recorte.xlsx`: todos los meses de 2017, 2018, 2024, 2025 y 2026 (ene–jul). La hoja `m2_casas` replica la "dimensión basura" de 65.536 filas del original.
* Las posiciones de **columna** difieren de las del original (se re-indexan); las **filas** son las mismas.
* La propiedad `modified` del XLSX es la fecha de generación del fixture, no la del original (openpyxl la reescribe): los tests no dependen de ella.
* Licencia/atribución de los datos: *Fuente: MINVU, Centro de Estudios de Ciudad y Territorio (CEDOC)*. El uso citando la fuente figura en el extractor de chile-hub (MIT); el texto exacto del sitio está pendiente de confirmar (P5 en `docs/permisos-edificacion/DISENO.md`).
