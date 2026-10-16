-- =============================================================================
-- Biblioteca compartida de íconos PNG para carpetas y capas.
-- =============================================================================
-- Los íconos que se suben desde "Editar estilo" quedan en el bucket público
-- `layer-icons` y los ve cualquier carpeta o capa del sistema (la biblioteca es
-- la lista del bucket: no hay tabla). Solo PNG, hasta 512 KB cada uno.
--
--   * Ver: cualquiera (el mapa usa la URL pública como ícono del marcador).
--   * Subir: usuarios autenticados (igual que `brand-logos`).
--   * Borrar: solo administradores.
--
-- Solo agrega un bucket y sus políticas: no toca ninguna tabla ni dato existente.
-- Idempotente. Rollback: supabase/rollbacks/20261016120000_layer_icons_bucket_down.sql
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('layer-icons', 'layer-icons', true, 524288, array['image/png'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "layer-icons_select_public" on storage.objects;
create policy "layer-icons_select_public"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'layer-icons');

drop policy if exists "layer-icons_insert_auth" on storage.objects;
create policy "layer-icons_insert_auth"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'layer-icons');

drop policy if exists "layer-icons_delete_admin" on storage.objects;
create policy "layer-icons_delete_admin"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'layer-icons' and public.has_role(auth.uid(), 'admin'::public.app_role));
