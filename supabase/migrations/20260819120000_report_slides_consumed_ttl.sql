-- Consumo de las láminas por leaseflow-pro, con limpieza diferida.
--
-- Borrarlas en el mismo momento de la extracción haría que un corte de red a
-- mitad de la transferencia las perdiera, y recuperarlas obliga al analista a
-- repetir toda la captura de mapas. Así que la extracción solo MARCA, y una
-- tarea programada borra después: el espacio ocupado en estado estacionario es
-- el mismo, pero un reintento dentro de la ventana funciona.

alter table public.isochrone_report_slides
  add column if not exists consumed_at timestamptz;

comment on column public.isochrone_report_slides.consumed_at is
  'Cuándo leaseflow-pro extrajo estas láminas. La fila sobrevive TTL_CONSUMED para tolerar un reintento; luego la borra cleanup_report_slides().';

create index if not exists isochrone_report_slides_consumed_at_idx
  on public.isochrone_report_slides (consumed_at)
  where consumed_at is not null;

-- Ventanas de retención.
--   consumidas:     48 h — margen para reintentar una descarga fallida.
--   sin consumir:   30 d — láminas que nadie fue a buscar; a esa altura el
--                   informe ya no refleja los datos vigentes y conviene
--                   regenerarlo antes que entregarlo viejo.
create or replace function public.cleanup_report_slides()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.isochrone_report_slides
   where (consumed_at is not null and consumed_at < now() - interval '48 hours')
      or (consumed_at is null     and generated_at < now() - interval '30 days');
  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function public.cleanup_report_slides() is
  'Borra láminas ya consumidas (>48 h) y las que nadie consumió (>30 d). La corre pg_cron a diario.';

-- Idempotente: correr la migración dos veces no debe dejar dos tareas.
select cron.unschedule('cleanup-report-slides')
 where exists (select 1 from cron.job where jobname = 'cleanup-report-slides');

select cron.schedule(
  'cleanup-report-slides',
  '17 4 * * *',                       -- 04:17 UTC, fuera del horario de uso
  $$select public.cleanup_report_slides()$$
);
