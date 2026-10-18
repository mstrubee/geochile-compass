# Hallazgos — Población comunal confiable (Censo 2024, INE)

Fecha de trabajo: 2026-10-18. Rama `feat/poblacion-censo-2024`. Ver `RUNBOOK_CENSO2024.md` para aplicar.

## 1. Fuente única

| | |
|---|---|
| Fuente | INE, Censo 2024, tabulado D1 «Población censada por sexo y edad en grupos quinquenales» (hojas 2 «comuna» y 4 «comuna × edad × sexo» a la base; hoja 1 solo para cuadrar) |
| URL | https://censo2024.ine.gob.cl/wp-content/uploads/2025/03/D1_Poblacion-censada-por-sexo-y-edad-en-grupos-quinquenales.xlsx |
| Archivo | 505.437 bytes · SHA-256 `1f3a9c97a1b3defa47a2fc3b8495688c4e08f164063cab704e7a18c41239e009` · `Last-Modified` 2025-12-04 |
| Publicación | 27-03-2025 (hoja *Nota*); tabla actualizada el 04-12-2025 por el cambio de nombre de Paihuano (Nota 2) |
| Período | 2024 (año del censo). Fechas exactas del levantamiento: [NO COMPROBADO] |
| Concepto | «Población censada» = residentes habituales censados (definición del propio archivo). **No es proyección.** |
| Licencia | CC BY-SA 4.0, **declarada por la página «Términos de uso y licencia de datos abiertos» del INE** (leída 2026-10-18); el XLSX no la repite y esa página no nombra el subdominio `censo2024.ine.gob.cl` → [NO COMPROBADO que el archivo esté cubierto expresamente]. CompartirIgual: atribuir, indicar cambios, no sugerir respaldo del INE; alcance sobre informes a clientes [NO COMPROBADO]: consultar. |

En la base: `data_sources` (+1) · `source_snapshots` (hash, período, publicación, original en Storage) · `poblacion_comunal` (346) · `poblacion_comunal_edad` (6.228) · RPC `get_poblacion_comunal()` y `get_poblacion_comunal_edad(cut)` (anon: nada; authenticated: solo lectura) · `get_layer_provenance('poblacion_censo2024')`.

## 2. Cuadres del dry-run local con el archivo real (12/12 ✔)
346 comunas · Σ comunas = país = 18.480.432 (hombres 8.967.033 + mujeres 9.513.399) · hoja 2 = hoja 1 · h + m = total en las 346 · Σ comunas por región = hoja 1 (16 regiones) · 18 grupos × 346 = 6.228 filas · Σ edades = hoja 2 por comuna (0 diferencias) · «Total Comuna» hoja 4 = hoja 2 · Σ por grupo = filas «País» · códigos 1:1 con `codigos_territoriales.csv` (346/346) · todo polígono de `comunas.geojson` tiene población (345; sin polígono: 12202 Antártica) · valores de control: Santiago 438.856 · Puente Alto 568.086 · Camarones 861. Carga real en una base local: todas las verificaciones del runbook (§4) dan lo esperado.

Nombres que difieren (la clave es el CUT): 04105 Paihuano/Paiguano · 11101 Coyhaique/Coihaique · 11201 Aysén/Aisen · 11302 O'Higgins/OHiggins (+ La Calera, Llay-Llay, Marchigüe, San Vicente de Tagua Tagua, Til Til en `COMMUNES`/CSV). Alias explícitos por CUT en `poblacionService.NAME_ALIASES`; una prueba verifica que **toda** comuna de `COMMUNES` y del CSV resuelve.

