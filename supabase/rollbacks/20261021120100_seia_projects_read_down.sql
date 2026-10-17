-- ROLLBACK de 20261021120100_seia_projects_read.sql. Solo funciones: no se pierde ningún dato.
drop function if exists public.get_seia_project(text, text);
drop function if exists public.get_seia_facets(text[]);
drop function if exists public.get_seia_projects(double precision, double precision, double precision, double precision,
                                                  text[], text[], text[], int, int, boolean, int);
