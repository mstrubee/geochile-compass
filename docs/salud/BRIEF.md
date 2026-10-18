PROYECTO: Inteligencia territorial de salud en geochile-compass (v6)

REGLA DE EJECUCIÓN (obligatoria)
Trabaja UNA fase a la vez, en este orden: 0, 1a, 1b, 1c, 2, (2b si la Fase 0 lo decide), 3, 4. Cada fase va en su rama (feat/salud-fase-0, -1a, -1b…) y cierra con un PR, su reporte de cierre y una DETENCIÓN. No sigas hasta que te escriba "Continuar con Fase X" (puede ir seguido de "preguntas OK" o de ajustes; ver más abajo). Si una premisa resulta falsa, para y repórtalo.
Al iniciar cada fase, relee docs/salud/BRIEF.md (este prompt, guardado tal cual en la Fase 0) y docs/salud/DISENO.md, y confirma en una línea qué fase empiezas y qué reglas aplican.

PARA QUÉ SIRVE (criterio de aceptación)
Los usuarios son analistas que entregan estudios de localización de establecimientos de salud a clientes. Cada fase tiene preguntas de uso. Las de este prompt son sugerencias: en el reporte de la Fase 0, propón la versión final de las preguntas de TODAS las fases, cada una con su nivel de rigor (regla 9).
Las confirmo con "Continuar con Fase 1a. Preguntas OK" o con mis ajustes en ese mismo mensaje. Una vez confirmadas, rigen para todas las fases, salvo que las modifique en un "Continuar" posterior. Si en "Continuar con Fase 1a" no menciono las preguntas, pídemelas antes de empezar.
Una pregunta cuenta como respondida solo si un test de Vitest con fixtures (o una captura con Playwright, con datos simulados y nunca contra el Supabase real) muestra la respuesta en la app. Los fixtures prueban el mecanismo, no que la cifra real sea correcta. Por eso el reporte incluye también una verificación de cordura con los datos reales del --dry-run: la cifra o lista que entrega la app se contrasta con una cifra independiente (por ejemplo, un total publicado por el organismo) o con 2 o 3 casos conocidos.

