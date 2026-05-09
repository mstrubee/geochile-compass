REVOKE EXECUTE ON FUNCTION public.set_poi_folder_kpi_order(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_poi_folder_kpi_order(uuid, jsonb) TO authenticated;