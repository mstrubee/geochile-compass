## Objetivo

Reemplazar los `window.confirm` / `window.prompt` nativos del flujo de conversión HTML → GeoJSON (y la eliminación de archivos/capas) por diálogos modernos y amigables, alineados al diseño del sistema, y pulir el `UploadDialog` existente.

## Cambios propuestos

### 1. Nuevo componente `ConvertHtmlDialog` (`src/components/admin/ConvertHtmlDialog.tsx`)

Diálogo único que cubre las 3 fases hoy resueltas con `confirm` + `prompt`:

- **Estado "confirmar"**: muestra resumen del archivo origen (nombre, tamaño, grupo) + nombre destino sugerido `<base>.geojson`. Botón primario "Convertir y guardar".
- **Estado "conflicto"** (cuando ya existe ese nombre): tarjeta destacada con icono de alerta y dos opciones grandes seleccionables (radio cards):
  - Reemplazar archivo existente (con timestamp del actual).
  - Guardar con un nombre nuevo → input editable precargado con sufijo de fecha.
- **Estado "procesando"**: spinner + mensaje ("Descargando…", "Parseando…", "Subiendo…").
- **Estado "éxito"**: resumen (features detectadas, grupos, tamaño) + botón "Cerrar".

Toda la lógica de `convertFileToGeoJson` se mueve a este componente (recibe `file` y `onDone`). Usa `Dialog`, `RadioGroup`, `Input`, `Button`, iconos de lucide y tokens semánticos.

### 2. Diálogos de confirmación de borrado

Reemplazar los dos `window.confirm` (eliminar capa y eliminar archivo) por `AlertDialog` (shadcn) con:

- Título claro, descripción con el nombre del recurso.
- Botón destructivo (`variant="destructive"`) "Eliminar".
- Botón "Cancelar".

Implementado vía un pequeño hook/estado local `confirmTarget` para no duplicar markup.

### 3. Pulido del `UploadDialog` existente

- Header con icono `Upload`, título y subtítulo descriptivo.
- Stepper visual (1. Archivo · 2. Grupo & opciones · 3. Resultado) con estados activo/completado.
- Drop-zone estilizado (borde dasheado, hover, archivo seleccionado con badge y tamaño).
- Sección "Opciones avanzadas" colapsable (`Collapsible`) para `DedupStrategy` y selector de grupo, con descripciones cortas.
- Footer consistente con `DialogFooter`, botones alineados, primario con icono.
- Mensajes de error en `Alert` destructivo en vez de toast suelto cuando aplica al formulario.

### 4. Detalles de diseño compartidos

- Usar tokens: `bg-card`, `border-border`, `text-muted-foreground`, `bg-destructive/10`, etc. Sin colores hardcodeados.
- Tipografía: títulos `text-base font-semibold`, descripciones `text-sm text-muted-foreground`.
- Espaciado consistente (`space-y-4`), bordes `rounded-lg`, sombras suaves.
- Animaciones por defecto de Radix (ya incluidas).
- Iconos lucide pequeños (h-4 w-4) acompañando títulos y acciones.

## Archivos a modificar / crear

- **Crear**: `src/components/admin/ConvertHtmlDialog.tsx`
- **Crear**: `src/components/admin/ConfirmDeleteDialog.tsx` (reutilizable, basado en `AlertDialog`)
- **Editar**: `src/pages/AdminCapas.tsx`
  - Remover `convertFileToGeoJson`, `window.confirm`, `window.prompt`.
  - Integrar `ConvertHtmlDialog` y `ConfirmDeleteDialog` con estado local.
  - Refinar markup del `UploadDialog` (mismo archivo).

## Notas técnicas

- No se modifica lógica de parseo (`htmlToGeoJson`) ni el esquema de datos.
- No se tocan edge functions ni RLS.
- Toda la interacción sigue dentro de `/admin/capas`; sin nuevas rutas.
