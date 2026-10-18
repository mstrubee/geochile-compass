# Inteligencia territorial de salud — Diseño

Documento vivo de la iniciativa. **Una sección por fase**; cada fase la relee al empezar junto con [`BRIEF.md`](./BRIEF.md) (el encargo, guardado
tal cual en la Fase 0). La evidencia con los archivos reales vive en [`HALLAZGOS_FASE0.md`](./HALLAZGOS_FASE0.md). Este documento recoge solo las
**decisiones de diseño** y las convenciones; no repite cifras.

Estado: **Fase 0 y 1a cerradas · Fase 1b (previsión) en curso — §3**. Las demás secciones se agregan en su fase.

---

## 0. Convenciones transversales (fijadas en la Fase 0)

### 0.1 Qué se reutiliza (no se construye un sistema paralelo)

`data_sources` → `source_snapshots` → `source_checks`, `comunas` (única fuente de CUT, `char(5)`), `comuna_name_aliases`, `pipeline_settings`,
`thematic_layers` + `layer_nodes`, y el patrón de ETL de `etl/permisos` y `etl/proyectos` (`--dry-run`, hash normalizado, `publish_*` todo o nada con
`SECURITY DEFINER`). Ver `docs/permisos-edificacion/DISENO.md` §3, §12 y §14.

### 0.2 Niveles de respuesta (regla 9) y sellos (regla 2) son independientes

| Eje | Valores | Dónde se ve |
|---|---|---|
| **Nivel** (cómo se responde) | Respondida con rigor · Estimada (siempre rango) · Escenario con supuestos · No respondible hoy | junto a cada respuesta y en todo informe o exportación |
| **Sello** (qué calidad tiene el dato) | Oficial > Oficial con advertencia > Estimado > Sin dato | leyenda y ficha; nunca dos sellos en un mismo color |

Un valor derivado hereda el sello **más débil** de sus insumos (regla 3). Mezclar fechas distintas, semánticas distintas o una clasificación propia lo deja
como máximo en «Oficial con advertencia», y la advertencia lo dice.

### 0.3 Rol admin y control de acceso (verificado en el código, Fase 0)

* El rol es **`admin`** del enum `public.app_role` (`admin | moderator | user`), guardado en `public.user_roles`. Lo crea la migración
  `20260507233321_f8f33cf5-586d-43b5-bf5d-18f255688580.sql` (la primera del repo).
* `public.has_role(_user_id, _role)` es **`SECURITY INVOKER`**, `STABLE`, con `GRANT EXECUTE` solo a `authenticated` y `service_role` (migración
  `20260509035106…`). Funciona porque `user_roles` deja a cada usuario leer su propia fila. **Una política que se evalúe con el rol `anon` y llame a
  `has_role` falla con `permission denied`**: el diseño público/anónimo no puede apoyarse en ella.
* `private.has_role(...)` es `SECURITY DEFINER` y solo se concede a `authenticated`. Las políticas del patrón de permisos usan
  `public.has_role(auth.uid(), 'admin')`.
* Hoy no hay rol «cliente». Los permisos por sección (`custom_roles`) **solo se aplican en la UI**; ninguna política RLS de datos los consulta.
* Estado real de producción (quiénes son admin, si las migraciones 2026102x están aplicadas): **[NO COMPROBADO]**. Se confirma con
  `docs/salud/planb/inventario_esquema_base.sql`.

### 0.4 Esquema restringido de conteos completos (regla 5) — principios, se concreta en la fase que primero publique conteos

* Un esquema propio (nombre propuesto: `salud_restringido`) **fuera de «Exposed schemas»** de la API de Supabase, con `REVOKE ALL` a `anon` y
  `authenticated`, RLS activa y acceso solo para `service_role` y `admin`.
* Lo publicado se sirve por RPC `get_*` (patrón de permisos: `SECURITY INVOKER`, `search_path` fijo, `REVOKE … FROM public, anon`,
  `GRANT … TO authenticated, service_role`) que lee **solo** las tablas ya suprimidas.
* Antes de codear (Fase 1a o 1b) se documenta aquí el **algoritmo de supresión** (`<5` con supresión complementaria, orden de dimensiones, a qué tablas
  publicadas se aplica) y el cuadre por cotas. **Aún no definido.**
* Se declara que los egresos DEIS ya son microdatos públicos: la supresión es una **política de presentación**, no una protección real.
* Si el esquema expuesto se confirma con la consulta 7 del inventario, el esquema restringido no debe aparecer en esa lista.

### 0.5 `client_ready` (regla 6) — dónde se aplica

`client_ready` **no existe** hoy en el repo (verificado por búsqueda en `src/`, `supabase/` y `docs/`). Propuesta de diseño (se implementa en la Fase 1a):

* **Dónde se guarda:** columna en `thematic_layers` (`client_ready boolean not null default false` + motivo). `layer_nodes.style` no sirve: `update_node_style`
  rechaza toda clave que no sea `color`, `icon` u `opacity` (migración `20261014180000_layer_nodes_edit.sql`, línea 404).
* **Filtro central en el frontend:** `useTerritorialLayers` alimenta a los dos consumidores de análisis, que hacen `layerIds = layers.map(l => l.id)`
  (`useIsochroneAnalysis.ts`, `useIsochroneReport.ts`); filtrar ahí limpia XLSX, PDF, PPTX, PNG, CSV/JSON y el resumen de IA a la vez.
* **Caminos que filtrar aparte** (detalle y rutas en `HALLAZGOS_FASE0.md` §9): exportación del árbol a KMZ/CSV (`layerTreeExport.ts` →
  `buildKmzTree`), proyección de ventas (`poiFeaturePayloadBuilder.ts` → `buildFromFolderRoles`) y **las capturas de mapa para informes**
  (`Index.tsx`), que no apagan las capas territoriales del árbol.
* **RPC de lectura para clientes:** hoy **no existe ninguna `get_*` que devuelva capas del árbol**; esos datos se leen por PostgREST bajo RLS
  (`TO authenticated USING (true)`). Las RPC nuevas incluirán la columna `client_ready` en su resultado y el aviso.
* **Se declara:** el acceso directo a tablas con la clave `anon` queda cubierto **solo por RLS**; `client_ready` no es un control de seguridad.
* Con `client_ready = false` la capa no entra a informes ni exportaciones y muestra el aviso. «Oficial con advertencia» **sí** es apto.

