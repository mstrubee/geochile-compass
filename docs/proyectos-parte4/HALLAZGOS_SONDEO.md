# Parte 4 — hallazgos del sondeo real (2026-10-17)

Fuente: `python etl/proyectos_probe.py --zip`, corrido por el usuario el 2026-10-17 (12:19 UTC) contra los servicios reales.
Todo lo de abajo es **[COMPROBADO]** sobre esa salida salvo donde diga otra cosa. La sesión de desarrollo no alcanza los servicios
(proxy), por lo que no puede repetir estas consultas.

## Conteos del servidor (coinciden con el encargo)
| Capa | Registros | Geometría | `editingInfo.lastEditDate` |
|---|---|---|---|
| INE `CRF_PE_v2/1` PE_NACIONAL | 163.487 | punto | 2026-07-30 (epoch 1785440340254) |
| INE `CRF_PE_v2/2` CRF_NACIONAL | 18.272 | polígono | 2026-07-30 |
| INE `CRF_PE_v2/0` CRF individuales | 9.013 | punto | 2026-07-30 |
| SEIA `ProyectosSEIA/1` EIA | 1.594 | punto | el servicio **no declara** `editingInfo` |
| SEIA `ProyectosSEIA/2` DIA | 28.408 | punto | ídem |

`maxRecordCount` = 2000 en las cinco; la paginación con `resultOffset` + `orderByFields=OBJECTID` funciona (dos páginas contiguas, sin solape).
`supportsPagination` aparece `null` en los metadatos pero la paginación responde: no hay que confiar en ese campo.

## INE PE_NACIONAL (permisos georreferenciados)
**Campos reales:** `OBJECTID, COD_REGION, GLOSA_REGION, COD_COMUNA (smallint), GLOSA_COMUNA, AÑO (smallint), CANTIDAD_UNIDAD (smallint),
NUM_PISOS (smallint), GLOSA_DESTINO, USO_DESTINO, SUPERFICIE (double), PRECISION_`. Sin fecha, sin número de permiso, sin dirección.

**Cobertura (comunas con ≥1 registro):** 117–123 comunas por año (128 distintas entre 2010 y 2025) de 346; 44 de 52 en la RM, solo 2–6 en las
regiones extremas. Es **cobertura parcial de comunas**, estable en el tiempo (no es la causa de la caída de 2020). Comunas presentes solo ≥2020:
Caldera, Canela, Zapallar, Marchihue, Romeral, Colbún, Yerbas Buenas, Pucón, Cobquecura; presente solo ≤2019: Paillaco; Maipú (13119)
desaparece en 2025. La cobertura por comuna **varía de un año a otro** (hasta 12 comunas faltantes según el año).

**Caída desde 2020 — qué dicen los datos (sin suponer causa):**
* Registros: 11.771 (2019) → 6.572 (2020): −44 %. Comunas con datos: 117 → 117 (sin cambio).
* Unidades (`CANTIDAD_UNIDAD`): 122.385 (2019) → 93.851 (2020): −23 %; las unidades por registro suben (≈10,4 → ≈14,3).
* Contra el total nacional de MINVU (viviendas, archivo anual): (HABITACIONAL + MIXTO) / MINVU = 0,71 · 0,77 · 0,77 · 0,76 · 0,79 · 0,81 · 0,75 ·
  0,73 · 0,75 · 0,75 · **0,75 (2020)** · 0,75 · 0,73 · 0,69 · 0,71 · 0,69 (2010 → 2025). **La razón es estable alrededor de 0,75 antes y después de 2020.**
* Conclusión **[COMPROBADO]**: el número de *registros* no es comparable entre ≤2019 y ≥2020; las *unidades* sí siguen al total nacional.
  La causa del cambio de agrupación **[NO COMPROBADO]**: no se puede decidir con estos datos (¿cambio de método del INE?, ¿efecto de la
  eliminación del número de permiso el 30-12-2020?). La interfaz no debe contar puntos como si fueran permisos; debe sumar `CANTIDAD_UNIDAD`.
* 2025 tiene más registros (9.274) pero menos unidades por registro (≈5,2) y 123 comunas; puede ser un año aún no consolidado (hipótesis).

**`PRECISION_`:** valores `ALTA / MODERADA / BAJA / nulo`. BAJA: 2 %–8 % por año. MODERADA: ≈40–45 % en 2010, 2012, 2016, 2017 (4.000–6.000 registros)
y ≤1 % en 2011, 2013–2015, 2019 en adelante. **Nulo solo aparece en 2020 (2.013), 2022 (299) y 2023 (34).** La mezcla de precisión cambia por año:
no es un atributo homogéneo.

**`USO_DESTINO`:** `HABITACIONAL / MIXTO / NO HABITACIONAL`. Las unidades de NO HABITACIONAL ≈ número de registros (≈1,05 por registro): para no vivienda,
`CANTIDAD_UNIDAD` parece contar edificaciones/unidades de obra, no viviendas **[HIPÓTESIS]**. `MIXTO` concentra muchas unidades por registro
(≈72 en 2010). `GLOSA_DESTINO`: **858 textos distintos** (muchos son combinaciones con `;` o `,`, y las mayúsculas varían: «Casa aislada» / «CASA AISLADA»).

