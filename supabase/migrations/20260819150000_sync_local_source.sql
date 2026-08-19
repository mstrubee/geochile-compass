-- Permite que la sincronización automática lea el Excel desde un archivo LOCAL
-- (en el computador de quien corre el script) además de Google Drive.
--
-- Diferencia importante: GitHub Actions corre en la nube y no ve archivos
-- locales, así que el modo 'local' solo funciona corriendo el script en la
-- máquina que tiene el archivo (a mano, o agendado con launchd en macOS).
-- Ver docs/sync-ventas-local.md.

alter table public.drive_sync_state
  add column if not exists source_type text not null default 'drive',
  add column if not exists local_path text;

-- En modo local no hay archivo de Drive que identificar.
alter table public.drive_sync_state
  alter column drive_file_id drop not null;

alter table public.drive_sync_state
  drop constraint if exists drive_sync_state_source_check;
alter table public.drive_sync_state
  add constraint drive_sync_state_source_check check (
    (source_type = 'drive' and drive_file_id is not null) or
    (source_type = 'local' and local_path is not null)
  );

comment on column public.drive_sync_state.source_type is
  'drive = archivo en Google Drive (lo puede correr GitHub Actions). local = archivo en el computador (solo corriendo el script en esa máquina).';
comment on column public.drive_sync_state.local_path is
  'Ruta absoluta del archivo cuando source_type = local.';
comment on column public.drive_sync_state.last_modified_time is
  'Detector de cambios: modifiedTime de Drive, o mtime del archivo local. Si no varió, la corrida no hace nada.';
