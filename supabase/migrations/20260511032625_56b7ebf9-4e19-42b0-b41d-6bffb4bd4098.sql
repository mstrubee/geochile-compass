CREATE OR REPLACE FUNCTION public.poi_sync_summary()
RETURNS TABLE (row_count bigint, max_updated_at timestamptz, checksum text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    COUNT(*)::bigint AS row_count,
    MAX(updated_at) AS max_updated_at,
    COALESCE(
      md5(string_agg(id::text, ',' ORDER BY id)),
      ''
    ) AS checksum
  FROM public.pois
  WHERE user_id = auth.uid();
$$;