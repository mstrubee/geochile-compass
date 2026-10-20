# Hallazgos — capacidad de hospitales (camas, ocupación y pabellones) · Fase 0

Fecha de las verificaciones: **2026-10-20** (descargas entre 11:54 y 12:07 UTC). Rama `feat/salud-hospital-capacidad`, desde `main` en `985fca5` (PR #24 ya mergeado). **No hay código de producto en esta fase.**

Regla de la interfaz (del encargo): no se infiere, no se estima y no se resta nada. Lo que no esté en una fuente oficial se muestra «sin dato».

## 0. Resumen y lo que necesito que decidas

| # | Fuente | Estado | Efecto |
|---|---|---|---|
| 1 | Ocupación, REM 20 (datos.gob.cl, CC0) | **Verificada y descargada.** 2014-01 a 2026-08, mensual, 208 establecimientos, **todos empalman por código** con nuestra capa | Lista para modelar |
| 2 | Dotación de camas DEIS/DIGERA | **Verificada y descargada.** El archivo que indicaste (2010-2023) **está desactualizado**: existen 2010-2024 y 2010-2025 con la misma ruta. Propongo la de **2010-2025** | Lista para modelar; licencia **[NO COMPROBADO]** |
| 3 | Pabellones, REM A21 sección A | **Definiciones y columnas verificadas (manual y planilla oficiales). El archivo de datos NO se pudo ubicar ni descargar**: el listado de «Datos Abiertos» del DEIS se carga con una tabla AJAX tras el WAF de Cloudflare (403 «Just a moment…») y los patrones de URL probados dan 404. No lo eludí | **Bloquea solo los pabellones.** Necesito tu decisión (§7, pregunta P1) |
| — | Clínicas privadas | **Casi no reportan.** De 145 establecimientos hospitalarios vigentes no SNSS de nuestra capa, solo 2 aparecen alguna vez en REM 20 (Clínica de Puerto Varas SpA, 2014-2015, y Hospital Naval de Puerto Williams, 2020). Ninguno en 2024-2026 | «sin dato» para privados es la norma, no la excepción |

Número de migración tomado: **`20261108000000`** (reservado; ver §6).

## 1. Fuente 1 — REM 20 (ocupación e indicadores del proceso de hospitalización)

| Campo | Valor |
|---|---|
| Portal | https://datos.gob.cl/dataset/indicadores-hospitalarios-rem20 (id `a756323f-85ba-4759-87dc-f5d5e63868cc`) |
| Título oficial | «Indicadores del proceso de hospitalización de los establecimientos públicos de Salud» · autor DEIS (`deis@minsal.cl`) · frecuencia declarada `1m` |
| Recurso | `Indicadores_REM20.csv` (id `657cc933-eac8-4bfc-b004-c4d6dcd988a8`) |
| URL exacta | https://datos.gob.cl/dataset/a756323f-85ba-4759-87dc-f5d5e63868cc/resource/657cc933-eac8-4bfc-b004-c4d6dcd988a8/download/indicadores_rem20_20260925.csv |
| Tamaño / modificación | 27.248.718 B · `last_modified` 2026-09-25T04:00:23Z |
| sha256 | `5085664576302b361f9207ce13b96acacd4a29da16477ebf2cccbce487571559` |
| Descarga | 2026-10-20T11:54:39Z |
| Período cubierto | **2014-01 a 2026-08** (2026 solo hasta agosto: 192 establecimientos, 183 con el mes 8) |
| Diccionario | `diccionario-rem20.xlsx` · sha256 `6feebecdce70cf9f850054c37d07a292183747d9df1323084d15abf97be26c9a` · https://datos.gob.cl/dataset/a756323f-85ba-4759-87dc-f5d5e63868cc/resource/6c7c8a9d-204d-4947-9c8e-82a893fc3f2e/download/diccionario-rem20.xlsx |
| Formato | CSV UTF-8, separador `;`, punto decimal, 168.474 filas, 20 columnas, sin celdas vacías |
| **Licencia** | **Creative Commons CCZero (CC0)** — `license_id: cc-zero`, https://www.opendefinition.org/licenses/cc-zero (campo del metadato CKAN). Uso comercial permitido, sin atribución obligatoria; citaremos la fuente igualmente |

El nombre del archivo lleva la fecha de publicación (`..._20260925.csv`): la URL **cambia en cada actualización**. El ETL debe resolver la URL vigente desde `package_show` (CKAN) y guardar la URL y el hash de lo que realmente descargó.

### 1.1 Columnas (diccionario oficial DEIS, citado)

| Columna | Significado oficial |
|---|---|
| `PERIODO` | «Año del Registro» |
| `MES` | «Mes del Registro» (1-12) |
| `TIPO_PERTENENCIA` | 1 = Perteneciente, 2 = No Perteneciente al Sistema Nacional de Servicios de Salud (los privados y de FF.AA./Orden tendrían 2) |
| `COD_SSS`, `GLOSA_SSS` | Servicio de Salud (o SEREMI) vigente en el año indicado |
| `CODIGO_ESTABLECIMIENTO` | «identificador único, que permite reconocer al prestador» (6 dígitos; es el código DEIS) |
| `ESTABLECIMIENTO` | denominación del establecimiento (cambia de redacción entre años) |
| `COD_AREA_FUNCIONAL`, `AREA_FUNCIONAL` | «Reconocimiento de camas hospitalarias según niveles de complejidad, en tres grandes áreas de cuidados» (básicos/medios/críticos; 330 Pensionado, 401-429) |
| `DIAS_CAMAS_OCUPADAS` | «Cantidad de Días en que una cama de un área funcional está siendo ocupada» |
| `DIAS_CAMAS_DISPONIBLES` | «Cantidad de Días en que una cama de un área funcional se encuentra disponible, para ser utilizada por un paciente» |
| `DIAS_ESTADA`, `NUMERO_EGRESOS`, `EGRESOS_FALLECIDOS`, `TRASLADOS` | estada, egresos, fallecidos y traslados entre áreas del mismo establecimiento (no son egresos) |
| `INDICE_OCUPACIONAL` | «Número de días camas ocupadas respecto a los días cama disponibles, durante un período de tiempo establecido, expresado en porcentaje» |
| `PROMEDIO_CAMAS_DISPONIBLE` | en el diccionario: «Promedio de días que una cama del Área Funcional permanece disponible» (la redacción es confusa; **medí** que equivale a `DIAS_CAMAS_DISPONIBLES / días del mes`, diferencia máxima 0,005) |
| `PROMEDIO_DIAS_ESTADA`, `LETALIDAD`, `INDICE_ROTACION` | derivados publicados |

### 1.2 Definiciones oficiales de camas e índice (fichas del repositorio DEIS)

Citadas de https://repositoriodeis.minsal.cl/deis/rem_base/ver.asp?var3=N (descargadas 2026-10-20):

* **Camas de dotación** (`var3=3`): «las camas asignadas al establecimiento por la autoridad competente, instaladas y dispuestas las 24 horas del día para recibir pacientes. En el caso de los hospitales del SNSS, la dotación normal de camas está definida por una Resolución Interna emanada del Director de Servicio».
* **Camas disponibles o en trabajo** (`var3=4`): «las camas habilitadas en los distintos servicios o salas del establecimiento, en condiciones de uso, para la atención de los pacientes hospitalizados. […] El número de camas disponibles es igual a la suma de las que están ocupadas más las desocupadas (pero listas para su utilización inmediata). Este número puede tener variaciones diarias, aunque lo deseable es que sea igual a la dotación normal. […] No se cuentan las camas que están fuera de servicio por falta de algún implemento, por refacción del local, por insuficiencia de personal […]».
* **Cama ocupada o paciente día** (`var3=5`): «permanencia de un paciente hospitalizado […] entre las 0 horas y las 24 horas de un mismo día. El ingreso y egreso […] en el mismo día debe ser considerado como día cama ocupado».
* **Porcentaje de ocupación o índice ocupacional** (`var3=23`): «relación entre los días camas ocupados o pacientes días de un período dado y los días camas disponibles de dicho período»; fórmula oficial **Días-cama ocupados / Días-cama disponibles × 100**.
* **Índice de rotación** (`var3=16`): egresos del período / promedio de camas disponibles del período.

**Consecuencia de diseño:** *camas de dotación* (archivo 2) y *camas disponibles* (REM 20) son **conceptos distintos** y no se mezclan ni se restan. Ejemplo medido: Hospital Luis Tisné, 2023: dotación **303**; camas disponibles promedio (días-cama disponibles / 365) **294,8**.

### 1.3 Granularidad y cómo se obtiene el índice a nivel hospital

* La fuente es **mensual y por área funcional**. El índice publicado está **por área y mes**. No existe un índice por hospital en el archivo.
* Verifiqué que el índice publicado coincide con la fórmula oficial: máxima diferencia con `100 · ocupados / disponibles` = **0,005** (redondeo) en las 165.293 filas con disponibles > 0. Con disponibles = 0 el archivo publica índice 0,00 (3.181 filas): **eso es «sin denominador», no «0 % de ocupación»**.
* **Propuesta:** guardar los **dos componentes** (`dias_cama_ocupados`, `dias_cama_disponibles`) por (establecimiento, año, mes, área) y calcular el índice del hospital para un período como **Σ ocupados / Σ disponibles × 100** sobre las áreas y meses del período, con la fórmula oficial y sin tocar los componentes. **Nunca promediar los índices publicados** (se obtendría un resultado distinto y sesgado hacia áreas chicas). Si Σ disponibles = 0 → «sin dato».
* Valores > 100 %: hay 1.935 filas (1,1 %) con ocupados > disponibles (índice hasta 2.700 % con denominador de 2 días-cama). A nivel hospital-mes hay 80 de 29.353 > 100 %; a nivel hospital-año 2025: **0** (máximo 98,1 %). **Mostrar el valor tal cual, sin recortar a 100 %**, con el aviso «puede superar 100 % por la definición de camas disponibles del período» **[la causa no está comprobada; el aviso solo dice que la fuente lo permite]**.

### 1.4 Cobertura

| Medida | Valor |
|---|---|
| Establecimientos distintos en el archivo | **208** (todos con `TIPO_PERTENENCIA = 1`: el archivo **no contiene privados con pertenencia 2**) |
| Por año | 2014: 192 · 2020: 203 (camas de campaña por pandemia) · 2024: 193 · 2025: 193 · 2026 (hasta agosto): 192 |
| Con los 12 meses de 2025 | 192 de 193 (1 incompleto) |
| **Empalme por `CODIGO_ESTABLECIMIENTO` con `health_establishments` (snapshot 34, base real local `salud_real`)** | **208 de 208 (100 %)**, directo por `code`, sin usar `old_code`. **No hay códigos sin empalmar** |
| De los 208, tipo en nuestra capa | hospitales 196 · centros de especialidades 2 · CESFAM 1 · «dispositivo incorporado por crisis sanitaria» 3 · «otro» 6; **8 están `cerrado`** (campañas 2020-2022) |

Establecimientos de REM 20 que **no** están en la clasificación «hospital vigente SNSS» de nuestra capa (para que quede a la vista; todos empalman por código):

| Código | Nombre en nuestra capa | Dependencia | Períodos en REM 20 |
|---|---|---|---|
| 124210 | Clínica de Puerto Varas SpA | **privado** | 2014-2015 |
| 126204 | Hospital Naval (Puerto Williams) | **armada** | 2020 |
| 200726, 200705, 200714, 200727, 200867, 200868, 200889, 201084 | hospitales/dispositivos de campaña (Laja, Chillán, Huechuraba, Arauco, Los Ángeles, El Teniente, Limache, Contulmo) | servicio_salud, **cerrados** | 2020-2022 |
| 124380 | CESFAM Río Negro Hornopirén | servicio_salud | 2015-2017 |
| 200282 | CRS Hospital Provincia Cordillera | servicio_salud | 2020 |

Nuestra capa tiene **198 establecimientos hospitalarios vigentes SNSS**: 197 aparecen en REM 20 alguna vez, **193 en 2025**. Sin REM 20 en 2025: Hospital Florencio Vargas (Diego de Almagro; «cierre temporal por normalización», nota del archivo 2), Hospital de Licantén («en reparaciones»), CERI Josefina Martínez, CRS Provincia Cordillera, y PAME Estadio Municipal (nunca).

### 1.5 Calidad

* **Duplicados de clave** (`PERIODO, CODIGO_ESTABLECIMIENTO, COD_AREA_FUNCIONAL, MES`): **3 pares** (Hospital de Teno 2014-12 área 401 y 2014-06 área 407; Hospital de Laja 2020-06 área 407). Las dos filas de cada par difieren (una con pocos días-cama, otra con el grueso): parecen dos unidades mapeadas a la misma área. **Propuesta:** sumar los componentes y registrar el hecho en el rechazo/aviso del ETL; nunca descartar una.
* **Ceros:** 3.181 filas con disponibles = 0 (todas con índice 0,00); 15 filas con disponibles = 0 y ocupados > 0; 4.821 con ocupados = 0 y disponibles > 0 (ocupación real nula). El archivo no distingue «no reporta» de «0»: la ausencia de fila es lo único que significa «no reporta». **Un 0 en disponibles se trata como «sin denominador».**
* **Cambio de nombre:** 88 códigos cambian de redacción entre años (p. ej. «Hospital Dr Luis Tisné B (Santiago, Peñalolén)» → «Hospital Dr. Luis Tisné B. (…)»). **La clave es el código, no el nombre.**
* **Cambio de código/servicio:** ningún código cambia de establecimiento; 1 código cambia de Servicio de Salud (Hospital Metropolitano Ex Militar, 114104: Metropolitano Occidente 2020-2021 → Oriente desde 2022), coherente con la nota del archivo 2.
* Áreas funcionales: 330 aparece con dos redacciones (espacio final) y 428/429 con dos glosas; el código es estable. El 417 no existe en ninguno de los dos archivos y el 425 solo existe en REM 20.

## 2. Fuente 2 — Dotación de camas DEIS/DIGERA

| Campo | 2010-2023 (el que indicaste) | **2010-2025 (propuesto)** | 2010-2024 |
|---|---|---|---|
| URL | https://repositoriodeis.minsal.cl/ContenidoSitioWeb2020/Estadisticas/DOTACION_CAMAS/Dotaci%C3%B3n%20de%20camas%202010-2023%20Establecimientos%20Pertenecientes%20al%20SNSS.xlsx | misma ruta con `2010-2025` en el nombre | misma ruta con `2010-2024` |
| `Last-Modified` | 2023-10-20 | **2025-10-20** (metadatos internos 2025-10-20 13:28) | 2024-12-02 |
| Tamaño | 160.160 B | 179.412 B | 170.081 B |
| sha256 | `94dcecdf0d92ffb701629834292ccf05630210504d5924b967cc7811391ff08e` | `ef5ca45f30c1e3937621e489826766cb9844c5bca0253a375be4851f28ba078f` | `1634e59bb49f265ae71090302088c5947403985960d7f529cad697242ddab151` |
| Descarga | 2026-10-20 11:54Z | 2026-10-20 12:07Z | 2026-10-20 12:07Z |
| Años | 2010-2023 | **2010-2025** | 2010-2024 |

* **Autor/Fuente en el archivo:** «Fuente: DEIS, DIGERA»; título «DOTACIÓN DE CAMAS HOSPITALARIAS DE ESTABLECIMIENTOS PERTENECIENTES AL SNSS (Públicos) POR SERVICIO DE SALUD, ESTABLECIMIENTO Y ÁREA FUNCIONAL». **Solo establecimientos públicos del SNSS.**
* **Los datos de 2010-2013 cambiaron entre versiones:** «Total País» 2011 = 25.594 (versión 2023) vs 25.496 (versión 2025); 2012 = 25.434 vs 25.354. **Por eso guardamos la versión (sha256) con cada carga** y nunca mezclamos años de archivos distintos.
* **Período:** una cifra **anual** por establecimiento y área funcional (la fuente no dice a qué fecha del año corresponde la dotación; **mostrar «Dotación de camas 2025» y no una fecha**).
* **Estructura de la hoja `2010-2025`** (una sola hoja, 4 filas de encabezado): columnas Servicio de Salud · Código Establecimiento · Tipo de Establecimiento (Alta/Mediana/Baja complejidad) · Nombre Establecimiento · Cod. Área Funcional · Área Funcional · una columna por año (`2014*` lleva asterisco). **El código solo aparece en la fila «Total» (área 100) de cada establecimiento; las filas de áreas siguientes lo heredan por posición** (hay que propagarlo). 7-8 notas al pie con asterisco (reclasificaciones, cierres, dependencia del Hospital Metropolitano).
* **Significado:** «camas de dotación» según la ficha DEIS (§1.2): camas asignadas por resolución del Director de Servicio, instaladas las 24 h. **No es «camas disponibles/en trabajo»** (REM 20).
* **Cobertura (versión 2025):** 196 códigos (197 bloques «Total»; 114104 aparece dos veces por el cambio de Servicio de Salud) · 193 con dotación > 0 en 2025 · «Total País» 2025 = **26.738** = suma de los totales por establecimiento (cuadra exacto). **Empalme por código con nuestra capa: 196 de 196.** Mismo conjunto de 193 establecimientos que REM 20 en 2025 (sin diferencias en ninguno de los dos sentidos).
* **Sin camas en 2025 (los 3 restantes):** Clínica de Puerto Varas SpA (nota 4: «no perteneciente al SNSS» desde 2012), Hospital Florencio Vargas (celda con `*******`, texto en lugar de número: **tratar como «sin dato»**), Hospital de Licantén («en reparaciones»).
* **Calidad:** (a) 1 de 3.152 celdas donde el total no es la suma de las áreas en la versión 2025 (en 2023 eran 21 de 2.744 en 4 hospitales); **guardar el total publicado y las áreas por separado y NO sumarlas ni restarlas** al mostrar; (b) 5 pares (código, área) duplicados, todos del Hospital Metropolitano (dos bloques); (c) celdas de texto con asteriscos como marca; (d) nombres distintos al de nuestra catálogo en 20 de 196 (la clave es el código).
* **Licencia: [NO COMPROBADO].** El archivo no declara licencia ni condiciones de uso; el repositorio `repositoriodeis.minsal.cl` devuelve 403 en la raíz y no encontré términos de uso aplicables a este archivo. Es información pública del DEIS (organismo del Estado), pero **no hay licencia declarada**. Para uso comercial recomiendo pedir confirmación escrita al DEIS (`deis@minsal.cl`) antes de poner la capa en `client_ready = true`; mientras tanto la capa queda en `client_ready = false` (que ya es el plan).

### 2.1 Controles concretos (valores esperados para el runbook)

| Hospital (código) | Dotación 2023 | Dotación 2024 | Dotación 2025 | Áreas con dotación 2025 |
|---|---|---|---|---|
| **Hospital Dr. Luis Tisné B. (112101)** | **303** | **296** | **280** | 402, 403, 404, 405, 406, 413, 414, 415, 416, 330 |
| **Hospital San Luis (Buin) (113150)** | **100** | **100** | **100** | 403, 404, 407, 408, 413, 416, 330 |

(En nuestra capa, 113150 se llama «Hospital San Luis (Buin)»; **no existe ningún establecimiento llamado «Hospital San Luis de Buin»**; usar el código.)

Valores REM 20 de los mismos hospitales (suma de áreas, fórmula oficial):

| Hospital | Período | Días-cama ocupados | Días-cama disponibles | Índice derivado | Camas disp. prom. |
|---|---|---|---|---|---|
| Tisné (112101) | 2023 (12 meses) | 89.376 | 107.587 | **83,07 %** | 294,8 |
| Tisné | 2025 (12 meses) | 87.230 | 102.835 | **84,83 %** | 281,7 |
| Tisné | 2026-08 | 7.791 | 8.897 | **87,57 %** | 287,0 (10 áreas) |
| Buin (113150) | 2023 | 25.693 | 35.636 | **72,10 %** | 97,6 |
| Buin | 2025 | 27.370 | 35.836 | **76,38 %** | 98,2 |
| Buin | 2026-08 | 2.383 | 3.059 | **77,90 %** | 98,7 (7 áreas) |

Detalle 2026-08 por área, útil para el runbook: Tisné 405: 373/434 (85,94) · 406: 1.104/1.116 (98,92) · 402: 2.015/2.015 (100,00) · 403: 899/899 (100,00) · 404: 1.580/1.860 (84,95) · 413: 136/186 (73,12) · 414: 254/310 (81,94) · 415: 423/465 (90,97) · 416: 999/1.581 (63,19) · 330: 8/31 (25,81). Buin 407: 39/93 · 408: 56/95 · 403: 606/773 · 404: 1.179/1.280 · 413: 54/124 · 416: 357/568 · 330: 92/126.

**Pregunta de definición (P2, §7):** ¿el índice del hospital suma **todas** las áreas funcionales, incluido 330 Pensionado y psiquiatría/sociosanitario? REM 20 no define un total por hospital. Propuesta: sumar **todas las áreas publicadas** (es lo que el DEIS llama «establecimiento») y mostrar el desglose por área en la ficha; así no excluimos nada por criterio propio.

## 3. Fuente 3 — REM A21 «Quirófanos y otros recursos hospitalarios», sección A

### 3.1 Lo que SÍ pude verificar (oficial)

| Documento | URL | sha256 | Descarga |
|---|---|---|---|
| Manual REM 2026, Series A, BS, BM y D (656 pp.; §REM A21 en pp. 348-352) | https://repositoriodeis.minsal.cl/ContenidoSitioWeb2020/REM/2026/SERIE/Manual%20Series%20REM%202026%20SERIE%20A%20BS%20BM%20DV1.2.pdf | `284daf7ce8b7071e91331c5fd258df39320b3604ae0d8fb4b7d36d1b9022d899` | 2026-10-20T12:04:24Z |
| Planilla Serie A 2026 V1.2 (hoja `A21`, formulario vacío) | https://repositoriodeis.minsal.cl/ContenidoSitioWeb2020/REM/2026/SERIE/SA_26_V1.2.xlsm | `82cc5f19d83c03a347ce3ccfa8693fadfc7cc657a2865fb1b38acc2485a92b12` | 2026-10-20T12:04:24Z |

(El manual y la planilla son **formularios y definiciones**, no datos. El manual declara «Todos los derechos reservados» sobre el texto del manual; eso no es la licencia de los datos.)

**Columnas de la sección A (planilla oficial, una fila por tipo de quirófano: Cirugía Electiva, Urgencia, Obstétrico, Indiferenciado, más «TOTAL QUIRÓFANOS»):**
`Número de Quirófanos en Dotación` · `Promedio Mensual de Quirófanos Habilitados` · `Promedio Mensual de Quirófanos en Trabajo` · `Total de Horas Mensuales de Quirófanos Habilitados (Horario Hábil)` · `Total de Horas Mensuales de Quirófanos en Trabajo (Horario Hábil)` · `Horas Mensuales Programadas de Tabla Quirúrgica…` · `Horas Mensuales Ocupadas…` (hábil, inhábil lunes-viernes, sábado/domingo/festivo; cada una por beneficiario Total/MAI/MLE/Otros) · horas de cirugías menores y procedimientos.

**Definiciones oficiales (manual REM 2026, REM A21 §A):**
* **Quirófano:** «espacio físico, de acceso restringido, con autorización sanitaria para su funcionamiento […] para realizar una intervención quirúrgica **mayor**». Se incluyen quirófanos de cirugía electiva, urgencia, obstétricos e indiferenciados.
* **Quirófanos en dotación:** «cantidad de quirófanos autorizados al establecimiento (informados por resolución y aprobados por el MINSAL), instalados para realizar cirugías mayores. El número de quirófanos en dotación no es modificable por fluctuaciones temporales».
* **Quirófanos habilitados:** «en condiciones de uso, es decir infraestructura y el equipamiento necesario […] disponible a lo menos ocho horas diarias de lunes a viernes».
* **Quirófanos en trabajo:** «disponibles, habilitados […] y además cuenta con la dotación de recursos humanos necesarios para funcionar».
* **Promedio mensual de quirófanos habilitados:** «suma de quirófanos habilitados en el mes, dividido por el número de días hábiles» (electivos e indiferenciados) o «el total de los días del mes calendario» (urgencia y obstétrico).
* **Horas ocupadas:** «horas utilizadas en los quirófanos en trabajo»; incluyen horas de intervención más recambio; «se deben calcular en base a las horas reales […] no realizar aproximaciones».
* **Reglas de consistencia R.1-R.8** (p. ej. R.2: habilitados ≤ dotación; R.4: horas ocupadas hábiles ≤ horas habilitadas) que sirven de **validación del ETL**.
* **El formulario REM es una declaración mensual por establecimiento.** El manual (introducción) dice que las estadísticas son de «establecimientos de salud pertenecientes al SNSS»; en su definición de «establecimientos de salud» (DFL 1/2005) enumera también «establecimientos Privados» con código propio, pero **«SERIE A» se define para «estadísticas de producción de Establecimientos de Salud del Sector público»** (sección «Series REM» de la introducción del manual).

### 3.2 Lo que NO pude verificar — **[NO COMPROBADO]**

* **El archivo oficial de datos REM A21 más reciente.** El manual 2026 indica que los datos abiertos del REM «se disponen de manera semanal» en `https://deis.minsal.cl/#datosabiertos`; las preguntas frecuentes del DEIS dicen que las bases del REM están «desde el año 2009 hasta el 2024». Lo intenté así (cada intento documentado, no lo repetí más allá de lo que sigue):
  1. La página `#datosabiertos` carga el listado con una tabla AJAX (Ninja Tables id 2889) → la petición a `admin-ajax.php` devuelve **403 «Just a moment…» (desafío de Cloudflare)**. No lo evadí.
  2. Búsqueda del dataset en `datos.gob.cl` (CKAN `package_search`: «REM serie A», «quirofanos», «REM A21», «DEIS REM»): **solo existe `indicadores-hospitalarios-rem20`**; el REM A21 no está publicado ahí.
  3. Sondeo de unos 400 patrones de URL bajo `repositoriodeis.minsal.cl/DatosAbiertos/REM/…` y `…/ContenidoSitioWeb2020/REM/…` (SerieA2023/2024, `.zip/.rar/.csv/.xlsx`, etc.): todos 404. (Control: `DatosAbiertos/EGRESOS/EGRESOS_2023.zip` → 200, así que la ruta base es válida.)
  4. Búsquedas web: sin enlace directo; el único mirror es una herramienta de terceros (OpenREM) cuyo host está bloqueado por la política de red de esta sesión.
* **Por lo tanto no puedo reportar:** URL exacta, sha256, período, cobertura, empalme, calidad ni si clínicas privadas reportan A21. **No invento esas cifras.**
* **Licencia del REM A21:** no se pudo leer la ficha del recurso; **[NO COMPROBADO]**. El manual dice que el REM es información oficial del DEIS; no hay licencia declarada que yo haya podido leer.
* **Formas de resolverlo (P1, §7):** (a) tú descargas con el navegador el archivo REM Serie A del año más reciente desde `https://deis.minsal.cl/#datosabiertos` y me das la ruta (o el archivo en el repo/escenario de trabajo): lo perfilo igual que a las otras dos fuentes y completo esta sección; (b) Fase 1 sin pabellones (dejo las columnas y el popup preparados y en «sin dato», sin migración de A21); (c) usar las planillas por establecimiento que publican los Servicios de Salud (p. ej. SSMSO): **no lo hago sin tu autorización** porque no son la fuente oficial de datos abiertos.

## 4. Privados: evidencia

| Pregunta | Evidencia |
|---|---|
| ¿REM 20 incluye privados? | **No como pertenencia 2**: las 168.474 filas tienen `TIPO_PERTENENCIA = 1`. Sin embargo, **un** código privado según nuestra capa aparece: **124210 Clínica de Puerto Varas SpA** (dependencia `privado`, `snss = false`), en **2014-2015**, y un código de FF.AA.: **126204 Hospital Naval (Puerto Williams)** (armada), solo **2020** |
| ¿La dotación de camas incluye privados? | **No**: título «(Públicos)». Aparece la misma Clínica de Puerto Varas (la nota 4 la declara «No Perteneciente al SNSS» desde 2012) con dotación en años anteriores y **sin camas en 2025** |
| De 145 hospitalarios vigentes no SNSS en nuestra capa | **2 con REM 20 alguna vez, 1 con dotación; 0 en 2024-2026** |
| 80 hospitales de alta complejidad (`alta_hospital`) vigentes | 64 tienen REM 20 en 2025 (los públicos). Los 16 sin dato son **FF.AA., Orden y privados** (p. ej. Hospital Militar de Santiago, Hospital Clínico UC-Christus, Hospital del Trabajador, Clínica Redsalud Mayor Temuco, Hospital Clínico U. de Chile, Dipreca, Hospital FACH, Hospital Naval Almirante Neff, Hospital del Cobre) |
| ¿Reportan REM A21 los privados? | **[NO COMPROBADO]** (no tengo el archivo; ver §3.2) |

**Conclusión:** camas, ocupación y (probablemente) pabellones son datos **de la red pública**. Para los ~145 hospitalarios no SNSS el popup mostrará **«sin dato»** y la leyenda debe decirlo explícitamente (no «0 camas»). **No busqué otras fuentes privadas** (p. ej. el informe de la asociación de clínicas); si quieres, me lo autorizas aparte.

## 5. Propuesta de modelo de datos

Siguiendo el patrón de 1a/1b: tablas **aditivas** en `public`, claves por `snapshot_n`, trazabilidad en `data_sources` / `source_snapshots`, y `client_ready = false` en toda capa/campo nuevo. (En el repositorio, el registro de fuentes se llama `data_sources`; no existe una tabla `dataset_sources`.)

### 5.1 Fuentes (filas en `data_sources`)

| `source_key` | dataset | licencia | acceso |
|---|---|---|---|
| `deis_rem20_hospitalizacion` | `indicadores-hospitalarios-rem20` | CC0 | CKAN `package_show` → URL vigente |
| `deis_dotacion_camas` | `Dotación de camas 2010-<año> … SNSS.xlsx` | **[NO COMPROBADO]** | URL con el año final en el nombre |
| `deis_rem_a21` | (pendiente P1) | **[NO COMPROBADO]** | (pendiente P1) |

Cada carga crea una fila en `source_snapshots` con la **URL exacta, `sha256`, bytes, fecha de descarga, versión/`Last-Modified`, y el período que cubre** (`period_from`, `period_to`), y deja el `status` en `validated` → `loaded` (publicación por función con `FOR UPDATE`, igual que `publish_health_establishments`).

### 5.2 Tablas

```
health_beds_dotacion        (snapshot_n, code, year, area, area_nom, beds numeric|null, beds_total_published, nota text)
                            -- PK (snapshot_n, code, year, area); area=100 guarda el «Total» publicado; NO se recalcula
health_rem20_month          (snapshot_n, code, period date, area, dias_cama_ocupados int, dias_cama_disponibles int,
                             dias_estada int, egresos int, egresos_fallecidos int, traslados int, row_dups smallint)
                            -- PK (snapshot_n, code, period, area); los 3 pares duplicados se SUMAN y se marca row_dups
health_theatres_month       (snapshot_n, code, period date, tipo text, dotacion int, habilitados_prom numeric,
                             en_trabajo_prom numeric, horas_habilitadas_habil numeric, horas_ocupadas_* numeric ...)
                            -- SOLO si P1 resuelve el archivo; si no, la tabla se crea vacía en una migración posterior
```

Vista de lectura **sin inferencias** (`health_capacity_latest`, `security invoker`), una fila por establecimiento de la capa:

* `dotacion_year`, `dotacion_total` (la fila «Total» publicada), `dotacion_snapshot`;
* `rem_period_from`, `rem_period_to`, `dias_cama_ocupados`, `dias_cama_disponibles` (sumas del período), `indice_ocupacional` (**calculado solo con la fórmula oficial** y NULL si disponibles = 0);
* `pabellones_period`, `quirofanos_dotacion` (si hay A21);
* todo `NULL` cuando no hay fila ⇒ la interfaz escribe «sin dato». **Prohibido** cualquier `coalesce(..., 0)`.

Período que muestra la ficha (propuesta, **P3**): ocupación = **los 12 meses del último año calendario con 12 meses informados** (hoy **2025**) y, aparte, el último mes publicado (hoy **2026-08**). El período que se calculó va siempre en el popup.

### 5.3 Propiedades pedidas

* **Idempotente** (`create … if not exists`, `on conflict`, mismo patrón que `20261103000000`), con **rollback**, **advisory lock** (`pg_advisory_xact_lock(hashtext('salud_v1'))`), **`_migration_log`** (`capacidad_v1` start/end) y **conteos antes y después** de las tablas tocadas.
* **`client_ready = false`:** campos y capa nuevos nacen con `client_ready = false` (no se reutiliza ni se cambia el de la capa de establecimientos; cada parte conserva el suyo, como hicimos con CASEN/Isapre). Mientras la licencia de la dotación esté [NO COMPROBADA] no pasa a `true`.
* **Seguridad:** tablas con RLS de solo lectura para `authenticated` (patrón de 1a); la carga la hace el rol de servicio.

## 6. Número de migración

Última migración existente en `main`: `20261105000000_isapre_penetracion.sql`. La rama de geo-overrides **no existe** (ni en el repo ni como PR abierto; el único PR abierto es el #12 de proyectos, cuyas migraciones son `20261020…`/`20261021…`, anteriores). Nadie usó `20261106…`–`20261108…`. **Tomo `20261108000000_health_capacity.sql`** (rollback `supabase/rollbacks/20261108000000_health_capacity_down.sql`, según el patrón vigente), como reservaste, y dejo libres `20261106000000` y `20261107000000`.

## 7. Propuesta de popup (hospitales)

Solo texto de la fuente; sin estimar ni restar. Ejemplo con dato (Hospital Luis Tisné B., código 112101):

```
Hospital Dr. Luis Tisné B. (Santiago, Peñalolén)
[...campos actuales: tipo, comuna, dependencia, complejidad, clase, estado...]

Camas de dotación: 280 (2025)
   Fuente: DEIS/DIGERA, dotación de camas 2010-2025 · «camas asignadas por el Director de Servicio»
Ocupación 2025 (ene-dic): 84,8 %
   87.230 días-cama ocupados de 102.835 disponibles. Promedio del período, no en tiempo real.
   Último mes publicado (2026-08): 87,6 %
Pabellones (REM A21, <período>): sí · 9 quirófanos en dotación   |   «sin dato»
Fuente: REM 20 (DEIS/MINSAL, CC0), descargado 2026-10-20 · Código 112101
```

* **Sin dato** (hospital público sin fila en el período, p. ej. Hospital de Licantén): «Camas de dotación: **sin dato**», «Ocupación: **sin dato**», «Pabellones: **sin dato**».
* **Privado / FF.AA. sin dato** (p. ej. Hospital Clínico UC-Christus): las mismas líneas en «sin dato» **más la nota** «Las camas, la ocupación y los pabellones se reportan al DEIS por la red pública (SNSS); este establecimiento no figura en esas fuentes».
* Ocupación > 100 %: «puede superar 100 % (la fuente lo permite)».
* Denominador 0: «sin dato (sin días-cama disponibles)».
* «Pabellones: sí/no» solo cuando hay una fila A21 del período; **un establecimiento sin fila no es «no»**, es «sin dato». Dotación 0 informado explícito = «no».
* Dotación y camas disponibles se rotulan distinto; **nunca se comparan ni restan**.
* Filtro opcional «con pabellón» (solo establecimientos con A21 y quirófanos > 0); los «sin dato» **no** se excluyen en silencio: el contador dice «N sin dato de pabellón».
* Aplicación del hook `useComunaHover`: **no aplica** (es una capa de puntos, no una coropleta comunal).

## 8. Riesgos y pendientes

1. **Pabellones (P1):** sin el archivo A21 no hay perfilado ni modelo definitivo. Es el único bloqueo real.
2. **Licencia de la dotación [NO COMPROBADO]:** se puede cargar y mostrar internamente, pero no declarar `client_ready` hasta confirmar con el DEIS.
3. La URL de REM 20 cambia con cada publicación; el ETL debe resolverla vía CKAN y fallar si cambian las columnas (se valida el encabezado exacto).
4. El archivo de dotación tiene una fila de encabezado con asteriscos (`2014*`), códigos solo en la fila «Total», una celda de texto `*******` y dos bloques para el Hospital Metropolitano; el ETL debe tratarlos explícitamente (todo documentado arriba).
5. 2020-2022: años de pandemia con establecimientos de campaña (203 en 2020): marcarlo en el período.

## 9. Decisiones que necesito (para entrar a la Fase 1)

| # | Pregunta | Mi propuesta |
|---|---|---|
| **P1** | REM A21: ¿me das el archivo descargado desde `deis.minsal.cl/#datosabiertos` (o autorizas otra vía), o hacemos la Fase 1 sin pabellones? | (a) tú lo descargas y yo lo perfilo; si no es posible, (b) Fase 1 sin pabellones y los pabellones en una fase siguiente |
| **P2** | Índice ocupacional del hospital: ¿suma de todas las áreas funcionales (incluye 330 Pensionado, psiquiatría y sociosanitario) con desglose por área? | Sí, todas las áreas publicadas, fórmula oficial Σocupados/Σdisponibles |
| **P3** | Período mostrado: último año con 12 meses (2025) + último mes publicado (2026-08) | Sí |
| **P4** | Dotación: ¿usar el archivo 2010-2025 (no el 2010-2023 que indicaste)? | Sí; guardo también los sha256 de las versiones anteriores como referencia |
| **P5** | Licencia de la dotación: ¿escribo al DEIS para confirmarla? | Sí, antes de `client_ready = true` |
| **P6** | Migración `20261108000000` | Confirmada |
