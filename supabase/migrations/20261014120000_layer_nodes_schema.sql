-- =============================================================================
-- Árbol de capas estilo Google Earth — Fase 1, parte 1/3: esquema y RPC
-- =============================================================================
-- Crea `layer_nodes` (árbol de carpetas y capas con anidación libre), el orden
-- fraccional, la visibilidad por usuario, las RPC de edición y la papelera.
--
-- Es SOLO ADITIVA: no toca ninguna tabla existente. La data se copia en la
-- parte 2 (20261014120100_layer_nodes_backfill.sql) y la columna PostGIS va en
-- la parte 3. Se aplican en ese orden, cada una idempotente.
--
-- Reglas: SQL_MIGRATION_GUARDRAILS.md (idempotencia, lock, log, validar antes).
-- Rollback: supabase/rollbacks/20261014120000_layer_nodes_down.sql
-- Prueba: supabase/tests/layer_nodes.sql (se corre dentro de una transacción
-- que termina en ROLLBACK).
-- =============================================================================

select pg_advisory_xact_lock(hashtext('layer_nodes_v1'));
set local statement_timeout = '5min';

insert into public._migration_log (sprint, notes) values ('layer_nodes_v1_schema', 'start');

-- -----------------------------------------------------------------------------
-- 1. Índice fraccional (port de fractional-indexing, CC0)
-- -----------------------------------------------------------------------------
-- La posición de un nodo es un texto cuyo orden de BYTES (COLLATE "C") es el
-- orden entre hermanos. Mover un nodo entre dos vecinos genera una clave nueva
-- entre las de ellos: un solo UPDATE, sin renumerar. Es el mismo algoritmo que
-- src/utils/fractionalIndex.ts; ambos se validan con los mismos vectores.

create or replace function public._fi_integer_length(p_head text)
returns int language plpgsql immutable set search_path = public as $$
declare c int := ascii(p_head);
begin
  if c between 97 and 122 then return c - 97 + 2; end if;   -- 'a'..'z'
  if c between 65 and 90 then return 90 - c + 2; end if;    -- 'A'..'Z'
  raise exception 'invalid order key head: %', p_head using errcode = 'invalid_parameter_value';
end $$;

create or replace function public._fi_validate_integer(p_int text)
returns void language plpgsql immutable set search_path = public as $$
begin
  if length(p_int) <> public._fi_integer_length(substr(p_int, 1, 1)) then
    raise exception 'invalid integer part of order key: %', p_int using errcode = 'invalid_parameter_value';
  end if;
end $$;

create or replace function public._fi_integer_part(p_key text)
returns text language plpgsql immutable set search_path = public as $$
declare n int := public._fi_integer_length(substr(p_key, 1, 1));
begin
  if n > length(p_key) then
    raise exception 'invalid order key: %', p_key using errcode = 'invalid_parameter_value';
  end if;
  return substr(p_key, 1, n);
end $$;

create or replace function public._fi_validate_key(p_key text)
returns void language plpgsql immutable set search_path = public as $$
declare i text; f text;
begin
  if p_key = 'A' || repeat('0', 26) then
    raise exception 'invalid order key: %', p_key using errcode = 'invalid_parameter_value';
  end if;
  i := public._fi_integer_part(p_key);
  f := substr(p_key, length(i) + 1);
  if right(f, 1) = '0' then
    raise exception 'invalid order key: %', p_key using errcode = 'invalid_parameter_value';
  end if;
end $$;

-- a puede ser '', b es null o no vacío; a < b si b no es null; sin ceros finales.
create or replace function public._fi_midpoint(a text, b text)
returns text language plpgsql immutable set search_path = public as $$
declare
  c_digits constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  c_zero   constant text := '0';
  v_n  int := 0;
  v_da int;
  v_db int;