CONTEXTO DEL REPO
- github.com/mstrubee/geochile-compass. React/Vite/TS + Leaflet + Turf; Supabase (PostGIS); Vercel; ETL en Python.
- Las migraciones van en supabase/migrations/ y se aplican A MANO (README). No las apliques ni cargues datos en el Supabase real.
- Lee antes SQL_MIGRATION_GUARDRAILS.md y docs/permisos-edificacion/DISENO.md (§3, §12 y §14). Reutiliza data_sources, source_snapshots, source_checks, comunas (única fuente de CUT, char(5)), comuna_name_aliases, pipeline_settings, layer_nodes y el patrón de ETL de etl/permisos y etl/proyectos (--dry-run, hash normalizado, publish todo o nada con SECURITY DEFINER). No construyas un sistema paralelo.
- Nunca hagas push a main. Antes de cada PR: rebase contra main y corre Vitest, pytest (cada carpeta de tests por separado) y las pruebas SQL, según la LÍNEA BASE de abajo. Si no puedes correr alguna (por ejemplo, sin PostGIS), dilo en el PR como pendiente y entrégame los comandos.
- Para abrir PR usa la API REST, no `gh pr create` (usa GraphQL y el entorno lo bloquea): `gh api repos/mstrubee/geochile-compass/pulls -f title=... -f head=<rama> -f base=main -f body=...`. Si la creación falla, deja la rama empujada y entrégame el enlace de comparación para abrirlo yo. No arregles ni reautentiques gh.
- Migraciones con timestamp 20261101xxxxxx o posterior, cada una con su _down.sql. No toques las existentes.
- Documentación en docs/salud/DISENO.md, con una sección por fase. Archivos compartidos: cambios mínimos y aditivos, listados en el PR.
- No imprimas ni commitees secretos (claves de ORS, Supabase u otras). Los archivos descargados no se commitean (van a .gitignore); solo su hash y fixtures mínimos.
- Los fixtures de test son recortes mínimos de los archivos reales, solo si la licencia permite redistribuirlos. Si no lo permite o está por confirmar, usa un fixture sintético con la misma estructura y márcalo como sintético (esto vale solo para tests; los cuadres y tamaños siguen la regla 7). Los microdatos (egresos DEIS) entran solo agregados o reducidos a su estructura, nunca como filas individuales reales. Los fixtures sintéticos viven solo en carpetas de test; nunca en data_sources, seeds ni datos cargados.
- LÍNEA BASE (medida en main, commit 9026d67). Comandos desde la raíz del repo. Un PR no puede empeorarla; reporta cualquier diferencia.
  - Dependencias: `npm ci` FALLA en main (package.json y package-lock.json desincronizados: falta esbuild@0.28.2; DISENO §12 lo documenta). Usa `npm install --no-save`. No modifiques package.json ni el lock sin pedírmelo. Python: venv fuera del repo con `pip install -r etl/requirements.txt`. En este entorno pip y npm necesitan salir por el proxy del entorno (anula NO_PROXY solo en el comando; nunca desactives TLS ni quites HTTPS_PROXY).
  - Vitest: `npm test`. Con VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY falsas solo en el comando, la línea base es 472 tests (433 + 39 de 3 archivos que sin esas variables no cargan).
  - pytest, cada carpeta por separado, con TEST_DATABASE_URL apuntando a una base *test* local con el stub, las migraciones 2026102x y las comunas sembradas (etl/permisos/seed.py): etl/permisos/tests → 43 pasan y 4 omitidos (requieren los XLSX completos de MINVU); etl/proyectos/tests → 45 pasan. Usa `-p no:cacheprovider` y PYTHONDONTWRITEBYTECODE=1 para no ensuciar el repo.
  - SQL: las migraciones se aplican con `psql -1` (necesitan transacción) y las pruebas con `psql -f`. permits_stats.test.sql corre sobre una base con SOLO las migraciones 1 y 2 → 92 aserciones. parte4_geo.test.sql → 111. parte4_nodes.test.sql → 7. Las pruebas api_quota, layer_nodes, layer_nodes_edit, layer_import y legacy_retired NO corren en local: asumen objetos del esquema base real (p. ej. public.user_roles) que no están en el repo. No inventes ese esquema.

REGLAS DE DATOS
1. Ningún dato visible sin organismo, URL exacta, fecha de publicación, período, licencia, fecha de descarga, sha256 y advertencias. Incluye los derivados de OpenStreetMap/ORS (isócronas, matrices de tiempo): su licencia es ODbL y la ficha lleva la atribución. El alcance de ODbL sobre matrices derivadas queda [NO COMPROBADO] hasta confirmarlo.
2. Sellos, de más fuerte a más débil: Oficial > Oficial con advertencia > Estimado > Sin dato. Visibles en la leyenda y en la ficha. Nunca mezcles sellos en un mismo color ni rellenes un vacío en silencio.
3. SELLO HEREDADO: un valor derivado toma el sello más débil de sus insumos. Es como máximo "Oficial con advertencia", y la advertencia lo dice, si combina fuentes con fechas distintas (p. ej. establecimientos oct-2026 con Censo 2024), fuentes con semánticas distintas o una clasificación propia del proyecto (p. ej. tipo → ambulatorio u hospitalario). Las tasas por habitante residente llevan además la advertencia de población flotante: comunas con muchos establecimientos y poca población residente darán tasas muy altas.
4. Dos fechas siempre separadas: publicación y período.
5. PRIVACIDAD Y CUADRES: un conteo de 1 a 4 se publica como "<5", con supresión complementaria para que ninguna celda se pueda despejar por resta. El algoritmo se define y documenta en DISENO ANTES de codear, en la primera fase que publique conteos (1a o 1b): a qué tablas publicadas se aplica y en qué orden de dimensiones. El cuadre se valida en el ETL con los datos completos, antes de suprimir. En lo publicado se muestra un residuo "<5 agrupado" y un cuadre por cotas (mínimo y máximo). Las métricas derivadas (captación 50/75/90 %, calibración) se calculan con los datos completos.
   Los conteos completos viven en un esquema restringido: fuera de la API de Supabase (Exposed schemas), con REVOKE a anon y authenticated, más RLS. Solo acceden service_role y el rol admin del repo (verifica en la Fase 0 que existe y cómo se llama). Así la Fase 3 es reproducible.
   Si una fuente no publica total, el cuadre dice contra qué se hizo o queda [NO COMPROBADO]. Declara en DISENO que los egresos DEIS ya son microdatos públicos: la supresión es una política de presentación, no una protección real.
