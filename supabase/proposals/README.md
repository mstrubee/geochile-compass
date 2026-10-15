# Propuestas de migración (no se aplican solas)

Todo lo que está en esta carpeta es una **propuesta**: `supabase db push` no la lee y nadie la ha
ejecutado. Para aplicar una hay que moverla a `supabase/migrations/` con una versión posterior a la última
aplicada, **con la aprobación explícita del usuario**, y cumpliendo
[`SQL_MIGRATION_GUARDRAILS.md`](../../SQL_MIGRATION_GUARDRAILS.md).

## `20261015000000_retire_legacy_layer_tables.sql` — retirar `territorial_layer_groups` y `custom_layers`

Estado: **escrita y revisada, NO ejecutada y NO probada contra la base** (no hay copia/branch en el plan Free;
tampoco se hizo una corrida con rollback, porque se pidió "sin ejecutar"). Lo único que se comprobó, solo con
`SELECT`, es que **hoy todos sus guardrails pasarían**:

| Comprobación (producción, 2026-10-15) | Resultado |
|---|---|
| Grupos sin carpeta raíz equivalente en `layer_nodes` | 0 de 13 |
| Capas cuyo `group_id` no es la raíz real de su nodo | 0 de 132 |
| Reglas de rol (`folder_layer_roles`) con grupo sin raíz | 0 de 12 |
| Archivos (`territorial_source_files`) con grupo sin nodo | 0 de 11 |
| Raíces compartidas sin `slug` en su estilo | 0 de 13 |
| Filas en `custom_layers` | 0 |
| Funciones, jobs de cron o políticas que usen lo que se borra | solo el cuerpo antiguo de `trg_layer_nodes_to_legacy`, que la migración reescribe antes |

### Orden para aplicarla

1. Mergear los PR de las fases 3, 4 y 5 y desplegar la app. Desde la Fase 5 la app **no lee ni escribe** estas
   tablas: los "grupos" del análisis salen de las carpetas raíz de `layer_nodes` (`src/utils/territorialGroups.ts`)
   y `custom_layers` ya no tiene ningún lector.
2. Comprobar en producción que el análisis de isócronas y las reglas de rol de carpetas se ven igual.
3. Aprobación del usuario.
4. Corrida de prueba **con `rollback`** (`... raise exception 'DRYRUN_OK'` al final): toma bloqueos breves sobre
   `territorial_layers`, `folder_layer_roles` y `territorial_source_files`, sin persistir nada.
5. Mover el archivo a `supabase/migrations/`, aplicarlo, registrar la versión y regenerar `src/integrations/supabase/types.ts`
   (desaparecen las dos tablas y la vista `territorial_layer_groups_active`).
6. Borrar las funciones de borde ya retiradas del repo, si siguen desplegadas:
   `supabase functions delete scan-territorial-html ingest-territorial-html --project-ref fmynxmxrtponfuqxmjli`.

### Qué cambia de verdad

- Las 3 FK que apuntaban a `territorial_layer_groups` pasan a apuntar a `layer_nodes(id)` (mismo uuid): ningún dato cambia.
- `trg_layer_nodes_to_legacy` deja de espejar carpetas raíz a grupos; para capas hace lo mismo que antes.
- Se borran `territorial_layer_groups`, su vista `_active`, `sync_layer_nodes_from_legacy`, `_layer_nodes_ensure_legacy_group`,
  `_legacy_group_style`, `_legacy_slug`, `trg_legacy_group_to_node` y `custom_layers`.
- Efecto lateral bueno: `custom_layers` tenía una política de lectura abierta a `anon`; deja de existir.
- Quedan 5 tablas de respaldo `_backup_*_retire_20261015` (RLS activa, sin acceso por la API). Conservar al menos hasta validar.

### Rollback

`20261015000000_retire_legacy_layer_tables_down.sql` recrea las dos tablas desde los respaldos, restaura funciones,
triggers y FK, y crea el grupo de las carpetas raíz que se hayan agregado después. Solo sirve mientras existan los respaldos.

### Lo que esta propuesta NO hace (decisiones aparte)

- Retirar los triggers `trg_legacy_layer_*` de `territorial_layers` (espejo capa antigua → nodo): ya nadie escribe esa tabla
  desde la app, pero pueden quedar escritores externos (scripts, SQL a mano); conviene revisarlo antes.
- Borrar `territorial_layers.parent_layer_id` y su trigger de profundidad.
- Borrar `territorial_source_files` y el bucket `territorial-sources`: el diálogo de georreferenciar todavía los usa.
