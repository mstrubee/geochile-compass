-- ROLLBACK de 20261020120200_permits_layer_node.sql. Borra SOLO la hoja y la carpeta que creó esa
-- migración (por slug / marca en thematic_layers), y solo si la carpeta no tiene otros hijos.
do $$
declare v_root uuid; v_layer uuid;
begin
  select id into v_root from public.layer_nodes
   where kind = 'folder' and parent_id is null and scope = 'shared' and style ->> 'slug' = 'edificacion_expansion';
  select t.layer_id into v_layer from public.thematic_layers t
    join public.territorial_layers l on l.id = t.layer_id
   where l.group_id = v_root and l.name = 'Permisos de edificación';
  if v_layer is not null then
    delete from public.territorial_layers where id = v_layer;   -- el trigger legacy borra el nodo; thematic_layers cae por cascada
  end if;
  if v_root is not null and not exists (select 1 from public.layer_nodes where parent_id = v_root) then
    delete from public.layer_nodes where id = v_root and kind = 'folder';
  end if;
end $$;
drop table if exists public.thematic_layers;
