# Hallazgos de la Fase 0 — entorno y sondeo

Fecha de las mediciones: **2026-10-17** (UTC). Todo lo marcado `[COMPROBADO]` se verificó con el archivo o el servicio real en esa fecha; lo marcado
`[NO COMPROBADO]` no. Las muestras de archivos grandes se leyeron **por rangos** (no se bajó ningún zip entero) y **ningún dato descargado se commitea**: aquí
solo hay hashes, columnas y cifras agregadas. Reproducible con `python etl/salud_probe.py --full` (sondeo) y `bash etl/salud/dev_env.sh` (entorno).

---

## 1. Resumen ejecutivo

**Premisas que caen o cambian (lo que más importa):**

| # | Premisa del brief | Resultado | Efecto |
|---|---|---|---|
| P1 | `ComunaCodigo` de establecimientos viene como entero sin cero inicial | **FALSA**: las 5.782 filas ya traen texto de **5 caracteres con cero** (`01101`) y todas cruzan con las 346 comunas | Se valida, no se rellena con `lpad` |
| P2 | Egresos DEIS con **establecimiento**, comuna de residencia y previsión | **FALSA**: el diccionario oficial y las cabeceras de 2019–2025 **no traen ninguna variable de establecimiento** | **Cae la matriz comuna→establecimiento** (Fase 2) y la calibración observada del modelo de captación (Fase 3) |
| P3 | Egresos abiertos «al menos hasta 2023; busca 2024» | **Mejor**: existen **2019–2025** (2025 modificado el 2026-06-03) | Hay 2024 y 2025 |
| P4 | Isapre: cartera por comuna, edad y sexo, dic-2025, XLSX | **Confirmada** y cuadra exacto con el «Total País»; además hay dic-2024, mensual regional hasta ago-2026 y un TXT trimestral hasta 2026 T2 | Se puede alinear 2024 con egresos 2024 |
| P5 | Fonasa: comuna = establecimiento APS de inscripción | **[NO COMPROBADO]**: `www.fonasa.cl` devuelve 403 del sitio | Plan B (descarga manual) |
| P6 | Isócronas: edge function → ORS (a pie, auto, bici) → `poi_isochrones` | **Confirmada**, con 4 hallazgos de riesgo (§7) | Cambia el diseño de la Fase 3 |

**Hallazgos nuevos que el brief no preveía:**

* En egresos **2024 y 2025 ≈ 7 % de las filas vienen con comuna, sexo, edad, previsión y año enmascarados con `*`**; en 2019–2023 no ocurre (§5.4).
* CASEN 2024 **no es representativa a nivel comunal** (nota oficial) y su base «provincia-comuna» solo trae claves y factores (§5.6).
* La premisa «`user_roles` no está en el repo» de la **línea base era errónea** (fue un error mío de grep, corregido; §8).
* `isochrone` está abierta (`verify_jwt = false`) y `sign-urls` no valida usuario (§7, §9).

**Bloqueos por el entorno:** el entorno **ahora permite** `deis.minsal.cl` y `censo2024.ine.gob.cl` (en el prechequeo daban 403 del proxy). Siguen sin
alcanzarse `www.fonasa.cl` (403 del sitio), `www.deis.minsal.cl` y `download.geofabrik.de` (la conexión se corta con el túnel abierto), y el **listado** de datos
abiertos de DEIS está detrás de un desafío de WAF (no se elude).

**Decisiones que necesito de ti:** §14.2.

---

## 2. Entorno, red y acceso al repo

### 2.1 Repo y permisos `[COMPROBADO]`
`mstrubee/geochile-compass` adjunto con credenciales de push; clon en `/home/user/geochile-compass`, rama `feat/salud-fase-0` desde `main` (`9026d67`).
`git push --dry-run` a una rama inexistente → `[new branch]` (no se creó nada); la API REST devuelve `permissions: {admin, maintain, push, pull, triage: true}`; `main` **no está protegida**.
`gh pr create` no se usa (GraphQL bloqueado); la lectura/creación de PR va por `gh api repos/mstrubee/geochile-compass/pulls`. `gh auth status` dice «token inválido» pero la API REST autentica: no se tocó.

### 2.2 Hosts (HEAD, salvo donde se indica) `[COMPROBADO]`

`salud_probe.py` clasifica cada resultado. «Proxy» = política de red del entorno (`CONNECT tunnel failed`, 403 del gateway); «sitio» = responde el propio sitio.

| Host | Resultado | Quién | Detalle |
|---|---|---|---|
| `datos.gob.cl` | 200 | — | API CKAN y descargas funcionan |
| `deis.minsal.cl` | 200 (home) | — | **Cambió** (antes 403 proxy). Su endpoint AJAX de datos abiertos (`admin-ajax.php`, tabla Ninja Tables) responde **403 «Just a moment…»** = desafío de WAF Cloudflare → **no se elude; plan B** |
| `www.deis.minsal.cl` | `Connection reset by peer` | sitio/upstream | el túnel se abre y se corta a los 13 s (517 B enviados, 39 B recibidos); no es denegación de política |
| `repositoriodeis.minsal.cl` | raíz 403; **archivos 200/206** | sitio (raíz) | los zips de egresos y urgencias responden por ruta exacta |
| `www.superdesalud.gob.cl` | 200 | — | |
| `datos.superdesalud.gob.cl` (descargas) | HEAD devuelve una página HTML; **GET con `Range` 206** | — | el HEAD no es fiable aquí |
| `www.fonasa.cl` | **403** | **sitio** | `server: awselb/2.0`; responde con túnel abierto → WAF; **plan B** |
| `datosabiertos.fonasa.cl`, `estadisticas.fonasa.cl` | 403 sitio / 502 gateway | — | **hosts que probé por conjetura**: no son fuentes confirmadas |
| `www.ine.gob.cl`, `censo2024.ine.gob.cl` | 200 | — | `censo2024` **cambió** (antes 403 proxy) |
| `redatam.ine.gob.cl` | GET 200 (HEAD 500) | — | `redatam-ine.ine.cl` (enlace antiguo de la página): 403 del **proxy** |
| `observatorio.ministeriodesarrollosocial.gob.cl` | 200 | — | |
| `download.geofabrik.de` | `Connection reset by peer` (también en la ruta real del `.pbf`) | sitio/upstream | corte a los 8 s con túnel abierto; **no confirmable como bloqueo** |
| `github.com` | HEAD 400 | — | git (clone/fetch/push) funciona |
| `pypi.org`, `registry.npmjs.org` | OK **solo por el proxy** | entorno | están en `NO_PROXY` y el DNS directo no resuelve; se anula `NO_PROXY` solo en el comando |
| `archive.ubuntu.com`, `security.ubuntu.com` | 200 **solo por HTTPS** | — | las fuentes de apt son `http://` y el proxy solo tuneliza HTTPS → fuentes temporales |

Certificados: ningún problema de TLS. Geobloqueo: **[NO COMPROBADO]** (no hay forma de distinguir un reset por geobloqueo desde aquí).

---

## 3. PostGIS, disco y cómo corren las pruebas SQL

* **PostGIS 3.4.2 sobre PostgreSQL 16.15 funciona** en la sesión (`apt` con fuentes `https` temporales y el proxy solo por línea de comandos; no se toca `/etc/apt`). Clúster fuera del repo
  (`/var/tmp/geochile-pgtest`, puerto 5433), venv fuera del repo (`/var/tmp/geochile-venv`).
