-- ROLLBACK de 20261103000200_prevision_layer_nodes.sql. Borra SOLO las dos hojas de previsión (por carpeta «Salud» + renderer) y restaura la restricción de renderers
-- de la 1a (seis). NO toca la carpeta «Salud» ni las columnas client_ready* (son de 20261102000100).
do $$
declare v_root uuid;
begin
  select id into v_root from public.layer_nodes where kind = 'folder' and parent_id is null and scope = 'shared' and style ->> 'slug' = 'salud';
  delete from public.territorial_layers l          -- el trigger legacy borra el nodo; thematic_layers cae por cascada
   using public.thematic_layers t
   where t.layer_id = l.id and l.group_id = v_root and t.renderer in ('choropleth_isapre', 'panel_casen_region');
end $$;
alter table public.thematic_layers drop constraint if exists thematic_layers_renderer_check;
alter table public.thematic_layers add constraint thematic_layers_renderer_check
  check (renderer in ('choropleth_comuna', 'points_projects', 'points_permits', 'polygons_crf', 'points_health', 'choropleth_health'));
