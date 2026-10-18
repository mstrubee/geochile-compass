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

> **Alcance de esta comprobación.** Que la base y el CSV coincidan valida el **pipeline** (ETL → base → RPC), no que el **dato** sea plausible: los dos salen del mismo archivo. La plausibilidad del ranking se revisa en §7, y reveló una rareza de la fuente.

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

## 7. Rareza de la fuente que distorsiona el ranking por comuna (revisión del dueño)

**Síntoma.** Con el filtro por defecto de la primera entrega el ranking de «establecimientos vigentes» era: La Serena 239 · Talca 122 · Arica 117 · Providencia 110 · Ovalle 107 · Temuco 104…; Santiago (13101) 99 (9.º) y Puente Alto (13201) 50.

**Respuesta a «¿qué cuenta el ranking?».** Contaba **todos los tipos** del registro, sin distinguir: consultas privadas, clínicas dentales, laboratorios, tomas de muestras (SETM), diálisis, vacunatorios, postas, hospitales, «Otro», unidades y programas. Ese conteo **no es oferta asistencial**. Se corrigió (ver «Qué se cambió»).

### 7.1 Top 15 (vigentes, todos los tipos) desglosado por tipo

`CSPriv` = Centro de Salud Privado · `Lab+SETM` = laboratorios + tomas de muestras · `Diál+Vac` = diálisis + vacunatorios · `APS púb` = CESFAM, CECOSF, postas, consultorios · `Urgenc` = SAPU/SUR/SAR · cerrados aparte.

| Comuna | Vigentes | Cerrados | CSPriv | Dental | C. Especialidades | Lab+SETM | Diál+Vac | Hosp+Clín | APS púb | Urgenc | Otros |
|---|---|---|---|---|---|---|---|---|---|---|---|
| La Serena | **239** | 10 | 78 | 61 | 26 | 39 | 7 | 2 | 14 | 6 | 6 |
| Talca | 122 | 11 | 48 | 16 | 10 | 9 | 4 | 6 | 13 | 6 | 10 |
| Arica | 117 | 9 | 27 | 15 | 23 | 12 | 4 | 6 | 12 | 3 | 15 |
| Providencia | 110 | 16 | 38 | 7 | 2 | 19 | 10 | 23 | 5 | 1 | 5 |
| Ovalle | 107 | 6 | 21 | 24 | 18 | 15 | 2 | 2 | 18 | 5 | 2 |
| Temuco | 104 | 27 | 14 | 31 | 1 | 10 | 5 | 5 | 16 | 8 | 14 |
| Antofagasta | 100 | 6 | 18 | 3 | 2 | 32 | 10 | 9 | 10 | 7 | 9 |
| Puerto Montt | 99 | 5 | 23 | 7 | 2 | 12 | 3 | 8 | 25 | 6 | 13 |
| Santiago | 99 | 12 | 39 | 8 | 0 | 17 | 4 | 12 | 7 | 2 | 10 |
| Coquimbo | 86 | 9 | 22 | 12 | 11 | 16 | 2 | 1 | 11 | 8 | 3 |
| Concepción | 81 | 14 | 15 | 4 | 2 | 16 | 17 | 6 | 9 | 6 | 6 |
| Valdivia | 80 | 4 | 21 | 9 | 0 | 10 | 2 | 4 | 18 | 5 | 11 |
| Copiapó | 78 | 12 | 27 | 5 | 1 | 13 | 4 | 4 | 9 | 3 | 12 |
| Valparaíso | 75 | 4 | 13 | 5 | 2 | 11 | 1 | 6 | 17 | 8 | 12 |
| Viña del Mar | 70 | 4 | 13 | 8 | 2 | 9 | 5 | 8 | 14 | 6 | 5 |

### 7.2 La Serena contra Santiago y Puente Alto

| | Vigentes | Cerrados | CSPriv | Dental | C. Esp. | Lab+SETM | Diál+Vac | Hosp+Clín | APS púb | Urgenc | Otros |
|---|---|---|---|---|---|---|---|---|---|---|---|
| La Serena (04101) | 239 | 10 | 78 | 61 | 26 | 39 | 7 | 2 | 14 | 6 | 6 |
| Santiago (13101) | 99 | 12 | 39 | 8 | 0 | 17 | 4 | 12 | 7 | 2 | 10 |
| Puente Alto (13201) | 50 | 3 | 10 | 5 | 2 | 2 | 2 | 5 | 10 | 8 | 6 |

