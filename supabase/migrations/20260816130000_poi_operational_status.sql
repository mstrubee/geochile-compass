-- Estado operativo del local.
--
-- Un local cerrado sigue siendo válido para el análisis territorial (su entorno
-- es un dato objetivo), pero sus ventas NO son representativas y no deben
-- alimentar las proyecciones: un cierre no es una señal de desempeño del
-- emplazamiento.

alter table public.pois
  add column if not exists operational_status text not null default 'operativo',
  add column if not exists closed_at          date,
  add column if not exists closure_reason     text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pois_operational_status_check'
  ) then
    alter table public.pois
      add constraint pois_operational_status_check
      check (operational_status in ('operativo', 'cerrado_definitivo', 'cerrado_temporal'));
  end if;
end $$;

-- Índice parcial: solo interesan los cerrados, que son la minoría.
create index if not exists pois_operational_status_idx
  on public.pois (operational_status)
  where operational_status <> 'operativo';

comment on column public.pois.operational_status is
  'operativo | cerrado_definitivo | cerrado_temporal. Los cerrados se excluyen de las proyecciones de venta.';
comment on column public.pois.closed_at is 'Fecha de cierre, si aplica.';
comment on column public.pois.closure_reason is 'Motivo del cierre (texto libre).';
