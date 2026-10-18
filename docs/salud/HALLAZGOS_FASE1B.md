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

**CASEN** (`etl/salud_casen.py`):

| Paso | Resultado |
|---|---|
| Personas | 218.367 en 16 regiones; personas y población expandida por región = filas «Total» del tabulado oficial ✔ |
| Estimaciones | 96 (16 regiones × 6 sistemas) |
| **Contraste con el tabulado oficial** (hoja 3) | estimación puntual: diferencia máxima **2,98·10⁻⁶ pp**; error estándar: **3,4·10⁻⁸ pp**; casos muestrales: **0** de diferencia |
| Publicables | **67 de 96**; 29 no publicables (< 60 casos muestrales y/o «no fiable» según las notas oficiales), todas «Otro sistema» y «No sabe» |
| Diseño | df mínimo 173; estratos con un solo conglomerado: 0 |

Ejemplos (Isapre, IC 95 %): región 01 **8,0 %** (entre 6,9 y 9,2 %) · región 13 **20,6 %** (entre 19,8 y 21,5 %) · región 15 **5,8 %** (entre 4,9 y 6,8 %). Fonasa región 13: entre 75,0 y 76,7 %.

## 2. Supresión de conteos pequeños (regla 5; umbral < 5; DISENO §3.3)

| | |
|---|---|
| Celdas publicadas | 23.958 |
| Ceros publicados (0 es 0, no se suprime) | 12.090 |
| Suprimidas primarias (1 a 4 personas) | 2.783 |
| Suprimidas complementarias (para que la primaria no se deduzca restando) | 144 |
| Grupos (unidad × sexo) con total «<5» | 71 de 1.089 |
| Grupos cuyo cuadre por cotas falla | **0** |

### 2.1 Qué ve el usuario (medido con las RPC sobre la captura real)

| Consulta | Comunas | Con rango (no exactas) | Σ rango publicado |
|---|---|---|---|
| `get_isapre_comuna(null, 0, null)` — todas las edades | 346 | **342** | 2.513.324 a 2.521.850 (real: 2.517.270 en comunas) |
| `get_isapre_comuna(null, 12, 'hospital')` — 60+ en comunas sin hospital de alta complejidad | 292 | **283** | 114.478 a 118.358 |

Casi todas las comunas se ven como rango porque basta **una** celda suprimida (hay 66 celdas por comuna: 22 tramos × 3 sexos) para que el total deje de ser exacto; por eso el panel muestra siempre el rango, dice cuántas comunas lo son y lo explica. Para el agregado de la pregunta 1b-1 **no** se usa el rango (ver §3).

**Declaración honesta:** la cartera completa por comuna, edad y sexo ya es **pública** en el XLSX de la Superintendencia. La supresión es una **política de presentación** de esta plataforma (regla 5), no una protección real de las personas; la fuente **no declara** una norma de supresión.

## 3. Pregunta 1b-1 y su verificación independiente

*¿Cuántos beneficiarios Isapre de 60 años o más hay en comunas sin hospital de alta complejidad en la comuna?* (D1: dos definiciones; «sin alta» = ningún establecimiento **vigente** que cumpla la definición, según la captura de 1a.)

| Definición (D1) | Comunas sin alta | Beneficiarios 60+ (conteos completos) | Rango que sale de lo publicado | ¿Cae dentro? |
|---|---|---|---|---|
| Solo hospitales | 292 de 346 | **116.128** | 114.478 a 118.358 | sí |
| Ampliada (+ clínicas y centros de especialidades) | 288 de 346 | **93.058** | 91.440 a 95.276 | sí |

Total del país con 60+ (todas las unidades): 395.273; en comunas sin hospital de alta complejidad: 29,4 %.
El agregado se calcula **dentro de la base con los conteos completos** (regla 5: las métricas derivadas usan datos completos) con una función `SECURITY DEFINER` que **solo devuelve el agregado** y **se niega** si el conjunto tiene menos de 10 comunas (`salud.min_aggregate_comunas`). Se entrega junto al rango publicado como control de consistencia.

**Verificación independiente** (`docs/salud/planb/verificar_1b1_independiente.py`; no usa el ETL ni el lector del repo): el conjunto de comunas se recalcula desde el CSV de establecimientos (54 comunas con hospital de alta complejidad → 292 sin) y es **igual** al de la base; la suma de los tramos 60-64 a ≥100 de las seis hojas del XLSX original para esas comunas da **116.128**, igual que la base. (Las comunas sin fila en el archivo Isapre: ninguna; el único nombre sin cruzar es la fila «-» que no es comuna.)

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
| 1b-2 | Comunas con mayor proporción de beneficiarios Isapre sobre el Censo 2024 | Respondida con rigor | Oficial con advertencia | **EN ESPERA** — falta la población comunal del Censo 2024 |
| 1b-3 | Proporción regional que declara Fonasa o Isapre (CASEN 2024) | **Estimada con rango** (IC 95 %) | Estimado | construida: 67 de 96 estimaciones publicables |
| 1b-4 | Esa proporción por comuna | **No respondible hoy** | — | CASEN no es representativa a nivel comunal (D6) |
| 1b-5 | Inscritos Fonasa por comuna, tramo, edad y sexo | **No respondible hoy** | — | faltan los archivos de Fonasa (D3) |

## 6. Lo que NO se comprobó **[NO COMPROBADO]**

* **Licencia** de ambas fuentes: no la declaran en lo leído. `data_sources.license_label` queda en `null` y la ficha dice «por confirmar».
* **Semántica de la comuna** del archivo Isapre (domicilio, contrato u otra): no está declarada. La interfaz no la interpreta.
* **Fecha exacta de publicación** de la cartera: se tomó de la cabecera `Last-Modified` (2026-01-28), que es una señal del servidor, no una declaración del archivo. La de CASEN (2026-06-10) la indicó el operador.
* **Fechas de terreno de CASEN 2024**.
* **Información provisional**: el archivo la declara «sujeta a modificación»; no se sabe cuándo se consolida.
* **Cómo se registra el error muestral** de CASEN más allá de lo que reproduce el tabulado (un nivel de conglomerados); el contraste con el tabulado oficial coincide, pero no equivale a una validación del diseño completo.
* La interfaz solo se probó en jsdom (Vitest con capas Leaflet simuladas); **no se vio en un navegador real** ni contra Supabase real. Las migraciones **no están aplicadas** en producción.
* No se subió el original a Storage en la carga local (`--no-storage`).

## 7. Decisiones que necesito del dueño

1. **Licencias:** confirmar (o pedir) la de la cartera Isapre y la de la base CASEN antes de pasar las capas a `client_ready = true`.
2. **Censo 2024 comunal (1b-2):** entregar la población por comuna (y edad si se quiere 60+) para habilitar la pregunta.
3. **Fonasa (1b-5):** entregar los archivos; mientras tanto no hay ninguna capa ni cifra que dependa de ellos.
4. **Presentación del rango:** casi todas las comunas aparecen como «entre a y b». ¿Se mantiene (conservador) o se prefiere publicar el total por comuna calculado con conteos completos y suprimir solo el detalle por edad/sexo? Es un cambio de política (regla 5), no técnico.
5. **Orden de aplicación** (`RUNBOOK_1B.md`): migraciones 1 y 2 → cargas → front → migración 3 (hojas del árbol), igual que en 1a.