## 3. Qué estaba mal (antes de este PR)
- `public/ine_communes.csv`: población sin fuente. Σ = 17.666.680 vs Censo 18.480.432; 185/346 comunas difieren > 10 % y 51 > 25 % (Santiago 404.495 vs 438.856; Puente Alto 757.721 vs 568.086; La Florida 397.497 vs 374.836; Camarones 679 vs 861).
- `src/data/communes.ts`: 345 poblaciones y densidades escritas a mano («INE 2017 / proyecciones», Santiago 503.147, Puente Alto 645.909…), usadas como respaldo silencioso.
- `poiFeaturePayloadBuilder`: si faltaba la comuna o su población, inventaba **50.000 habitantes, 15.000 hogares, 50 km²** y seguía.
- Capa de delitos: el popup llamaba «Población» a la suma GSE `n_per` (16.185.953; 254 comunas difieren > 10 % del Censo; cubre 87,6 % del Censo en esas comunas; origen [NO COMPROBADO]) y el archivo declaraba «INE Censo 2024» como fuente.
- Isócronas: la población salía de manzanas GSE (`n_per`), manzanas Censo 2017 (RM) o comuna × área, y los textos decían a veces «Censo 2017» y a veces «Censo 2024» para lo mismo.

## 4. Inventario de lugares con población (archivo:línea **antes**, en `main`) y qué pasó

| Lugar | Antes | Ahora |
|---|---|---|
| `src/data/communes.ts` (345 filas) | `pop`/`density` a mano | `pop: 0` y `density: 0`; la población no vive en el código |
| `public/ine_communes.csv` | columna `poblacion` | columna eliminada (queda `commune_id,commune_name,superficie_km2,ingreso_promedio,nse`); `parseCSV` la ignora aunque vuelva |
| `src/services/ineService.ts:6,122,129` | CSV (opcional) + «fallback» a COMMUNES | población solo de `loadPoblacionIndex` (RPC); sin fallback; no se cachea error ni «vacío» |
| `src/services/poblacionService.ts`, `src/hooks/usePoblacion.ts`, `src/types/poblacion.ts` | — | nuevos: servicio, hook `useCommunesWithPopulation`, rótulo `Población censada 2024 (INE)` y `sin dato` |
| `src/components/map/CommuneLayer.tsx:55,132,135` | popup «Población»; relleno desde CSV/COMMUNES | popup con el rótulo; «sin dato» si falta; la densidad se recalcula |
| `src/components/map/TrafficLayer.tsx:26`, `GseLayer.tsx:36` | «Población» de COMMUNES | rótulo + «sin dato» |
| `src/components/layout/CommuneSearch.tsx:130,194,309` | rango sobre `c.pop` (0 contaba como pequeña) | el rango exige `pop > 0`; rótulo |
| `src/components/panels/CommuneSearchResultsDialog.tsx:155,179`, `CommuneCompareDialog.tsx:49-51` | «Población», «—» | rótulo y «sin dato» |
| `src/services/communeDataService.ts:21,81,104,169-182` | población editable por Excel y guardada en overrides; exportada | no se importa ni se guarda; la exportación usa la columna censada (vacía si sin dato) |
| `src/components/layout/Sidebar.tsx` | exportaba COMMUNES | exporta la versión con población censada |
| `src/utils/ineScales.ts` | etiqueta «Población» | «Población censada 2024 (INE)»; «Densidad (superficie sin fuente)» |
| `src/components/map/CrimeLayer.tsx:118` | «Población» = suma GSE | popup: «Población censada 2024 (INE)» o «sin dato»; la base de la tasa aparece aparte como «Base de la tasa (sin fuente)»; pie: «Delitos: CEAD» (ya no cita al INE) |
| `src/services/poiFeaturePayloadBuilder.ts:56,458,465,476,478` | 50.000 hab., 15.000 hogares, 50 km² inventados | sin comuna o sin población censada **no hay celda** (sin dato); superficie del CSV o, si falta, de la geometría de la comuna; nunca un valor fijo |
| `src/utils/isochroneAnalysis.ts` (`totals.source`), `AnalysisPanel.tsx:131,135,790`, `IsochroneReportDialog.tsx:221`, `reportExportXlsx.ts:38,52`, `reportExportPdf.ts:686`, `reportExportPptx.ts:158` | textos distintos y a veces falsos | `totals.popSource` (`gse`/`manzanas2017`/`comuna`) y un solo rótulo (`popSourceLabel`/`popSourceShort`) en pantalla, CSV, XLSX, PDF y PPTX; la comuna fallback usa la población censada |
| `MicrozoneLayer.tsx:80`, `ManzanaLayer.tsx:81`, `Index.tsx:1873` | «Población» (manzanas Censo 2017, RM) | rotulado «(manzanas Censo 2017)»: no es la cifra comunal |
| `GastoEndogenoSection.tsx`, `reportData.ts`, `reportExportPdf.ts` | «Manzanas GSE (Censo 2024)» | «Manzanas GSE 2024» (el origen de `n_per` no está verificado) |
| `supabase/functions/*` (`compute-poi-features`, `isochrone-insights`, `export-sales-projection`) | consumen `pop_total`/`totals.pop` del payload | sin cambios de código: heredan el payload corregido |

