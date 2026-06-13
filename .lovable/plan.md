## Problema

El sidebar de "Red Comercial Nacional" arma un árbol de carpetas/categorías/marcas. El hook `useComercialFolders` apunta a tres tablas en Supabase, pero **dos no existen en la base de datos**:

- `comercial_carpetas` → no existe
- `comercial_cat_overrides` → no existe
- `comercial_marca_overrides` → ✅ existe

Resultado: las carpetas y los movimientos de categorías hoy solo viven en `localStorage`. Si el usuario cambia de navegador, limpia caché o entra desde otro equipo, **pierde toda la organización y el orden**. Además, las consultas no usan `ORDER BY`, así que el orden de hermanos no es estable ni reproducible.

También hay que quitar el botón "Restaurar orden" del pie del panel.

## Solución

### 1. Backend — crear tablas faltantes y agregar `sort_order`

Migración Supabase:

- **`comercial_carpetas`** (nueva):
  - `id uuid PK default gen_random_uuid()`
  - `user_id uuid → auth.users ON DELETE CASCADE`
  - `nombre text NOT NULL`
  - `parent_id uuid NULL` (carpeta padre; null = raíz o categoría padre vía override)
  - `sort_order int NOT NULL default 0`
  - `created_at`, `updated_at` con trigger
  - Índice `(user_id, parent_id, sort_order)`
- **`comercial_cat_overrides`** (nueva):
  - PK `(user_id, cat)`
  - `parent_id text NULL`, `sort_order int NOT NULL default 0`
- **`comercial_marca_overrides`** (existente):
  - `ALTER TABLE ADD COLUMN sort_order int NOT NULL default 0`

Cada tabla con: `GRANT` a `authenticated` + `service_role`, RLS habilitado y política única `"<tabla>_own"` con `auth.uid() = user_id` (USING y WITH CHECK).

### 2. Hook `useComercialFolders.ts`

- Fetch con `.order("sort_order", { ascending: true }).order("created_at")`.
- En `createFolder` / `moveFolderTo` / `moveCatTo` / `moveBrandTo`: calcular `sort_order = max(sort_order del nuevo parent) + 1` y persistirlo.
- El `backfillTree` actual ya re-siembra desde localStorage cuando faltan filas → extenderlo para incluir `sort_order` derivado del orden actual del array. Así la organización existente en localStorage queda guardada en DB en la primera carga post-migración (sin pérdida).
- Quitar `resetTree` del retorno público (ya no se usa).

### 3. UI — `ComercialPOISection.tsx`

- Eliminar el bloque del botón "Restaurar orden" (líneas 1096-1106) y el import de `RotateCcw`.
- Quitar uso de `resetTree` y de `isCustomized`.

### 4. Verificación

- Crear carpeta → recargar → sigue ahí, en la misma posición.
- Mover categoría dentro de una carpeta → recargar → conserva posición.
- Confirmar que el pie del panel ya no muestra el botón.

## Notas técnicas

- No se agrega UI nueva de "reordenar hermanos" (drag entre hermanos): el DnD actual sigue siendo solo reparentar. El `sort_order` garantiza que el orden de creación / movimiento se preserve de forma determinística.
- La migración es idempotente (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DO $$ ... CREATE POLICY IF NOT EXISTS` patrón).
- `localStorage` se conserva como respaldo defensivo (ya existente) por si la DB falla.
