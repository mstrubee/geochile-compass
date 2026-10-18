-- Comprobación posterior a los rollbacks de 1b (se corre después de los down; NO es una migración).
select pg_temp.assert_that('los rollbacks de 1b dejan solo lo de 1a: sin tablas, funciones ni hojas de previsión, CHECK de seis renderers, carpeta «Salud» y hojas de 1a intactas',
  to_regclass('public.isapre_cartera_celda') is null and to_regclass('public.casen_prevision_region') is null
  and not exists (select 1 from pg_namespace where nspname = 'salud_restringido')
  and not exists (select 1 from pg_proc where (proname like '%isapre%' or proname like '%casen%') and pronamespace = 'public'::regnamespace)
  and not exists (select 1 from public.thematic_layers where renderer in ('choropleth_isapre', 'panel_casen_region'))
  and (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.thematic_layers'::regclass and conname = 'thematic_layers_renderer_check') not like '%isapre%'
  and (select count(*) from public.layer_nodes where style ->> 'slug' = 'salud') = 1
  and (select count(*) from public.thematic_layers where renderer in ('points_health', 'choropleth_health')) = 2
  and not exists (select 1 from public.data_sources where source_key in ('superdesalud_isapre_cartera_comunal', 'mds_casen_2024_nacional'))
  and (select count(*) from public.layer_nodes n where n.kind = 'layer' and n.parent_id = (select id from public.layer_nodes where kind = 'folder' and parent_id is null and style ->> 'slug' = 'salud')) = 2
  and (select count(*) from public.territorial_features) = (select n from _before where t = 'territorial_features'));
