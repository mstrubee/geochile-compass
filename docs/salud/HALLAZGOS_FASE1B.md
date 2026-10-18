# Hallazgos de la Fase 1b — previsión (Isapre por comuna y CASEN regional)

Evidencia de la carga **real** de los dos archivos contra una base PostGIS local (migraciones de 1a y 1b aplicadas, 346 comunas del repo, captura real de establecimientos de 1a). Nada se tocó en Supabase de producción.
Alcance (D3): **solo Isapre**; Fonasa no está descargado, así que no se creó nada que dependa de él (1b-5 «No respondible hoy»). CASEN **solo regional** y como estimación (D6).

| Archivo | SHA-256 | Tamaño | Período | Publicación | Licencia |
|---|---|---|---|---|---|
| `estadistica-anual-de-cartera-de-beneficiarios-comunal-2025.xlsx` (Superintendencia de Salud) | `0b810d74…df20ff1` | 797.428 B | cartera vigente a **2025-12** (2025-12-01 a 2025-12-31) | 2026-01-28 (cabecera `Last-Modified`; indicada por el operador) · extracción de datos 2026-01-22 (dentro del archivo) | **No declarada** → por confirmar |
| `casen_2024.sav` (Ministerio de Desarrollo Social y Familia) | `ac2d48b5…8758f` | 749.656.107 B | encuesta 2024 (fechas exactas de terreno **[NO COMPROBADO]**) | 2026-06-10 (indicada por el operador) | **No declarada** en lo leído → por confirmar |
| `Salud_Casen_2024.xlsx` (tabulado oficial, hoja 3) | `bbb36105…a4286` | — | 2024 | — | ídem |

URL de origen de cada archivo: guardada en `source_snapshots.origin_url` y en la ficha de procedencia. El **período**, la **fecha de publicación** y la **fecha de extracción** se guardan y se muestran por separado.

## 1. Cuadre (ETL → zona de paso → publicación)

**Isapre** (`etl/salud_isapre.py`):

| Paso | Resultado |
|---|---|
| Unidades del archivo = cargadas + rechazadas | 363 = 363 + **0** (346 comunas + 16 «sin dato de comuna» + 1 «sin dato de región»); rechazo 0,000 % (máximo 0,5 %) |
| Σ unidades de cada región = subtotal regional del archivo | ✔ las 16 regiones, cotizantes y cargas |
| Σ regiones + «sin dato de región» = Total País publicado | ✔ cotizantes 1.557.693 · cargas 959.612 |
| Hoja «Total …» idéntica a la suma de sexos; F + M + S/I = total de la comuna | ✔ 362 filas por rol |
| Beneficiarios (cotizantes + cargas) | **2.517.305** = 1.557.693 + 959.612 |
| Celdas staged (incluidos ceros) | 47.916 filas (363 unidades × 22 tramos × 3 sexos × 2 roles) |
| Publicadas | 23.958 celdas (unidad × sexo × tramo) y 1.089 grupos |
| Réplica Python de la supresión vs. base | **idénticas celda por celda** (prueba pytest con base) |
| Totales regionales publicados | **11 de 16** (las regiones 01, 02, 06, 11 y 16 no publican su total; ver §2.2) |

**CASEN** (`etl/salud_casen.py`):

| Paso | Resultado |
|---|---|
| Personas | 218.367 en 16 regiones; personas y población expandida por región = filas «Total» del tabulado oficial ✔ |
| Estimaciones | 96 (16 regiones × 6 sistemas) |
| **Contraste con el tabulado oficial** (hoja 3) | estimación puntual: diferencia máxima **2,98·10⁻⁶ pp**; error estándar: **3,4·10⁻⁸ pp**; casos muestrales: **0** de diferencia |
| Publicables | **67 de 96**; 29 no publicables (< 60 casos muestrales y/o «no fiable» según las notas oficiales), todas «Otro sistema» y «No sabe» |
| Diseño | df mínimo 173; estratos con un solo conglomerado: 0 (la carga **se niega** si apareciera alguno: antes se descartaba en silencio del cálculo de la varianza); la base contrasta además el **error estándar** con el del tabulado oficial |