begin
  if b = '' then b := null; end if;
  if b is not null and a collate "C" >= b collate "C" then
    raise exception '% >= %', a, b using errcode = 'invalid_parameter_value';
  end if;
  if right(a, 1) = c_zero or (b is not null and right(b, 1) = c_zero) then
    raise exception 'trailing zero' using errcode = 'invalid_parameter_value';
  end if;
  if b is not null then
    -- prefijo común, rellenando `a` con ceros a medida que avanza
    while v_n < length(b)
      and coalesce(nullif(substr(a, v_n + 1, 1), ''), c_zero) = substr(b, v_n + 1, 1) loop
      v_n := v_n + 1;
    end loop;
    if v_n > 0 then
      return substr(b, 1, v_n) || public._fi_midpoint(substr(a, v_n + 1), substr(b, v_n + 1));
    end if;
  end if;
  v_da := case when a <> '' then strpos(c_digits, substr(a, 1, 1)) - 1 else 0 end;
  v_db := case when b is not null then strpos(c_digits, substr(b, 1, 1)) - 1 else length(c_digits) end;
  if v_db - v_da > 1 then
    -- Math.round(0.5 * (da + db)) == floor((da + db + 1) / 2)
    return substr(c_digits, ((v_da + v_db + 1) / 2) + 1, 1);
  end if;
  -- primeros dígitos consecutivos
  if b is not null and length(b) > 1 then
    return substr(b, 1, 1);
  end if;
  return substr(c_digits, v_da + 1, 1) || public._fi_midpoint(substr(a, 2), null);
end $$;

-- null si x ya es el entero más grande
create or replace function public._fi_increment_integer(x text)
returns text language plpgsql immutable set search_path = public as $$
declare
  c_digits constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  v_head text := substr(x, 1, 1);
  v_trailing text := '';
  v_d int;
  v_h text;
  p int;
begin
  perform public._fi_validate_integer(x);
  for p in reverse length(x)..2 loop
    v_d := strpos(c_digits, substr(x, p, 1));            -- índice + 1
    if v_d = length(c_digits) then
      v_trailing := '0' || v_trailing;
    else
      return v_head || substr(x, 2, p - 2) || substr(c_digits, v_d + 1, 1) || v_trailing;
    end if;
  end loop;
  -- acarreo fuera de todo el tramo de dígitos
  if v_head = 'Z' then return 'a0'; end if;
  if v_head = 'z' then return null; end if;
  v_h := chr(ascii(v_head) + 1);
  return v_h || case when v_h collate "C" > 'a' collate "C" then v_trailing || '0' else substr(v_trailing, 2) end;
end $$;

-- null si x ya es el entero más chico
create or replace function public._fi_decrement_integer(x text)
returns text language plpgsql immutable set search_path = public as $$
declare
  c_digits constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  v_head text := substr(x, 1, 1);
  v_trailing text := '';
  v_d int;
  v_h text;
  p int;
begin
  perform public._fi_validate_integer(x);
  for p in reverse length(x)..2 loop
    v_d := strpos(c_digits, substr(x, p, 1)) - 1;        -- índice
    if v_d = 0 then
      v_trailing := 'z' || v_trailing;
    else
      return v_head || substr(x, 2, p - 2) || substr(c_digits, v_d, 1) || v_trailing;
    end if;
  end loop;
  if v_head = 'a' then return 'Zz'; end if;
  if v_head = 'A' then return null; end if;
  v_h := chr(ascii(v_head) - 1);
  return v_h || case when v_h collate "C" < 'Z' collate "C" then v_trailing || 'z' else substr(v_trailing, 2) end;
end $$;

-- Clave estrictamente entre a y b (null = sin límite). Lanza si a >= b.
create or replace function public.generate_key_between(a text, b text)
returns text language plpgsql immutable set search_path = public as $$
declare
  v_smallest constant text := 'A' || repeat('0', 26);
  ia text; fa text; ib text; fb text; i text; res text;