6. CLIENT_READY: false si la licencia no está confirmada, si un Estimado no tiene su nota metodológica o si la validación de la carga está pendiente. "Oficial con advertencia" SÍ es apto. Con false, la capa no entra a informes ni exportaciones y muestra el aviso. Se aplica en el frontend (en los caminos de informes y exportación que ubiques en la Fase 0) y en las RPC de lectura para clientes (también ubicadas en la Fase 0). Declara que el acceso directo a tablas con la clave anon queda cubierto solo por RLS. Lleva test.
7. Lo que no existe o no es público se documenta como Sin dato. No inventes fuentes, campos ni APIs. Marca [NO COMPROBADO] todo lo que no verificaste con el archivo real. Si no puedes acceder a los archivos reales o a PostGIS, la fase no se cierra con cifras: no inventes cuadres, supresiones, rechazos ni tamaños, ni los reemplaces por datos sintéticos. Abre el PR marcado "pendiente de verificación con datos reales", entrégame los comandos del plan B y detente.
8. Nunca sumes ni restes Fonasa e Isapre entre sí, ni las restes del Censo: tienen semánticas distintas (Censo por residencia, Isapre por domicilio [NO COMPROBADO], Fonasa por comuna de inscripción APS). No hay residuo "sin previsión" por comuna. La proporción Isapre usa el Censo como denominador y lleva "Oficial con advertencia". Fonasa no se usa como proporción comunal.
9. HONESTIDAD DE LAS RESPUESTAS: cada pregunta de uso, y cada cifra que la app entrega como respuesta, declara uno de cuatro niveles:
   - Respondida con rigor: datos oficiales, sin estimación.
   - Estimada: modelo con método publicado; se entrega como RANGO ("entre X e Y"), nunca como cifra puntual.
   - Escenario con supuestos: se entrega con los supuestos escritos junto al resultado, rotulada "escenario" y no "predicción".
   - No respondible hoy: se dice qué dato falta y cómo conseguirlo.
   Nunca presentes como rigurosa una respuesta estimada o sugerida. El nivel se ve en la app junto a la respuesta y en todo informe o exportación. El nivel (regla 9) y el sello (regla 2) son independientes: una respuesta puede ser "Respondida con rigor" y llevar el sello "Oficial con advertencia".

PREMISAS (oct-2026; re-verifícalas en la Fase 0)
- Establecimientos: datos.gob.cl, CSV CC0 de oct-2026, unas 5.782 filas, 33 campos, con lat/lon. Incluye cerrados. ComunaCodigo viene como entero sin cero inicial.
- Isapre: cartera por comuna, edad y sexo de la Superintendencia (dic-2025, XLSX).
- Fonasa: la comuna es la del establecimiento APS de inscripción.
- DEIS: egresos con establecimiento, comuna de residencia y previsión, abiertos al menos hasta 2023. Busca 2024.
- Isócronas: la edge function supabase/functions/isochrone llama a OpenRouteService (a pie, auto y bici), guarda en poi_isochrones y genera en lote desde poiIsochroneService. También existe drive-distance. ORS no considera tráfico.

=== FASE 0: ENTORNO Y SONDEO (rama feat/salud-fase-0; el PR solo trae el sondeo, los docs, los archivos del plan B y el script dev_env.sh) ===
1. Entorno y red:
   - Confirma que el repo está adjunto y que puedes hacer push a tu rama y abrir un PR.
   - Confirma acceso a datos.gob.cl, deis.minsal.cl, superdesalud.gob.cl, fonasa.cl, ine.gob.cl (y sus hosts de descarga), observatorio.ministeriodesarrollosocial.gob.cl y download.geofabrik.de. Reporta bloqueos, geobloqueo o problemas de certificados. No uses cabeceras de navegador para saltar un WAF: si un sitio bloquea, va al plan B.
   - PLAN B: si algo falla, lista los archivos exactos (URL y nombre) para que yo los descargue y los suba, o deja salud_probe.py listo para correrlo en mi máquina. No reintentes en bucle.