* **Disco:** ≈ 28 GB escribibles (de 31 GB; prueba de escritura de 50 MB OK). Cabe un PostGIS con los datos reales completos: los egresos 2019–2025 pesan **≈ 2,0 GB de CSV sin comprimir** (103 MB en zip),
  la cartera Isapre trimestral 327 MB por trimestre, CASEN nacional 750 MB. El diseño no carga microdatos de egresos en tablas publicadas (solo agregados).
  El tamaño de lo publicado **no se mide en esta fase** (aún no hay ETL): queda para la fase que cargue (`planb/medir_tamano.sql`).
* **`docker` no sirve aquí** (CLI sin daemon). El plan B con `docker compose` para tu máquina está en `docs/salud/planb/` y **no se probó** (`[NO COMPROBADO]`); `dev_env.sh` acepta `SALUD_EXTERNAL_PG=1` para usarlo, y ese modo **sí se probó** contra el clúster local.
* **Línea base reproducida con `dev_env.sh`**, desde cero (rutas, puerto y venv alternativos, pasos de apt, clúster, venv, npm y bases) y en la pasada idempotente (también en modo externo):
  Vitest **472 tests en 34 archivos**, pytest permisos **43 + 4 omitidos**, proyectos **45**, SQL **92 / 111 / 7**, `git` sin cambios en archivos versionados. Coincide con la línea base del brief.
* Las pruebas SQL antiguas no corren en local: ver §8 (la causa real es otra).

---

## 4. Premisas: estado

| Premisa | Estado | Evidencia |
|---|---|---|
| Establecimientos: CSV CC0, oct-2026, 5.782 filas, 33 campos, lat/lon, incluye cerrados | **Confirmada** | 5.782 filas, 33 columnas, 428 «Cerrado», lat/lon en 5.412 filas; `license_id = cc-zero` (a nivel de dataset) |
| `ComunaCodigo` entero sin cero inicial | **Falsa** | texto de 5 caracteres en el 100 % |
| Isapre comunal dic-2025 XLSX | **Confirmada** | §5.2 |
| Fonasa por comuna de inscripción APS | **[NO COMPROBADO]** | WAF |
| DEIS egresos con establecimiento | **Falsa** | §5.4 |
| DEIS 2024 disponible | **Confirmada (y 2025)** | §5.4 |
| ISÓCRONAS vía ORS + `poi_isochrones` + lote | **Confirmada** | §7 |
| ORS no considera tráfico | **Confirmada** | la edge function llama a `/v2/isochrones/{perfil}` con `range_type: time` sin parámetros de tráfico |

---

## 5. Fuentes (ficha por fuente; regla 1)

Para toda fuente: **fecha de descarga 2026-10-17**. «Hash» solo existe si se descargó el archivo completo; con descarga parcial se dice y **no se inventa**.
`client_ready` recomendado = el valor con el que debería nacer la capa (regla 6).

### 5.1 Establecimientos de salud vigentes
| Campo | Valor |
|---|---|
| Organismo | Ministerio de Salud (DEIS) vía datos.gob.cl |
| URL exacta | `https://datos.gob.cl/dataset/3bf4cf7c-f638-4735-9a01-f65faae4beca/resource/2c44d782-3365-44e3-aefb-2c8b8363a1bc/download/establecimientos_20261014.csv` |
| Publicación / período | `metadata_modified` 2026-10-14 19:02 UTC; el archivo no declara otro período (nombre `…_20261014`) |
| Licencia | **CC0** (`cc-zero`, declarada a nivel de dataset en la API CKAN) |
| Tamaño y hash | 2.524.897 B · sha256 `244426f9201ecfaa4f8dc964d3ee7479a65eef565c37b9ddf05d22cac31343a6` (descarga completa) |
| Diccionario | `diccionario-de-datos.pdf`, 696.208 B, sha256 `b4d9a4919201f0a22101acc82e15850e1b13b3d3efb055f0fe9d99c804670451` |
| `client_ready` recomendado | `false` hasta cerrar la validación de la carga (Fase 1a); la licencia no lo impide |

**Estructura medida:** `;` como separador, UTF-8, 33 columnas, 5.782 filas, `EstablecimientoCodigo` único. **345 de las 346 comunas** tienen establecimientos (falta `12202` Antártica). Coordenadas con punto decimal; todas dentro de la caja de Chile (lat −54,94…−17,59; lon −109,42…−67,60; incluye Isla de Pascua); **370 filas (6,4 %) sin coordenadas**, de ellas 81 «cerrados» tienen coordenadas.

**Problemas de calidad (todos medidos):**
* `EstadoFuncionamiento`: el diccionario define **4** estados (vigente habitual, vigente transitoria, cerrado temporal, cerrado definitivo); el archivo trae **3 valores**: `Vigente en Operación Habitual` (5.142), `Vigente en operación habitual` (212, otra capitalización) y `Cerrado` (428). No distingue temporal de definitivo. 73 cerrados sin `FechaCierre` y 1 no cerrado con `FechaCierre`.
* Capitalización y truncados inconsistentes: `TipoPertenenciaEstabGlosa` («No Perteneciente» 2.323 / «No perteneciente» 139), `TieneServicioUrgencia` (`NO`/`No`/`SI`), `TipoAtencionEstabGlosa` trae un valor truncado «Atención Abierta-Ambu» (1). Todo exige normalización explícita (`lower(btrim())`), no `IN` con literales.
* **Complejidad** (`NivelComplejidadEstabGlosa`): Baja 3.342 · Mediana 1.262 · **Alta 131** · «No Aplica» 760 · **vacío 287**. Las 131 de alta complejidad son: 82 `Hospital`, 39 `Clínica`, 8 `Centro de Especialidades`, 1 `Otro`, 1 `SAMU`. Entre los 234 `Hospital`, 6 no tienen complejidad.
* **Tipo de atención** (`TipoAtencionEstabGlosa`): ambulatoria 5.110 · hospitalaria 372 · «No Aplica» 56 · **vacío 243** · truncado 1. **Existe un campo oficial ambulatorio/hospitalario**; la clasificación propia tipo→ambulatorio/hospitalario solo hace falta para ~300 filas sin dato (esto reduce, pero no elimina, la advertencia de «clasificación propia» de la regla 3).
* «Privado» tiene **tres campos que no coinciden**: `DependenciaAdministrativa = Privado` 2.336; `TipoSistemaSaludGlosa = Privado` 2.338; `TipoPertenencia` no-SNSS 2.462 (2.323 + 139). Hay que **elegir una definición** (D2).
* `DependenciaAdministrativa` vacía en 8; `NivelAtencionEstabglosa` vacía en 2; `FechaInicioFuncionamientoEstab` vacía en 2.721; fechas en formato `dd-mm-aaaa`.