begin
  if a is not null then perform public._fi_validate_key(a); end if;
  if b is not null then perform public._fi_validate_key(b); end if;
  if a is not null and b is not null and a collate "C" >= b collate "C" then
    raise exception '% >= %', a, b using errcode = 'invalid_parameter_value';
  end if;

  if a is null then
    if b is null then return 'a0'; end if;
    ib := public._fi_integer_part(b);
    fb := substr(b, length(ib) + 1);
    if ib = v_smallest then return ib || public._fi_midpoint('', fb); end if;
    if ib collate "C" < b collate "C" then return ib; end if;
    res := public._fi_decrement_integer(ib);
    if res is null then raise exception 'cannot decrement any more' using errcode = 'invalid_parameter_value'; end if;
    return res;
  end if;

  if b is null then
    ia := public._fi_integer_part(a);
    fa := substr(a, length(ia) + 1);
    i := public._fi_increment_integer(ia);
    return case when i is null then ia || public._fi_midpoint(fa, null) else i end;
  end if;

  ia := public._fi_integer_part(a);
  fa := substr(a, length(ia) + 1);
  ib := public._fi_integer_part(b);
  fb := substr(b, length(ib) + 1);
  if ia = ib then return ia || public._fi_midpoint(fa, fb); end if;
  i := public._fi_increment_integer(ia);
  if i is null then raise exception 'cannot increment any more' using errcode = 'invalid_parameter_value'; end if;
  if i collate "C" < b collate "C" then return i; end if;
  return ia || public._fi_midpoint(fa, null);
end $$;

-- Autoprueba contra vectores generados con la librería de referencia: si el
-- port SQL se desvía, la migración aborta ANTES de crear nada que dependa de él.
do $$
declare v_bad int;
begin
  select count(*) into v_bad
    from (values
      (null, null, 'a0'),
      ('a0', null, 'a1'),
      (null, 'a0', 'Zz'),
      ('a0', 'a1', 'a0V'),
      ('a0', 'a2', 'a1'),
      ('a1', 'a2', 'a1V'),
      ('az', null, 'b00'),
      ('az', 'b00', 'azV'),
      ('b00', null, 'b01'),
      ('a0', 'a0V', 'a0G'),
      ('a0V', 'a1', 'a0l'),
      ('a1', 'a1V', 'a1G'),
      ('Zz', null, 'a0'),
      ('Zz', 'a0', 'ZzV'),
      (null, 'Zz', 'Zy'),
      (null, 'Zy', 'Zx'),
      ('Yzz', 'Zz', 'Z0'),
      ('A00000000000000000000000001', null, 'A00000000000000000000000002'),
      (null, 'A00000000000000000000000001', 'A00000000000000000000000000'),
      ('a0', 'a00V', 'a00G'),
      ('a0V', 'a0W', 'a0VV'),
      ('a0Vz', 'a0W', 'a0VzV'),
      ('zzzzzzzzzzzzzzzzzzzzzzzzzzz', null, 'zzzzzzzzzzzzzzzzzzzzzzzzzzzV'),
      ('a0z', 'a1', 'a0zV'),
      ('a0zz', 'a1', 'a0zzV'),
      ('bzz', 'c000', 'bzzV'),
      ('a1', null, 'a2'),
      ('a2', null, 'a3'),
      ('a3', null, 'a4'),
      ('a4', null, 'a5'),
      ('a5', null, 'a6'),
      ('a6', null, 'a7'),
      ('a7', null, 'a8'),
      ('a8', null, 'a9'),
      ('a9', null, 'aA'),
      ('aA', null, 'aB'),
      ('aB', null, 'aC'),
      ('aC', null, 'aD'),
      ('aD', null, 'aE'),
      ('aE', null, 'aF')
    ) as t(a, b, expected)
   where public.generate_key_between(t.a, t.b) is distinct from t.expected;
  if v_bad > 0 then
    raise exception 'Guardrail: generate_key_between difiere de la referencia en % vectores', v_bad;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2. layer_nodes: el árbol
-- -----------------------------------------------------------------------------
create table if not exists public.layer_nodes (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid references public.layer_nodes(id) on delete cascade,
  kind        text not null check (kind in ('folder', 'layer')),
  name        text not null check (btrim(name) <> ''),
  position    text not null collate "C",
  style       jsonb not null default '{}'::jsonb,   -- color, icon, opacity (+ slug y visible_default en las raíces heredadas)
  scope       text not null default 'shared' check (scope in ('shared', 'personal')),
  owner_id    uuid references auth.users(id) on delete cascade,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint layer_nodes_scope_owner check (
    (scope = 'shared' and owner_id is null) or (scope = 'personal' and owner_id is not null)
  ),
  constraint layer_nodes_not_own_parent check (parent_id is distinct from id)
);

comment on table public.layer_nodes is
  'Árbol de carpetas y capas. Las carpetas raíz y las capas reutilizan el uuid de territorial_layer_groups / territorial_layers (que sigue siendo la tabla de detalle de las capas).';