### 0.6 Archivos descargados, hashes y fixtures

* Lo descargado no se commitea (`salud_probe_out/` en `.gitignore`); solo su `sha256` y fixtures mínimos.
* Fixtures reales solo si la licencia permite redistribuir; si no, sintéticos con la misma estructura, **marcados como sintéticos** y solo en carpetas de test.
* Los egresos DEIS (microdatos) entran solo agregados o reducidos a su estructura, nunca como filas individuales reales.

### 0.7 Entorno de pruebas y línea base

Se reproduce con `bash etl/salud/dev_env.sh` (idempotente; ver su cabecera). Línea base de `main` (commit `9026d67`, actualizada por cada PR de salud al mergear), que un PR no puede empeorar:

| Suite | Comando | Línea base |
|---|---|---|
| Vitest | `VITE_SUPABASE_URL=… VITE_SUPABASE_PUBLISHABLE_KEY=… npm test` (valores falsos solo en el comando) | 560 tests en 39 archivos (472 de `main` + 40 de seguridad y convención + 48 de salud 1a; sin las variables fallan los que no mockean el cliente) |
| pytest permisos | `TEST_DATABASE_URL=… python -m pytest etl/permisos/tests -q -p no:cacheprovider` | 43 pasan, 4 omitidos |
| pytest proyectos | `TEST_DATABASE_URL=… python -m pytest etl/proyectos/tests -q -p no:cacheprovider` | 45 pasan |
| SQL `permits_stats.test.sql` | `psql -f` sobre base con **solo** las migraciones 1 y 2 | 92 aserciones |
| SQL `parte4_geo.test.sql` / `parte4_nodes.test.sql` | `psql -f` sobre base con migraciones 2026102x | 111 / 7 |
| SQL `health_establishments.sql` / `health_establishments_rollback.sql` (Fase 1a) | receta de su cabecera (migraciones dos veces + prueba, una transacción que termina en error) en `geochile_salud_test` | 71 / 4 aserciones |
| pytest salud | `TEST_DATABASE_URL=…/geochile_salud_test python -m pytest etl/salud/tests -q -p no:cacheprovider` | 46 pasan (16 del sondeo + 30 de establecimientos) |

* `npm ci` falla en `main` (lock desincronizado: falta `esbuild@0.28.2`); se usa `npm install --no-save`.
* Las migraciones se aplican con `psql -1` (necesitan transacción: usan `SET LOCAL` y tablas temporales).
* **Migraciones y rollbacks (convención, `supabase/README.md`):** las migraciones nuevas usan versión `>= 20261101000000` y su `down` va **siempre** en
  `supabase/rollbacks/<misma versión>_<nombre>_down.sql`, **nunca** en `supabase/migrations/` (`supabase db push` lo trataría como otra migración). Lo hace cumplir
  `src/test/migrationsConvention.test.ts`.
* **Corrección de la línea base (Fase 0):** el texto original decía que `api_quota`, `layer_nodes`, `layer_nodes_edit`, `layer_import` y `legacy_retired`
  «no corren porque asumen objetos del esquema base que no están en el repo (p. ej. `public.user_roles`)». **Esa causa era errónea**: `user_roles` y
  `app_role` sí los crea el repo. La causa real está en `HALLAZGOS_FASE0.md` §8 (necesitan datos reales y 3 objetos que el repo no crea en orden).

---

## 1. Fase 0 — Entorno y sondeo (esta fase)

**Entrega:** `etl/salud_probe.py` (sondeo de solo lectura, plan B), `etl/salud/dev_env.sh` (entorno reproducible), `etl/salud/tests/` (16 tests del sondeo,
datos sintéticos rotulados), `docs/salud/` (BRIEF, este DISENO, HALLAZGOS, plan B) y una línea en `.gitignore`. **No** hay migraciones, ni ETL de carga, ni cambios en
la app.

**Decisiones de la fase**

1. **Honestidad del sondeo:** identidad propia (User-Agent del proyecto), sin cabeceras de navegador, sin reintentar bloqueos; cada fallo se clasifica
   (`proxy_policy_denied`, `waf_challenge`, `site_403`, `reset`, `dns`, `tls`, `timeout`) para saber si lo arregla el entorno o hay que ir al plan B.
2. **Archivos grandes por rangos:** los zips se leen por su directorio central (cola del archivo) y se descomprime solo el principio de la entrada de datos;
   nunca se baja el zip entero. El HEAD **no es fiable** en `datos.superdesalud.gob.cl` (devuelve una página HTML) ni en `redatam.ine.gob.cl` (500); allí se usa GET.
3. **El plan cambia** según lo que se midió (ver `HALLAZGOS_FASE0.md` §11): las fases 2 y 3 pierden el flujo comuna→establecimiento observado porque los egresos
   abiertos no traen establecimiento; Fonasa queda en plan B por un WAF; la Fase 2b queda condicionada al conteo de manzanas.
4. **Las preguntas de uso** se proponen en `HALLAZGOS_FASE0.md` §12, con su nivel; rigen cuando las confirmes con «Continuar con Fase 1a. Preguntas OK».

**Criterios de aceptación de la Fase 0**

- [x] Repo adjunto y push a rama propia verificado (`git push --dry-run` OK; REST con `permissions.push = true`).
- [x] Hosts de la fase clasificados con evidencia (proxy vs. sitio).
- [x] PostGIS local con el stub, las migraciones 2026102x y las 346 comunas; línea base reproducida (`dev_env.sh`, ruta desde cero y ruta idempotente).
- [x] Motor de isócronas, `api_quota`, caminos de informes/exportación y RPC de lectura ubicados (verificados por lectura de código).
- [x] Rol admin verificado en el código del repo.
- [x] Sondeo de las fuentes alcanzables con archivos reales (muestras por rangos).
- [ ] Fuentes en plan B (Fonasa, Geofabrik, descargas del Censo 2024, diccionario Isapre trimestral): **pendientes del usuario**.
- [ ] Inventario del esquema base confirmado contra el Supabase real: **pendiente del usuario** (`planb/inventario_esquema_base.sql`).

**Tras la Fase 0 (aprobada, merge `da8de67`):** las decisiones D1–D10, las preguntas aprobadas, la regla de merge y el orden de trabajo están en la
**adenda de [`BRIEF.md`](./BRIEF.md)**, que es la fuente de verdad. Dos efectos de diseño que cada fase debe respetar: (a) «hospital de alta complejidad» y «privado» tienen definición
fija (D1, D2); (b) el residuo `*` de los egresos es siempre una fila propia, nunca se reparte.