### 5.2 Cartera de beneficiarios del Sistema Isapre, nivel comunal
| Campo | Valor |
|---|---|
| Organismo | Superintendencia de Salud |
| URL exacta (dic-2025) | `https://www.superdesalud.gob.cl/app/uploads/2026/01/estadistica-anual-de-cartera-de-beneficiarios-comunal-2025.xlsx` |
| Dic-2024 | `…/app/uploads/2025/01/estadistica-anual-de-cartera-de-beneficiarios-comunal-2024.xlsx` (misma estructura; Σ cotizantes 1.610.979) |
| Publicación / período | `Last-Modified` 2026-01-28; «Fecha extracción de información» **2026-01-22**; período **diciembre 2025** |
| Licencia | **No declarada** en la «Ficha Metadatos» del archivo; términos generales del sitio **[NO COMPROBADO]** |
| Tamaño y hash | 797.428 B · sha256 `0b810d7438fc1d489f1e0dc8ca46403cc74dc4889a0f1afefe3a3f981df20ff1` |
| Advertencia oficial | «Información provisional… sujeta a modificación» (hoja Notas, nota 4) |
| `client_ready` recomendado | **`false`** (licencia sin confirmar) |

**Estructura:** libro con hojas `Cotizantes`, `Cargas` y sus versiones por sexo (`F`, `M`, `SI`), `Total Cotizantes` y `Total Cargas`. **La comuna viene solo por nombre** (con espacios de relleno), **sin CUT**:
hace falta cruce nombre→CUT por `comunas` + alias explícito. Tras normalizar, **todas las comunas cruzan salvo `O'Higgins`** (apóstrofo distinto a `O’Higgins`: alias explícito, igual que en permisos). Hay una fila `Sin dato Comuna` **por región** (residuo explícito).
**Cuadre `[COMPROBADO]`:** Σ filas de comuna = «Total País» publicado: cotizantes **1.557.693** y cargas **959.612** (beneficiarios = **2.517.305**), en ambas hojas. El libro **sí publica un total**, así que el cuadre se hace contra él.
**Tramos de edad:** `0-4, 5-9, …, 95-99, >=100, S/I` (21 tramos + sin información). **Sexo:** F, M, S/I (en hojas separadas). La semántica del domicilio por comuna **no está declarada** (regla 8: «Isapre por domicilio» sigue **[NO COMPROBADO]**).

**Otros productos de la misma fuente `[COMPROBADO]`:**
* Cartera mensual **regional** hasta agosto-2026 (XLSX ≈ 403 KB), no comunal.
* **TXT trimestral `Beneficiarios_2026t2.zip`** (32 MB; 326.764.067 B sin comprimir; `|`; **cp1252**; **sin fila de encabezado**; 15 columnas; dos identificadores numéricos por fila): **no se puede interpretar** porque el diccionario está en un modal por JavaScript de la página. Hasta leerlo, no se sabe si trae comuna ni si es de nivel individual. `[NO COMPROBADO]`; si fuera individual, serían microdatos y entran solo agregados.

### 5.3 Indicadores hospitalarios REM20 y atenciones de urgencia (DEIS)
* **REM20** (`datos.gob.cl`, dataset `indicadores-hospitalarios-rem20`): CSV de 27.248.718 B, `Last-Modified` 2026-09-25, licencia **CC0**; 20 columnas (período, tipo de pertenencia, servicio de salud, **código y nombre de establecimiento**, área funcional, mes, días-cama, **número de egresos**, fallecidos, traslados, índices). **Solo establecimientos públicos**, **sin comuna de residencia**. Útil para el *tamaño* de cada hospital; no para flujos. Diccionario `diccionario-rem20.xlsx` (sha256 `6feebecdce70cf9f850054c37d07a292183747d9df1323084d15abf97be26c9a`). Último período del archivo: **[NO COMPROBADO]** (solo se leyó la cabecera, desde 2014).
* **Atenciones de urgencia** (`atenciones-de-urgencia`): ZIP por año en `repositoriodeis.minsal.cl`; licencia **CC-NC** (no comercial) en datos.gob.cl; datos agregados de consultas de urgencia (estructura y cadencia **[NO COMPROBADO]**, no se descargó). La licencia NC **impide el uso comercial** si se confirma → `client_ready = false`.

### 5.4 Egresos hospitalarios (DEIS) — microdatos abiertos
| Campo | Valor |
|---|---|
| Organismo | Ministerio de Salud (DEIS) |
| URL (patrón **observado**, no es un enlace oficial verificado) | `https://repositoriodeis.minsal.cl/DatosAbiertos/EGRESOS/EGRESOS_<año>.zip` — **[NO COMPROBADO] como enlace oficial**: el listado oficial está tras el WAF. Responden con zip real **2019, 2020, 2021, 2022, 2023, 2024, 2025** (control con una ruta inexistente → 404) |
| Publicación (`Last-Modified`) | 2019, 2020, 2022: 2023-10-17 · 2021: 2025-05-12 · 2023: 2024-05-06 · **2024 y 2025: 2026-06-03** |
| Licencia | **[NO COMPROBADO]** (no se leyó la del sitio de DEIS) → `client_ready = false` |
| Hash | no aplica: **descarga parcial** (≈ 1,5 MB por zip); no se calculó hash completo |
| Tamaño | zip 103 MB en total (7,9–22,8 MB por año); CSV sin comprimir **≈ 2,0 GB** (220–358 MB por año); **≈ 1,3 a 1,7 millones de filas por año** (estimado por muestreo) |

**Variables (diccionario oficial dentro de cada zip, hoja «Hoja1») — 16 en 2024:** pertenencia del establecimiento (SNSS / no SNSS), sexo, grupo de edad, etnia, país de origen, **comuna de residencia** (código y glosa), región de residencia, **previsión** (código y glosa, «al momento del ingreso»), año de egreso, diagnóstico principal CIE-10, causa externa, días de estada, condición de egreso (1 vivo, 2 fallecido).
**No existe ninguna variable de establecimiento ni de comuna del establecimiento** `[COMPROBADO]`. Columnas por año: 2019 y 2020 → 18 (con `INTERV_Q` y `PROCED`); 2021 → 15 (sin etnia); 2022 → 18; 2023 y 2024 → 16; 2025 → 17 (columna `ERROR`).
**Códigos de previsión (vistos en datos):** 1 FONASA, 2 ISAPRE, 3 CAPREDENA, 4 DIPRECA, 5 SISA, 96 NINGUNA, 99 DESCONOCIDO.
**Códigos de comuna:** texto de 5 dígitos; además `99999` (desconocida; ≈ 1,2 % de la muestra 2024) y `88888` (≈ 0,07 %), que **no** son comunas. Ñuble ya viene con códigos `16xxx` (2024); **no hace falta tabla de equivalencias para 2019–2025**. Años ≤ 2018: **[NO COMPROBADO]** (no se sondearon). **Codificación:** cp1252, no UTF-8.
**Enmascarado `*` `[COMPROBADO]`:** en **2024 (7,5 % de la muestra) y 2025 (7,1 %)** hay filas con `*` en pertenencia, sexo, edad, etnia, país, comuna, región, previsión y año; solo quedan diagnóstico, estada y condición. En 2019–2023 la muestra no tiene ninguna. Proporción **medida sobre la muestra** (primeras ≈ 190.000 filas de 2024, ≈ 53.000 de 2025; 2024 y 2025 no están ordenadas por comuna), **no sobre el archivo completo**. **El diccionario no explica el `*`.** Consecuencia: Σ egresos por comuna **no** suma el total del archivo; el residuo «sin comuna» debe mostrarse (regla 5, cuadre por cotas).
**Muestras 2019, 2020, 2022 y 2023 están ordenadas por comuna y edad**: sirven para estructura, **no** para distribuciones.
**¿Reportan completo las clínicas privadas?** **No se puede saber**: sin establecimiento no hay forma de medirlo; el archivo trae ≈ 38 % de egresos en establecimientos no SNSS en la muestra 2024, lo que sugiere que sí se incluye el sector privado, pero la completitud es `[NO COMPROBADO]`.
**Total publicado para cuadrar:** el archivo no publica total. Cuadre posible: contra el conteo de filas del propio archivo (consistencia interna) y, de forma independiente, contra la «Estadística Anual de Egresos Hospitalarios del Sistema ISAPRE año 2025» de la Superintendencia (XLSX; `…/app/uploads/2026/05/estadistica-anual-de-egresos-hospitalarios-del-sistema-isapre-ano-2025.xlsx`) — **[NO COMPROBADO]** que las definiciones coincidan.

