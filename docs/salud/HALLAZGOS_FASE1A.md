# Hallazgos de la Fase 1a — establecimientos de salud (archivo real)

Evidencia de la carga **real** del registro DEIS contra una base PostGIS local (con las migraciones aplicadas y las 346 comunas del repo). Nada se tocó en Supabase de producción.
Archivo: `establecimientos_20261014.csv`, SHA-256 `244426f9201ecfaa4f8dc964d3ee7479a65eef565c37b9ddf05d22cac31343a6`, CC0, 5.782 filas.
Reproducir: `python etl/salud_establecimientos.py --dry-run --file establecimientos_20261014.csv` (sin base) y, con base de prueba, la misma orden sin `--dry-run` y con `--no-storage`.

## 1. Cuadre de filas (ETL → zona de paso → publicación en la base)

| Paso | Resultado |
|---|---|
| Filas del archivo = cargadas + rechazadas | 5.782 = 5.782 + **0** (0,000 % de rechazo; máximo configurado 0,5 %) |
| Estado | 5.354 vigentes (5.142 `Vigente en Operación Habitual` + 212 con minúscula) + 428 cerrados |
| Equivalencias aplicadas (todas contadas) | 1 `Atención Abierta-Ambu` (truncada en la fuente) → ambulatoria · 34 `Gendamería` (errata) → gendarmería |
| Sin dato ≠ No aplica ≠ baja | complejidad: 3.342 baja · 1.262 mediana · 131 alta · 760 no aplica · **287 sin dato** |
| Reportado, no corregido | 370 sin coordenadas · 73 cerrados sin fecha de cierre · 38 filas con nombre de comuna distinto del CUT (p. ej. «Con Con»/Concon, «Coyhaique»/Coihaique) |
| Comunas con ≥ 1 establecimiento | 345 de 346; sin ninguno: 12202 Antártica |
| Resultado de `publish_health_establishments` | `inserted 5782`, `rejected 0`; **idéntico** al ensayo sin base (ver §3) |
| Segunda ejecución con el mismo archivo | `already_loaded`, sin tocar nada (`ok_same_content`) |

## 2. Cordura contra cifras calculadas aparte

Cada cifra de la base se recalculó **directamente desde el CSV con otro método** (Python `csv`, sin pasar por el ETL ni la base):

| Cifra | Base (RPC) | Calculada aparte desde el CSV |
|---|---|---|
| Vigentes | 5.354 | 5.354 |
| Alta complejidad + Hospital, todos los estados (D1 por defecto) | 82 | 82 |
| …vigentes / comunas que tienen al menos uno | 80 / 54 | 80 / 54 |
| Alta complejidad ampliada (+ Clínica + Centro de Especialidades), todos | 129 | 129 |
| Alta complejidad fuera de ambas definiciones (tipo Otro y SAMU) | 2 (1 vigente) | 2 |
| Privados por dependencia (D2) | 2.336 | 2.336 |
| Privados con atención ambulatoria declarada por la fuente, vigentes | 1.953 | 1.953 |
| …más los 35 imputados por la tabla = ambulatorios privados vigentes | **1.988** (1.953 + 35) | 1.953 + 35 |
| Clase: oficial / imputada por tabla / sin clasificar (todas las filas) | 5.483 / 197 / 102 | 5.111 + 372 = 5.483 declarados |
| Establecimientos en el ranking: La Serena / Talca / Arica / Ovalle / Temuco | 239 / 122 / 117 / 107 / 104 | 239 / 122 / 117 / 107 / 104 |
| Providencia (13123) | 110 | **109 por nombre de comuna, 110 por CUT** (ver hallazgo) |
| Hospitales de alta complejidad vigentes: Providencia / Santiago / Independencia | 7 / 5 / 4 | 7 / 5 / 4 |

**Hallazgo en la fuente.** El establecimiento `112961` («E.L.S.A») trae `ComunaCodigo = 13123` (Providencia) y `ComunaGlosa = La Florida`. Su punto cae **dentro de Providencia**, así que el CUT es el dato correcto y el nombre
es la errata. El diseño usa **el CUT como verdad** y reporta los 38 desajustes de nombre; no los corrige en silencio.

## 3. Validación geográfica (se marca, jamás se mueve)

El ensayo sin base (shapely, distancia aproximada) y la publicación en la base (PostGIS `geography`) dan **exactamente lo mismo**:

| Estado | Filas |
|---|---|
| 0 dentro de su comuna | 5.379 |
| 1 borde (≤ 500 m) | 9 |
| 2 costero | **0** |
| 3 fuera de su comuna declarada | 24 |
| 4 sin coordenadas | 370 |
| 5 comuna sin polígono / 6 coordenada inválida | 0 / 0 |