Ejemplos (Isapre, IC 95 %): región 01 **8,0 %** (entre 6,9 y 9,2 %) · región 13 **20,6 %** (entre 19,8 y 21,5 %) · región 15 **5,8 %** (entre 4,9 y 6,8 %). Fonasa región 13: entre 75,0 y 76,7 %.

## 2. Supresión de conteos pequeños (regla 5; umbral < 5; DISENO §3.3)

| | |
|---|---|
| Celdas publicadas | 23.958 |
| Ceros publicados (0 es 0, no se suprime) | 12.090 |
| Suprimidas primarias (1 a 4 personas) | 2.783 |
| Suprimidas complementarias (para que la primaria no se deduzca restando) | 144 |
| Grupos (unidad × sexo) con total «<5» | **65** de 1.089 (eran 71: 6 se retienen, ver §2.3) |
| Grupos con el total **retenido** (el residuo determinaría exactamente las suprimidas) | **40** de 1.089 (§2.3) |
| Grupos cuyo cuadre por cotas falla | **0** |

### 2.1 Qué ve el usuario (medido con las RPC sobre la captura real, con las migraciones corregidas)

El valor por comuna es **exacto cuando lo publicado lo determina** y un **rango** si no (DISENO §3.3 punto 6): con todas las edades y el total del grupo publicado el valor es exactamente ese total; con un filtro de edad, las celdas suprimidas dentro del filtro se acotan por el **residuo publicado** del grupo; un grupo con total retenido solo tiene las cotas de cada celda. Nada de esto usa conteos completos.

| Consulta | Comunas | Con rango (no exactas) | Σ del rango publicado | Real (conteos completos) |
|---|---|---|---|---|
| `get_isapre_comuna(null, 0, null)` — todas las edades, ambos sexos | 346 | **88** (342 antes de la corrección B2; 59 tras B2 y antes de la retención) | 2.517.228 a 2.517.830 | 2.517.270 (comunas) |
| ídem, solo mujeres / solo hombres / sexo sin información | 346 | 29 / 24 / 49 | F 1.191.775–1.192.011 · M 1.325.302–1.325.521 · SI 151–298 | |
| `get_isapre_comuna(null, 12, null)` — 60+, todas las comunas | 346 | 171 | 394.750 a 396.700 | |
| `get_isapre_comuna(null, 12, 'hospital')` — 60+ en comunas sin hospital de alta complejidad | 292 | **158** (283 → 137 → 158) | **115.614 a 117.442** (114.478–118.358 → 115.632–117.226 → ahora) | 116.128 |
| `get_isapre_comuna(null, 12, 'ampliada')` | 288 | 156 | **92.547 a 94.353** (91.440–95.276 → 92.565–94.156 → ahora) | 93.058 |

La retención de la §2.3 devuelve parte de la anchura que la corrección B2 había quitado: es el costo de no publicar un residuo que determinaría exactamente las celdas suprimidas.

**Corrección del rango verificada tras la retención en las 2.768 combinaciones** (346 comunas × 4 sexos × 2 cortes de edad): el valor real, calculado con los conteos completos, cae **siempre** dentro del rango publicado (0 fuera). Una prueba SQL aleatoria hace la misma comprobación sobre 640 combinaciones en cada corrida.

**Declaración honesta:** la cartera completa por comuna, edad y sexo ya es **pública** en el XLSX de la Superintendencia. La supresión es una **política de presentación** de esta plataforma (regla 5), no una protección real de las personas; la fuente **no declara** una norma de supresión. Por eso no se publica el total comunal calculado con los conteos completos: restarle los grupos publicados despejaría un grupo «sexo sin información» de 1 a 4.

