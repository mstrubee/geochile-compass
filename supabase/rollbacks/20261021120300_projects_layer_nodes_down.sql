-- ROLLBACK de 20261021120300_projects_layer_nodes.sql. Borra SOLO las tres hojas que creó (por carpeta + nombre + marca en thematic_layers).
do $$
declare v_root uuid;
begin
  select id into v_root from public.layer_nodes
   where kind = 'folder' and parent_id is null and scope = 'shared' and style ->> 'slug' = 'edificacion_expansion';
  delete from public.territorial_layers l          -- el trigger legacy borra el nodo; thematic_layers cae por cascada
   using public.thematic_layers t
   where t.layer_id = l.id and l.group_id = v_root and t.renderer in ('points_permits', 'polygons_crf', 'points_projects');
end $$;
alter table public.thematic_layers drop constraint if exists thematic_layers_renderer_check;
alter table public.thematic_layers add constraint thematic_layers_renderer_check check (renderer in ('choropleth_comuna', 'points_projects'));