2. PostGIS y disco: averigua cómo corren hoy las pruebas SQL, si puedes levantar PostGIS aquí y cuánto disco tienes. Confirma que cabe un PostGIS local con los datos reales completos, porque el tamaño medido y el --dry-run real lo exigen.
   - PLAN B: si no puedes levantar PostGIS aquí, deja un docker compose y un script para que yo corra en mi máquina las pruebas SQL, el --dry-run real y la medición de tamaño. Entrégame los comandos exactos.
3. Motor de isócronas y accesos: revisa la edge function isochrone, poi_isochrones, drive-distance y la cuota actual de ORS (api_quota), sin imprimir claves. Ubica los caminos de informes y exportación y las RPC de lectura para clientes donde se aplicará client_ready. Revisa el modelo de roles y verifica que existe el rol admin de la regla 5.
4. etl/salud_probe.py: usa descargas parciales o muestreo para los archivos grandes (egresos de varios años, CASEN y cartografía de manzanas; de Geofabrik, solo alcanzabilidad). Por fuente, reporta columnas, filas, período, licencia, comuna de domicilio o de inscripción, si trae total publicado, tramos de edad (¿son compatibles entre Isapre, Fonasa y Censo, o hay que reagrupar?) y problemas. Además:
   - si existen los campos que necesita cada pregunta sugerida (p. ej. complejidad, dependencia, tipo, previsión). Si falta alguno, esa pregunta pasa a No respondible hoy y lo reportas;
   - si el Censo 2024 trae previsión de salud y a qué nivel;
   - si existe población por manzana y cuántas manzanas son. Si son muchas, propón la Fase 2b (teselas vectoriales MVT o PMTiles) antes de la Fase 3;
   - CASEN más reciente: previsión por comuna, representatividad y error muestral;
   - DEIS: último año, si las clínicas privadas reportan egresos completos y los cambios de código de comuna (Ñuble 2018) que exijan una tabla de equivalencias.
5. Script de entorno: deja en el PR un script idempotente (etl/salud/dev_env.sh) que reproduzca el entorno de pruebas en una sesión nueva: PostGIS (apt con fuentes https temporales y el proxy solo por línea de comandos, sin tocar /etc/apt), venv fuera del repo, npm install --no-save, clúster Postgres local fuera del repo, bases *test* con el stub, las migraciones y el seed. Debe correr los comandos de la LÍNEA BASE y confirmar que los números coinciden.
6. Inventario del esquema base: lista los objetos que las migraciones y pruebas del repo asumen y el repo no crea (public.user_roles, funciones de rol, etc.), con la consulta de SOLO LECTURA que debo correr en mi Supabase real para confirmar su definición. Con mi respuesta se escribe un stub de test marcado como stub. No lo inventes: si no puedes confirmar su forma, es [NO COMPROBADO], y las pruebas que dependan de él (rol admin de la regla 5, RPC de la regla 6) quedan pendientes de mi confirmación.
7. Entrega docs/salud/HALLAZGOS_FASE0.md: premisas confirmadas o caídas, cómo cambia el plan y las preguntas de uso propuestas para todas las fases, con su nivel (regla 9). Guarda este prompt, sin cambios, en docs/salud/BRIEF.md. DETENTE.

