CREATE OR REPLACE FUNCTION public.reject_future_sales_metrics()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.metric_key = 'ventas' AND NEW.period > date_trunc('month', now())::date THEN
    RAISE EXCEPTION 'Period % is in the future. Sales metrics cannot have periods > current month (%).',
      NEW.period, date_trunc('month', now())::date;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_future_sales ON public.poi_metrics;
CREATE TRIGGER trg_reject_future_sales
  BEFORE INSERT OR UPDATE ON public.poi_metrics
  FOR EACH ROW EXECUTE FUNCTION public.reject_future_sales_metrics();