comment on column public.layer_nodes.position is
  'Índice fraccional; el orden entre hermanos es el orden de bytes (COLLATE "C"), desempate por id.';

-- Hermanos activos en orden: es la consulta que hace el panel de árbol.
create index if not exists layer_nodes_parent_position_idx
  on public.layer_nodes (parent_id, position, id) where archived_at is null;
create index if not exists layer_nodes_archived_idx
  on public.layer_nodes (archived_at) where archived_at is not null;

drop trigger if exists trg_layer_nodes_updated on public.layer_nodes;
create trigger trg_layer_nodes_updated before update on public.layer_nodes
  for each row execute function public.update_updated_at_column();

-- Invariantes que NO deben depender de que el cliente se porte bien (aplican
-- también a escrituras directas a la tabla, no solo a las RPC).
create or replace function public.layer_nodes_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_parent public.layer_nodes;
begin
  new.name := btrim(new.name);

  if tg_op = 'UPDATE' then
    if new.kind is distinct from old.kind
       or new.scope is distinct from old.scope
       or new.owner_id is distinct from old.owner_id then
      raise exception 'layer_nodes: kind, scope y owner_id no se pueden cambiar' using errcode = 'check_violation';
    end if;
  end if;

  if new.parent_id is not null then
    select * into v_parent from public.layer_nodes where id = new.parent_id;
    if not found then
      raise exception 'layer_nodes: el padre % no existe', new.parent_id using errcode = 'foreign_key_violation';
    end if;
    if v_parent.kind <> 'folder' then
      raise exception 'layer_nodes: solo una carpeta puede tener hijos (el padre % es una capa)', new.parent_id
        using errcode = 'check_violation';
    end if;
    if v_parent.scope <> new.scope or v_parent.owner_id is distinct from new.owner_id then
      raise exception 'layer_nodes: un nodo % no puede colgar de uno %', new.scope, v_parent.scope
        using errcode = 'check_violation';
    end if;
    if tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id then
      if v_parent.archived_at is not null and new.archived_at is null then
        raise exception 'layer_nodes: el padre % está en la papelera', new.parent_id using errcode = 'check_violation';
      end if;
    end if;
    if tg_op = 'UPDATE' and new.parent_id is distinct from old.parent_id then
      -- ciclo: el nuevo padre no puede ser el propio nodo ni uno de sus descendientes
      if exists (
        with recursive up as (
          select id, parent_id from public.layer_nodes where id = new.parent_id
          union all
          select n.id, n.parent_id from public.layer_nodes n join up on n.id = up.parent_id
        )
        select 1 from up where id = new.id
      ) then
        raise exception 'layer_nodes: mover % bajo % crearía un ciclo', new.id, new.parent_id
          using errcode = 'check_violation';
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_layer_nodes_guard on public.layer_nodes;
create trigger trg_layer_nodes_guard before insert or update on public.layer_nodes
  for each row execute function public.layer_nodes_guard();

-- -----------------------------------------------------------------------------
-- 3. Visibilidad por usuario
-- -----------------------------------------------------------------------------
-- Guarda solo el estado de las HOJAS (capas); el de una carpeta (marcada /
-- intermedia / vacía) se deriva en el cliente. Antes vivía en el localStorage
-- de cada navegador (`territorial_visible_v2`).
create table if not exists public.layer_node_visibility (
  user_id    uuid not null references auth.users(id) on delete cascade,
  node_id    uuid not null references public.layer_nodes(id) on delete cascade,
  visible    boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, node_id)
);
create index if not exists layer_node_visibility_node_idx on public.layer_node_visibility (node_id);

-- -----------------------------------------------------------------------------
-- 4. Papelera: bitácora de lo purgado
-- -----------------------------------------------------------------------------
create table if not exists public.layer_node_purge_log (
  id           bigserial primary key,
  purged_at    timestamptz not null default now(),
  node_id      uuid not null,
  kind         text not null,
  name         text not null,
  scope        text not null,
  archived_at  timestamptz not null,
  descendants  int not null,
  features     bigint not null
);