*Las secciones de las fases 1a, 1b, 1c, 2, 2b, 3 y 4 se agregan aquí al empezar cada una.*

---

## 2. Fase 1a — Establecimientos de salud (decisiones tomadas ANTES de codificar)

**Alcance.** Registro oficial de establecimientos (DEIS/MINSAL, datos.gob.cl, CC0, `establecimientos_20261014.csv`, 5.782 filas, 33 columnas), su validación geográfica,
y una capa derivada «establecimientos por comuna» filtrable y rankeable. **Fuera de esta fase:** población comunal del Censo 2024 (archivo pendiente) → las preguntas
**1a-1** y **1a-2** quedan **EN ESPERA** y no se construye ninguna tabla de población hasta ver el layout real del archivo.

### 2.1 Definiciones que fija el dueño (D1, D2) y cómo se implementan

| Definición | Regla exacta | Dónde |
|---|---|---|
| **Alta complejidad (D1, por defecto)** | `NivelComplejidadEstabGlosa = 'Alta Complejidad'` **y** `TipoEstablecimientoGlosa = 'Hospital'` | columna `alta_hospital` |
| **Alta complejidad ampliada (D1, variante)** | lo anterior **más** `Clínica` y `Centro de Especialidades` con `Alta Complejidad` | columna `alta_ampliada` |
| Alta complejidad fuera de ambas | los 2 registros `Alta Complejidad` de tipo `Otro` y `SAMU` | se reportan aparte; **no** se pierden |
| **Privado (D2)** | `DependenciaAdministrativa = 'Privado'` | columna `dependencia_norm = 'privado'` |

* Las dos definiciones se **muestran siempre con su etiqueta** y el selector del panel las nombra; ninguna se presenta como «la» definición.
* La ficha documenta que «privado» **no** coincide con `TipoSistemaSaludGlosa = 'Privado'` ni con «no perteneciente al SNSS» (cifras de `HALLAZGOS_FASE0.md`); la
  columna cruda de cada una se conserva para poder auditarlo.
* Las cifras «82 / 39 / 8» de D1 cuentan **todos** los estados; la capa **oculta los cerrados por defecto**, de modo que los conteos vigentes son menores. Cada
  respuesta dice si incluye cerrados.

### 2.2 Normalización (explícita, nada implícito)

| Campo | Regla |
|---|---|
| CUT | `ComunaCodigo` ya trae 5 dígitos; se valida contra `public.comunas` (FK). Si no existe → **rechazo `cut_unknown`**. Se **conserva** `ComunaGlosa` tal cual para auditar discrepancias nombre↔CUT (se reportan, no se corrigen). |
| Estado | `Vigente en Operación Habitual` y `Vigente en operación habitual` (212 filas con minúscula) → `vigente`; `Cerrado` → `cerrado`. Cualquier otro texto → rechazo `other` (`estado_desconocido`). 73 cerrados sin `FechaCierre` se **reportan**, no se inventa fecha. |
| Complejidad | `Alta/Mediana/Baja Complejidad` → `alta/mediana/baja`; `No Aplica` → `no_aplica`; vacío (287) → `sin_dato`. **Vacío ≠ No Aplica ≠ baja.** |
| Tipo de atención | `Atención Abierta-Ambulatoria` → `ambulatoria`; `Atención Cerrada-Hospitalaria` → `hospitalaria`; **`Atención Abierta-Ambu` (1 fila truncada en la fuente) → `ambulatoria` por equivalencia explícita y contada en el reporte**; `No Aplica` → `no_aplica`; vacío → `sin_dato`. |
| Dependencia | tabla de equivalencias explícita (`Municipal`, `Privado`, `Servicio de Salud`, FFAA/Orden = Ejército, Armada, FACh, Carabineros, PDI, Gendarmería, `SEREMI`, `Delegado`, `Otra Institución`); vacío (8) → `sin_dato`. Un valor nuevo **no se adivina**: va a rechazo `other` y detiene la publicación por encima del umbral. |
| Pertenencia SNSS | `Perteneciente…` / `No Perteneciente…` / `No perteneciente…` (dos mayúsculas distintas en la fuente) → booleano; `No Aplica` → nulo. |
| Código | `EstablecimientoCodigo` (6 dígitos, único en la fuente) es la clave. Duplicado → `duplicate_key`; vacío/no numérico → `other` (`codigo_invalido`). |

### 2.3 Clasificación ambulatorio / hospitalario — **decisión de diseño propia (activa la advertencia de la regla 3)**

La fuente declara `TipoAtencionEstabGlosa`, pero está vacía o `No Aplica` en 300 filas. Regla: **manda lo oficial**; solo si no hay dato se completa con la tabla
`health_tipo_clasificacion` (tipo de establecimiento → clase), derivada de lo que el propio registro declara para ese tipo:

| Clase en la tabla | Tipos |
|---|---|
| `ambulatorio` | la mayoría (CESFAM, CECOSF, Posta, Consultorio, SAPU/SUR/SAR, Centro de Salud Privado, Centro de Especialidades, Hospital de Día, Laboratorio, Clínica Dental, Diálisis, Vacunatorio, etc.): >99 % de sus filas con dato son ambulatorias |
| `hospitalario` | `Hospital` (233 de 234), `CONIN` (9 de 9) |
| `mixto` | `Clínica` (106 hospitalarias y 62 ambulatorias con dato): **no se imputa** |
| `sin_clasificar` | `Otro`, `Dispositivo Incorporado por Crisis Sanitaria`, `Atención Remota`: sin base para imputar |

* Cada fila guarda `clase_servicio` **y** `clase_fuente` (`oficial` · `tabla` · `sin_clasificar`). Todo conteo que mezcle filas imputadas lo declara: **«N de M
  establecimientos tienen la clase imputada por una tabla de diseño, no por la fuente»**. Esa es la advertencia de la regla 3; el sello baja a *Oficial con advertencia*.
* La tabla es **datos, editable por admin**, versionada en la migración con su justificación por fila. Cambiarla no requiere código.

### 2.4 Validación geográfica (§14.4: se **marca**, jamás se mueve)

Cada punto se compara con el polígono de **su propia comuna declarada** (`public.comunas`). El punto original nunca se modifica; solo recibe un estado.