Por dependencia (vigentes): La Serena 209 privados · 20 municipales · 6 de Servicio de Salud; Santiago 69 · 8 · 16; Puente Alto 21 · 20 · 6. La diferencia **no está en lo público** (los dos tienen 26 establecimientos públicos: municipales + Servicio de Salud) sino en los **privados pequeños**: consultas, clínicas dentales y centros de especialidades, que suman 165 de los 239 de La Serena.

### 7.3 Qué es y qué no es

* **No es un error de código de comuna ni un registro «cargado en la capital».** De los 239 vigentes de La Serena, **238 caen dentro de su polígono** (1 en otra comuna). Los 212 privados los registra la *SEREMI de Salud de Coquimbo* (códigos 200xxx–202xxx) y los 26 públicos el Servicio de Salud Coquimbo. Los nombres y direcciones son reales y distintos (p. ej. `105202` Centro de Salud Mutual CChC La Serena, `105203` Policlínico del Trabajador AChS, `105208` Clínica Regional Elqui, `105225` Centro Médico Integramédica, `105232` Policlínico Cruz Roja). Los duplicados exactos (mismo nombre y dirección) entre los vigentes son 2 casos en todo el país (Talca y Ancud, 1 cada una): no explican nada.
* **Sí es una heterogeneidad del registro entre regiones.** Establecimientos **privados vigentes** por región: **Coquimbo 417** · Metropolitana 516 · Biobío 105 · Valparaíso 124 · Maule 200. Una sola comuna (La Serena) concentra el 50 % de los privados de su región (209 de 417), y por tipo: *Clínica Dental privada* Coquimbo **119** · Biobío 9 · RM 62 · Valparaíso 16; *Centro de Especialidades privado* Coquimbo **63** · Biobío 0 · RM 1 · Valparaíso 0; *toma de muestras (SETM)* Coquimbo 47 · Biobío 0 · RM 40.
* **Causa: [NO COMPROBADO].** Lo compatible con los datos es que cada SEREMI autorice, clasifique y registre de forma distinta a los privados (p. ej. una consulta dental dentro de un centro médico como establecimiento aparte, o un «centro de especialidades» para cada consulta). No lo puedo confirmar con el archivo; habría que preguntarlo a la SEREMI de Salud de Coquimbo o al DEIS. **No se corrigió ningún dato.**
* **Consecuencia de uso:** el conteo de establecimientos **no es oferta ni es comparable** entre comunas o regiones. Por habitante sería peor (la población llega con el Censo). Para acercarse a «atención» hay que filtrar por tipo y dependencia.

### 7.4 Con filtros asistenciales el ranking cambia (misma base, mismo archivo)

| Filtro | Primeras comunas |
|---|---|
| Solo hospitales y clínicas (vigentes) | Providencia 23 · Santiago 12 · Vitacura 10 · Antofagasta 9 · Las Condes 9 · Viña del Mar 8 |
| Solo dependencia pública (municipal + Servicio de Salud) | Puerto Montt 46 · Los Ángeles 42 · Valparaíso 40 · Temuco 37 · Valdivia 33 · Talca 30 |
| Por defecto nuevo (solo «Establecimiento de Salud», todos los tipos) | La Serena 209 · Talca 113 · Arica 104 · Providencia 101 · Ovalle 98 (Santiago 7.º con 89; Puente Alto 25.º con 43) |

El filtro por ámbito **por sí solo no corrige** la distorsión (La Serena sigue primera con 209): quita 30 unidades y programas, no los privados pequeños. Por eso la solución es **decir qué se cuenta**, ofrecer el filtro por tipo y advertir la heterogeneidad, no esconder el número.

### 7.5 Qué se cambió
1. **RPC:** `get_health_comuna_counts` y `get_health_establishments` aceptan `p_ambito` (ámbito de la fuente) y `p_tipo`; nueva `get_health_comuna_tipos(cut)` con el desglose de una comuna por tipo, ámbito y estado.
2. **Por defecto** el front cuenta solo `AmbitoFuncionamiento = 'Establecimiento de Salud'` (las unidades de atención y los programas cuelgan de un establecimiento y no son uno); casilla para incluirlos.
3. **Cada panel dice qué se está contando** («todos los tipos · solo establecimientos · solo vigentes», con la lista de tipos que entran) y avisa la heterogeneidad entre regiones.
4. **Filtro por tipo** y **desglose por tipo de la comuna elegida** en el ranking.
5. **La ficha** lleva la advertencia en «Qué NO dice esta capa».