-- -----------------------------------------------------------------------------
-- 5. RLS (coherente con territorial_*: lectura a autenticados, escritura a admin)
-- -----------------------------------------------------------------------------
alter table public.layer_nodes            enable row level security;
alter table public.layer_node_visibility  enable row level security;
alter table public.layer_node_purge_log   enable row level security;

drop policy if exists layer_nodes_read on public.layer_nodes;
create policy layer_nodes_read on public.layer_nodes
  for select to authenticated
  using (
    (scope = 'shared' and (archived_at is null or public.has_role(auth.uid(), 'admin')))
    or (scope = 'personal' and owner_id = auth.uid())
  );

drop policy if exists layer_nodes_write_shared on public.layer_nodes;
create policy layer_nodes_write_shared on public.layer_nodes
  for all to authenticated
  using (scope = 'shared' and public.has_role(auth.uid(), 'admin'))
  with check (scope = 'shared' and public.has_role(auth.uid(), 'admin'));

drop policy if exists layer_nodes_write_personal on public.layer_nodes;
create policy layer_nodes_write_personal on public.layer_nodes
  for all to authenticated
  using (scope = 'personal' and owner_id = auth.uid())
  with check (scope = 'personal' and owner_id = auth.uid());

drop policy if exists layer_node_visibility_own on public.layer_node_visibility;
create policy layer_node_visibility_own on public.layer_node_visibility
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists layer_node_purge_log_admin_read on public.layer_node_purge_log;
create policy layer_node_purge_log_admin_read on public.layer_node_purge_log
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));

-- Supabase da por defecto todos los privilegios a anon; sin policy no verían
-- nada, pero se quitan igual (defensa en profundidad).
revoke all on public.layer_nodes, public.layer_node_visibility, public.layer_node_purge_log from anon;

-- -----------------------------------------------------------------------------
-- 6. Helpers internos
-- -----------------------------------------------------------------------------
create or replace function public._layer_nodes_can_edit(p_scope text, p_owner uuid)
returns boolean language sql stable set search_path = public as $$
  select coalesce(auth.role(), '') = 'service_role'
      or (p_scope = 'shared'   and public.has_role(auth.uid(), 'admin'))
      or (p_scope = 'personal' and p_owner is not null and p_owner = auth.uid());
$$;

