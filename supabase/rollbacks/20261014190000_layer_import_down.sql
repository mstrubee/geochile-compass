-- =============================================================================
-- ROLLBACK de la Fase 4 (20261014190000_layer_import.sql)
-- =============================================================================
-- Quita las tablas de lotes/staging/cambios, las RPC del importador y el job de limpieza.
-- Lo que las importaciones ya crearon (carpetas, capas y puntos) son datos normales del
-- árbol y NO se tocan.
--
-- Perder `territorial_import_changes` significa perder el "deshacer" de las importaciones de
-- los últimos 30 días, así que se niega si hay lotes confirmados. Para forzarlo a sabiendas:
--   set local layer_import.force_down = 'on';
-- =============================================================================
select pg_advisory_xact_lock(hashtext('layer_nodes_v1'));
set local statement_timeout = '5min';

do $$
declare v_n int;
begin
  if to_regclass('public.territorial_import_batches') is not null
     and coalesce(current_setting('layer_import.force_down', true), '') <> 'on' then
    select count(*) into v_n from public.territorial_import_batches where status = 'committed';
    if v_n > 0 then
      raise exception 'Guardrail: hay % importaciones confirmadas con su registro de deshacer; borrarlo las vuelve irreversibles. Para forzar: set local layer_import.force_down = ''on''', v_n;
    end if;
  end if;
end $$;

insert into public._migration_log (sprint, notes) values ('layer_import_v1_down', 'start');

do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge-layer-import-data') then
    perform cron.unschedule('purge-layer-import-data');
  end if;
end $$;

drop function if exists public.revert_layer_import(uuid);
drop function if exists public.commit_layer_import(uuid, text, uuid, text[]);
drop function if exists public.preview_layer_import(uuid, text, uuid, text[]);
drop function if exists public.discard_layer_import(uuid);
drop function if exists public.finish_layer_import_staging(uuid);
drop function if exists public.create_layer_import(text, text, jsonb, int);
drop function if exists public.layer_import_limits();
drop function if exists public.purge_layer_import_data();
drop function if exists public._import_create_nodes(uuid, jsonb, uuid, text[], boolean);
drop function if exists public._import_build_diff(uuid, uuid, text[]);
drop function if exists public._import_lock_batch(uuid);
drop function if exists public._import_safe_color(text);
drop function if exists public._import_safe_icon(text);
drop function if exists public._import_validate_structure(jsonb, int);
drop function if exists public._import_layers(jsonb, text[], text[]);
drop function if exists public._import_assert_admin();
drop function if exists public._import_row_cap();

drop table if exists public.territorial_import_changes;
drop table if exists public.territorial_import_staging;
drop table if exists public.territorial_import_batches;

insert into public._migration_log (sprint, notes) values ('layer_import_v1_down', 'done');
