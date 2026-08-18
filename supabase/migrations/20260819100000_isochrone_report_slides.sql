-- Guarda las 2 láminas del "Informe directorio" (PNG en base64) generadas
-- para una isócrona, para que leaseflow-pro pueda extraerlas vía API y
-- usarlas como slides propias en su Informe Directorio.
--
-- Se cachean en cada exportación del analista desde AnalysisPanel (además
-- de la descarga normal del .pptx) — no hay una acción nueva que aprender.

create table public.isochrone_report_slides (
  isochrone_id uuid primary key references public.saved_isochrones(id) on delete cascade,
  slide1_png   text not null,
  slide2_png   text,
  generated_at timestamptz not null default now()
);

alter table public.isochrone_report_slides enable row level security;

-- Mismo dueño que la isócrona (saved_isochrones.user_id) — el analista que
-- generó el informe puede leer/escribir su propia caché.
create policy "Users manage report slides of own isos"
  on public.isochrone_report_slides for all
  using (exists (select 1 from public.saved_isochrones s where s.id = isochrone_id and s.user_id = auth.uid()))
  with check (exists (select 1 from public.saved_isochrones s where s.id = isochrone_id and s.user_id = auth.uid()));