| `geo_status` | Significado | Cómo se decide |
|---|---|---|
| 0 `dentro` | dentro de su comuna | `ST_Covers(comuna.geom, punto)` |
| 1 `borde` | fuera por ≤ `health.near_border_m` | distancia geográfica al polígono declarado |
| 2 `costero` | fuera de su comuna por ≤ `health.coast_buffer_m` **y no dentro de ningún otro polígono** | cubre la costa simplificada del polígono comunal (puntos que caen «en el mar») |
| 3 `fuera_declarada` | dentro de otra comuna o más lejos que el buffer | **se muestra con borde de aviso y se cuenta aparte; no se mueve** |
| 4 `sin_coordenadas` | sin latitud/longitud (370 filas) | el establecimiento **sí cuenta en la comuna** (por su CUT) pero no se dibuja |
| 5 `comuna_sin_poligono` | su comuna no tiene polígono (12202 Antártica) | idem; no se puede validar |
| 6 `coordenada_invalida` | fuera del rectángulo de Chile (incl. Rapa Nui y la Antártica), `0,0` o lat/lon invertidos | se guardan los valores crudos, **sin geometría** |

* `health.near_border_m` y `health.coast_buffer_m` viven en `pipeline_settings` (nada hardcodeado). Valores iniciales y su medición real: ver §2.9.
* Casos de prueba obligatorios: **Isla de Pascua** (05201), **Juan Fernández** (05104) y **Antártica** (12202/12201): el reporte los muestra por separado.
* Conteos por comuna usan el **CUT declarado**, no la posición del punto: un establecimiento mal ubicado cuenta en su comuna y se marca; el mapa de puntos lo dibuja
  donde dice la fuente con el aviso.

### 2.5 Modelo de datos (aditivo; patrón de `permisos`/`proyectos`)

| Objeto | Rol |
|---|---|
| `data_sources` `deis_establecimientos` | URL, licencia CC0, atribución, `verification_status = 'comprobado'` (sondeo de la Fase 0), `scope_note` con lo que la capa **no** dice |
| `health_tipo_clasificacion` | tabla de §2.3 (editable por admin) |
| `health_establishments` | una fila por (`snapshot_n`, `code`); conserva los textos crudos y los normalizados; `geom` punto 4326, `geo_status`, `geo_distance_m` |
| `health_establishments_stage` (UNLOGGED) | zona de paso; se vacía al publicar |
| `publish_health_establishments(snapshot)` | **único camino** (SECURITY DEFINER, todo-o-nada): re-valida dominios, duplicados, CUT, cuadres, calcula `geo_status` y las dos definiciones de alta complejidad **en la base** |
| `get_health_establishments(bbox, filtros)` | puntos para el mapa (SECURITY INVOKER) |
| `get_health_comuna_counts(filtros)` | **capa derivada**: por comuna, conteo con los filtros elegidos, etiquetado `ranking`; incluye las 346 comunas (un cero verdadero se distingue de «sin dato») |
| `get_health_comuna_tipos(cut)` | desglose de una comuna por tipo, ámbito y estado: qué hay detrás de un número del ranking (§2.12) |
| `get_health_summary()` | leyenda y ficha: conteos por estado, geo_status, clase imputada, alta complejidad (ambas definiciones) |
| `thematic_layers.client_ready` + nota | regla 6 (ver §2.8); renderers nuevos `points_health` y `choropleth_health` (**`choropleth_comuna` está capturado por `PermitsHost`**, no se reutiliza) |

Retención: `retention.keep_point_snapshots` (ya existe). Los nombres, direcciones y teléfonos son **datos públicos del registro** (CC0), no personales de pacientes.

### 2.6 Cuadres que la publicación exige (si no cuadran, no se publica)

`filas del archivo = cargadas + rechazadas` · rechazo ≤ `publish.max_reject_ratio` · `cargadas = suma por geo_status = suma por estado` · cero duplicados de `code` · todos los CUT en `comunas`
· todos los dominios conocidos. El reporte del dry-run los imprime **antes** de escribir y el SQL los vuelve a comprobar.

### 2.7 Preguntas de esta fase

| # | Pregunta | Nivel | Estado |
|---|---|---|---|
| 1a-3 | ¿Cuántos establecimientos vigentes hay por comuna, por complejidad y clase? (filtrable, con ranking) | **Respondida con rigor** (conteo del registro) | construida; sello *Oficial con advertencia* si incluye clase imputada |
| 1a-4 | ¿Cuántos hospitales de alta complejidad hay y dónde (dos definiciones)? | **Respondida con rigor**, con las dos definiciones etiquetadas | construida |
| 1a-1 | Comunas > 50.000 hab. sin establecimiento de alta complejidad **en** la comuna | Respondida con rigor · *Oficial con advertencia* | **EN ESPERA** (falta población comunal Censo 2024) |
| 1a-2 | Establecimientos ambulatorios privados por 10.000 hab. en comunas de la RM | Respondida con rigor · *Oficial con advertencia* | **EN ESPERA** (idem) |

Regla 8: nunca se suman ni restan Fonasa/Isapre/Censo; aquí solo hay un registro de establecimientos. «**En** la comuna» no implica «accesible»: la advertencia dice que un
paciente puede atenderse fuera de su comuna y que la capa no mide distancia ni tiempo (eso es la Fase 3).

### 2.8 `client_ready` en esta fase (regla 6)

* `thematic_layers.client_ready boolean` **nullable**: `NULL` = sin evaluar (comportamiento previo, las capas existentes **no cambian**); `false` = no entra a informes ni exportaciones y
  el panel lo avisa; `true` = apta. Las dos capas de salud nacen con `false` y la nota «pendiente de revisión del dueño»: **el dueño decide** cuándo pasan a `true`.
* **Regla de publicación en informes para clientes (decidida por el dueño; vale aunque la capa esté en `true`):** el **ranking nacional o interregional de «todos los establecimientos» NO se publica**. En informes solo se usan **cortes asistenciales comparables** (público; hospitales y clínicas) o **comparaciones dentro de una misma región**. Motivo: el conteo de todos los establecimientos depende de cómo cada SEREMI registra a los privados y no es oferta (§2.12, `HALLAZGOS_FASE1A.md` §7).
* **Procedimiento para pasar a `true`** (decidido por el dueño; **no se automatiza**): (a) resuelta la anomalía del ranking (§2.12); (b) revisión del dueño en un navegador contra Supabase real, después de aplicar; (c) un `UPDATE` explícito que registre en `client_ready_note` la fecha, quién revisó y qué se revisó. Plantilla y lista de revisión en [`RUNBOOK_1A.md`](./RUNBOOK_1A.md) §5.
* El front lee la bandera de `thematic_layers` (con *fallback* a la consulta anterior si la columna aún no existe) y la une a las capas del árbol que usan las capturas de
  mapa de `Index.tsx` (ya preparadas en el PR de seguridad). Las capas de salud no tienen filas en `territorial_features`, así que los análisis por isócrona no las ven.