No se tocó: tamaño de hogar (3,1/3,2/3,3 en tres sitios), `nse`/`traffic`/`area`/`hh`/coordenadas de `COMMUNES`, `ingreso_promedio`, `nse` y `superficie_km2` del CSV (ver §6).

## 5. Impacto en `analysis_settings.small_commune_pop_threshold`
**Valor de producción: no legible desde esta sesión** (no hay acceso a producción). El default de la migración es **0 = regla desactivada**; es un valor **por carpeta**. Con 0 no cambia ninguna decisión. Consulta para leerlo (solo lectura):
```sql
select folder_id, small_commune_pop_threshold, iso_minutes_small_commune from public.analysis_settings where small_commune_pop_threshold > 0;
```
Regla del código (`isoMinutesForCommune`): comuna pequeña ⇔ `0 < población ≤ umbral`; **sin dato ⇒ la regla no aplica** (se usa RM/regiones). Comunas que **cambian de lado** al pasar de la población del CSV a la censada, según el umbral (346 comunas cruzadas por CUT, 0 sin par):

| Umbral | Cambian | Pasan a «pequeña» | Dejan de serlo |
|---:|---:|---:|---:|
| 5.000 | 9 | 4 | 5 |
| 10.000 | 15 | 3 | 12 |
| 15.000 | 15 | 2 | 13 |
| 20.000 | 14 | 1 | 13 |
| 25.000 | 14 | 3 | 11 |
| 30.000 | 11 | 2 | 9 |
| 40.000 | 8 | 2 | 6 |
| 50.000 | 7 | 3 | 4 |
| 75.000 | 7 | 1 | 6 |
| 100.000 | 13 | 4 | 9 |

Ejemplos: umbral 10.000 → pasan a pequeña Alto Biobío (10.039 → 6.016), Lumaco (10.479 → 9.253), Quilleco (10.396 → 9.700); dejan de serlo 12 (Mejillones 9.752 → 14.084, Santo Domingo 9.205 → 13.171, Florida (08104) 9.867 → 12.958…). Umbral 50.000: pasan Castro (50.764 → 46.997), Concón (63.210 → 48.294), Penco (52.389 → 48.971); dejan de serlo Maule (21.957 → 61.081), Machalí (44.566 → 60.875), Puerto Varas (39.414 → 52.942), Limache (45.864 → 56.145). Con el valor real de producción, el listado exacto sale de cruzar esa tabla con el umbral (herramienta de solo lectura: `python etl/censo/impacto_umbral.py --xlsx <D1.xlsx> --csv-old <CSV anterior> --umbral N --detalle`; el CSV anterior sale de `git show 277deb2:public/ine_communes.csv`).
Efecto: cambia solo los minutos de isócrona de los **POI nuevos o recalculados** de esas comunas; no se recalcula nada automáticamente.