### 2.2 Fuga por resta regional (encontrada en la revisión del PR)

Σ de los totales regionales − Σ de los totales de grupo publicados de la región = **R**, la suma de los totales de los grupos **sin total publicado**. Con un solo grupo así, R es su total exacto. Con la captura real ocurría en **4 de 16 regiones** (02, 03, 14, 16: residuos 4, 1, 3 y 1).

La regla se generalizó en la segunda revisión (DISENO §3.3 punto 5b): el total regional **no se publica** cuando R, junto con las cotas de los totales que la componen, determina exactamente su valor: (1) un solo grupo sin total; (2) R = Σ de las cotas inferiores (todos valen su mínimo); (3) todos «<5» y R = 4·k (todos valen 4). Los grupos con total retenido (§2.3) cuentan como sin total y sin cota superior. Resultado con la captura real: **5 regiones sin total: 01, 02, 06, 11 y 16** (la 06 era el caso `R = k` señalado en la revisión; la 01, 02 y 11 aparecen al contar los totales retenidos; las 03 y 14 dejan de ser determinadas porque ahora tienen más de un grupo sin total y su R ya no coincide con sus cotas). La base re-valida la invariante sobre lo publicado antes de cerrar y la réplica Python aplica la misma regla.

### 2.3 Retención del residuo de grupo (segunda revisión del PR)

Regla general (DISENO §3.3 punto 5b): un residuo publicado **no se publica** cuando, junto con las cotas, determina **exactamente** el valor de las celdas suprimidas: `residuo = Σ cota inferior` (todas valen su mínimo) o, sin complementaria, `residuo = 4·k` (todas valen 4); y el caso combinado de un total «<5» con cuatro celdas suprimidas (total 4, cada una 1). El total del grupo se **retiene** (`total_pub` NULL, `total_withheld`); las celdas quedan suprimidas con cotas sin residuo (primaria `[1,4]`; complementaria `[5, la menor otra celda publicada ≥ 5]`).

Medido con la captura real **antes** de aplicar la regla (grupos con total publicado y celdas suprimidas: 636):

| Caso | Grupos |
|---|---|
| Residuo = Σ cotas inferiores (todas valen su mínimo) | **31** (12 de ellos con una complementaria de 5) |
| Residuo = 4·k sin complementaria (todas valen 4) | **3** |
| Total «<5» con cuatro celdas suprimidas de 1 (caso combinado) | **6** (de 71 grupos con total «<5») |
| **Total retenido** | **40 de 1.089** (34 + 6) |

Con la regla aplicada: 65 grupos quedan con total «<5» y 40 con total retenido. Los 40 se identificaron igual en la base y en la réplica Python (`groups_total_withheld = 40`). Ningún grupo publicado, recalculado desde lo publicado, tiene un residuo que determine sus suprimidas (0). Ejemplos del efecto: un grupo con dos celdas de 1 y un total de 32 antes publicaba «32 = 30 + 2, y ambas valen 1»; ahora publica solo las 30 de las celdas visibles y cada suprimida entre 1 y 4. Cada celda suprimida de un grupo retenido tiene su valor real dentro de las cotas publicadas (comprobado en todos).

Límite que se declara: en un grupo retenido con una complementaria, la cota superior de esa celda es la menor otra celda publicada ≥ 5; si no existiera ninguna (un grupo de una primaria de 1 y una única celda de 5) la publicación **se detiene** con un mensaje explícito en vez de publicar una cota falsa. Con el archivo real no ocurre (los 12 grupos retenidos con complementaria tienen entre 15 y 20 celdas ≥ 5).

## 3. Pregunta 1b-1 y su verificación independiente

*¿Cuántos beneficiarios Isapre de 60 años o más hay en comunas sin hospital de alta complejidad en la comuna?* (D1: dos definiciones; «sin alta» = ningún establecimiento **vigente** que cumpla la definición, según la captura de 1a. **«60+» = tramos 60-64 a ≥100: excluye la edad sin información e incluye el sexo sin información.**)

