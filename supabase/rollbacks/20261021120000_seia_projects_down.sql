-- ROLLBACK de 20261021120000_seia_projects.sql. SE PIERDEN los proyectos cargados y las revisiones geográficas
-- humanas (exportarlas antes si existen). Los snapshots registrados en source_snapshots y sus archivos en Storage
-- NO se tocan.
-- Se niega a correr mientras existan lo que depende de estas tablas (las funciones SQL no registran dependencias:
-- se quedarían rotas en silencio). Revertir antes 20261021120200 y 20261021120100.
do $$
begin
  if to_regprocedure('public.get_seia_projects(double precision,double precision,double precision,double precision,text[],text[],text[],integer,integer,boolean,integer)') is not null
     or to_regprocedure('public.get_seia_facets(text[])') is not null
     or to_regprocedure('public.get_seia_project(text,text)') is not null then
    raise exception 'Rollback detenido: existen las RPC de lectura del SEIA; revertir antes 20261021120100';
  end if;
  if to_regclass('public.thematic_layers') is not null
     and exists (select 1 from public.thematic_layers where dataset = 'seia_projects') then
    raise exception 'Rollback detenido: existe la hoja "Proyectos SEIA" en el árbol; revertir antes 20261021120200';
  end if;
end $$;
drop view if exists public.seia_projects_current_v;
drop function if exists public.seia_purge_superseded(uuid, int);
drop function if exists public.seia_publish_snapshot(uuid);
drop function if exists public.seia_check_geometry(uuid, numeric);
drop table if exists public.seia_project_geo_reviews;
drop table if exists public.seia_project_geo_checks;
drop table if exists public.seia_rejected_rows;
drop table if exists public.seia_current_snapshot;
drop table if exists public.seia_projects;
drop function if exists public.seia_projects_immutable();