=== FASE 1a: ESTABLECIMIENTOS Y POBLACIÓN ===
- Establecimientos con CUT normalizado, tipo, dependencia, nivel, complejidad y estado. Los cerrados van ocultos por defecto.
- Tabla de clasificación tipo → ambulatorio u hospitalario, documentada como decisión de diseño (activa la advertencia de la regla 3).
- Validación geográfica como en §14.4 (se marca, no se mueve), con un buffer costero configurable en pipeline_settings. Isla de Pascua, Juan Fernández y Antártica van como casos de prueba.
- Población del Censo 2024 por comuna, con edad y sexo.
- Capa derivada: establecimientos por comuna según complejidad y clase, con filtro o ranking (no bastan los puntos y una coroplética).
- ETL con --dry-run, alias y equivalencias explícitos, rechazos con código y cuadres.
- Si esta fase publica conteos, define en DISENO el algoritmo de supresión (regla 5).
- Preguntas sugeridas:
  - ¿Qué comunas de más de 50.000 habitantes no tienen un hospital de alta complejidad EN la comuna? Mide ausencia en la comuna, no falta de acceso: la población puede usar hospitales de comunas vecinas. Nivel esperado: Respondida con rigor, con sello Oficial con advertencia.
  - ¿Cuántos establecimientos privados ambulatorios hay por cada 10.000 habitantes en cada comuna de la RM? Nivel esperado: Respondida con rigor, con sello Oficial con advertencia (por fechas distintas, clasificación propia y población flotante).

=== FASE 1b: PREVISIÓN ===
- Isapre por comuna (edad y sexo) y Fonasa por comuna de inscripción (tramo, edad y sexo), como capas SEPARADAS (regla 8).
- CASEN como capa Estimado con su error muestral, si la Fase 0 la confirma.
- Si la 1a no lo hizo, define en DISENO el algoritmo de supresión.
- Preguntas sugeridas: ¿cuántos beneficiarios Isapre de 60 años o más hay en comunas sin hospital de alta complejidad (en la comuna)? ¿Qué comunas tienen mayor proporción Isapre sobre el Censo?

=== FASE 1c: SOLICITUDES DE TRANSPARENCIA ===
- Con lo que la Fase 0 mostró que falta, redacta las solicitudes; yo las presento. Fonasa: atenciones MLE por prestador y comuna de residencia, y beneficiarios por comuna de residencia. Superintendencia: prestaciones Isapre por prestador y comuna. Van en docs/salud/solicitudes/, con el formato de datos pedido. Sin código de ingesta.

=== FASE 2: UTILIZACIÓN OBSERVADA ===
- Matriz de egresos DEIS (comuna de residencia → establecimiento), por previsión y año, con la regla 5. Marca 2020-2022 como período de pandemia.
- Cruce de códigos DEIS con la Fase 1a: lo que no cruce se reporta.
- REM y urgencias: si no traen la comuna del paciente, van como Sin dato.
- Frontend: flujos y captación observada 50/75/90 % por hospital. Mide y justifica el tamaño, incluido el esquema restringido de conteos completos.
- Preguntas sugeridas: ¿de qué comunas vienen los pacientes Isapre hospitalizados en la Clínica X? (No respondible si la Fase 0 muestra que esa clínica no reporta completo.) ¿Qué comunas se hospitalizan mayoritariamente fuera de su comuna?

=== FASE 2b (solo si la Fase 0 la decide): MANZANAS ===
- Población por manzana servida como teselas vectoriales (MVT o PMTiles), no como GeoJSON en Leaflet.

