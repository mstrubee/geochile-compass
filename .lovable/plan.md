## Problema

El error "viola nuevas políticas de rol" al subir archivos viene de las policies del bucket `storage.objects` para `territorial-sources`. Estas siguen referenciando `public.has_role`, pero en la migración previa movimos la función a `private.has_role` y revocamos acceso a la versión pública. Resultado: la verificación de admin falla en el INSERT a storage y el upload es rechazado.

## Plan

Migración SQL única que recrea las 4 policies del bucket `territorial-sources` en `storage.objects` apuntando a `private.has_role`:

1. `DROP POLICY` de las 4 actuales (SELECT, INSERT, UPDATE, DELETE).
2. `CREATE POLICY` equivalentes usando `private.has_role(auth.uid(), 'admin'::app_role)`.
3. Asegurar `GRANT USAGE ON SCHEMA private TO authenticated` y `GRANT EXECUTE ON FUNCTION private.has_role TO authenticated` (idempotente, por si acaso).

No se tocan tablas ni código frontend.

## Verificación

Tras aplicar la migración, recargar `/admin/capas` y reintentar subir un archivo. El upload al bucket y el insert a `territorial_source_files` deben funcionar.
