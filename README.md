# GeoChile Compass

Sistema de información geográfica para análisis territorial y de red comercial en Chile
(Grupo Planet). Permite:

- Calcular **isócronas** (a pie, bici, auto) y dibujar **microzonas** a mano, y analizarlas:
  población, grupo socioeconómico (Censo 2024 por manzana), comunas, parque automotriz,
  gasto potencial y comercios cercanos.
- Gestionar la **red de locales (POIs)** por carpeta (Autoplanet, Agroplanet…): ventas
  mensuales, presupuesto, pronóstico y curva de maduración.
- **Proyectar ventas** de una ubicación nueva a partir de locales comparables, con
  canibalización y ajustes del analista.
- Administrar **capas territoriales** (comercios, servicios, atractores) y subir capas propias
  desde KML/KMZ/GeoJSON/CSV.
- Generar **informes** en PDF, PPTX y láminas PNG, y exponer la proyección a LeaseFlow por API.

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | React 18, TypeScript, Vite 5 (SWC), Tailwind CSS, shadcn/ui (Radix) |
| Mapa y geometría | Leaflet / react-leaflet, Turf.js |
| Datos en cliente | TanStack Query, `@supabase/supabase-js` |
| Backend | Supabase: Postgres + PostGIS, Auth, Storage, Edge Functions (Deno) |
| Informes | jsPDF, pptxgenjs |
| Tests | Vitest (jsdom), tests de Deno para código compartido de las edge functions |
| Deploy | Vercel (SPA, ver `vercel.json`) |

## Cómo correrlo

Requisitos: Node 20+ y npm.

```bash
npm ci
cp .env.example .env     # completa las variables (ver abajo)
npm run dev              # http://localhost:8080
```

### Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo (puerto 8080) |
| `npm run build` | Build de producción en `dist/` |
| `npm run preview` | Sirve el build local |
| `npm test` / `npm run test:watch` | Tests con Vitest |
| `npm run lint` | ESLint |
| `npm run sync:ventas` | Carga el Excel de ventas (ver `docs/sync-ventas-*.md`) |
| `npm run backtest:pronostico` | Backtest del pronóstico de ventas |
| `npm run proponer:presupuesto` | Propone presupuesto anual por local |
| `npm run validar:potencial` | Valida el modelo de potencial de ventas |

### Variables de entorno

Solo las `VITE_*` llegan al navegador: **nunca pongas secretos en ellas**.

| Variable | Obligatoria | Uso |
|---|---|---|
| `VITE_SUPABASE_URL` | Sí | URL del proyecto Supabase |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Sí | Clave pública (anon) |
| `VITE_SUPABASE_PROJECT_ID` | Sí | Id del proyecto |
| `VITE_GOOGLE_MAPS_KEY` | No | Activa Google Maps; vacío = solo OpenStreetMap |
| `VITE_MANZANA_API_URL` | No | API de manzanas; vacío = datos incluidos |
| `VITE_OVERPASS_URL` | No | Instancia propia de Overpass |

Los scripts de sincronización (`scripts/sync-ventas.sh`) leen `.env.sync` con
`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`. Ese archivo está en `.gitignore` y la clave de
servicio nunca debe ir en el repo ni en el navegador.

## Estructura

```
src/
  components/   UI (layout, map, panels, admin, ui = shadcn)
  pages/        Index (mapa), AdminCapas, Auth, …
  hooks/        Datos y estado (capas, POIs, isócronas guardadas, análisis)
  services/     Acceso a Supabase y lógica de negocio (proyección, curva de maduración…)
  utils/        Parsers (KML/KMZ/GeoJSON/CSV), exportación PDF/PPTX/PNG, helpers
  types/ data/ config/
  test/         Tests de Vitest
supabase/
  migrations/   SQL versionado
  functions/    Edge Functions (Deno) y `_shared/`
  config.toml   verify_jwt por función
scripts/        Sincronización de ventas, backtests, builds de datos (GSE, manzanas)
etl/            Pipelines Python (score Agroplanet, red comercial). Ver etl/README.md
docs/           Guías operativas
public/         Datos estáticos (comunas, GSE, manzanas, parque, crimen)
```