=== FASE 3: ACCESIBILIDAD Y ESTIMACIONES ===
- Isócronas visuales: REUTILIZA la edge function isochrone y poi_isochrones; un establecimiento genera su isócrona igual que un POI.
- Motor para matrices: compara ORS autohospedado (misma API: solo cambia la URL base y queda un único motor) con OSRM y Valhalla, con RAM, costo y dónde corre [NO COMPROBADO hasta medirlo]. El cálculo en lote es un job separado y encolado que corre después de publicar un snapshot, nunca dentro de la función publish. Su resultado lleva sello Estimado.
- Tiempos sin tráfico: la nota metodológica lo dice y la app lo muestra (en la RM, en hora punta, los minutos reales serán más).
- Modelo de captación: separa APS (cercanía, gravitacional o 2SFCA) de hospitales (red de derivación). Calibra con unos años o regiones y valida FUERA DE MUESTRA con otros. Excluye o trata aparte 2020-2022. Informa el error por comuna. Está calibrado con hospitalizaciones: no lo uses para consultas ambulatorias.
- Previsión por manzana: es inferencia ecológica, así que se publica solo como intervalo, y si es demasiado ancho no se publica. Las estimaciones por manzana deben CUADRAR con el total oficial de su comuna (ajuste o benchmarking); si no cuadran, el modelo no se publica. En la nota metodológica, define cómo se combinan los intervalos al agregar manzanas (por ejemplo, por simulación; no sumes cotas).
- Nota metodológica de una página por modelo.
- Preguntas sugeridas:
  - ¿Cuántos beneficiarios Isapre quedan a más de 20 minutos en auto (sin tráfico) de una clínica? Estimada: la respuesta es "entre X e Y", con un rango que incorpora la incertidumbre de la previsión por manzana y la de la isócrona (sin tráfico, polígono simplificado). Requiere población por manzana: si la Fase 0 muestra que no existe, esta pregunta pasa a No respondible hoy, o a una versión comunal con advertencia explícita que yo apruebe.
  - ¿Qué captación tendría un centro médico nuevo en un punto dado? Escenario con supuestos explícitos. Para consultas ambulatorias, es No respondible hasta que la Fase 4 incorpore los datos de transparencia.

=== FASE 4: INCORPORAR RESPUESTAS Y FRESCURA ===
- Esquema genérico versionado sobre source_snapshots para las respuestas de transparencia. El parser concreto se escribe al llegar cada archivo. Al cargarlo cambian el sello y el nivel de las preguntas afectadas, y lo anterior queda en el historial.
- FASE 4 PARCIAL: si una respuesta llega antes de esta fase, te la paso como "Fase 4 parcial". Incorpora solo esa fuente, en su propia rama (feat/salud-fase-4-<fuente>) y PR. La primera fuente que llegue crea el esquema genérico (migración y tabla de historial); las siguientes lo reutilizan, y la Fase 4 completa no lo rediseña. Al terminar, DETENTE y espera mi "Continuar con Fase X" para retomar la fase en curso.
- Revisión de frescura por fuente, según su cadencia.

REPORTE DE CIERRE DE CADA FASE (va en la descripción del PR y en el chat)
- Qué se hizo y qué no.
- Cada pregunta de uso: su nivel (regla 9), el test o la captura que muestra la respuesta y la verificación de cordura con datos reales.
- Fuentes con URL, período, licencia y estado de client_ready.
- Resultados de pytest, Vitest y SQL contra la LÍNEA BASE (o los comandos del plan B, si corren en mi máquina).
- Tamaño medido (tablas publicadas y esquema restringido, por separado).
- Cuadres (contra qué total), supresiones y rechazos del --dry-run real.
- [NO COMPROBADO] y decisiones que necesito tomar.
- Archivos compartidos modificados.
Luego DETENTE y espera "Continuar con Fase X".

Para los puntos 1 a 3 de la Fase 0 usa los resultados del prechequeo y de la preparación del entorno que ya hiciste, y re-verifica solo lo que haya cambiado. El clúster Postgres sigue en el puerto 5433 si lo necesitas.

---

# ADENDA (2026-10-18) — reglas permanentes y decisiones posteriores a la Fase 0