**Validación geográfica (muestra real de 695 puntos, 2012/2019/2021/2024 + BAJA + nulo):** 695 de 695 caen dentro del polígono de su `COD_COMUNA`
(incluidos los BAJA y nulos). Es una **muestra**, no el universo; el ETL lo medirá completo.

## INE CRF_NACIONAL (recepciones finales, polígonos)
**Campos reales:** `OBJECTID, REGION, NOM_REGION, CUT, NOM_COMUNA, N_VIVIENDA, AÑO_EMISION, SHAPE__Area, SHAPE__Length`.
* **`CUT` es texto SIN el cero inicial para las regiones 1–9** (`'1401'`, 188 de 309 valores distintos tienen 4 caracteres). Hay que normalizar a `char(5)`
  con `lpad` y validar contra `comunas`; el encargo anticipaba esto para `COD_COMUNA` pero también ocurre aquí.
* Son **huellas pequeñas**: 5–58 vértices (mediana 8), áreas de ≈250 a ≈20.000 m². **No hace falta simplificar** para el mapa (ver DISENO §Parte 4).
* 18.272 polígonos, 127–182 comunas por año (309 CUT distintos); años 2011–2025; 1 de cada ~50 es `MultiPolygon`.
* `OBJECTID` 1…18272 contiguo.

## INE CRF individuales (capa 0)
Puntos, 2017–2018 (9.013). Campos: `COD_COMUNA, GLOSA_AREA, AÑO_CRF, USO_DESTINO, SUPERFICIE, PRECISION_` — **sin `N_VIVIENDA`**. En 2017–2018 CRF_NACIONAL ya trae
1.661 + 1.149 polígonos; no se puede decir si la capa 0 duplica esas recepciones **[NO COMPROBADO]**. **Decisión: fuera de la v1** (riesgo de doble conteo, sin conteo de viviendas,
solo dos años). Se puede añadir después como capa aparte si se comprueba que no se solapa.

## SEIA
* `ID_EXPEDIENTE` es `double` en el servicio y llega hasta **2.147.998.999 > 2³¹−1**: debe ser `bigint`, no `integer`. `OBJECTID` llega a 2.147.149.324.
* **La geometría del servicio coincide con `NUEVO_X/NUEVO_Y`** (coordenadas corregidas por el SEA), no con `X/Y`: en la muestra `X/Y` vienen **redondeados a grados enteros**
  (p. ej. −71, −33) en proyectos recientes. `MODIFICADO` vale 1 ó 2 (significado **no documentado**).
* `COMUNAS` es el **nombre** de la comuna (p. ej. «Lo Barnechea»), no el CUT; `REGION` es romano o «RM» (no CUT). En 132 proyectos de la muestra no apareció ningún valor con coma;
  los separadores de proyectos con varias comunas **[NO COMPROBADO]**.
* Las fechas (`FECHA_*`) son epoch en ms a **medianoche UTC**: se convierten a fecha en UTC (en America/Santiago caerían un día antes).
* **Caso reportado reproducido con datos reales:** *Praderas La Dehesa* (`ID_EXPEDIENTE 2147600353`, `COMUNAS = Lo Barnechea`) trae su punto en lat −33,802013, lon −70,720227,
  fuera de Lo Barnechea. Es el fixture de `outside_declared`.
* **Tipologías:** el *mismo código* tiene *nombres distintos* según el año del reglamento (ej. `g.1` = «Conjuntos habitacionales…» o «Proyectos de desarrollo urbano…»; `i.1` = minería o canteras).
  **No se puede filtrar solo por letra.** `h.1) Proyectos inmobiliarios` incluye proyectos no residenciales (una fábrica, un centro comercial): **tipología inmobiliaria ≠ vivienda**.
  Ver la lista propuesta en DISENO §Parte 4.
* Estados: Aprobado (904 EIA / 17.836 DIA), Desistido, No Admitido a Tramitación, Rechazado, En Calificación, etc.: la interfaz **debe mostrar el estado**.

## Licencia y términos
* Ítem de ArcGIS Online del INE (`CRF_PE_v2`, dueño `publicaciones_geodatos`, acceso público): `licenseInfo = null`, `accessInformation = null`, sin descripción ni etiquetas; los metadatos XML
  no traen términos. **No hay licencia declarada en el servicio.** **[NO COMPROBADO]** cuál es la oficial: queda pendiente de leer los términos de uso de datos abiertos del INE y,
  mientras tanto, `license_label` queda «por confirmar» y la capa lo muestra. (Un ítem del Hub INE 2010-2018 decía CC BY-NC 4.0; no se puede aplicar a este servicio sin confirmarlo.)
* SEA: `copyrightText = "sea"`; sin licencia declarada.
* Ambos son organismos del Estado; eso **no** equivale a una licencia de reutilización con clientes.