| Definición (D1) | Comunas sin alta | Beneficiarios 60+ (conteos completos) | Rango que sale de lo publicado | ¿Cae dentro? |
|---|---|---|---|---|
| Solo hospitales | 292 de 346 | **116.128** | 115.614 a 117.442 | sí |
| Ampliada (+ clínicas y centros de especialidades) | 288 de 346 | **93.058** | 92.547 a 94.353 | sí |

`benef_total_comunas` = 60+ en las unidades de tipo **comuna** con fila: **395.273** (sin las unidades «sin dato de comuna» ni «sin dato de región»; **no es el total del país**; en la versión anterior de esta función la columna se llamaba `benef_total_pais`, con un nombre que decía más de lo que sumaba). En comunas sin hospital de alta complejidad: 29,4 % de ese total.
El agregado se calcula **dentro de la base con los conteos completos** con una función `SECURITY DEFINER` que **solo devuelve el agregado**, **solo admite el corte 60+** (`p_min_tramo = 12`) y se **niega** si el conjunto tiene menos de 10 comunas (`salud.min_aggregate_comunas`).

**Límite que no se resuelve y queda declarado.** El mínimo de comunas **no resiste la diferencia entre consultas**: el conjunto ampliado (288) está dentro del de hospitales (292), así que 116.128 − 93.058 = **23.070** es el agregado exacto de las 4 comunas que los separan (Hualpén, Vitacura, Puerto Varas y Huechuraba). Restringir `p_min_tramo` a un solo corte cierra el aislamiento de **tramos** individuales, no el de **conjuntos**. Es una barrera de presentación: los mismos conteos están en el XLSX público. Una prueba SQL deja el comportamiento fijado.

**Verificación independiente** (`docs/salud/planb/verificar_1b1_independiente.py`; no usa el ETL ni el lector del repo): el conjunto de comunas se recalcula desde el CSV de establecimientos (54 comunas con hospital de alta complejidad → 292 sin) y es **igual** al de la base; la suma de los tramos 60-64 a ≥100 de las seis hojas del XLSX original para esas comunas da **116.128**, igual que la base. (El único nombre sin cruzar es la fila «-» que no es comuna.)

**«Sin alta complejidad en la comuna» no es «sin acceso»**: la población puede atenderse en comunas vecinas. El texto del panel lo dice.

## 4. Tamaño medido (`docs/salud/planb/medir_tamano.sql`; regla 7: medido, no estimado)

| Objeto | Tamaño con índices | Filas |
|---|---|---|
| `salud_restringido.isapre_cartera` (conteos completos) | 1.800 kB | 18.111 |
| `salud_restringido.isapre_unidad` | 96 kB | 363 |
| **Esquema restringido, total** | **≈ 1,9 MB** | |
| `public.isapre_cartera_celda` | 2.816 kB | 23.958 |
| `public.isapre_cartera_grupo` | 192 kB | 1.089 |
| `public.isapre_cartera_unidad` | 96 kB | 363 |
| `public.isapre_cartera_region` | 32 kB | 32 |
| `public.casen_prevision_region` | 64 kB | 96 |
| **Publicado nuevo en 1b, total** | **≈ 3,2 MB** | |

(Las 18.111 filas restringidas son celdas por rol (cotizante o carga) × sexo × tramo con valor > 0; los ceros no se guardan allí y se publican como 0 en `isapre_cartera_celda`.) Por captura nueva: ≈ 5 MB; la retención conserva `keep_isapre_snapshots` capturas (por período).

## 5. Preguntas de la fase y su nivel (regla 9)