> Todo lo anterior es el encargo original, **sin cambios**. Esta adenda registra lo que el dueño del proyecto dispuso al aprobar el PR de la Fase 0
> ([mstrubee/geochile-compass#14](https://github.com/mstrubee/geochile-compass/pull/14), merge `da8de67`). Si algo de la adenda contradice el texto original, **rige la adenda**.

## Regla de merge (permanente)
Cuando el dueño apruebe un PR («aprobado», «OK, mergea» o «Continuar con…» referido a ese PR), **lo mergea el agente**:
`gh api -X PUT repos/mstrubee/geochile-compass/pulls/<N>/merge -f merge_method=merge`
- **Antes de mergear:** verificar que el PR siga apuntando al commit que el dueño revisó y que no haya conflictos. Si `mergeable_state` no es `clean`, mirar la causa; si es solo el workflow de sincronización, decirlo en una línea y mergear igual.
- **Después:** actualizar el `main` local y reportar el SHA del merge.
- **Sigue prohibido:** el push directo a `main`, mergear sin aprobación y aplicar migraciones. Tampoco se despliegan funciones: lo hace el dueño.

## Decisiones D1–D10 (aprobadas)
| # | Decisión |
|---|---|
| D1 | «Hospital de alta complejidad»: se reportan **las dos definiciones, con rótulo**. Por defecto `TipoEstablecimiento = Hospital` (82); la variante agrega clínicas (39) y centros de especialidades (8). |
| D2 | «Privado» = `DependenciaAdministrativa = Privado`. La ficha documenta la diferencia con `TipoSistemaSalud` y con no-SNSS. |
| D3 | El dueño baja los archivos de Fonasa. Mientras no lleguen, la 1b avanza con Isapre y la **1b-5 queda No respondible hoy**. |
| D4 | **Sí:** agregar **R4 (egresos hospitalarios con código de establecimiento)** a la Fase 1c, como **solicitud prioritaria**. |
| D5 | La **3-2 queda No respondible hoy** hasta tener R4. |
| D6 | CASEN **solo regional**, como Estimada con error muestral. **A nivel comunal, nunca.** |
| D7 | Fase 2b **aprobada, condicionada al conteo de manzanas**. |
| D8 | **2-3 aprobada**, con la advertencia de semántica y el **mismo año (dic-2024)**. |
| D9 | El dueño corre el inventario en su Supabase y entrega las 9 salidas (`docs/salud/planb/inventario_esquema_base.sql`). |
| D10 | Sí: `isochrone` exige JWT y rol **sin esperar a la Fase 3** → PR de seguridad `fix/seguridad-edge`. |

## Preguntas de uso (versión final aprobada)
Las del `HALLAZGOS_FASE0.md` §12 **con los niveles propuestos** y estos ajustes (D1, D2, D5, D8):
- **1a-1** y **1a-2**: con las definiciones de D1 y D2. Quedan **en espera del archivo de población comunal del Censo 2024** (lo único que bloquea la 1a).
- **1b-3**: CASEN solo regional (Estimada). **1b-4**: No respondible hoy. **1b-5**: No respondible hoy mientras no lleguen los archivos de Fonasa.
- **2-1, 2-2 y 2-3 (egresos):** el residuo enmascarado con `*` **se muestra siempre como fila propia, nunca se reparte**. 2-3 con la advertencia de semántica y dic-2024.
- **2-4 y 2-5**: No respondible hoy hasta R4.
- **3-1**: Estimada, **bloqueada** hasta saber si hay población y previsión por manzana (o versión comunal con advertencia que el dueño apruebe). **3-2**: **No respondible hoy** hasta R4.

## Orden de trabajo vigente
1. `fix/seguridad-edge` (PR aparte, independiente de salud; con tests; **detención hasta que el dueño lo apruebe**; sin desplegar).
2. **Fase 1a** con «Preguntas OK» ya dadas. El plan B del dueño corre en paralelo (población comunal del Censo 2024, diccionario Isapre, Fonasa, inventario y `probe --full`).
   Si la **población comunal** no llegó al terminar el PR de seguridad, la 1a avanza con todo lo demás y deja **1a-1 y 1a-2 en espera** de ese archivo.

## Deuda del esquema (registrada, no se arregla ahora)
Issue [mstrubee/geochile-compass#15](https://github.com/mstrubee/geochile-compass/issues/15): `public.custom_layers` no la crea ninguna migración, `fn_marcas_categoria` se usa antes de existir y 9 de 114 migraciones no se aplican desde cero. Hay que poder reconstruir la base desde el repo.

## Corrección de la LÍNEA BASE
- La causa original de que 5 pruebas SQL no corran en local («asumen `public.user_roles`, que no está en el repo») **era errónea**: `user_roles` y `app_role` los crea `20260507233321`. La causa real está en `HALLAZGOS_FASE0.md` §8.
- Vitest: **472 tests / 34 archivos** en `main` `9026d67`; **508 / 36** una vez mergeado `fix/seguridad-edge` (+36 tests, +2 archivos). `etl/salud/dev_env.sh` guarda las constantes vigentes.
