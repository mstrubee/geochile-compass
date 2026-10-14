-- ROLLBACK de 20261014181000_layer_nodes_serv_first.sql: devuelve "SERV. AUTOMOTRICES"
-- a la posición que tenía, guardada en _migration_log. No hace nada si no se aplicó
-- o si ya se revirtió.
select pg_advisory_xact_lock(hashtext('layer_nodes_v1'));

do $$
declare v_notes jsonb; v_log_id bigint;
begin
  select id, notes::jsonb into v_log_id, v_notes
    from public._migration_log where sprint = 'layer_nodes_v2_serv_first' order by id desc limit 1;
  if v_notes is null then
    raise notice 'layer_nodes_v2_serv_first no estaba aplicada; nada que revertir';
    return;
  end if;
  update public.layer_nodes set position = v_notes ->> 'old_position'
   where id = (v_notes ->> 'node_id')::uuid;
  update public._migration_log set sprint = 'layer_nodes_v2_serv_first_reverted' where id = v_log_id;
end $$;