| # | Pregunta | Nivel | Sello | Estado |
|---|---|---|---|---|
| 1b-1 | Beneficiarios Isapre 60+ en comunas sin hospital de alta complejidad | **Respondida con rigor** | Oficial con advertencia | construida: 116.128 (hospitales) / 93.058 (ampliada) |
| 1b-2 | Comunas con mayor penetración de beneficiarios Isapre sobre la población censada 2024 (INE) | **Respondida con rigor** | Oficial con advertencia | **construida** (Fase 1b-2, §8): mediana 3,8 %, máximo 89,5 % (Vitacura) |
| 1b-3 | Proporción regional que declara Fonasa o Isapre (CASEN 2024) | **Estimada con rango** (IC 95 %) | Estimado | construida: 67 de 96 estimaciones publicables |
| 1b-4 | Esa proporción por comuna | **No respondible hoy** | — | CASEN no es representativa a nivel comunal (D6) |
| 1b-5 | Inscritos Fonasa por comuna, tramo, edad y sexo | **No respondible hoy** | — | faltan los archivos de Fonasa (D3) |

## 6. Lo que NO se comprobó **[NO COMPROBADO]**

* **Licencia** de ambas fuentes: no la declaran en lo leído. `data_sources.license_label` queda en `null` y la ficha dice «por confirmar».
* **Semántica de la comuna** del archivo Isapre (domicilio, contrato u otra): no está declarada. La interfaz no la interpreta.
* **Fecha exacta de publicación** de la cartera: se tomó de la cabecera `Last-Modified` (2026-01-28), que es una señal del servidor, no una declaración del archivo. La de CASEN (2026-06-10) la indicó el operador.
* **Fechas de terreno de CASEN 2024**.
* **Información provisional**: el archivo la declara «sujeta a modificación»; no se sabe cuándo se consolida.
* **Garantías de privacidad:** son las de una política de presentación (la cartera es pública). Se probó que el rango publicado contiene siempre el valor real y que ni un residuo de grupo ni uno regional determinan exactamente las suprimidas (§2.2 y §2.3); **no** se probó (ni se afirma) resistencia a un atacante que combine consultas (§3) ni que use la regla pública de la complementaria (la menor celda ≥ 5 del grupo) para acotar más de lo publicado.
* **Cómo se registra el error muestral** de CASEN más allá de lo que reproduce el tabulado (un nivel de conglomerados); el contraste con el tabulado oficial coincide, pero no equivale a una validación del diseño completo.
* La interfaz solo se probó en jsdom (Vitest con capas Leaflet simuladas); **no se vio en un navegador real** ni contra Supabase real. Las migraciones **no están aplicadas** en producción.
* No se subió el original a Storage en la carga local (`--no-storage`).

## 7. Decisiones del dueño y pendientes

Resueltas en las revisiones del PR: licencias (las confirma el dueño; la ficha sigue en «por confirmar»); Censo 2024 y Fonasa pendientes (1b-2 y 1b-5 en espera; **1b-2 quedó construida en la Fase 1b-2, §8**, al cargarse el Censo); regla 5 sin cambios (no se publica el total comunal con conteos completos); **retención del residuo generalizada** a grupos y regiones (§2.2 y §2.3); **la diferencia entre consultas de 1b-1 (hospitales − ampliada = 23.070, cuatro comunas) queda aceptada como límite declarado**: es un agregado grande que se puede derivar igual del XLSX público.

Pendiente de aplicar (lo hace el dueño con `RUNBOOK_1B.md` y respaldo): migraciones 1 y 2 → cargas → front → migración 3. Requiere 1a aplicada y cargada.

## 8. Fase 1b-2 — Penetración Isapre sobre la población censada 2024 (construida)

Método, reglas y interfaz: `DISENO.md` §3.7. Aplicar con `RUNBOOK_1B2.md` (migración `20261105000000`, solo aditiva: dos funciones). **Nivel:** Respondida con rigor · **Sello:** Oficial con advertencia.
Cifras calculadas con las capturas **reales** (Isapre dic-2025, SHA-256 `0b810d74…0ff1`; Censo 2024, SHA-256 `1f3a9c97…e009`) en una base local; son las de producción (mismas capturas y mismo SQL).

