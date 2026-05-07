
# Plan: Capas Territoriales "Talleres" + Admin de carga

## 1. Modelo de datos (Lovable Cloud)

Tres tablas nuevas + 1 bucket de Storage + conector Google Drive.

### Tablas

- **`territorial_layer_groups`** — agrupador padre tipo "Talleres"
  - `name`, `slug`, `color`, `icon`, `order_index`, `visible_default`
- **`territorial_layers`** — cada sub-capa encendible (un "taller")
  - `group_id` → groups
  - `name`, `color`, `icon`, `order_index`, `source_file_id` (nullable), `feature_count`, `bbox`
- **`territorial_features`** — geometrías de cada capa
  - `layer_id`, `external_id` (id estable extraído del HTML, para deduplicar), `geometry` (jsonb GeoJSON), `properties` (jsonb), `name`, `lat`, `lng`
  - Índice único `(layer_id, external_id)` para detectar duplicados en re-cargas
  - Índice GIN sobre `properties` y btree sobre `(layer_id)`
- **`territorial_source_files`** — historial de archivos cargados
  - `original_filename`, `size_bytes`, `storage_path`, `gdrive_file_id`, `uploaded_by`, `uploaded_at`, `processed_at`, `status` (pending/processing/done/error), `error`, `excluded_layers` (jsonb), `dedup_strategy` (`replace_layer` | `merge_external_id` | `merge_coords_name`), `layers_summary` (jsonb)

### RLS

- Lectura: cualquier usuario autenticado (las capas son contenido global del proyecto).
- Escritura/upload: solo rol `admin` (tabla `user_roles` con enum `app_role`, función `has_role` security definer — patrón estándar).

### Storage

- Bucket privado **`territorial-sources`** para guardar el HTML crudo (hasta 1GB) antes de procesarlo.

## 2. Pipeline de carga del HTML

Flujo en dos pasos para soportar archivos grandes y permitir excluir capas:

```text
[Admin UI]
   │  1. Sube HTML al bucket (upload directo, resumable)
   ▼
[edge: scan-territorial-html]
   │  2. Lee por streaming, lista las capas detectadas
   │     y devuelve resumen: [{layer_name, feature_count, sample}]
   ▼
[Admin UI]
   │  3. Admin marca qué capas excluir y elige estrategia de dedup:
   │     - Reemplazo total (default) → borra features de la capa y reinserta
   │     - Merge por external_id    → upsert por (layer_id, external_id)
   │     - Merge por coords+nombre  → match aproximado
   ▼
[edge: ingest-territorial-html]
   │  4. Procesa por streaming, inserta features en lotes de ~1000.
   │  5. Sube copia del HTML a Google Drive vía conector (carpeta dedicada).
   │  6. Marca source_file como `done` con resumen.
   ▼
[BD pobladas → frontend lee y dibuja]
```

### Parseo del HTML

Asumimos HTML tipo Leaflet/My Maps con bloques `L.geoJson({...})`, `var pts = [...]` o KML embebido. La edge function:
- Hace stream del archivo desde Storage.
- Detecta bloques candidatos por regex y los parsea como JSON / KML.
- Cada bloque → un `territorial_layer` (nombre extraído del HTML o del nombre de variable).
- Calcula `bbox` y `feature_count`.

Si el formato no encaja, `status=error` con detalle, sin tocar capas existentes.

### Google Drive

- Conector **Google Drive** (cuenta del dev) ya disponible vía `standard_connectors--connect`.
- La edge function `ingest-territorial-html` sube el HTML a una carpeta `Lovable/GeoPlanet/territorial-sources/` con el nombre `<timestamp>__<original>.html`.
- Guardamos `gdrive_file_id` en `territorial_source_files` para auditoría / restauración.

## 3. Frontend

### Sidebar — sección "Talleres" (capa territorial padre)

Reusa `SidebarSection` existente:

```text
[▼] Talleres                    [☑] ← toggle padre (encender/apagar todas)
     ├ [☐] Taller A
     ├ [☑] Taller B
     └ [☐] Taller C
```