## 6. Análisis y reportes con población congelada
Solo cambian las cifras que venían de la **celda comunal** (fallback) o de la **comuna × área**; las manzanas GSE/Censo 2017 no se tocan.
- `poi_features_cache.features` (JSONB: `pop_total`, `pop_density_avg`, `cells_count`…): las filas con `cells_count = 1` provienen de la celda comunal (o de una sola manzana). No se recalculan solas (la caché se invalida por `config_version`/hash de isócrona, no por población). Revisión (solo lectura): `select poi_id, features->>'pop_total', features->>'cells_count', computed_at from public.poi_features_cache where (features->>'cells_count')::int = 1;` — las que tengan `pop_total = 50000` usaron el valor inventado.
- `export-sales-projection`: usa `features.pop_total` de esas filas para el rango de comparables (`comparablePopulationRange`): los POI con celda comunal quedan comparados con una población vieja hasta recalcular. Los modelos entrenados con esas variables (p. ej. `scripts/validate-potential-model.ts`) no se reentrenan.
- `isochrone_report_slides` (PNG de las láminas): llevan la cifra de población impresa, con la etiqueta antigua; se regeneran al reabrir el informe, no solos. Informes PDF/XLSX/PPTX ya descargados o enviados: no se pueden corregir.
- `saved_isochrones` guarda solo geometría (la población se calcula al abrir): no congela población. `useIsochroneInsights` cachea por `totals.pop` (cambia la llave sola).
- `localStorage` de overrides de comunas: puede contener `pop`/`density` antiguos; la importación y `applyOverrides` ya no los leen.

## 7. Datos sin fuente (no se cambian en este PR salvo lo indicado)
| Dato | Dónde | Estado |
|---|---|---|
| `superficie_km2` | `public/ine_communes.csv` | **Sin fuente documentada.** Contraste informativo con el área de los polígonos de `comunas.geojson` (proyección equivalente): de 345 comunas, 47 difieren > 5 %, 24 > 10 %, 8 > 25 % (Papudo 64 vs 167 km², San Esteban 681 vs 1.375, Malloa 113 vs 220, Andacollo 310 vs 515, Río Verde 17.248 vs 9.152…). `comunas.geojson` tampoco tiene fuente verificada. |
| `ingreso_promedio`, `nse` | `public/ine_communes.csv` | **[NO COMPROBADO]**: sin fuente ni fecha. Candidatos a retirar o a reemplazar por una fuente oficial (decisión del dueño). |
| `nse`, `traffic`, `area`, `hh`, `lat`, `lng` | `src/data/communes.ts` | Escritos a mano, sin fuente. `hh` se deriva además como población / 3,3 (CommuneLayer), / 3,2 (payload de POI) y / 3,1 (isócronas): tres supuestos distintos de tamaño de hogar. |
| Densidad | `ineScales`, `CommuneLayer`, payload | **Propuesta aplicada solo en parte:** densidad = población censada / superficie del CSV, rotulada «Densidad (superficie sin fuente)». **No** se declara oficial: no pude descargar una superficie oficial verificada (BCN `reportescomunales`, INE `geoarchivos` y SUBDERE devolvieron 403 desde el sandbox el 2026-10-18). Si el dueño entrega la superficie oficial (BCN/INE, con URL y fecha), se carga como fuente propia y se cambia el rótulo. |
| `poblacion` de la capa de delitos | `public/crime/*.geojson` | Es la suma GSE `n_per` (no el Censo); su origen es [NO COMPROBADO]; la **tasa por 1.000 hab.** se calculó con ella y **no se recalculó** aquí (cambiaría el score de riesgo). |
| `n_per`/`n_hog` de las manzanas GSE | `public/gse/*.geojson` | Σ 16,19 M (vs 18,48 M del Censo); origen [NO COMPROBADO]; rotulado «GSE 2024» sin llamarlo Censo. |
| `fn_indice_saturacion` | `20260611120000_comercio_poi.sql` | Marcador de posición que devuelve NULL. |
| Aplicación de la licencia CC BY-SA 4.0 a informes a clientes | — | [NO COMPROBADO]; consultar. |

## 8. Hallazgo menor (fuera de alcance)
Los runners de `salud_isapre`/`salud_casen` no capturan `zipfile.BadZipFile` (un XLSX corrupto sale con código 4 en vez de 2); el de población sí.
