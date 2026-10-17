-- ROLLBACK de 20261020120100_building_permit_statistics.sql. Revertir antes las partes 4 y 3.
-- Se pierden TODOS los valores cargados: los archivos originales siguen en Storage y se pueden
-- volver a procesar con el ETL. Las series sembradas y el mapa de destinos también se borran.
drop function if exists public.get_layer_provenance(text);
drop function if exists public.get_permit_series(text, text, text, text, text);
drop function if exists public.get_permit_choropleth(text, text, int, int, text, text, text);
drop function if exists public._xl_col(int);
drop function if exists public.purge_superseded_permit_rows(uuid, int);
drop function if exists public.publish_permit_snapshot(uuid, numeric);
drop table if exists public.snapshot_control_totals;
drop table if exists public.permit_rejected_rows;
drop table if exists public.permit_stage;
drop table if exists public.building_permit_statistics;
drop function if exists public.bps_immutable();
drop table if exists public.permit_series;
drop table if exists public.permit_destination_map;
