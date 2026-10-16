-- ROLLBACK de 20261016120000_layer_icons_bucket.sql. Quita las políticas del bucket
-- `layer-icons`. El bucket y sus archivos NO se borran aquí (Supabase no permite borrar
-- un bucket con archivos por SQL): vacíalo y bórralo desde Storage si de verdad lo quieres fuera.
-- Los estilos que usaban un ícono de la biblioteca quedarían apuntando a una URL sin acceso.
drop policy if exists "layer-icons_delete_admin" on storage.objects;
drop policy if exists "layer-icons_insert_auth" on storage.objects;
drop policy if exists "layer-icons_select_public" on storage.objects;
