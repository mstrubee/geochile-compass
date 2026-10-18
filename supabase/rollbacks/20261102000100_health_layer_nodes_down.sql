-- ROLLBACK de 20261102000100_health_layer_nodes.sql. Borra SOLO las dos hojas de salud (por carpeta + renderer) y la carpeta «Salud» si quedó vacía.
-- Restaura la restricción de renderers anterior (los cuatro de permisos/proyectos). Las columnas client_ready* se quitan solo si ninguna capa
-- restante tiene la bandera puesta (si alguien la usó, se conservan y se avisa).
do $$
declare v_root uuid;
begin
  select id into v_root from public.layer_nodes
   where kind = 'folder' and parent_id is null and scope = 'shared' and style ->> 'slug' = 'salud';
  delete from public.territorial_layers l          -- el trigger legacy borra el nodo; thematic_layers cae por cascada
   using public.thematic_layers t
   where t.layer_id = l.id and l.group_id = v_root and t.renderer in ('points_health', 'choropleth_health');
  if v_root is not null and not exists (select 1 from public.layer_nodes where parent_id = v_root) then
    delete from public.layer_nodes where id = v_root;
  end if;
end $$;
alter table public.thematic_layers drop constraint if exists thematic_layers_renderer_check;
alter table public.thematic_layers add constraint thematic_layers_renderer_check
  check (renderer in ('choropleth_comuna', 'points_projects', 'points_permits', 'polygons_crf'));
do $$
declare v_used boolean;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'thematic_layers' and column_name = 'client_ready') then
    return;                                                   -- ya revertido (idempotente)
  end if;
  execute 'select exists (select 1 from public.thematic_layers where client_ready is not null or client_ready_note is not null)' into v_used;
  if v_used then
    raise notice 'hay capas con client_ready definido: las columnas client_ready y client_ready_note se conservan';
  else
    alter table public.thematic_layers drop column if exists client_ready;
    alter table public.thematic_layers drop column if exists client_ready_note;
  end if;
end $$;
