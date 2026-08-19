-- Arregla el guard de restore_import_snapshot.
--
-- La versión anterior exigía has_role(auth.uid(), 'admin'), que es correcto
-- cuando se la llama por RPC desde la app (ahí auth.uid() es el usuario), pero
-- la vuelve inusable desde el editor SQL de Supabase o desde un script con
-- service_role: en esos contextos auth.uid() es NULL y el guard rechazaba
-- siempre — justo el escenario documentado para revertir una importación.
--
-- Ahora acepta: admin autenticado por la app, O una conexión privilegiada
-- (postgres / service_role / supabase_admin), que ya implica acceso total a la
-- base de todos modos.
create or replace function public.restore_import_snapshot(p_job_id uuid)
returns table (restored integer, deleted integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restored integer := 0;
  v_deleted integer := 0;
  v_privileged boolean;
begin
  v_privileged := current_user in ('postgres', 'service_role', 'supabase_admin');

  if not (v_privileged or has_role(auth.uid(), 'admin'::app_role)) then
    raise exception 'solo un admin puede revertir una importación';
  end if;

  -- Métricas que existían antes: volver al valor anterior.
  with upd as (
    update poi_metrics m
       set value = s.old_value, updated_at = now()
      from poi_metrics_snapshots s
     where s.job_id = p_job_id
       and s.existed_before
       and m.poi_id = s.poi_id
       and m.metric_key = s.metric_key
       and m.period = s.period
    returning 1
  ) select count(*) into v_restored from upd;

  -- Métricas que esta corrida creó: borrarlas.
  with del as (
    delete from poi_metrics m
     using poi_metrics_snapshots s
     where s.job_id = p_job_id
       and not s.existed_before
       and m.poi_id = s.poi_id
       and m.metric_key = s.metric_key
       and m.period = s.period
    returning 1
  ) select count(*) into v_deleted from del;

  update poi_import_jobs
     set status = 'reverted', error = coalesce(error, '') || ' [revertido]'
   where id = p_job_id;

  return query select v_restored, v_deleted;
end;
$$;

comment on function public.restore_import_snapshot(uuid) is
  'Revierte una importación: restaura los valores sobrescritos y borra las métricas que esa corrida creó. Admin desde la app, o conexión privilegiada (editor SQL / service_role).';
