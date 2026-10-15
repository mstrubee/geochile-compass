-- =============================================================================
-- Árbol de capas — deja "SERV. AUTOMOTRICES" como la primera carpeta raíz
-- =============================================================================
-- La lista anterior de capas fijaba esta carpeta arriba por código (regla de
-- interfaz). Desde la Fase 3 el orden es del árbol y se edita arrastrando, así
-- que esa posición se guarda en la base una sola vez. Es el único UPDATE de datos
-- existentes de esta fase (una columna de una fila), autorizado explícitamente.
--
-- Salvaguardas:
--  - Solo corre una vez (queda en _migration_log). Si se vuelve a ejecutar, NO
--    mueve nada: no debe pisar el orden que los administradores hayan dejado.
--  - Exige exactamente UNA carpeta raíz con slug 'talleres'.
--  - Guarda la posición anterior en _migration_log para poder revertirla
--    (supabase/rollbacks/20261014181000_layer_nodes_serv_first_down.sql).
-- =============================================================================

select pg_advisory_xact_lock(hashtext('layer_nodes_v1'));

do $$
declare v_n int; v_id uuid; v_old text; v_first text; v_new text;
begin
  if exists (select 1 from public._migration_log where sprint = 'layer_nodes_v2_serv_first') then
    raise notice 'layer_nodes_v2_serv_first: ya se aplicó; no se vuelve a mover para respetar el orden actual';
    return;
  end if;

  select count(*) into v_n
    from public.layer_nodes
   where parent_id is null and archived_at is null and scope = 'shared' and style ->> 'slug' = 'talleres';
  if v_n <> 1 then
    raise exception 'Guardrail: se esperaba exactamente 1 carpeta raíz con slug "talleres" y hay %', v_n;
  end if;

  select id, position into v_id, v_old
    from public.layer_nodes
   where parent_id is null and archived_at is null and scope = 'shared' and style ->> 'slug' = 'talleres';

  -- Primera posición de la raíz entre las demás carpetas (activas, o archivadas por si se restauran).
  select min(position collate "C") into v_first from public.layer_nodes where parent_id is null and id <> v_id;

  if v_first is not null and (v_old collate "C") > (v_first collate "C") then
    v_new := public.generate_key_between(null, v_first);
    update public.layer_nodes set position = v_new where id = v_id;
  else
    v_new := v_old;   -- ya era la primera
  end if;

  insert into public._migration_log (sprint, notes)
  values ('layer_nodes_v2_serv_first',
          jsonb_build_object('node_id', v_id, 'old_position', v_old, 'new_position', v_new)::text);
end $$;