## Base de datos y migraciones

Las migraciones viven en `supabase/migrations/` y se aplican **a mano** sobre el proyecto
(`fmynxmxrtponfuqxmjli`), desde el SQL editor del dashboard o por la Management API. No hay
aplicación automática al hacer push.

- Escribe migraciones **idempotentes** (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`).
- Cualquier cambio destructivo (`DELETE`, `TRUNCATE`, `DROP`, `UPDATE` masivo) debe cumplir
  [`SQL_MIGRATION_GUARDRAILS.md`](./SQL_MIGRATION_GUARDRAILS.md): backup versionado, IDs
  capturados antes de borrar y conteos validados.
- Después de cambiar el esquema, regenera `src/integrations/supabase/types.ts`.
- Los roles viven en `user_roles` (`admin`, `moderator`, `user`) y las tablas de negocio usan RLS (`has_role(auth.uid(), 'admin')` para escritura de admin).

## Edge Functions

Se despliegan una a una (requiere `SUPABASE_ACCESS_TOKEN`; el CLI de Supabase instalado):

```bash
supabase functions deploy <nombre> --project-ref fmynxmxrtponfuqxmjli
```

Un `git push` **no** despliega funciones. Los secretos (claves de Gemini, API key de
exportación, etc.) viven en los secrets de Supabase, no en el repo.

| Función | Para qué |
|---|---|
| `export-sales-projection`, `export-report-slides`, `list-saved-isochrones` | API para LeaseFlow (protegida con `x-api-key`) |
| `isochrone`, `isochrone-insights` | Cálculo de isócronas y sus insights |
| `poi-insights`, `compute-poi-features`, `compute-performance-batch` | Análisis y features de la red de locales |
| `geocode-addresses` | Geocodificación de direcciones (normalizador y resolvedor en `_shared/`) |
| `sync-uf-values`, `sync-comercio-osm`, `trigger-sync` | Sincronizaciones programadas |
| `drive-distance`, `sign-urls`, `export-backup`, `gemini-key-test` | Utilidades |

> Las capas territoriales **no** pasan por una función: el asistente de importación (KMZ, KML, GeoJSON, CSV y
> HTML de mapas) lee el archivo en el navegador y lo escribe con las RPC `create_layer_import` →
> `commit_layer_import` (ver `supabase/migrations/20261014190000_layer_import.sql`). Las funciones
> `scan-territorial-html` e `ingest-territorial-html` se retiraron del repo en la Fase 5; si siguen desplegadas,
> bórralas con `supabase functions delete <nombre> --project-ref fmynxmxrtponfuqxmjli`.

## Tests y calidad

```bash
npm test                 # Vitest (src/**/*.test.ts[x])
npm run build            # debe compilar sin errores
npm run lint
```

Los tests de `supabase/functions/_shared/` son de Deno y se corren con `deno test`.
El lint arrastra deuda previa (errores `no-explicit-any` y similares): el criterio al
contribuir es **no empeorar** el conteo, no limpiarlo todo en un mismo PR.

## Automatizaciones (GitHub Actions)

- `sync_drive_sales.yml`: carga de ventas desde Google Drive. Ver `docs/sync-ventas-drive.md`.
- `sync_comercio_osm.yml`: sincronización de la red comercial (Google Places → Supabase).

## Más documentación

- [`docs/sync-ventas-local.md`](./docs/sync-ventas-local.md) y [`docs/sync-ventas-drive.md`](./docs/sync-ventas-drive.md)
- [`docs/prompt-leaseflow-business-case.md`](./docs/prompt-leaseflow-business-case.md)
- [`etl/README.md`](./etl/README.md)
- [`SQL_MIGRATION_GUARDRAILS.md`](./SQL_MIGRATION_GUARDRAILS.md)
