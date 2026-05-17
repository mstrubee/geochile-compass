# Plan: Reubicar y arreglar "Obtener más API Keys"

## Problema actual
1. El botón "Obtener más API Keys" está en el header como dropdown independiente, fuera del área Admin.
2. Al presionarlo no responde (el `DropdownMenuTrigger` se renderiza sin clase compatible y/o el menú no abre por z-index del header o falta de portal correcto; además, si `links` está vacío sólo muestra "Sin enlaces configurados", dando la sensación de que "no hace nada").
3. La carga de `listGeminiLinks` depende de `isAdmin` desde `useUserRole`, que es async — si el dropdown se renderiza antes, queda vacío.

## Cambios

### 1. Quitar el botón independiente del Header
- En `src/components/layout/Header.tsx`, eliminar el bloque `<DropdownMenu>` actual con el trigger "Obtener más API Keys".
- Mantener únicamente el botón pill **Admin** (link a `/admin/capas`) visible cuando `isAdmin`.

### 2. Convertir "Admin" en un menú desplegable
- Reemplazar el `<Link to="/admin/capas">` por un `DropdownMenu` con trigger pill "Admin" (mismo estilo actual, ícono `Shield`).
- Contenido del menú:
  - **Capas territoriales** → `/admin/capas`
  - **Gemini API Keys** → `/admin/gemini-keys`
  - Separador
  - **Label**: "Generar nuevas Gemini API Keys"
  - Lista dinámica de `links` desde `listGeminiLinks()`
    - Cada item es un `<a target="_blank" rel="noopener noreferrer">` que abre en nueva pestaña.
    - Si no hay links: item deshabilitado "Sin enlaces configurados — agregar en Gemini Keys".

### 3. Arreglar el click / apertura
- Asegurar `DropdownMenuContent` con `align="end"` y `className="z-[1100]"` (el header usa `z-[1000]`, el portal de Radix debe quedar por encima).
- Cargar `listGeminiLinks` dentro de un `useEffect` que se vuelva a disparar cuando `isAdmin` cambie a `true` (ya existe, se conserva).
- Envolver el trigger en un `<button>` o usar `asChild` correctamente para que el evento click llegue. El trigger actual ya es clickeable; el bug visual probablemente sea por z-index del portal.

### 4. Sin cambios de backend
- No se tocan tablas, RLS, ni edge functions.
- `matiasstrube@gplanet` ya es admin según el sistema de roles existente (`user_roles`), no requiere migración.

## Archivos afectados
- `src/components/layout/Header.tsx` (única edición)

## Resultado esperado
- Un solo pill "Admin" en el header.
- Al hacer click despliega: accesos a paneles admin + enlaces externos para generar nuevas API Keys (abren en pestaña nueva).
- El click responde inmediatamente; el menú se ve por encima del header.