### 8.1 Con todas las edades y ambos sexos — `get_isapre_penetracion(null, 0)`
Σ población = 18.480.432 (el total censado). Beneficiarios en las 346 comunas: 2.517.228 a 2.517.830.

| Mayor penetración (punto medio) | Beneficiarios | Población censada | Penetración |
|---|---:|---:|---:|
| Vitacura | 77.372 | 86.420 | 89,5 % |
| Las Condes | 220.870 | 296.134 | 74,6 % |
| Lo Barnechea | 74.828 – 74.860 | 112.620 | 66,4 % – 66,5 % |
| Providencia | 95.492 | 143.974 | 66,3 % |
| La Reina | 48.230 – 48.233 | 89.870 | 53,7 % |
| Ñuñoa | 121.181 | 241.467 | 50,2 % |
| Colina | 59.377 – 59.380 | 173.293 | 34,3 % |
| Huechuraba | 34.272 | 101.808 | 33,7 % |
| Concón | 15.922 – 15.925 | 48.294 | 33,0 % |
| Machalí | 19.837 – 19.840 | 60.875 | 32,6 % |

| Menor penetración (punto medio) | Beneficiarios | Población censada | Penetración |
|---|---:|---:|---:|
| Camarones | 2 – 4 | 861 | 0,2 % – 0,5 % |
| San Juan de la Costa | 35 | 7.776 | 0,5 % |
| Putre | 8 – 9 | 1.547 | 0,5 % – 0,6 % |
| General Lagos | 2 – 4 | 508 | 0,4 % – 0,8 % |
| Ercilla | 55 | 7.730 | 0,7 % |
| Tirúa | 74 | 10.208 | 0,7 % |
| Galvarino | 97 | 12.710 | 0,8 % |
| Lago Verde | 4 – 8 | 779 | 0,5 % – 1,0 % |
| Ninhue | 45 | 5.763 | 0,8 % |
| Saavedra | 105 | 12.877 | 0,8 % |

Distribución del punto medio (346 comunas): mínimo 0,35 % · p25 2,04 % · mediana 3,82 % · p75 7,78 % · p95 20,30 % · máximo 89,53 %. **88 comunas** (25 %) se muestran como rango por conteos pequeños suprimidos; el ancho máximo es **11,8 puntos porcentuales** (Torres del Paine: 18–42 beneficiarios sobre 203 → 8,9 % – 20,7 %). **Ninguna comuna supera 100 %.** Sin comunas «sin dato».

### 8.2 60 años o más, ambos sexos — `get_isapre_penetracion(null, 12)`
Σ población 60+ = 3.665.028 (mujeres 2.036.940 + hombres 1.628.088); beneficiarios 394.750 a 396.700.

| Mayor penetración | Beneficiarios | Población censada | Penetración |
|---|---:|---:|---:|
| Vitacura | 17.393 – 17.396 | 21.269 | 81,8 % |
| Las Condes | 47.482 | 70.514 | 67,3 % |
| Lo Barnechea | 12.249 – 12.279 | 19.272 | 63,6 % – 63,7 % |
| Providencia | 17.846 – 17.849 | 29.585 | 60,3 % |
| La Reina | 10.483 | 21.562 | 48,6 % |
| Ñuñoa | 17.113 – 17.116 | 47.952 | 35,7 % |
| Machalí | 2.712 | 9.803 | 27,7 % |
| Calama | 6.243 | 23.130 | 27,0 % |
| Concón | 2.820 | 10.476 | 26,9 % |
| Laguna Blanca | 6 – 17 | 51 | 11,8 % – 33,3 % |