### 5.5 Censo 2024 (INE)
* **Comunicados `[COMPROBADO]`** (páginas del INE leídas): **2025-12-04** «INE publica Base de Datos del Censo 2024»: microdatos de personas, hogares y viviendas **desagregados a nivel comuna-área**, manual de uso y diccionario de variables. **2025-12-16** «INE publica bases de datos a nivel de manzana y cartografía»: base **manzana–entidad con 189 variables** (personas, hogares, viviendas) hasta manzana urbana, manzana aldea, entidad rural, zona urbana y localidad rural, más cartografía censal (nacional y regional), manual de la cartografía y diccionario; con **control de divulgación estadística**.
* **Síntesis de resultados** (PDF, 18.266.109 B, sha256 `fdf5a5b0acc0c3eefe5623d3bf13c72194d83a16fd42d5dec95fcb3fc2c14486`, `https://censo2024.ine.gob.cl/wp-content/uploads/2025/12/sintesis_resultados_censo2024.pdf`): **resultados nacionales y regionales; no hay tabla de población por comuna**; **no menciona previsión de salud, Fonasa ni Isapre**.
* **Enlaces de descarga de las bases: `[NO COMPROBADO]`** (el portal `censo2024.ine.gob.cl/resultados` los carga dinámicamente; ofrece «Visualizador Geográfico Manzana–Entidad» y «Redatam Web»). Redatam es una aplicación interactiva: no se pudo listar variables.
* **¿Trae previsión de salud, y a qué nivel? `[NO COMPROBADO]`.** No aparece en la síntesis (no prueba que el cuestionario no la pregunte). Se resuelve leyendo el **diccionario de variables** de la base comuna-área y de la manzana–entidad (plan B, §13).
* **¿Cuántas manzanas son? `[NO COMPROBADO]`** (no hay archivo). Se mide con `python etl/salud_probe.py --only censo --manzana-file <archivo>`.
* **Licencia:** la página «Términos de Uso y Licencia de Datos Abiertos» del INE responde 200, pero **su texto no se leyó** → `[NO COMPROBADO]`; `client_ready = false` hasta confirmar.
* **Población por comuna, edad y sexo (necesaria para la Fase 1a):** **no obtenida** (depende de la descarga o de un export de Redatam).

### 5.6 CASEN 2024 (Ministerio de Desarrollo Social y Familia)
* La **más reciente** es **CASEN 2024** (también 2022, 2017, …). Archivos con `Last-Modified` 2026-06-10, bajo `https://observatorio.ministeriodesarrollosocial.gob.cl/storage/docs/casen/2024/`: `casen_2024.sav` (**749.656.107 B**, nacional), `casen_2024_provincia_comuna.sav` (5.488.742 B) y `.dta`/`.RData`, libros de códigos, `Salud_Casen_2024.xlsx` (tabulados), `Diseno_Muestral_Casen_2024.pdf`, `Nota_uso_bases_de_datos_Casen_2024.pdf` (sha256 `44ca117ffedd29f3ac9e8cc415bc6924dede91a220505e2b518b02ff1ac57e90`).
* **La base «provincia-comuna» solo tiene 6 variables:** `folio`, `id_persona`, `expp`, `expc`, `provincia`, `comuna` (218.367 observaciones). Sirve para **enlazar** con la base nacional; **no trae previsión**. La previsión vive en `casen_2024.sav` (**[NO COMPROBADO]**: no se descargó; el nombre de la variable no se verificó).
* **Representatividad (nota oficial):** diseño probabilístico estratificado y bietápico con representatividad **nacional, por área (urbano/rural) y regional**. Los factores provincial y comunal «deben utilizarse con precaución… el diseño no considera representatividad para dichos niveles»; cualquier resultado comunal debe acompañarse de una nota que diga que es «muestral» y «no representativo». Quedan **excluidas** comunas completas o parte de ellas (Ollagüe, Juan Fernández y áreas de General Lagos, Colchane, Tortel y Cabo de Hornos) y **la Antártica**. Los factores se calibran con la **proyección de población base Censo 2017**, no con el Censo 2024.
* **Error muestral:** requiere las variables de diseño (estratos/conglomerados), que **no** vienen en la base comunal. Sin ellas no se puede publicar un error comunal. `[NO COMPROBADO]` si la base nacional las trae.
* **Licencia:** **[NO COMPROBADO]**. `client_ready = false`.
* **Conclusión:** previsión por comuna desde CASEN **no es una respuesta con rigor**. Solo se puede entregar a nivel **regional** y como **Estimada**, y sujeto a descargar el archivo nacional (D6).

### 5.7 Fonasa
`www.fonasa.cl` responde **403 del sitio** (`awselb/2.0`) con el túnel abierto: WAF. **No se usa nada para saltarlo.** En datos.gob.cl solo hay material de Fonasa de **2015** con licencia CC-NC (no sirve).
Todo lo de Fonasa queda **[NO COMPROBADO]** y en plan B (§13). La Fase 1b no puede incluir Fonasa hasta que lo bajes tú.

### 5.8 Geofabrik (alcanzabilidad)
`download.geofabrik.de` corta la conexión en ≈ 8 s con el túnel abierto, tanto en la raíz como en la ruta real del archivo de Chile; es el mismo patrón que `www.deis.minsal.cl`. Se registra como **no alcanzable**; la causa **no se puede confirmar** desde aquí. Tamaño del `.pbf` de Chile: **[NO COMPROBADO]**. Un ORS autohospedado (Fase 3) necesita ese archivo: ver §7.5.

---

## 6. Tramos de edad: ¿compatibles?

| Fuente | Tramos | ¿Compatible? |
|---|---|---|
| Isapre (cartera) | quinquenales `0-4 … 95-99`, `>=100`, `S/I` | base de la comparación |
| Egresos DEIS | `menor de un año`, `1 a 9`, `10 a 19`, … `80 a 89`, `90 y más`, `*` | **Sí, por agregación de los tramos Isapre**: `0 a 9` = `0-4`+`5-9`; `10 a 19` = `10-14`+`15-19`; … ; `90 y más` = `90-94`+`95-99`+`>=100`. **No se pueden separar** «menor de un año» y «1 a 9» desde Isapre: solo se comparan juntos como 0–9. Probado en `etl/salud/tests` (`ISAPRE_TO_EGRESO`) |
| Censo 2024 | **[NO COMPROBADO]** | pendiente del diccionario |
| Fonasa | **[NO COMPROBADO]** | pendiente de la descarga |
| CASEN | **[NO COMPROBADO]** (la edad está en la base nacional) | — |

Regla práctica: **≥ 60 años = tramos `60-64 … >=100`** de Isapre (exacto); `S/I` se muestra aparte como «edad sin dato».

---

