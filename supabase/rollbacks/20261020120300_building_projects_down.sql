-- ROLLBACK de 20261020120300_building_projects.sql. Se pierden los proyectos cargados y las
-- revisiones geográficas humanas (exportarlas antes si existen).
drop view if exists public.building_projects_current_v;
drop function if exists public.publish_project_snapshot(uuid);
drop function if exists public.check_project_geometry(uuid, numeric);
drop table if exists public.building_project_geo_reviews;
drop table if exists public.building_projects;
drop function if exists public.bp_immutable();
