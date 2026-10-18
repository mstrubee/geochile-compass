# Inteligencia territorial de salud — Diseño

Documento vivo de la iniciativa. **Una sección por fase**; cada fase la relee al empezar junto con [`BRIEF.md`](./BRIEF.md) (el encargo, guardado
tal cual en la Fase 0). La evidencia con los archivos reales vive en [`HALLAZGOS_FASE0.md`](./HALLAZGOS_FASE0.md). Este documento recoge solo las
**decisiones de diseño** y las convenciones; no repite cifras.

Estado: **Fase 0 (entorno y sondeo) — esta sección**. Las demás secciones se agregan en su fase.

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

Se reproduce con `bash etl/salud/dev_env.sh` (idempotente; ver su cabecera). Línea base de `main` (commit `9026d67`), que un PR no puede empeorar:

| Suite | Comando | Línea base |
|---|---|---|
| Vitest | `VITE_SUPABASE_URL=… VITE_SUPABASE_PUBLISHABLE_KEY=… npm test` (valores falsos solo en el comando) | 472 tests en 34 archivos (433 sin las variables) |
| pytest permisos | `TEST_DATABASE_URL=… python -m pytest etl/permisos/tests -q -p no:cacheprovider` | 43 pasan, 4 omitidos |
| pytest proyectos | `TEST_DATABASE_URL=… python -m pytest etl/proyectos/tests -q -p no:cacheprovider` | 45 pasan |
| SQL `permits_stats.test.sql` | `psql -f` sobre base con **solo** las migraciones 1 y 2 | 92 aserciones |
| SQL `parte4_geo.test.sql` / `parte4_nodes.test.sql` | `psql -f` sobre base con migraciones 2026102x | 111 / 7 |

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

*Las secciones de las fases 1a, 1b, 1c, 2, 2b, 3 y 4 se agregan aquí al empezar cada una.*
