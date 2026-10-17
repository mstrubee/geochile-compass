-- ROLLBACK de 20261021120200_seia_projects_layer_node.sql. Borra SOLO la hoja "Proyectos SEIA" (la identifica por su
-- marca en thematic_layers: dataset 'seia_projects'). NO borra la carpeta "Edificación y expansión urbana": la comparte
-- con "Permisos de edificación" (y con cualquier otra hoja futura) y su rollback es el de esa migración.
do $$
declare v_layer uuid;
begin
  for v_layer in select layer_id from public.thematic_layers where dataset = 'seia_projects' loop
    delete from public.territorial_layers where id = v_layer;   -- el trigger legacy borra el nodo; thematic_layers cae por cascada
  end loop;
end $$;