## 7. Motor de isócronas y cuota ORS (lectura de código; sin imprimir claves)

*Procedencia:* este apartado sale de una exploración del código; **verifiqué yo directamente** la URL base fija (línea 72 de ambas funciones), `verify_jwt = false` de `isochrone` en `config.toml`, el `CHECK` de `api_quota_config.api`, que ninguna edge function llama a `api_quota`, y `poi_id NOT NULL` con FK y `UNIQUE (poi_id, mode, minutes)`. El resto (reintentos, timeouts, límites, consumidores del cliente) **lo reportó la exploración y no lo re-verifiqué línea por línea**; si algo de eso fuera a decidir un diseño, hay que revalidarlo.

1. **`supabase/functions/isochrone/index.ts`**: proxy a ORS; la **URL base está fija en el código** (`https://api.openrouteservice.org/v2/isochrones/${mode}`, línea 72; igual en `drive-distance`, línea 72). Perfiles permitidos: `foot-walking`, `driving-car`, `cycling-regular`. Entrada `{mode, lat, lng, minutes[]}`, `range_type: "time"`, `attributes: ["area"]`. Hasta 5 reintentos (429/5xx) con espera exponencial: peor caso > 100 s por llamada. La clave se lee con `getSecret("OPENROUTESERVICE_API_KEY")` (tabla `app_secrets` o variable de entorno); **solo se nombra, no se imprime**.
2. **Hallazgo de seguridad:** `config.toml` declara `[functions.isochrone] verify_jwt = false` y el código **no valida usuario ni rol**: cualquiera con la URL puede gastar cuota de ORS (CORS `*`). `drive-distance` sí exige JWT pero tampoco valida rol. La propia migración de `poi_isochrones` dice que generar «no debe poder dispararlas cualquiera»; ese control solo protege la tabla.
3. **`api_quota` NO cubre ORS.** Solo cubre Google Maps Platform: su `CHECK` limita `api` a `maps_js`, `places`, `autocomplete`, `geocoding` (`20261015130000_api_quota.sql`, línea 21) y **ninguna edge function** la llama. Los límites son **mensuales** y en hora del Pacífico. Lo único que existe para ORS es un throttle de cliente de ≈ 40 req/min (un comentario y un texto de UI; **no verificado** contra el plan real de ORS).
4. **`poi_isochrones`** (`20260819160000`): `poi_id uuid NOT NULL REFERENCES pois(id) ON DELETE CASCADE`, `UNIQUE (poi_id, mode, minutes)`, `geometry jsonb`, sin hash, sin versión del motor, sin PostGIS. **Un establecimiento de salud no cabe** si no es una fila de `pois`. Recomendación para la Fase 3: tabla nueva (`entity_isochrones`: `entity_type`, `entity_id`, `mode`, `minutes`, `geometry`, `origin_*`, `engine`, `computed_at`) en vez de aflojar la existente (rompería `onConflict: "poi_id,mode,minutes"` y las consultas `.in("poi_id", …)`). «Reutiliza la edge function y la tabla» del brief **solo vale a medias**: la función sí; la tabla no.
5. **`drive-distance`** no es una matriz: ruta punto a punto, una llamada ORS por destino **en serie**, `MAX_DESTINOS = 12`, sin timeout ni reintentos. **No sirve para matrices**; la matriz de la Fase 3 requiere otro endpoint (`/v2/matrix` de ORS u otro motor).
6. **ORS autohospedado `[NO COMPROBADO]`:** para cambiar solo la URL base hay que (a) mover la URL a una variable de entorno en **las dos** funciones, (b) tolerar que no haya clave (`isochrone:33` y `drive-distance:49` responden 500 sin clave), y (c) revisar `maximum_ranges`, `maximum_locations` y tamaño máximo de isócrona de esa instancia. Geofabrik no es alcanzable desde la sesión: el extracto de Chile habría que descargarlo en la máquina que lo aloje. RAM, costo y comparación con OSRM/Valhalla: **no medidos** (Fase 3).
7. **Licencia ODbL:** regla 1; su alcance sobre matrices derivadas sigue **[NO COMPROBADO]**.

---

## 8. Inventario del esquema base y por qué no corren 5 pruebas SQL

### 8.1 Corrección de la línea base (error mío, reconocido)
En el cierre de preparación del entorno afirmé que `public.user_roles` «no la crea ninguna migración». **Era falso**: el grep fue sensible a mayúsculas y las migraciones usan `CREATE TABLE`. `user_roles` y `app_role` los crea
`20260507233321_f8f33cf5-586d-43b5-bf5d-18f255688580.sql` (líneas 4 y 7). El brief repitió esa causa; **este documento y `DISENO.md` §0.7 la corrigen**. La conclusión práctica («esas cinco no corren en local») se mantiene, pero por otras razones.

### 8.2 Experimento (solo en el scratchpad; **no** se entrega ningún stub)
Se aplicaron las **114 migraciones en orden** sobre una base con solo lo que aporta la plataforma Supabase (roles, `auth`, `storage`, `cron`):

* **105 de 114 se aplican.** Las 9 que fallan son de tres tipos:
  * **Guardrails de datos** que exigen datos reales de producción (por diseño; no se pueden satisfacer en una base vacía): `20260517221613` (espera entre 1.100 y 1.300 filas reasignadas), `20261014181000` (espera exactamente 1 carpeta raíz `talleres`), `20261015000000` (11 grupos sin carpeta raíz equivalente) y, en cascada, `20261020120200` y `20261021120300`.
  * **Objetos que el repo referencia y no crea:** `public.custom_layers` (**ninguna migración la crea**; la referencian `20260621023422`, `20261014120100` y `20261015000000`).
  * **Objetos usados antes de existir / forma distinta:** `20260613150916` hace `ALTER FUNCTION public.fn_marcas_categoria` antes de que `20260613203801` la cree; `20260613191928` falla con «`column "sort_order" does not exist`» (la tabla ya existía con otra forma; causa exacta **[NO COMPROBADO]**).
* **Las cinco pruebas** (`api_quota`, `layer_nodes`, `layer_nodes_edit`, `layer_import`, `legacy_retired`) se arman concatenando migración + prueba + `RAISE 'DRYRUN_OK'` en una transacción. Con la plataforma mínima llegan al cuerpo de las pruebas y **fallan por falta de datos reales**: «hay capas reales con las que probar» (`layer_nodes_edit`), «Solo los administradores pueden hacer esto» (`api_quota`: no hay un admin en `user_roles`) y `invalid input syntax for type uuid: ""` (`layer_import`). **Están pensadas para correr contra una copia de la base real**, no contra un stub. Las dos de la Parte 4 y `permits_stats` **sí** corren (línea base).

### 8.3 Objetos que el repo asume y no crea (a confirmar en tu Supabase)

| Objeto | De dónde sale | Qué usa el repo |
|---|---|---|
| Roles `anon`, `authenticated`, `service_role` (+ `BYPASSRLS` en `service_role`) | plataforma | 270 / 55 / 31 referencias en `GRANT`/políticas |
| `auth.users` con columnas `instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token, reauthentication_token` | plataforma | las pruebas insertan esas columnas |
| `auth.uid()`, `auth.role()` | plataforma | 299 y 4 usos; las pruebas fijan el usuario con `set_config('request.jwt.claims', …)` |
| `storage.buckets(id, name, public)`, `storage.objects` (con RLS) | plataforma | 49 y 4 usos |
| Extensión `pg_cron` (`cron.schedule`, `cron.unschedule`, `cron.job`) | plataforma | 5 migraciones |
| `public.custom_layers` | **no la crea ninguna migración** | referenciada y luego retirada |
| `public.fn_marcas_categoria(text)` (antes de `20260613203801`) | orden de migraciones | `ALTER FUNCTION` previo |
| `public.comercial_carpetas` con `sort_order` | forma previa | `20260613191928` |
| Un usuario `admin` en `user_roles`; capas y carpetas reales | **datos** | las cinco pruebas |

