## Objetivo

Extender la sección **Admin · Capas Territoriales** (`/admin/capas`) para que soporte la carga de capas en cuatro formatos: **GeoJSON, HTML, KML y KMZ**, manteniendo la lógica actual (sincronización con Google Drive, deduplicación, exclusión de capas, hasta 1GB).

## Alcance

- Mismo flujo: subir → escanear → elegir capas/dedup → procesar.
- Mismas tablas (`territorial_layer_groups`, `territorial_layers`, `territorial_features`, `territorial_source_files`).
- Mismo bucket `territorial-sources`.
- Misma sincronización a Google Drive del archivo original.

## Cambios en base de datos

Migración mínima sobre `territorial_source_files`:

- Agregar columna `file_type text not null default 'html'` con check `('html','geojson','kml','kmz')`.
- Ampliar `content_type` permitido en el bucket (no requiere migración, sólo en el cliente).

## Edge functions

### `scan-territorial-html` → renombrar conceptualmente a `scan-territorial-source`

Una sola función que recibe `{ source_file_id }` y, según `file_type` guardado, ejecuta el parser adecuado:

- **html**: parser actual (KML embebido + arrays JS).
- **geojson**: `JSON.parse` del archivo, agrupa features por `properties.layer` o `properties.folder` o un único bucket "default" si no hay agrupación. Reporta `{name, count, sample}`.
- **kml**: parser actual de `<Folder>/<Placemark>` aplicado al XML directo.
- **kmz**: descomprime con `JSZip` (npm), busca `doc.kml` (o el primer `.kml`), aplica parser KML.

Devuelve la misma estructura: `{ layers: [{ name, count }] }`.

### `ingest-territorial-html` → idem, multi-formato

- Lee `file_type` y reutiliza el parser correspondiente.
- El resto del pipeline (insert por chunks, bbox, dedup `replace_layer | merge_external_id | merge_coords_name`, subida a Google Drive) se mantiene igual.
- Para **kmz**, el archivo subido a Drive es el `.kmz` original (binario); para los demás, el archivo de texto tal cual.

## Frontend (`AdminCapas.tsx`)

### Diálogo de carga

- `Input type="file"` con `accept=".html,.htm,.geojson,.json,.kml,.kmz,application/json,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz,text/html"`.
- Detectar `file_type` a partir de la extensión y/o MIME al elegir el archivo. Mostrar un badge con el tipo detectado.
- Pasar `file_type` al insert de `territorial_source_files` y al `contentType` del upload a Storage.
- Renombrar el botón de "Cargar HTML" a **"Cargar capa"**, con icono genérico.
- Texto de ayuda: "Formatos aceptados: GeoJSON, HTML, KML, KMZ. Hasta 1GB."

### Resto del flujo

Sin cambios visuales: el escaneo, la tabla de capas detectadas, la exclusión y la elección de estrategia de dedup funcionan igual para los cuatro formatos.

## Detalles técnicos

```text
Archivo elegido
   │
   ▼
extensión → file_type (html | geojson | kml | kmz)
   │
   ▼
Storage upload (territorial-sources/<ts>-<name>)
   │
   ▼
INSERT territorial_source_files {file_type, ...}
   │
   ▼
scan-territorial-source  ──► parser(file_type)  ──► [{name,count}]
   │
   ▼ (usuario marca exclusiones + dedup)
ingest-territorial-source ──► parser(file_type) ──► insert features + Drive upload
```

Dependencia nueva en edge functions: `npm:jszip@3` (sólo se importa cuando `file_type === 'kmz'`).

## Fuera de alcance

- Edición individual de features.
- Sincronización inversa Drive → app.
- Soporte de Shapefile / GPX (se puede agregar después siguiendo el mismo patrón).