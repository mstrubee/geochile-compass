# Problema

Los POIs no cargan porque las consultas hacen **timeout** en Postgres (`code: 57014`, "canceling statement due to statement timeout").

**Diagnóstico (BD real):**
- 2006 POIs activos, 0 en papelera, 1 usuario.
- Índices existentes: solo `user_id`, `source_layer`, `folder_id`, `deleted_at` por separado.
- La query actual hace `ORDER BY created_at DESC, id ASC` con filtros sobre `user_id` (RLS) + `deleted_at IS NULL`, sin índice que cubra ese plan → sort completo en cada página → timeout.
- Además se hidrata trayendo **TODAS** las columnas (incluido `properties` JSON y `icon` que puede ser data URL gigante de KMZ), multiplicando el costo.

# Solución

## 1. Migración SQL — índice compuesto que sirva el orden

```sql
-- Índice para POIs activos del usuario, ordenados por fecha
CREATE INDEX IF NOT EXISTS idx_pois_user_active_created
  ON public.pois (user_id, created_at DESC, id)
  WHERE deleted_at IS NULL;

-- Índice para la papelera del usuario
CREATE INDEX IF NOT EXISTS idx_pois_user_trashed_deleted
  ON public.pois (user_id, deleted_at DESC, id)
  WHERE deleted_at IS NOT NULL;
```

Esto convierte el `ORDER BY` + filtros en un index scan directo, eliminando el sort completo y el timeout.

## 2. `src/hooks/useSavedPois.ts` — carga en dos fases

Cambiar la estrategia de fetch para reducir drásticamente el payload por página:

- **Fase A (ligera, rápida)**: traer solo columnas necesarias para pintar el mapa: `id, name, color, icon, lat, lng, folder_id, source_layer, category, created_at`. Sin `properties` (puede ser JSON pesado) ni `description`. Esto permite renderizar markers casi al instante.
- **Fase B (en background)**: una vez pintado, traer `properties` y `description` por lotes para enriquecer (solo cuando se abre un popup, o lazy en background).

Adicional:
- Bajar `PAGE` de 1000 → **500** para que cada request termine bien dentro del límite.
- Mantener el caché IndexedDB existente (ya hidrata instantáneo en recargas).

## 3. (Opcional, no rompedor) `SavedPoi` type

Hacer `description` y `properties` opcionales en el tipo para soportar la fase ligera sin romper consumidores. Los componentes que ya los usan (popups, manager dialog) ya manejan ausencia con `?.`.

# Archivos a modificar

- **Nueva migración**: índices compuestos parciales (arriba).
- `src/hooks/useSavedPois.ts`: split de fetch en fase ligera + enriquecimiento; PAGE=500.
- `src/types/pois.ts`: marcar `description` / `properties` opcionales si hace falta para tipar la fase ligera.

# Resultado esperado

- Los 2006 POIs cargan sin timeout.
- Tiempo de aparición de markers en el mapa: < 1s (fase ligera + caché local).
- La papelera y los detalles completos siguen disponibles, solo cargan después.
