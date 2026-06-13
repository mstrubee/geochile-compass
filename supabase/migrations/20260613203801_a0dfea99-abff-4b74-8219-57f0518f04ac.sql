UPDATE public.comercio_poi
SET marca_estandar = 'Otros'
WHERE eliminado = false
  AND (marca_estandar IS NULL OR btrim(marca_estandar) = '');

CREATE OR REPLACE FUNCTION public.fn_marcas_categoria(p_categoria text)
RETURNS TABLE (marca_estandar text, total_locales bigint)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT
    COALESCE(NULLIF(btrim(marca_estandar), ''), 'Otros') AS marca_estandar,
    COUNT(*) AS total_locales
  FROM public.comercio_poi
  WHERE categoria = p_categoria
    AND NOT eliminado
  GROUP BY COALESCE(NULLIF(btrim(marca_estandar), ''), 'Otros')
  ORDER BY total_locales DESC;
$$;