
CREATE OR REPLACE FUNCTION public.list_public_tables()
RETURNS TABLE(table_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT c.relname::text AS table_name
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
  ORDER BY c.relname;
$$;

REVOKE ALL ON FUNCTION public.list_public_tables() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_public_tables() TO service_role;
