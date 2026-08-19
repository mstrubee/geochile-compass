-- Totales de venta de la red por mes. Son ~91 filas, contra las 5.800+ de
-- poi_metrics: permite que el diálogo de un local calcule la estacionalidad de
-- la RED (que es la estimación estable, ver salesForecast.ts) sin traerse la
-- serie completa de los 64 locales al navegador.
--
-- Se deja como vista y no como tabla materializada porque el cálculo es
-- trivial y así nunca queda desactualizada tras una importación.
create or replace view public.network_monthly_sales
with (security_invoker = true) as
select
  period,
  sum(value) as total,
  count(*) as locales
from public.poi_metrics
where metric_key = 'ventas'
group by period
order by period;

comment on view public.network_monthly_sales is
  'Venta total de la red por mes. Insumo para calcular la estacionalidad (computeSeasonalFactors) sin descargar toda la serie por local.';

grant select on public.network_monthly_sales to authenticated;