| Menor penetración | Beneficiarios | Población censada | Penetración |
|---|---:|---:|---:|
| Juan Fernández · Tortel · Río Verde · San Gregorio · General Lagos (cero publicado) | 0 | 171 · 59 · 24 · 63 · 157 | 0,0 % |
| San Juan de la Costa | 6 – 14 | 2.332 | 0,3 % – 0,6 % |
| Ñiquén | 7 – 27 | 3.810 | 0,2 % – 0,7 % |
| San Ignacio | 12 – 28 | 4.482 | 0,3 % – 0,6 % |
| Monte Patria | 24 – 39 | 6.954 | 0,3 % – 0,6 % |
| Putre | 1 – 2 | 331 | 0,3 % – 0,6 % |

Distribución: mínimo 0,00 % · p25 1,40 % · mediana 2,37 % · p75 5,92 % · p95 18,38 % · máximo 81,78 %. **171 comunas** como rango; ancho máximo **21,6 puntos** (Laguna Blanca, 51 personas de 60+: 6–17 beneficiarios). **Ninguna supera 100 %.** **Una comuna sin penetración: Antártica**, población censada 60+ = 0 (hay 0 beneficiarios 60+); se muestra «sin dato».

### 8.3 Otros filtros (mismo método)
Mujeres, todas las edades: **1 comuna supera 100 %**: **Antártica**, 5 beneficiarias sobre 4 mujeres censadas (125,0 %) — se muestra tal cual. Posibles causas, no comprobadas: diferencias de definición territorial (domicilio Isapre [NO COMPROBADO] frente a residencia censal) o de fecha entre las dos fuentes, o el efecto de poblaciones muy pequeñas (4 mujeres censadas). Hombres, todas las edades; mujeres y hombres 60+: ninguna sobre 100 % (con 60+, Antártica queda «sin dato»: población 0). Medianas: mujeres 3,15 % / hombres 4,25 % (todas las edades); mujeres 2,22 % / hombres 2,76 % (60+). Rango por filtro: 29 y 24 comunas (todas las edades, F y M), 146 y 137 (60+, F y M).

### 8.4 Cortes de edad habilitados
**Solo 0 y 12.** Los cortes 1..17 calzan con los grupos del Censo (probado contra `get_poblacion_comunal_edad`) pero **no se abren**: restar dos cortes consecutivos aísla un tramo del numerador y en 104 de 16.608 casos (0,6 %) el intervalo resultante es más estrecho que las cotas por celda; ninguna celda suprimida queda exacta. Los cortes 18..20 (90+, 95+, 100+) no tienen grupo equivalente en el Censo. `get_isapre_comuna` (1b) ya admite 0..20 en producción. **Decisión del dueño (18-oct-2026): queda como está**, sin abrir otro PR. Motivos: ninguna celda suprimida queda exacta por resta de cortes (medido con la captura real), el XLSX de la Superintendencia es público y la supresión está declarada como política de presentación, no como protección. Esta fase no lo toca.

### 8.5 Advertencias que lleva la interfaz
Solo Isapre (sin Fonasa ni «resto»); numerador con la asimetría de edad y sexo sin información (§3.7 punto 4); períodos distintos (dic-2025 frente a 2024); comuna de la cartera Isapre no declarada [NO COMPROBADO] frente a residencia censal; sin recorte a 100 %; el color es por clases fijas (0–2, 2–5, 5–10, 10–20, 20–35, 35–50 y ≥ 50 %), por el punto medio del rango.

### 8.6 [NO COMPROBADO] de esta fase
Que el domicilio de la cartera Isapre sea la residencia censal; la causa de cualquier valor extremo (Vitacura 89,5 %, Antártica 125 %) — no se afirma ninguna; que las licencias de ambas fuentes permitan mostrarlas juntas en informes a clientes (Isapre sigue «por confirmar»; Censo CC BY-SA 4.0 declarada por el INE). La interfaz solo se probó en jsdom con capas simuladas: **no se vio en un navegador real**.
