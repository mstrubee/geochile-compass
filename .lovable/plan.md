## Problema

Al guardar la importación de Excel, el INSERT en `poi_import_jobs` devuelve 403 con:

```
permission denied for function has_role
```

Las políticas RLS de las 5 tablas del módulo de ventas (`poi_import_jobs`, `poi_metrics`, `poi_attributes`, `poi_address_aliases`, `poi_folder_schemas`) llaman a `public.has_role(...)`, pero el rol `authenticated` no tiene `EXECUTE` sobre esa función. Por eso PostgREST aborta antes de evaluar la política.

Tu usuario sí tiene `role='admin'` en `public.user_roles`, así que es puramente un tema de permisos sobre la función.

## Solución (1 migración SQL)

Otorgar EXECUTE sobre `public.has_role` a los roles que la necesitan:

```sql
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role)
  TO authenticated, anon, service_role;
```

Esto desbloquea los INSERT/UPDATE/DELETE en las 5 tablas del módulo de ventas para administradores. No cambia ninguna política, ni el código frontend, ni los datos existentes.

## Verificación

Después de aplicar:
1. Reintentar la importación → el POST a `poi_import_jobs` debe devolver 201.
2. Las métricas y atributos se escriben con los upserts ya implementados.
3. El detalle del POI mostrará el gráfico con los datos cargados.

No se requieren cambios de código.