### 2.9 Supresión de conteos pequeños (regla 5) — **algoritmo definido ahora, se codifica en la primera fase que publique conteos de personas (1c)**

**D11 (CONFIRMADO por el dueño):** los conteos de **establecimientos** de esta fase **no** llevan supresión: son instalaciones de un registro público con nombre y dirección, no
personas. Se sigue publicando el número real (incluidos 1–4). La regla 5 se aplica desde que haya **conteos de personas** (egresos, atenciones, inscritos).

**Algoritmo (especificación, pruebas con fixtures sintéticos en 1c):**

1. **Alcance.** Toda celda publicada que cuente personas = combinación de dimensiones (comuna × período × sexo × grupo de edad × agrupación diagnóstica). El conteo completo vive **solo** en
   `salud_restringido` (esquema fuera de «Exposed schemas», `REVOKE ALL` a `anon` y `authenticated`, RLS, acceso `service_role`/admin). Lo público es lo ya suprimido.
2. **Supresión primaria.** Celda con valor **1 a 4 → suprimida** (se publica «< 5», valor nulo + bandera `suprimida`). **0 no se suprime** (un cero no identifica a nadie y
   suprimirlo ocultaría un hallazgo). Umbral configurable `salud.suppress_below = 5`.
3. **Supresión complementaria.** Si en un grupo cuyo total se publica queda **exactamente una** celda suprimida, se suprime también la **menor** de las restantes del grupo, hasta que cada
   grupo tenga 0 o ≥ 2 suprimidas (así nadie obtiene el valor por resta). **Orden de dimensiones:** primero la más gruesa (región ⊃ comuna), luego sexo, luego edad; una celda
   suprimida en un nivel fino no se «rescata» sumando en uno grueso: los totales publicados son los **reales** (calculados antes de suprimir), y un total que a su vez sea < 5 se suprime.
4. **Residual `*` de la fuente** (el propio DEIS enmascara conteos pequeños con `*`): se muestra **como fila propia «Enmascarado por la fuente»**, nunca se reparte entre celdas.
5. **Cuadre por cotas.** Por grupo con total publicado `T`, suma publicada `S` y `k` celdas suprimidas: `k ≤ T − S ≤ 4k` (con `k = 0`, `T = S`). Si falla, **no se publica**. La prueba incluye mutación
   (quitar la complementaria debe hacer fallar el test de «no recuperable por resta»).
6. **Declaración honesta:** los egresos DEIS ya son **microdatos públicos**; esta supresión es una **política de presentación**, no una protección real. Se dice en la ficha.

### 2.10 Valores iniciales de la validación geográfica (medidos con el archivo real)

Medido con el archivo real (`HALLAZGOS_FASE1A.md` §3): los 33 puntos fuera de su polígono caen **todos dentro de otra comuna**; **9** quedan a ≤ 500 m (`borde`) y **24** más lejos (`fuera_declarada`); ninguno cae en el mar.
`health.near_border_m = 500` marca 9 filas; **`health.coast_buffer_m = 2.000` no marca ninguna** con este archivo y los polígonos del repo: se conserva configurable porque el polígono comunal es simplificado, pero es un valor inicial **no respaldado por datos de este archivo**.

### 2.11 [NO COMPROBADO] y decisiones pendientes de esta fase

* Población comunal Censo 2024 (1a-1/1a-2) — **pendiente del dueño**.
* D11 (supresión no aplica a establecimientos) — **pendiente de confirmar**.
* La clase `hospitalario/ambulatorio` imputada por tabla es una **decisión de diseño**, no un dato oficial. `Clínica` queda como mixta (no se imputa) y `Hospital de Día` como ambulatorio: **confirmado por el dueño**.
* Causa de la heterogeneidad entre regiones en los privados (§2.12): **[NO COMPROBADO]**; habría que preguntarla a la SEREMI de Salud de Coquimbo o al DEIS.
* Si el polígono comunal del repo (`public/comunas.geojson`) es simplificado: el efecto en `borde/costero` se mide en §2.10; no se compara contra un límite oficial de alta resolución.

### 2.12 Qué cuenta el ranking, y por qué no es oferta (hallazgo de la revisión del dueño)

El conteo por comuna de la primera entrega contaba **todos los tipos** del registro. Al revisarlo, La Serena (239) quedaba sobre Providencia (110), Santiago (99) y Puente Alto (50); el análisis (`HALLAZGOS_FASE1A.md` §7) muestra que **no es un error de código de comuna** (238 de 239 puntos caen en su polígono) sino que **el registro no es homogéneo entre regiones**: la región de Coquimbo trae 119 clínicas dentales privadas (Biobío 9, RM 62) y 63 centros de especialidades privados (Biobío 0, RM 1). Causa **[NO COMPROBADO]**: se consultará a la SEREMI de Salud de Coquimbo y al DEIS (solicitud **R5**, [`solicitudes/LISTA_1C.md`](./solicitudes/LISTA_1C.md)); mientras no haya respuesta así queda también en la ficha.

Decisiones: (1) **no se corrige ningún dato**; (2) por defecto se cuenta solo `AmbitoFuncionamiento = 'Establecimiento de Salud'` (las unidades de atención y los programas cuelgan de un establecimiento) — el filtro por sí solo no corrige la distorsión y se dice; (3) **cada panel declara qué se cuenta** (tipos, ámbito, estado) y la lista de tipos que entran; (4) filtro por **tipo** y **desglose por tipo** de la comuna elegida; (5) la **ficha** y el bloque de fuente advierten que el conteo no es oferta ni comparable entre comunas o regiones; (6) el nivel se mantiene en *Respondida con rigor* **como conteo del registro**, nunca como oferta asistencial.

---

## 3. Fase 1b — Previsión (Isapre comunal y CASEN regional) — decisiones tomadas ANTES de codificar

