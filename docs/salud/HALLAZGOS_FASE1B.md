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
| Totales regionales publicados | 12 de 16 (4 regiones con un único grupo suprimido no publican su total; ver §2.2) |

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
| Grupos (unidad × sexo) con total «<5» | 71 de 1.089 |
| Grupos cuyo cuadre por cotas falla | **0** |

### 2.1 Qué ve el usuario (medido con las RPC sobre la captura real, con las migraciones corregidas tras la revisión del PR)

El valor por comuna es **exacto cuando lo publicado lo determina** y un **rango** si no (DISENO §3.3 punto 6): con todas las edades y el total del grupo publicado el valor es exactamente ese total; con un filtro de edad, las celdas suprimidas dentro del filtro se acotan por el **residuo publicado** del grupo. Nada de esto usa conteos completos.

| Consulta | Comunas | Con rango (no exactas) | Σ del rango publicado | Real (conteos completos) |
|---|---|---|---|---|
| `get_isapre_comuna(null, 0, null)` — todas las edades, ambos sexos | 346 | **59** (antes **342**) | 2.517.246 a 2.517.421 | 2.517.270 (comunas) |
| ídem, solo mujeres / solo hombres / sexo sin información | 346 | 7 / 6 / 49 | F 1.191.787–1.191.802 · M 1.325.308–1.325.321 · SI 151–298 | |
| `get_isapre_comuna(null, 12, null)` — 60+, todas las comunas | 346 | 141 | 394.768 a 396.372 | |
| `get_isapre_comuna(null, 12, 'hospital')` — 60+ en comunas sin hospital de alta complejidad | 292 | **137** (antes **283**) | **115.632 a 117.226** (antes 114.478–118.358) | 116.128 |
| `get_isapre_comuna(null, 12, 'ampliada')` | 288 | 136 | **92.565 a 94.156** (antes 91.440–95.276) | 93.058 |

**Corrección del rango verificada en las 2.768 combinaciones** (346 comunas × 4 sexos × 2 cortes de edad): el valor real, calculado con los conteos completos, cae **siempre** dentro del rango publicado (0 fuera). Una prueba SQL aleatoria hace la misma comprobación sobre 640 combinaciones en cada corrida. Las comunas que quedan en rango son las que tienen un grupo (casi siempre «sexo sin información») con total «<5».

**Declaración honesta:** la cartera completa por comuna, edad y sexo ya es **pública** en el XLSX de la Superintendencia. La supresión es una **política de presentación** de esta plataforma (regla 5), no una protección real de las personas; la fuente **no declara** una norma de supresión. Por eso no se publica el total comunal calculado con los conteos completos: restarle los grupos publicados despejaría un grupo «sexo sin información» de 1 a 4.

### 2.2 Fuga por resta regional (encontrada en la revisión del PR)

Σ de los totales regionales − Σ de los totales de grupo publicados de la región = Σ de los totales de grupo **suprimidos** de esa región; si la región tiene **un solo** grupo suprimido, eso despeja su total. Con la captura real ocurría en **4 de 16 regiones**:

| Región | Residuo regional (total − Σ grupos publicados) | Grupos suprimidos | Qué revelaba |
|---|---|---|---|
| 02 | 4 | 1 | ese grupo suma exactamente 4 |
| 03 | 1 | 1 | exactamente 1 |
| 14 | 3 | 1 | exactamente 3 |
| 16 | 1 | 1 | exactamente 1 |

Corrección (misma regla que en las celdas): en esas regiones el **total regional no se publica** (`total` NULL con su nota; la base lo cuadró contra el archivo **antes** de retenerlo, y la publicación re-valida la invariante). La captura real publica ahora 12 de 16 regiones; `regions_total_withheld = 4`. **Queda una limitación, igual que en las celdas:** con 2 o más grupos suprimidos el residuo regional da cotas; si fuera igual a `k` (todos 1) o a `4k` (todos 4) las cotas se vuelven exactas. Con la captura real ocurre en la región 06 (residuo 3 con 3 grupos suprimidos: los tres suman 1 cada uno). No lo cerré porque es la misma regla de cuadre por cotas ya aceptada para las celdas (DISENO §3.3 punto 5); decidir si se endurece para las regiones está en §7.

## 3. Pregunta 1b-1 y su verificación independiente

*¿Cuántos beneficiarios Isapre de 60 años o más hay en comunas sin hospital de alta complejidad en la comuna?* (D1: dos definiciones; «sin alta» = ningún establecimiento **vigente** que cumpla la definición, según la captura de 1a. **«60+» = tramos 60-64 a ≥100: excluye la edad sin información e incluye el sexo sin información.**)

| Definición (D1) | Comunas sin alta | Beneficiarios 60+ (conteos completos) | Rango que sale de lo publicado | ¿Cae dentro? |
|---|---|---|---|---|
| Solo hospitales | 292 de 346 | **116.128** | 115.632 a 117.226 | sí |
| Ampliada (+ clínicas y centros de especialidades) | 288 de 346 | **93.058** | 92.565 a 94.156 | sí |

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
* **Garantías de privacidad:** son las de una política de presentación (la cartera es pública). Se probó que el rango publicado contiene siempre el valor real y que ninguna resta regional despeja un grupo; **no** se probó (ni se afirma) resistencia a un atacante que combine consultas (§3).
* **Cómo se registra el error muestral** de CASEN más allá de lo que reproduce el tabulado (un nivel de conglomerados); el contraste con el tabulado oficial coincide, pero no equivale a una validación del diseño completo.
* La interfaz solo se probó en jsdom (Vitest con capas Leaflet simuladas); **no se vio en un navegador real** ni contra Supabase real. Las migraciones **no están aplicadas** en producción.
* No se subió el original a Storage en la carga local (`--no-storage`).

## 7. Decisiones del dueño y pendientes

Resueltas en la revisión del PR: **(1)** las licencias de Isapre y CASEN las confirma el dueño (la ficha sigue en «por confirmar»; no bloquea el merge porque las capas quedan en `client_ready = false`); **(2)** Censo 2024 y Fonasa siguen pendientes (1b-2 y 1b-5 en espera); **(3)** la regla 5 **no se cambia**: no se publica el total comunal con conteos completos (la opción de la versión anterior de este informe se descartó porque permitiría despejar por resta un grupo «sexo sin información» de 1 a 4); el rango se resuelve con la precisión de §2.1.

Quedan abiertas:
1. **Región 06** (residuo regional = k): ¿endurecer la regla para que no se publique el total regional cuando el residuo es `k` o `4k`? Hoy es la misma cota que aceptan las celdas.
2. **Diferencia entre consultas de 1b-1** (§3): ¿se acepta como límite declarado o se retira la segunda definición del agregado? No tiene arreglo técnico mientras haya dos conjuntos anidados.
3. **Orden de aplicación** (`RUNBOOK_1B.md`): migraciones 1 y 2 → cargas → front → migración 3 (igual que 1a). Requiere 1a aplicada y cargada.
