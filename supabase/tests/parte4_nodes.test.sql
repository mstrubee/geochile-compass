-- PRUEBA de 20261021120300_projects_layer_nodes (patrón: se corre DESPUÉS de aplicar 20261020120200 y 20261021120300; termina en ROLLBACK).
begin;
create or replace function pg_temp.assert(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'FALLA: %', p_msg; end if;
  raise notice 'ok   %', p_msg;
end $$;

select pg_temp.assert((select count(*) = 4 from public.thematic_layers), '4 capas temáticas: la de MINVU y las 3 de la Parte 4');
select pg_temp.assert((select count(*) = 3 from public.thematic_layers where renderer in ('points_permits', 'polygons_crf', 'points_projects')), 'las 3 nuevas usan los renderers nuevos');
select pg_temp.assert((select count(*) = 4 from public.layer_nodes n join public.layer_nodes f on f.id = n.parent_id
                        where f.style ->> 'slug' = 'edificacion_expansion' and n.kind = 'layer' and n.archived_at is null), 'las 4 hojas cuelgan de "Edificación y expansión urbana"');
select pg_temp.assert((select count(*) = 3 from public.layer_nodes where name in ('Permisos georreferenciados (INE)', 'Recepciones finales (INE)', 'Proyectos SEIA (inmobiliarios y urbanos)')), 'los nombres son los esperados');
select pg_temp.assert((select bool_and(dataset in ('ine_permit_points', 'ine_crf', 'building_projects', 'building_permits')) from public.thematic_layers), 'datasets conocidos');
select pg_temp.assert((select count(*) = 0 from public.territorial_features where layer_id in (select layer_id from public.thematic_layers)), 'las capas temáticas no copian polígonos a territorial_features');
do $$
begin
  begin
    insert into public.thematic_layers (layer_id, renderer, dataset) select layer_id, 'inventado', 'x' from public.thematic_layers limit 1 on conflict do nothing;
    raise exception 'FALLA: aceptó un renderer inventado';
  exception when check_violation then raise notice 'ok   un renderer inventado se rechaza (check)';
  end;
end $$;
rollback;