**Alcance (D3, D6).** Solo **Isapre** (cartera comunal de la Superintendencia de Salud) y **CASEN regional**. **Fonasa no está descargado: no se crea nada que dependa de él** y la 1b-5 queda *No respondible hoy*.
La población comunal del Censo 2024 ya está en producción (`20261104000000`): **1b-2 está CONSTRUIDA** (§3.7). Regla 8: Isapre, Fonasa y Censo no se suman ni se restan; no hay residuo «sin previsión» por comuna.

### 3.1 Fuentes (regla 1: organismo, URL exacta, publicación ≠ período, licencia, hash)

| | Isapre — cartera comunal | CASEN 2024 — tabulados y base |
|---|---|---|
| Organismo | Superintendencia de Salud | Ministerio de Desarrollo Social y Familia (Observatorio Social) |
| URL | `https://www.superdesalud.gob.cl/app/uploads/2026/01/estadistica-anual-de-cartera-de-beneficiarios-comunal-2025.xlsx` | `https://observatorio.ministeriodesarrollosocial.gob.cl/storage/docs/casen/2024/casen_2024.sav` y `…/Salud_Casen_2024.xlsx` (tabulados oficiales, para contrastar) |
| **Período** | **diciembre 2025** (cartera vigente) | **2024** (trabajo de campo; factores calibrados con proyección base Censo 2017) |
| **Publicación** | `Last-Modified` 2026-01-28 → `declared_date`; «fecha de extracción» 2026-01-22 va aparte en el reporte de la captura | `Last-Modified` 2026-06-10 |
| Licencia | **No declarada** en el archivo [NO COMPROBADO] → `client_ready = false` | **[NO COMPROBADO]** → `client_ready = false` |
| Advertencia oficial | «Información provisional… sujeta a modificación» | no usar estimaciones con < 60 casos muestrales (nota b); no es representativa a nivel comunal |

* `source_snapshots` guarda `period_start/period_end` (el período) y `declared_date` (la publicación): **siempre separados**. El hash se calcula sobre el archivo original.
* **Semántica del Isapre comunal [NO COMPROBADO]:** el archivo no declara si la comuna es la de domicilio, la del contrato u otra. No se interpreta ni se compara con el Censo (que es por residencia).

### 3.2 Qué se publica y a qué grano (Isapre)

Grano de lo **publicado**: `unidad × sexo × tramo de edad`, con **beneficiarios = cotizantes + cargas**. *Unidad* = comuna (CUT `char(5)`), «sin dato de comuna» de cada región, o «sin dato de región». *Sexo* = F, M, S/I. *Tramo* = los 21 quinquenales `0-4 … >=100` más `S/I` de edad (22 posiciones, `0..21`).
El rol (cotizante / carga) **no se publica por comuna**: solo vive en el esquema restringido. Se publican además los **totales por región y rol** (siempre grandes) y se cuadra contra los totales del propio archivo.

* **Esquema restringido `salud_restringido`:** conteos completos (sin suprimir) con rol. `REVOKE ALL` a `public`, `anon` y `authenticated`; RLS activa con política solo para admin (`public.has_role(auth.uid(),'admin')`) que **no tiene efecto mientras nadie conceda SELECT**; acceso real: `service_role` y SQL directo del dueño. No debe figurar en «Exposed schemas» (se verifica con la consulta 7 del inventario).
* **Públicas:** `isapre_cartera_celda` (valor o suprimido, con cotas), `isapre_cartera_grupo` (total del grupo, suma publicada, **residuo «<5 agrupado»**, cotas y cuadre) e `isapre_cartera_region`.

### 3.3 Algoritmo de supresión (regla 5) — especialización de §2.9 para esta tabla

Se ejecuta **en la base** (`publish_isapre_snapshot`, fuente única de verdad) con los conteos completos y se **replica en Python** (`etl/salud/isapre.py`) para el `--dry-run`; una prueba exige que ambos den lo mismo con el archivo real. Orden de dimensiones: unidad (región ⊃ comuna) → sexo → edad. Un **grupo** = una `unidad × sexo` con sus 22 celdas y su total.

1. **Cuadre antes de suprimir** (datos completos): fila = suma de tramos; `cotizantes = F+M+S/I`; Σ comunas + «sin dato de comuna» = subtotal regional; Σ regiones + «sin dato de región» = **Total País publicado** por el archivo. Si algo no cuadra, **no se carga**.
2. **Supresión primaria:** celda con valor **1–4** → suprimida (`primary`; se publica «<5», `n = NULL`, cotas 1–4). **0 se publica** como 0 (no identifica a nadie).
3. **Total del grupo:** se publica si es ≥ 5; si es 1–4 se suprime (y todas sus celdas no nulas ya son primarias).
4. **Supresión complementaria:** si el total del grupo **se publica** y queda **exactamente una** celda suprimida, se suprime también la **menor celda publicada con valor ≥ 5** (empate: menor tramo). Un grupo con total publicado queda con **0 o ≥ 2** suprimidas, así que ninguna celda se despeja por resta. (Con un solo total por grupo basta una pasada; si el diseño publicara subtotales habría que iterar hasta un punto fijo; **no se publican subtotales** por esa razón.)
5. **Residuo «<5 agrupado» y cotas:** por grupo con total publicado, `residuo = total − Σ publicadas` y `k` suprimidas. Cotas por celda: primaria `[1, 4]`; complementaria `[5, residuo − Σ cotas inferiores de las demás]`. **Cuadre por cotas:** `Σ mínimos ≤ residuo` y, sin complementarias, `residuo ≤ 4k`. Si falla, **no se publica**.
5b. **Retención del residuo (regla general).** Un residuo publicado —el de un grupo (unidad × sexo) o el de un total regional— **no se publica** cuando, junto con las cotas, determina **exactamente** el valor de las suprimidas que lo componen. Con `k` suprimidas y `cota_inf`/`cota_sup` sus cotas publicadas, eso ocurre cuando el residuo es `Σ cota_inf` (todas valen su mínimo: `k·1`, o primarias de 1 más una complementaria de 5) o, sin complementaria, `(umbral−1)·k` (todas valen 4); con `k = 1` ya lo cubre la complementaria. Hay un caso combinado: un total «<5» (cota `≤ 4`) con cuatro celdas suprimidas de ≥ 1 (`Σ cota_inf = 4`) fija el total en 4 y cada celda en 1.
   * **Grupo:** el total se **retiene** (`total_pub` NULL y `total_withheld = true`: ni el total ni su cota «<5»; `residual` NULL). Las celdas siguen suprimidas con cotas **sin residuo**: primaria `[1, 4]`; complementaria `[umbral, la menor otra celda publicada ≥ umbral]` (se eligió como la menor, regla pública). Si no hubiera otra celda publicada ≥ umbral la complementaria quedaría sin cota superior y la publicación **se detiene** (no ocurre con el archivo real: todos los grupos retenidos con complementaria tienen ≥ 15 celdas ≥ 5).
   * **Región:** Σ de los dos totales regionales − Σ de los totales de grupo publicados = `R`, la suma de los totales de los grupos **sin total publicado** (los «<5» y los retenidos). El total regional **no se publica** (ambos roles, `total` NULL con su nota) cuando: (1) hay un solo grupo sin total; (2) `R = Σ` de las cotas inferiores de esos totales (un «<5» vale ≥ 1; un retenido, ≥ publicadas + cotas inferiores); o (3) todos son «<5» y `R = (umbral−1)·k`. Los grupos retenidos cuentan como sin total y sin cota superior.
   * La base **re-valida** las dos invariantes sobre lo ya publicado antes de cerrar, la réplica Python las aplica igual (`region_withheld`) y los tests comparan ambas.
