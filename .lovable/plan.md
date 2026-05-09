
# "Continuar" debe retomar sin re-subir el archivo

## Por qué hoy obliga a re-subir

El botón "Continuar" del historial es en realidad un `<input type="file">` disfrazado. La aplicación nunca guarda el Excel original ni el snapshot de filas, así que la única forma de regenerar la vista de revisión es que el usuario vuelva a elegir el archivo desde su disco.

## Cambios

### 1. Guardar el Excel en storage al subirlo
- Crear un bucket privado `poi-imports` con RLS: lectura/escritura sólo para admins.
- En `usePoiImport.parse(file)`, además de parsear, subir el archivo a `poi-imports/{folder_id}/{uuid}.xlsx` y memorizar la ruta en estado.
- Al hacer commit, persistir esa ruta en una nueva columna `poi_import_jobs.source_file_path text`.

### 2. Mostrar "Continuar" sólo cuando hay archivo recuperable
- En el listado de imports, si `source_file_path` existe, el botón "Continuar" descarga el archivo desde storage, lo parsea y dispara matching (la nueva memoria de identidad + aliases hará que las filas ya resueltas vuelvan automáticas, y las pendientes queden listas para revisión).
- Si no hay `source_file_path` (jobs antiguos), el botón cae al comportamiento actual (input de archivo) para no romper compatibilidad.

### 3. Etiqueta y tooltip
- Cambiar el tooltip a "Retomar la revisión usando el archivo original guardado".
- Quitar el `<input type="file">` cuando el job ya tiene archivo en storage.

### 4. Limpieza al borrar un import
- En `handleDeleteJob`, si el job tiene `source_file_path`, borrar también el objeto del bucket.

## Detalles técnicos

- Migración: `ALTER TABLE poi_import_jobs ADD COLUMN source_file_path text`. Bucket `poi-imports` con políticas: SELECT/INSERT/DELETE sólo si `has_role(auth.uid(),'admin')`.
- `usePoiImport`:
  - Nueva función `resumeFromStorage(jobId, path, filename)` que descarga (`supabase.storage.from('poi-imports').download(path)`), construye un `File`, llama a `parse`, y luego `runMatching`.
  - `parse` upsubre el archivo (no bloqueante respecto del parseo) y guarda `sourceFilePath` en estado.
  - `commit` incluye `source_file_path` al insertar/actualizar el job.
- `PoiImportDialog`:
  - El render del item de historial usa un `<button>` real cuando `j.source_file_path` está presente, llamando a `imp.resumeFromStorage(j.id, j.source_file_path, j.filename)`.

## Resultado

Tras un import (terminado o no), el usuario presiona "Continuar" y vuelve directo a la pantalla de revisión con todas las filas, sin tocar su disco. Las que ya estaban asignadas siguen marcadas como `alias_matched`/`auto_matched` gracias a la memoria de identidad y los aliases existentes.
