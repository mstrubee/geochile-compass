-- ROLLBACK de 20261021120200_seia_projects.sql. Revertir antes 20261021120300 (nodos).
-- Se pierden los proyectos cargados y las REVISIONES HUMANAS de ubicación (building_project_geo_reviews):
-- exportarlas antes si importan. Los archivos originales siguen en Storage. Las reglas de tipología también se borran.
-- La verificación de las fuentes SEIA (nota de 2026-10-17) NO se revierte.
drop function if exists public.get_seia_summary();
drop function if exists public.get_seia_projects(double precision, double precision, double precision, double precision, text[], text[], integer, integer, integer);
drop function if exists public._seia_current_snapshots();
drop function if exists public.publish_seia_snapshot(uuid);
drop table if exists public.seia_stage;
drop table if exists public.building_project_geo_reviews;
drop function if exists public.building_project_geo_reviews_append_only();
drop table if exists public.building_projects;
drop table if exists public.seia_typology_rules;