6. **Métricas derivadas con datos completos (1b-1) y sus límites.** La agregación sobre muchas comunas se calcula con los conteos completos dentro de una función `SECURITY DEFINER` que **solo devuelve el agregado** de un conjunto de al menos 10 comunas, junto con su verificación contra el rango publicado. Dos límites, dichos sin rodeos:
   * **Un único corte de edad.** `p_min_tramo` **solo admite 12 (60+)**: con varios cortes la resta entre dos consultas aísla un tramo individual (60+ − 65+ = 60-64). Con un corte no hay tramos que restar.
   * **El mínimo de comunas NO resiste la diferencia entre consultas.** El conjunto de la definición ampliada (288 comunas) está contenido en el de hospitales (292): `hospitales − ampliada` da el agregado **exacto** de las 4 comunas que los separan (Hualpén, Vitacura, Puerto Varas y Huechuraba: 116.128 − 93.058 = 23.070), aunque sean menos de 10. Es una barrera de presentación, no una protección; se declara en la ficha técnica y no se pretende más (punto 7).
   Lo que se muestra por comuna sale **solo** de lo publicado.
   **Valor por comuna (`get_isapre_comuna`).** Es **exacto** cuando lo publicado lo determina y un **rango** si no. Por grupo (unidad × sexo): con todas las edades y el total del grupo publicado, el valor es exactamente ese total (las celdas suprimidas suman el residuo); con un filtro de edad, las celdas suprimidas **dentro** del filtro se acotan por sus cotas y por el residuo publicado del grupo (la suma de las suprimidas dentro y fuera del filtro es el residuo); si el total del grupo es «<5», la suma de las suprimidas no pasa de 4; si el total está **retenido** (punto 5b), solo cuentan las cotas de cada celda. Todo sale de datos ya públicos (`get_isapre_celdas` devuelve los mismos totales y residuos). **No** se publica el total comunal calculado con los conteos completos: restar los grupos publicados despejaría un grupo «sexo sin información» de 1 a 4.
   **«60+»** = tramos 60-64 a ≥100: **excluye** la edad sin información (tramo 21) e **incluye** el sexo sin información; la interfaz lo dice.
   **Fuga por resta regional:** ver punto 5b (retención del total regional).
7. **Declaración honesta:** la cartera por comuna, edad y sexo **ya es pública completa** en el XLSX de la Superintendencia (no hay microdatos individuales). Esta supresión es una **política de presentación**, no una protección real.
8. **Pruebas:** propiedad sobre miles de grupos aleatorios (ningún valor 1–4 publicado; 0 o ≥ 2 suprimidas; residuo = total − Σ; cotas coherentes); mutación (quitar la complementaria hace fallar); la base re-valida las mismas invariantes al publicar.

### 3.4 Qué muestra la interfaz y con qué nivel

* **Capa «Isapre: beneficiarios por comuna»** (renderer propio `choropleth_isapre`): métrica (todas las edades o edad mínima), sexo, y filtro «solo comunas sin hospital de alta complejidad (en la comuna)» con las dos definiciones de D1. Valor por comuna = **exacto** cuando lo publicado lo determina y **rango** («entre a y b») si no (§3.3 punto 6); 0 verdadero ≠ sin dato; «60+» excluye la edad sin información e incluye el sexo sin información.
* **Panel «Previsión regional (CASEN, estimada)»** (renderer propio `panel_casen_region`; **sin pintar comunas**: una región no se pinta sobre sus comunas para no insinuar un dato comunal).
* **Niveles (regla 9) y sello (regla 2):** Isapre = *Respondida con rigor* · sello *Oficial con advertencia* (provisional, domicilio no declarado, fecha distinta de los establecimientos). CASEN = *Estimada* (siempre rango con intervalo de confianza) · sello *Estimado* con nota metodológica. Todo con `client_ready = false` hasta la revisión del dueño (mismo procedimiento que 1a, `RUNBOOK_1A.md` §5).

### 3.5 CASEN regional: método

Estimación de la distribución del sistema previsional de salud (`s13`: Fonasa, Isapre, FF.AA. y del Orden, Ninguno, Otro, No sabe) por región (`region`), con el factor regional `expr` y **error muestral por linealización de Taylor** (estratos `varstrat`, conglomerados `varunit`, un solo nivel de conglomerados, `df = conglomerados − estratos`) → intervalo de confianza del 95 %. Se **contrasta con el tabulado oficial** `Salud_Casen_2024.xlsx` (hoja 3): los puntos deben coincidir. No se publica un valor con **< 60 casos muestrales** (nota técnica b). **Nunca a nivel comunal (D6).** El tabulado oficial **sí** trae error estándar, población expandida y casos muestrales, y las notas «no fiable»: el error estándar publicado aquí lo **calcula esta plataforma** con el diseño muestral y se **contrasta** contra el del tabulado (coincide con una diferencia máxima de ~3·10⁻⁸ pp); el intervalo de confianza del 95 % (t de Student, df = conglomerados − estratos) es cálculo nuestro, el tabulado no lo trae.

### 3.6 Preguntas de la fase