- Sub-botones colapsados por defecto (el `SidebarSection` ya persiste estado).
- Toggle padre con 3 estados: todas off / mixto / todas on. Click enciende o apaga todas.
- Cada sub-toggle controla visibilidad de su `territorial_layer`.
- Se renderiza dinámicamente: una sección por cada `territorial_layer_group`. "Talleres" es solo el primer grupo seedeado, pero el modelo soporta crear otros grupos en el futuro.

### Mapa

- Nueva capa `<TerritorialLayersLayer />` en `MapView.tsx`.
- Carga los features de las capas visibles desde `territorial_features` (filtro por viewport + `layer_id IN (...)`).
- Cada layer pinta con su `color`/`icon`.
- Hook `useTerritorialLayers()` con cache + realtime opcional.

### Admin → "Capas Territoriales"

Ruta nueva `/admin/capas` (gateada por rol `admin`).

- Lista de grupos (Talleres, etc.) con CRUD básico (nombre, color, orden).
- Lista de capas dentro de cada grupo: nombre, color, conteo de features, último archivo fuente, botón eliminar.
- **Botón "Cargar archivo HTML"** → abre dialog:
  1. Drop zone (acepta hasta 1GB, upload resumable a Storage).
  2. Tras subir, llama a `scan-territorial-html`.
  3. Muestra tabla de capas detectadas con checkbox por capa (default: todas incluidas).
  4. Selector de estrategia de dedup.
  5. Botón "Procesar" → llama a `ingest-territorial-html`, muestra progreso (polling al `status` del `source_file`).
- Sección "Historial" con lista de `territorial_source_files` y enlace al archivo en Drive.

## 4. Edge functions

- **`scan-territorial-html`** — input `{ source_file_id }`. Lee Storage por stream, devuelve `{ layers: [{name, count, sample}] }`.
- **`ingest-territorial-html`** — input `{ source_file_id, excluded_layers, dedup_strategy }`. Procesa, inserta en BD, sube a Drive, actualiza `status`. Verify JWT + role admin.

Ambas con CORS estándar y validación con Zod.

## 5. Pasos de implementación (orden)

1. Migración: tablas + enum `app_role` + tabla `user_roles` + función `has_role` + RLS + bucket `territorial-sources`.
2. Conectar Google Drive (tool `standard_connectors--connect`).
3. Edge function `scan-territorial-html`.
4. Edge function `ingest-territorial-html`.
5. Hook `useTerritorialLayers` + componente `TerritorialLayersLayer`.
6. Render dinámico de la sección "Talleres" en `Sidebar.tsx` con toggle padre.
7. Página `/admin/capas`: lista, dialog de carga, historial.
8. Asignar rol `admin` a tu usuario (vía SQL `insert`).

## Detalles técnicos

- **Dedup "reemplazo total"**: en la transacción de ingest, `DELETE FROM territorial_features WHERE layer_id = $1` antes del bulk insert.
- **Dedup "merge por external_id"**: `INSERT … ON CONFLICT (layer_id, external_id) DO UPDATE`.
- **Dedup "merge por coords+nombre"**: query previa por `(layer_id, round(lat,6), round(lng,6), name)`; los nuevos sobrescriben, los no-coincidentes se insertan.
- **Streaming 1GB**: el upload va directo Storage → edge function lee con `fetch(storageUrl)` y `ReadableStream`. Nunca cargamos el HTML completo en memoria del browser; el browser solo sube el blob.
- **Toggle padre tri-estado**: derivado de `subLayers.every(visible)` / `subLayers.some(visible)`.
- **Tipos**: `src/types/territorial.ts` con `TerritorialGroup`, `TerritorialLayer`, `TerritorialFeature`.
- **Performance**: índice `(layer_id)` + carga por viewport (bbox query) cuando una capa supera N features.
- **Google Drive**: usamos el endpoint multipart upload del gateway; guardamos `gdrive_file_id` para futura "sincronización" (re-descargar si el archivo en BD se perdió).

## Fuera de alcance (para confirmar después)

- Sincronización inversa Drive → app (si subís un HTML directo a Drive sin pasar por la app). Lo planificamos en una segunda iteración si lo necesitás.
- Edición visual de features individuales desde admin.