Todo esto se confirma **sin escribir nada** con `docs/salud/planb/inventario_esquema_base.sql` (nueve `SELECT` sobre catálogos; no lee contraseñas, claves, correos ni el `command` de `cron.job`; cuenta usuarios por rol sin identificarlos). Su **sintaxis se verificó** en una base local; su **resultado contra tu Supabase real es `[NO COMPROBADO]`**.
**Con tu respuesta** se escribe un stub de test **marcado como stub** (hoy no se inventa). Hasta entonces quedan **pendientes** los tests que dependen de él: el rol admin de la regla 5 y las RPC de la regla 6.

---

## 9. `client_ready` (regla 6): dónde se aplica

`client_ready` **no existe** (0 resultados en `src/`, `supabase/`, `docs/`; verificado). Diseño en `DISENO.md` §0.5. Caminos ubicados por exploración del código; **verifiqué yo** que `Index.tsx` no referencia `useTerritorialVisibility` (hallazgo de la fuga del camino 4), la lista blanca `color/icon/opacity` de `update_node_style`, `has_role` `SECURITY INVOKER`, los `GRANT`/`REVOKE` de `get_permit_*`, y que `sign-urls` no valida usuario y no está en `config.toml`. Los demás caminos y rutas de archivo los reportó la exploración:

| # | Camino | Archivo / función | Cómo filtrar |
|---|---|---|---|
| 1 | Informe de isócrona **XLSX** | `utils/reportExportXlsx.ts` → `exportReportToXlsx` (botón en `IsochroneReportDialog.tsx`) | volcado de `band.pointsByGroup`/`pointsDetail`: filtrar capas en el hook |
| 2 | Informe **PDF** (diálogo) | `utils/reportExportPdf.ts` → `exportReportToPdf` | **no lista capas territoriales** (totales, densidad, NSE, comunas); seguro salvo fotos del mapa |
| 3 | Informe PDF/**PPTX/PNG** del panel de análisis | `AnalysisPanel.tsx` + `reportExportPptx.ts`, `reportExportPng.ts` | mismo filtro del hook; ojo con la proyección de ventas (camino 9) |
| 4 | **Capturas de mapa** para informes | `pages/Index.tsx` (`captureAtractoresOnly`, `captureIsochroneMapImages`, `ALL_LAYERS_OFF`) | apagan las capas locales pero **`Index.tsx` no referencia `useTerritorialVisibility`**: una capa territorial encendida puede salir en la foto → **fuga real**; apagar las no `client_ready` antes de capturar y restaurar |
| 5 | Láminas para leaseflow | `isochroneReportSlidesService.ts` + edge `export-report-slides` | filtrar **al generar** (la edge no sabe de capas) |
| 6 | CSV/JSON del panel de análisis | `AnalysisPanel.tsx` (`exportJson`, `exportCsv`) | filtro del hook; ojo: `pointsPerKm2` y `serviceCoverageIndex` se calculan con todos los puntos |
| 7 | Resumen IA de isócrona | `useIsochroneInsights.ts` → edge `isochrone-insights` | se limpia solo si `analysis` ya viene filtrado |
| 8 | **Exportar árbol a KMZ y CSV** | `LayerTreeSection.tsx` → `layerTreeExport.ts` (`buildKmzTree.walk`), `kmzExport.ts`, `layerCsvExport.ts` | descartar hojas y carpetas por flag; hoy **cualquier usuario con acceso a la sección** puede exportar |
| 9 | Proyección de ventas | `poiFeaturePayloadBuilder.ts` → `buildFromFolderRoles` | filtrar `relevantLayerIds` |
| — | Punto central | `useTerritorialLayers.ts` → `fetchTerritorialData` alimenta `useIsochroneAnalysis.ts` y `useIsochroneReport.ts` (`layerIds = layers.map(l => l.id)`) | un solo filtro limpia 1, 3, 6 y 7 |

**Edge functions** (`supabase/functions/`): `export-backup` (JWT + admin; vuelca todas las tablas con service role; el flag no aplica), **`sign-urls` (sin ninguna verificación de usuario y sin entrada en `config.toml`: firma 3 archivos fijos del bucket privado `territorial-sources` por 1 h)**, `export-report-slides` / `list-saved-isochrones` / `export-sales-projection` (protegidas por `x-api-key`; **no tocan `territorial_*`**). Buckets **públicos**: `territorial-aggregates` y `geodata` (no se pueden controlar con un flag).
**Compartir/mapa público: no existe** (rutas solo `/`, `/auth`, `/comunas`, `/admin/*`); `get_public_map_config` solo devuelve la clave de Google Maps.
**RPC de lectura:** todas las `get_*` de permisos/INE/SEIA son `SECURITY INVOKER`, `REVOKE … FROM public, anon`, `GRANT … TO authenticated, service_role` (verificado en `get_permit_*`). **No existe ninguna `get_*` que devuelva capas del árbol**: se leen por PostgREST con RLS `TO authenticated USING (true)`. Las 7 migraciones 2026102x están rotuladas «PROPUESTA (NO APLICADA)»: su estado en producción es `[NO COMPROBADO]`.
**`.env.production` está versionado** (variables `VITE_*` publicables de navegador, valores no impresos): conviene confirmar que es intencional.

---

## 10. Roles
Ver `DISENO.md` §0.3. Resumen verificado: el rol es `admin` (enum `app_role`, tabla `user_roles`); `has_role` es `SECURITY INVOKER` y **no sirve para `anon`**; `moderator` aparece solo en dos políticas; `user` no se asigna en ninguna migración; no hay rol «cliente»; los permisos por sección son solo de UI. En el front hay **tres mecanismos paralelos** para saber si alguien es admin (`useUserRole`, `useUserRoles`, `usePermissions`), ninguno con enforcement fuera de RLS.

---

## 11. Cómo cambia el plan

| Fase | Cambio |
|---|---|
| **1a** | Usar el campo **oficial** `TipoAtencionEstabGlosa` y clasificar solo las ~300 filas sin dato (la advertencia de «clasificación propia» se acota). Normalizar estados/capitalización; validar `ComunaCodigo` sin `lpad`; **definir «privado» y «hospital de alta complejidad»** (D1, D2). Necesita población Censo 2024 por comuna, edad y sexo: **no obtenida** (§5.5). |
| **1b** | Isapre: **sí**, con alias `O'Higgins` y residuos por región; alinear **dic-2024** con egresos 2024. Fonasa: **bloqueado** hasta que bajes los archivos (D3). CASEN: **solo regional**, como Estimada (D6). |
| **1c** | **Agregar una solicitud nueva (R4): egresos hospitalarios con código de establecimiento** (y comuna del establecimiento). Sin ella, las fases 2 y 3 no tienen flujo observado. Mantener las de Fonasa (MLE y beneficiarios por comuna de residencia) y Superintendencia (prestaciones Isapre por prestador y comuna). |
| **2** | La **matriz comuna→establecimiento no se puede construir** con datos abiertos. Se reemplaza por **utilización por comuna de residencia** (previsión, sexo, edad, pertenencia SNSS) con el residuo `*` explícito y `99999/88888` aparte; marcar 2020–2022 como pandemia; REM20 aporta el tamaño por hospital público. Las preguntas de flujo pasan a **No respondible hoy** hasta R4. |
| **2b** | **Decisión pendiente** del conteo de manzanas: existe la base manzana–entidad (189 variables) y la cartografía, pero el número de filas es `[NO COMPROBADO]`. Mi recomendación a priori es **hacer la 2b** (un polígono por manzana de todo el país no se sirve como GeoJSON en Leaflet), pero **lo decide el conteo** (D7). |
| **3** | (a) **Calibración observada imposible** sin R4 → el modelo de captación solo puede ser **Escenario con supuestos no calibrados** (o «No respondible hoy» hasta R4; D5). (b) Previsión por manzana: depende de si el Censo trae previsión (`[NO COMPROBADO]`); si no, es inferencia ecológica publicada solo como intervalo y cuadrada con el total comunal Isapre. (c) **Hardening de ORS antes de cualquier lote:** autenticar `isochrone`, URL base por variable de entorno, cuota propia (no cabe en `api_quota`), tabla nueva `entity_isochrones`, matriz con endpoint propio. |
| **4** | Sin cambios; el esquema genérico sobre `source_snapshots` recibirá R4 como primera fuente probable («Fase 4 parcial»). |

---

## 12. Preguntas de uso propuestas (todas las fases; regla 9)

Rigen cuando las confirmes con «Continuar con Fase 1a. Preguntas OK» (o con tus ajustes). Cada una necesita, para darse por respondida, un test de Vitest con fixtures (o captura con datos simulados) **y** una verificación de cordura con datos reales del `--dry-run`.

| ID | Pregunta (versión final propuesta) | Nivel | Sello esperado | Estado de datos hoy | Verificación de cordura prevista |
|---|---|---|---|---|---|
| **1a-1** | ¿Qué comunas de más de 50.000 habitantes (Censo 2024) **no tienen dentro de la comuna** un establecimiento de **alta complejidad** en operación? *Mide ausencia en la comuna, no falta de acceso.* | Respondida con rigor | Oficial con advertencia (oct-2026 vs. censo 2024; 287 establecimientos sin complejidad y 6 hospitales sin complejidad se listan aparte; `12202` sin establecimientos) | falta **población por comuna** (§5.5) y decidir D1 | 131 de alta complejidad en el CSV; 2–3 comunas que tú fijes; Σ por comuna = total del archivo menos cerrados |
| **1a-2** | ¿Cuántos establecimientos **privados ambulatorios** en operación hay por cada 10.000 habitantes en cada comuna de la RM? | Respondida con rigor | Oficial con advertencia (fechas, «privado»/«ambulatorio» con campos oficiales que discrepan y vacíos, población flotante) | falta población por comuna; decidir D2 | Σ RM contra el total del CSV filtrado; población RM contra la síntesis del Censo |
| **1b-1** | ¿Cuántos **beneficiarios Isapre de 60 años o más** (dic-2025) hay en comunas **sin** establecimiento de alta complejidad (en la comuna)? | Respondida con rigor | Oficial con advertencia (provisional; domicilio no declarado; fechas distintas) | Isapre **lista**; falta 1a-1 | Σ nacional contra **2.517.305** (cotizantes 1.557.693 + cargas 959.612); `S/I` de edad y «sin dato comuna» como residuos |
| **1b-2** | ¿Qué comunas tienen la **mayor proporción de beneficiarios Isapre** sobre la población del Censo 2024? | Respondida con rigor | Oficial con advertencia (denominador por residencia vs. domicilio Isapre, fechas distintas) | falta población por comuna | 2–3 casos conocidos; ninguna proporción se calcula con Fonasa |
| **1b-3** | ¿Qué proporción de la población de cada **región** declara estar en Fonasa o Isapre (CASEN 2024)? | **Estimada** (rango con error muestral) | Estimado | CASEN nacional **no descargada**; variable de previsión `[NO COMPROBADO]` | contra Fonasa/Isapre oficiales **solo como orden de magnitud**, sin restar |
| **1b-4** | Esa misma proporción **por comuna** | **No respondible hoy** | — | CASEN no es representativa a nivel comunal (nota oficial) | — |
| **1b-5** | ¿Cuántos **inscritos Fonasa** (APS) hay por comuna, tramo, edad y sexo? | **No respondible hoy** | — | falta el archivo de Fonasa (WAF); hay que descargarlo a mano o pedirlo (R2) | — |
| **2-1** | ¿Cuántos **egresos hospitalarios** (2024) tuvo cada comuna de residencia, por previsión, sexo y grupo de edad? | Respondida con rigor | Oficial con advertencia (≈ 7 % de filas sin comuna por enmascarado; `99999/88888`) | **datos listos** (2024 y 2025) | Σ por comuna + enmascarados + desconocidos = filas del archivo; Isapre contra la estadística anual de egresos Isapre de la Superintendencia (`[NO COMPROBADO]` que coincidan las definiciones) |
| **2-2** | ¿Qué proporción de los egresos de cada comuna ocurrió en establecimientos del **SNSS** (público) vs. no SNSS? | Respondida con rigor | Oficial con advertencia | datos listos | 62 %/38 % aprox. en la muestra 2024 (orden de magnitud, no cifra a publicar) |
| **2-3** | ¿Cuántos egresos **Isapre por 1.000 beneficiarios Isapre** (dic-2024) hay por comuna? | Respondida con rigor | Oficial con advertencia (previsión al ingreso vs. cartera por domicilio; mismo año) | datos listos (cartera dic-2024 disponible) | **sujeta a tu aprobación** por la diferencia de semántica |
| **2-4** | ¿De qué comunas vienen los pacientes Isapre hospitalizados en la **Clínica X**? | **No respondible hoy** | — | **el archivo abierto no trae establecimiento**; hace falta **R4** (egresos con código de establecimiento) | — |
| **2-5** | ¿Qué comunas se hospitalizan **mayoritariamente fuera de su comuna**? | **No respondible hoy** | — | requiere la comuna del establecimiento (R4) | — |
| **2-6** | ¿Cuál es el total de **egresos por hospital público y mes** (REM20)? | Respondida con rigor | Oficial con advertencia (solo establecimientos públicos) | datos listos (CC0) | contra el total anual del propio archivo |
| **3-1** | ¿Cuántos **beneficiarios Isapre** quedan a más de **20 min en auto (sin tráfico)** de una clínica? | **Estimada** (rango) | Estimado | **bloqueada**: requiere población y previsión por manzana (Censo: previsión `[NO COMPROBADO]`; manzanas sin contar). Alternativa: versión **comunal con advertencia** que tú apruebes | cuadre con el total comunal Isapre |
| **3-2** | ¿Qué captación tendría un **centro médico nuevo** en un punto dado? | **Escenario con supuestos** (**no calibrado**) o **No respondible hoy** (D5) | — | sin flujos observados no hay calibración ni validación fuera de muestra; ambulatorio: **No respondible hoy** | — |
| **4-1** | ¿Qué **fuentes están vencidas** según su cadencia? | Respondida con rigor | Oficial | metadatos de `source_checks`/`source_freshness_v` | cadencias de §5 |

---

## 13. Plan B: lo que necesito que hagas (archivos y comandos exactos)

**Correr el sondeo en tu máquina** (alcanza lo que esta sesión no puede; no usa cabeceras de navegador):
```bash
git checkout feat/salud-fase-0
python -m venv ~/.venvs/geochile && ~/.venvs/geochile/bin/pip install -r etl/requirements.txt
~/.venvs/geochile/bin/python etl/salud_probe.py --full --out ./salud_probe_out/mi_maquina
# y, cuando tengas la base manzana-entidad del Censo 2024 descargada:
~/.venvs/geochile/bin/python etl/salud_probe.py --only censo --manzana-file <archivo> --out ./salud_probe_out/manzanas
```
Súbeme `report.json` y `RESUMEN.md` (solo datos públicos; ninguna credencial).

**PostGIS en tu máquina** (si prefieres no depender de la sesión): `docs/salud/planb/docker-compose.yml` + `SALUD_EXTERNAL_PG=1 bash etl/salud/dev_env.sh` (**no probado**).

**Descargas manuales** (no se pudo o no se debe automatizar):

| Qué | Dónde | Por qué |
|---|---|---|
| Archivos de Fonasa: **beneficiarios/inscritos validados por comuna** (tramo, edad, sexo) y su definición | sección de estadísticas/datos abiertos de `www.fonasa.cl` (el sitio bloquea; dime los nombres exactos y la URL) | Fase 1b |
| **Diccionario de variables** de la base **comuna-área** y de la **manzana–entidad** del Censo 2024, y el archivo manzana–entidad | `https://censo2024.ine.gob.cl/resultados/` («Visualizador Geográfico Manzana–Entidad», «Redatam Web») y comunicados INE del 4 y 16-dic-2025 | ¿trae previsión? ¿cuántas manzanas? Fase 2b/3 |
| **Población por comuna, edad y sexo** (Censo 2024) | Redatam Web (`https://redatam.ine.gob.cl/redbin/RpWebEngine.exe/Portal?BASE=CENSO_2024&lang=esp`) o la base comuna-área | Fase 1a (la pregunta 1a-1 y 1a-2 la necesitan) |
| Texto del **modal «Ver diccionario de datos» → Beneficiarios** | `https://www.superdesalud.gob.cl/tax-biblioteca-digital/datos-abiertos-de-isapres-6988/` | interpretar `Beneficiarios_2026t2.txt` |
| **Enlaces oficiales** de egresos hospitalarios (y su fecha de publicación) | `https://deis.minsal.cl/#datosabiertos` (el listado se carga por AJAX tras un desafío de WAF) | regla 1: URL oficial y fecha; hoy solo tengo el patrón observado |
| **Licencias** de: Superintendencia (datos abiertos), INE (Censo 2024), CASEN 2024, DEIS egresos | las páginas de cada organismo | `client_ready` |
| `casen_2024.sav` (nacional, 750 MB) | `…/storage/docs/casen/2024/casen_2024.sav` | solo si apruebas CASEN regional (D6) |

**Inventario del esquema base:** corre `docs/salud/planb/inventario_esquema_base.sql` en el SQL editor de tu Supabase y pégame las 9 salidas.

---

## 14. `[NO COMPROBADO]` y decisiones

### 14.1 `[NO COMPROBADO]` (no se verificó con el archivo o servicio real)
Fonasa (todo) · semántica de domicilio de Isapre · diccionario del TXT trimestral de la Superintendencia · licencias de Superintendencia, INE, CASEN y DEIS-egresos · si el Censo 2024 trae previsión · número de manzanas ·
población por comuna del Censo 2024 · variable de previsión y variables de diseño en `casen_2024.sav` · enlaces oficiales y listado de egresos (el patrón de URL es observado) · egresos ≤ 2018 · columnas de urgencias · último período de REM20 ·
proporción exacta de filas enmascaradas en el archivo completo (se midió en muestras) y significado del `*` · completitud de las clínicas privadas en egresos · definiciones de la estadística anual Isapre de egresos frente a DEIS ·
plan, clave y límites reales de ORS y si la clave está cargada · valor desplegado de `verify_jwt` (solo se leyó `config.toml`) · tamaño del `.pbf` de Chile y alcanzabilidad de Geofabrik (reset) ·
estado de las migraciones 2026102x en producción, usuarios por rol, grants reales de funciones sin `GRANT`/`REVOKE` explícito · `.env.production` publicado o no · docker compose del plan B · geobloqueo.

### 14.2 Decisiones que necesito de ti

| # | Decisión | Mi recomendación |
|---|---|---|
| **D1** | «Hospital de alta complejidad» (1a-1): ¿solo `TipoEstablecimiento = Hospital` (82), o también clínicas (39) y centros de especialidades (8)? | Reportar **ambas** definiciones y rotularlas; usar «Hospital» por defecto |
| **D2** | «Privado» (1a-2): `DependenciaAdministrativa` (2.336), `TipoSistemaSalud` (2.338) o no-SNSS (2.462) | `DependenciaAdministrativa = Privado` (es el campo del dueño administrativo); documentar la diferencia |
| **D3** | Fonasa (Fase 1b): ¿lo bajas tú, o la 1b va solo con Isapre? | Bajarlo; si no, 1b sin Fonasa y la pregunta 1b-5 queda **No respondible hoy** |
| **D4** | Agregar **R4** (egresos con establecimiento) a la Fase 1c | **Sí**: sin ella no hay flujos |
| **D5** | Pregunta 3-2: ¿**Escenario no calibrado** o **No respondible hoy** hasta R4? | **No respondible hoy** hasta R4 (un escenario sin calibrar con datos chilenos se confunde con una predicción) |
| **D6** | CASEN: ¿solo regional y Estimada, o no incluirla? | Solo regional; comunal **no** (la propia nota oficial lo desaconseja) |
| **D7** | Fase 2b: ¿me das la base manzana–entidad (o su diccionario) para contar, o apruebas la 2b a priori? | Aprobar la 2b condicionada al conteo |
| **D8** | Pregunta 2-3 (egresos Isapre por 1.000 beneficiarios): ¿la apruebas pese a la diferencia de semántica (previsión al ingreso vs. cartera por domicilio)? | Sí, con la advertencia y el mismo año (dic-2024) |
| **D9** | ¿Corres el inventario del esquema base y me pasas las salidas? | Sí; desbloquea el stub y los tests de la regla 5 y 6 |
| **D10** | ¿Estás de acuerdo en que `isochrone` pase a exigir JWT y rol antes de la Fase 3? (hoy cualquiera con la URL gasta cuota) | Sí; es un cambio de la Fase 3 y toca una función desplegada |

---

## 15. Archivos compartidos modificados

* `.gitignore`: **una línea** (`salud_probe_out/`).
* Nada más de los archivos existentes (sin cambios en `src/`, `supabase/`, `package*.json`, ni `etl/requirements.txt`).

Archivos nuevos: `docs/salud/{BRIEF,DISENO,HALLAZGOS_FASE0}.md`, `docs/salud/planb/{docker-compose.yml,inventario_esquema_base.sql,medir_tamano.sql}`, `etl/salud_probe.py`, `etl/salud/{__init__.py,dev_env.sh}`, `etl/salud/tests/test_probe.py`.