-- Posición al final de los hijos activos de un padre. El lock evita que dos
-- inserciones simultáneas calculen la misma clave.
create or replace function public._layer_nodes_next_position(p_parent uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_last text;
begin
  perform pg_advisory_xact_lock(hashtext('layer_nodes:' || coalesce(p_parent::text, 'root')));
  select position into v_last
    from public.layer_nodes
   where parent_id is not distinct from p_parent and archived_at is null
   order by position desc, id desc
   limit 1;
  return public.generate_key_between(v_last, null);
end $$;

-- Reescribe las posiciones de los hijos activos con claves cortas, conservando
-- el orden. Solo se usa si una clave crece más de la cuenta (inserciones
-- repetidas siempre en el mismo punto).
create or replace function public._layer_nodes_rebalance(p_parent uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record; v_key text := null;
begin
  perform pg_advisory_xact_lock(hashtext('layer_nodes:' || coalesce(p_parent::text, 'root')));
  for r in
    select id from public.layer_nodes
     where parent_id is not distinct from p_parent and archived_at is null
     order by position, id
  loop
    v_key := public.generate_key_between(v_key, null);
    update public.layer_nodes set position = v_key where id = r.id and position is distinct from v_key;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 7. RPC
-- -----------------------------------------------------------------------------

-- Mueve un nodo a otra carpeta (o a la raíz) y/o a otra posición, con UN update.
--   p_after_id : hermano que quedará inmediatamente ANTES del nodo (va después de él).
--   p_before_id: hermano que quedará inmediatamente DESPUÉS del nodo (va antes de él).
--   ninguno    : al final.
create or replace function public.move_node(
  p_node_id uuid,
  p_new_parent_id uuid,
  p_before_id uuid default null,
  p_after_id  uuid default null
) returns public.layer_nodes
language plpgsql security definer set search_path = public as $$
declare
  v_node   public.layer_nodes;
  v_parent public.layer_nodes;
  v_before public.layer_nodes;
  v_after  public.layer_nodes;
  v_prev text; v_next text; v_pos text;
  v_row public.layer_nodes;
begin
  select * into v_node from public.layer_nodes where id = p_node_id for update;
  if not found then
    raise exception 'move_node: el nodo % no existe', p_node_id using errcode = 'no_data_found';
  end if;
  if not public._layer_nodes_can_edit(v_node.scope, v_node.owner_id) then
    raise exception 'move_node: sin permiso para mover este nodo' using errcode = 'insufficient_privilege';
  end if;
  if v_node.archived_at is not null then
    raise exception 'move_node: el nodo está en la papelera' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtext('layer_nodes:' || coalesce(p_new_parent_id::text, 'root')));

  if p_new_parent_id is not null then
    select * into v_parent from public.layer_nodes where id = p_new_parent_id;
    if not found then
      raise exception 'move_node: la carpeta destino % no existe', p_new_parent_id using errcode = 'no_data_found';
    end if;
    if v_parent.kind <> 'folder' then
      raise exception 'move_node: el destino no es una carpeta' using errcode = 'check_violation';
    end if;
    if v_parent.archived_at is not null then
      raise exception 'move_node: la carpeta destino está en la papelera' using errcode = 'check_violation';
    end if;
    if v_parent.scope <> v_node.scope or v_parent.owner_id is distinct from v_node.owner_id then
      raise exception 'move_node: no se puede mover entre capas compartidas y personales' using errcode = 'check_violation';
    end if;
    if p_new_parent_id = p_node_id or exists (
      with recursive d as (
        select id from public.layer_nodes where parent_id = p_node_id
        union all
        select c.id from public.layer_nodes c join d on c.parent_id = d.id
      )
      select 1 from d where id = p_new_parent_id
    ) then
      raise exception 'move_node: mover un nodo dentro de sí mismo o de un descendiente crearía un ciclo'
        using errcode = 'check_violation';
    end if;
  end if;

  if p_after_id is not null then
    select * into v_after from public.layer_nodes
     where id = p_after_id and id <> p_node_id and archived_at is null
       and parent_id is not distinct from p_new_parent_id;
    if not found then
      raise exception 'move_node: after_id % no es un hermano activo del destino', p_after_id using errcode = 'check_violation';
    end if;
  end if;
  if p_before_id is not null then
    select * into v_before from public.layer_nodes
     where id = p_before_id and id <> p_node_id and archived_at is null
       and parent_id is not distinct from p_new_parent_id;
    if not found then
      raise exception 'move_node: before_id % no es un hermano activo del destino', p_before_id using errcode = 'check_violation';
    end if;
  end if;

  if v_after.id is not null and v_before.id is not null then
    v_prev := v_after.position;
    v_next := v_before.position;
    if (v_prev collate "C", v_after.id) >= (v_next collate "C", v_before.id) then
      raise exception 'move_node: after_id debe quedar antes que before_id' using errcode = 'check_violation';
    end if;
  elsif v_before.id is not null then
    v_next := v_before.position;
    select position into v_prev from public.layer_nodes
     where parent_id is not distinct from p_new_parent_id and archived_at is null and id <> p_node_id
       and (position, id) < (v_before.position, v_before.id)
     order by position desc, id desc limit 1;
  elsif v_after.id is not null then
    v_prev := v_after.position;
    select position into v_next from public.layer_nodes
     where parent_id is not distinct from p_new_parent_id and archived_at is null and id <> p_node_id
       and (position, id) > (v_after.position, v_after.id)
     order by position, id limit 1;
  else
    select position into v_prev from public.layer_nodes
     where parent_id is not distinct from p_new_parent_id and archived_at is null and id <> p_node_id
     order by position desc, id desc limit 1;
    v_next := null;
  end if;

  v_pos := public.generate_key_between(v_prev, v_next);

  update public.layer_nodes
     set parent_id = p_new_parent_id, position = v_pos
   where id = p_node_id
   returning * into v_row;

  if length(v_pos) > 48 then
    perform public._layer_nodes_rebalance(p_new_parent_id);
    select * into v_row from public.layer_nodes where id = p_node_id;
  end if;
  return v_row;
end $$;

create or replace function public.rename_node(p_node_id uuid, p_name text)
returns public.layer_nodes
language plpgsql security definer set search_path = public as $$
declare v_node public.layer_nodes; v_row public.layer_nodes;
begin
  if p_name is null or btrim(p_name) = '' then
    raise exception 'rename_node: el nombre no puede estar vacío' using errcode = 'check_violation';
  end if;
  select * into v_node from public.layer_nodes where id = p_node_id for update;
  if not found then
    raise exception 'rename_node: el nodo % no existe', p_node_id using errcode = 'no_data_found';
  end if;
  if not public._layer_nodes_can_edit(v_node.scope, v_node.owner_id) then
    raise exception 'rename_node: sin permiso para renombrar este nodo' using errcode = 'insufficient_privilege';
  end if;
  update public.layer_nodes set name = btrim(p_name) where id = p_node_id returning * into v_row;
  return v_row;
end $$;

-- Papelera: archiva el nodo y TODO su subárbol activo con el mismo timestamp,
-- para poder restaurar exactamente ese conjunto.
create or replace function public.archive_node(p_node_id uuid)
returns public.layer_nodes
language plpgsql security definer set search_path = public as $$
declare v_node public.layer_nodes; v_ts timestamptz := clock_timestamp(); v_row public.layer_nodes;
begin
  select * into v_node from public.layer_nodes where id = p_node_id for update;
  if not found then
    raise exception 'archive_node: el nodo % no existe', p_node_id using errcode = 'no_data_found';
  end if;
  if not public._layer_nodes_can_edit(v_node.scope, v_node.owner_id) then
    raise exception 'archive_node: sin permiso para eliminar este nodo' using errcode = 'insufficient_privilege';
  end if;
  if v_node.archived_at is not null then
    raise exception 'archive_node: el nodo ya está en la papelera' using errcode = 'check_violation';
  end if;

  update public.layer_nodes set archived_at = v_ts
   where id in (
     with recursive d as (
       select id from public.layer_nodes where id = p_node_id
       union all
       select c.id from public.layer_nodes c join d on c.parent_id = d.id where c.archived_at is null
     )
     select id from d
   ) and archived_at is null;

  select * into v_row from public.layer_nodes where id = p_node_id;
  return v_row;
end $$;

-- Restaura el nodo y los descendientes que se archivaron JUNTO con él (mismo
-- timestamp). Los que estaban en la papelera desde antes se quedan ahí. Si su
-- carpeta sigue en la papelera, el nodo vuelve a la raíz.
create or replace function public.restore_node(p_node_id uuid)
returns public.layer_nodes
language plpgsql security definer set search_path = public as $$
declare v_node public.layer_nodes; v_ts timestamptz; v_row public.layer_nodes;
begin
  select * into v_node from public.layer_nodes where id = p_node_id for update;
  if not found then
    raise exception 'restore_node: el nodo % no existe', p_node_id using errcode = 'no_data_found';
  end if;
  if not public._layer_nodes_can_edit(v_node.scope, v_node.owner_id) then
    raise exception 'restore_node: sin permiso para restaurar este nodo' using errcode = 'insufficient_privilege';
  end if;
  if v_node.archived_at is null then
    raise exception 'restore_node: el nodo no está en la papelera' using errcode = 'check_violation';
  end if;
  v_ts := v_node.archived_at;

  if v_node.parent_id is not null and exists (
    select 1 from public.layer_nodes where id = v_node.parent_id and archived_at is not null
  ) then
    update public.layer_nodes
       set parent_id = null, position = public._layer_nodes_next_position(null)
     where id = p_node_id;
  end if;

  update public.layer_nodes set archived_at = null
   where id in (
     with recursive d as (
       select id from public.layer_nodes where id = p_node_id
       union all
       select c.id from public.layer_nodes c join d on c.parent_id = d.id where c.archived_at = v_ts
     )
     select id from d
   );

  select * into v_row from public.layer_nodes where id = p_node_id;
  return v_row;
end $$;

-- Enciende o apaga un nodo para el usuario actual. Si es una carpeta, aplica a
-- todas las capas activas que contiene. Devuelve cuántas filas escribió.
create or replace function public.set_node_visibility(p_node_id uuid, p_visible boolean)
returns int
language plpgsql set search_path = public as $$
declare v_n int;
begin
  if auth.uid() is null then
    raise exception 'set_node_visibility: requiere sesión' using errcode = 'insufficient_privilege';
  end if;
  with recursive d as (
    select id, kind from public.layer_nodes where id = p_node_id and archived_at is null
    union all
    select c.id, c.kind from public.layer_nodes c join d on c.parent_id = d.id where c.archived_at is null
  )
  insert into public.layer_node_visibility (user_id, node_id, visible)
  select auth.uid(), id, p_visible from d where kind = 'layer'
  on conflict (user_id, node_id) do update set visible = excluded.visible, updated_at = now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Purga lo que lleva más de p_days en la papelera. Solo borra la RAÍZ de cada
-- subárbol archivado (el resto cae por cascade), deja registro de qué se llevó
-- y tiene un tope por corrida.
create or replace function public.purge_archived_layer_nodes(p_days int default 30, p_max_roots int default 50)
returns int
language plpgsql security definer set search_path = public as $$
declare r record; v_n int := 0; v_desc int; v_feat bigint;
begin
  if p_days < 7 then
    raise exception 'purge_archived_layer_nodes: p_days debe ser >= 7 (recibido %)', p_days using errcode = 'invalid_parameter_value';
  end if;
  for r in
    select n.* from public.layer_nodes n
     where n.archived_at is not null
       and n.archived_at < now() - make_interval(days => p_days)
       and not exists (
         select 1 from public.layer_nodes p
          where p.id = n.parent_id and p.archived_at = n.archived_at
       )
     order by n.archived_at
     limit p_max_roots
  loop
    with recursive d as (
      select id from public.layer_nodes where parent_id = r.id
      union all
      select c.id from public.layer_nodes c join d on c.parent_id = d.id
    )
    select count(*) into v_desc from d;

    select count(*) into v_feat
      from public.territorial_features f
     where f.layer_id in (
       with recursive d as (
         select id from public.layer_nodes where id = r.id
         union all
         select c.id from public.layer_nodes c join d on c.parent_id = d.id
       )
       select id from d
     );

    insert into public.layer_node_purge_log (node_id, kind, name, scope, archived_at, descendants, features)
    values (r.id, r.kind, r.name, r.scope, r.archived_at, v_desc, v_feat);

    delete from public.layer_nodes where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Diaria, mismo patrón que purge-deleted-pois-daily. cron.schedule con un
-- nombre existente lo reemplaza, así que re-aplicar la migración es seguro.
select cron.schedule(
  'purge-archived-layer-nodes',
  '23 3 * * *',
  $$ select public.purge_archived_layer_nodes(); $$
);

-- -----------------------------------------------------------------------------
-- 8. Permisos de ejecución
-- -----------------------------------------------------------------------------
-- Supabase otorga EXECUTE a anon/authenticated/service_role por defecto. Los
-- helpers internos no deben ser invocables por RPC; las RPC públicas solo por
-- usuarios con sesión (y service_role).
revoke all on function
  public._fi_integer_length(text), public._fi_validate_integer(text), public._fi_integer_part(text),
  public._fi_validate_key(text), public._fi_midpoint(text, text), public._fi_increment_integer(text),
  public._fi_decrement_integer(text), public.generate_key_between(text, text),
  public._layer_nodes_can_edit(text, uuid), public._layer_nodes_next_position(uuid),
  public._layer_nodes_rebalance(uuid), public.purge_archived_layer_nodes(int, int)
  from public, anon, authenticated;
grant execute on function
  public.generate_key_between(text, text), public.purge_archived_layer_nodes(int, int)
  to service_role;

revoke all on function
  public.move_node(uuid, uuid, uuid, uuid), public.rename_node(uuid, text),
  public.archive_node(uuid), public.restore_node(uuid), public.set_node_visibility(uuid, boolean)
  from public, anon;
grant execute on function
  public.move_node(uuid, uuid, uuid, uuid), public.rename_node(uuid, text),
  public.archive_node(uuid), public.restore_node(uuid), public.set_node_visibility(uuid, boolean)
  to authenticated, service_role;

insert into public._migration_log (sprint, notes) values ('layer_nodes_v1_schema', 'done');
