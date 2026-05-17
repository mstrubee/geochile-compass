# Plan: Gemini API Keys como 4ª sección colapsable en /admin/capas

## Cambios

### 1. Extraer el contenido de la página Gemini Keys a un componente reutilizable
- Crear `src/components/admin/GeminiKeysAdminSection.tsx` con todo el contenido actual de `GeminiKeysAdminPage` **sin** el wrapper de página (sin `min-h-screen`, sin botón "Volver", sin `<h1>` ni guards de auth/role — esos los maneja `AdminCapas`).
- Exporta `GeminiKeysAdminSection` que renderiza: stats, botón "Agregar nueva key", grilla de `KeyCard`, `LinksSection`, y los diálogos (`KeyDialog`, `AlertDialog`).
- Mover `KeyCard`, `KeyDialog`, `LinksSection` y `fmtDate` al nuevo archivo (o dejarlos privados dentro).

### 2. Agregar la 4ª `AdminCollapsible` en `AdminCapas.tsx`
- Después de la sección "Parque automotor" (línea 522), agregar:
  ```tsx
  <AdminCollapsible
    id="gemini-keys"
    title="Gemini API Keys"
    icon={<KeyRound className="h-4 w-4" />}
    description="Administrá las API Keys de Gemini con fallback automático y enlaces para obtener nuevas."
  >
    <GeminiKeysAdminSection />
  </AdminCollapsible>
  ```
- Importar `KeyRound` desde `lucide-react` y `GeminiKeysAdminSection`.

### 3. Revertir el header
- En `src/components/layout/Header.tsx`, restaurar el pill **Admin** como `<Link to="/admin/capas">` simple (sin dropdown).
- Eliminar imports y estado relacionados con `listGeminiLinks`, `DropdownMenu*`, `KeyRound`, `ExternalLink`, `GeminiKeyLink`.

### 4. Ruta `/admin/gemini-keys`
- Opción A (recomendada): mantener la ruta como fallback (redirige o renderiza la misma sección con wrapper mínimo). Lo más simple: dejar `GeminiKeysAdmin.tsx` como un wrapper delgado que renderiza `<GeminiKeysAdminSection />` con header "Volver".
- Esto evita romper enlaces existentes.

## Archivos afectados
- **Nuevo**: `src/components/admin/GeminiKeysAdminSection.tsx`
- **Editado**: `src/pages/AdminCapas.tsx` (agregar import + 4ª colapsable)
- **Editado**: `src/pages/GeminiKeysAdmin.tsx` (simplificar a wrapper de la sección)
- **Editado**: `src/components/layout/Header.tsx` (revertir a pill Admin simple)

## Sin cambios
- Backend (tablas, RLS, edge functions) intactos.
- Lógica de rotación de keys intacta.