| # | Pregunta | Nivel | Estado |
|---|---|---|---|
| 1b-1 | ¿Cuántos beneficiarios Isapre de **60 años o más** hay en comunas **sin** hospital de alta complejidad **en la comuna**? (dos definiciones D1) | **Respondida con rigor** · *Oficial con advertencia* | construida (agregado con datos completos + rango publicado) |
| 1b-2 | ¿Qué comunas tienen la mayor **penetración** de beneficiarios Isapre sobre la población censada 2024 (INE)? | **Respondida con rigor** · *Oficial con advertencia* | **construida** (§3.7; `get_isapre_penetracion`, migración `20261105000000`) |
| 1b-3 | ¿Qué proporción de cada **región** declara Fonasa o Isapre (CASEN 2024)? | **Estimada** (rango con IC 95 %) · *Estimado* | construida (regional; contraste con el tabulado oficial) |
| 1b-4 | Esa proporción **por comuna** | **No respondible hoy** | CASEN no es representativa a nivel comunal (D6) |
| 1b-5 | Inscritos **Fonasa** por comuna, tramo, edad y sexo | **No respondible hoy** | faltan los archivos de Fonasa (D3); no se crea nada que dependa de ellos |

**«En la comuna» no es «accesible»** (misma advertencia que 1a): la población Isapre puede atenderse en comunas vecinas.

### 3.7 1b-2 — Penetración Isapre sobre la población censada 2024 (construida)

**Qué es.** Por comuna: beneficiarios Isapre (cotizantes + cargas, cartera vigente a dic-2025) ÷ población censada 2024 (INE) del **mismo sexo y de la misma edad**. Une dos capturas de fechas distintas y de fuentes distintas (regla 8: se dividen, no se suman ni se restan; no hay Fonasa ni residuo «sin previsión»). RPC `get_isapre_penetracion(p_sexo, p_min_tramo)`, SECURITY INVOKER, lectura solo para `authenticated` y `service_role`.

**Método (todo lo siguiente está fijado por pruebas SQL).**
1. **Numerador = SOLO lo publicado.** Sale de `get_isapre_comuna()` (celdas publicadas, totales de grupo y residuo) —exacto o rango `[n_lo, n_hi]`—, nunca de `salud_restringido` (la función no tiene acceso al esquema ni lo menciona). Como la población es pública, `pct × población = n` reconstruye el rango publicado y **no revela nada que ese rango no revele ya** (prueba: `pct_lo × población = n_lo`, `pct_hi × población = n_hi`).
2. **Denominador = el Censo con el mismo filtro.** Ambos sexos → total censado; `F` → mujeres; `M` → hombres. `SI` (sexo sin información) se **rechaza** con `22023`: el Censo no tiene ese grupo.
3. **Edad: solo 0 (todas las edades) y 12 (60 años o más).** El tramo Isapre *k* (5k a 5k+4 años) coincide **exactamente** con el grupo *k* del Censo para *k* = 0 … 17 (el grupo «85 o más» = tramos 17..20; los cortes 18, 19 y 20 no tienen grupo equivalente en el Censo). Aun así solo se abren 0 y 12: con dos cortes consecutivos la resta aísla un **tramo** del numerador (regla 5, «un corte único evita aislar tramos restando»). Medido con la captura real: de 16.608 intervalos de tramo obtenidos por resta, 104 (0,6 %) quedan más estrechos que las cotas por celda (aprovechan el residuo publicado del grupo) y **ninguna** celda suprimida queda exacta; no es una filtración de lo no publicado, pero la penetración no necesita ese detalle. **Hallazgo para el dueño:** `get_isapre_comuna` (1b, ya en producción) admite todos los cortes 0..20 y `get_isapre_celdas` publica las celdas con su residuo; esta fase **no** lo cambia.
4. **Asimetría del numerador (declarada en la ficha y en el código).** Con todas las edades incluye la edad **sin información** (tramo 21) y, con ambos sexos, el sexo sin información; con 60+ **excluye** la edad sin información e **incluye** el sexo sin información (ambos sexos). El Censo no tiene «sin información»: su denominador es la población con edad y sexo conocidos.
5. **Sin recorte a 100 %.** Un valor sobre 100 % se muestra tal cual, con la advertencia: «puede reflejar diferencias de definición territorial o de fecha entre las dos fuentes, o el efecto de poblaciones muy pequeñas; la causa no está comprobada». La interfaz no afirma una causa.
6. **Sin dato, nunca respaldo.** Comuna sin fila Isapre, sin población censada, con población 0 para el filtro o sin captura vigente de alguna fuente ⇒ `null` («sin dato»). Siempre 346 filas.

**Interfaz.** En la capa «Isapre: beneficiarios por comuna» un selector de métrica (*Beneficiarios (n.º)* / *Penetración (% de la población censada 2024)*); sexo, edad y «sin alta complejidad» siguen activos (con penetración, «sexo sin información» se deshabilita; el filtro «sin alta» se aplica en el cliente con las comunas de `get_isapre_comuna`). Color (ambas métricas): **clases discretas** de una misma familia, viridis de 7 clases (de menor a mayor; elegida por su luminosidad monótona, su separación entre clases contiguas bajo protanopía, deuteranopía y tritanopía y su contraste con los mapas Oscuro, Claro y Satélite; ver `src/utils/isapreClasses.ts`), relleno 0,7 y borde de comuna visible, sobre el **punto medio** del rango. Penetración: cortes fijos 2, 5, 10, 20, 35 y 50 % (iguales para todas las edades, 60+ y por sexo; un valor igual a un corte cae en la clase superior; sin tope en el percentil 95). Beneficiarios: cortes 100, 300, 1.000, 3.000, 10.000 y 30.000. El 0 tiene su clase propia y sin dato es gris punteado. La leyenda lista una fila por clase con su color, rango y número de comunas (también las vacías); si el rango de una comuna cruza clases, su ventana lo dice. La ventana de la comuna lleva el bloque «Previsión de salud»: beneficiarios Isapre, *Población censada 2024 (INE)*, penetración (exacta o «entre a % y b %»), «Fonasa: pendiente (fase C)» sin cifra, el sello *Oficial con advertencia* y las fuentes con período y fecha de publicación de las dos capturas. No se creó ningún nodo en `thematic_layers`.

**Nivel y sello (reglas 2 y 9).** *Respondida con rigor* · *Oficial con advertencia*.