* **Los 33 puntos fuera de su polígono** (9 borde + 24 fuera) caen **todos dentro de otra comuna** (ninguno en el mar). Distancia de los 24 a su comuna declarada: 3 entre 500 y 1.000 m · 2 entre 1 y 2 km · 1 entre 2 y 5 km · 14 entre 5 y 50 km · 4 a más de 50 km (uno a 2.066 km: Iquique/Santiago, error de captura evidente).
* **Consecuencia para los umbrales:** `health.near_border_m = 500` marca 9 filas; `health.coast_buffer_m = 2.000` **no marca ninguna** en este archivo con los polígonos del repo. Se conserva (configurable) porque el polígono comunal es simplificado y otro archivo podría traer puntos en la orilla, pero **no se justifica con datos de este archivo**: es un valor inicial, no medido.
* Casos de prueba: **Isla de Pascua (05201)** 1 establecimiento, dentro · **Juan Fernández (05104)** 2, ambos dentro · **Cabo de Hornos (12201)** 3 (2 dentro, 1 sin coordenadas) · **Antártica (12202)**: ningún establecimiento en el archivo; el caso «comuna sin polígono» (estado 5) se prueba con una fila **sintética** en el test SQL.
* El polígono comunal del repo (`public/comunas.geojson`) es el que se usa; **no se comparó** con un límite oficial de alta resolución ([NO COMPROBADO]).

## 4. Tamaño medido (`docs/salud/planb/medir_tamano.sql`; regla 7: medido, no estimado)

| Objeto | Tamaño |
|---|---|
| `health_establishments` (5.782 filas, con índices) | **3.024 kB** (≈ 535 bytes por fila; tabla 2.392 kB) |
| `health_tipo_clasificacion` (29 filas) | 32 kB |
| `health_establishments_stage` tras publicar | 16 kB (se vacía con `TRUNCATE`; con `DELETE` quedaban 2.152 kB de páginas muertas) |
| Base completa de pruebas | 29 MB (26 MB antes de cargar) |

Con retención 1 (`retention.keep_point_snapshots`) cada carga nueva reemplaza a la anterior; con 2 capturas serían ≈ 6 MB (2 × lo medido). **No hay esquema restringido todavía** (D11: los conteos de establecimientos no llevan supresión).

## 5. Preguntas de la fase

| # | Pregunta | Nivel · sello | Prueba | Cordura con datos reales |
|---|---|---|---|---|
| 1a-3 | ¿Cuántos establecimientos vigentes hay por comuna, por complejidad y clase (filtrable, con ranking)? | Respondida con rigor · *Oficial con advertencia* (la clase de algunos está imputada) | SQL 67 aserciones (conteo por CUT declarado, filtros, ceros verdaderos, ranking con empates, cerrados ocultos, clase imputada declarada) · Vitest (panel, ranking, popups) | §2: top de comunas y totales recalculados aparte desde el CSV |
| 1a-4 | ¿Cuántos hospitales de alta complejidad hay y dónde (dos definiciones)? | Respondida con rigor, **dos definiciones etiquetadas** · *Oficial con advertencia* | SQL (D1: hospital / ampliada / fuera de ambas; cerrados fuera de «vigentes») · Vitest (el filtro nombra la definición) | 82/80 hospitales (54 comunas), 129/126 ampliada, 2/1 fuera de ambas: coinciden con el CSV |
| 1a-1 | Comunas > 50.000 hab. sin establecimiento de alta complejidad **en** la comuna | — | — | **EN ESPERA**: falta la población comunal del Censo 2024 |
| 1a-2 | Establecimientos ambulatorios privados por 10.000 hab. en la RM | — | — | **EN ESPERA**: idem |

Con la definición por defecto, **292 de 346 comunas no tienen ningún hospital de alta complejidad vigente** (54 sí). Ese conteo **no responde** 1a-1: falta filtrar por población y «en la comuna» no es «accesible».

## 6. Lo que NO se comprobó
* La interfaz solo se probó en jsdom (Vitest con capas Leaflet simuladas); **no se vio en un navegador real** ni con Supabase real.
* Las migraciones **no están aplicadas** en producción; las pruebas SQL corrieron en una base local con el esquema mínimo de plataforma (no el esquema real, issue de deuda).
* No se subió el original a Storage (`--no-storage`); la subida y `get_layer_provenance` con una captura real quedan para la primera carga en el proyecto.
* La clase ambulatorio/hospitalario imputada por tabla es **decisión de diseño**, no dato oficial.
