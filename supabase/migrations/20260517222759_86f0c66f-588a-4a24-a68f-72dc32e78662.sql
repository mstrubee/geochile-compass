-- Make layer_id nullable, add group_id, swap unique constraint, simplify roles
ALTER TABLE public.folder_layer_roles
  ALTER COLUMN layer_id DROP NOT NULL;

ALTER TABLE public.folder_layer_roles
  ADD COLUMN IF NOT EXISTS group_id uuid
    REFERENCES public.territorial_layer_groups(id) ON DELETE CASCADE;

-- Drop old unique constraint
ALTER TABLE public.folder_layer_roles
  DROP CONSTRAINT IF EXISTS folder_layer_roles_folder_id_layer_id_key;

-- XOR check: exactly one of group_id / layer_id must be set
ALTER TABLE public.folder_layer_roles
  DROP CONSTRAINT IF EXISTS folder_layer_roles_xor_check;
ALTER TABLE public.folder_layer_roles
  ADD CONSTRAINT folder_layer_roles_xor_check
    CHECK ((group_id IS NOT NULL AND layer_id IS NULL)
        OR (group_id IS NULL AND layer_id IS NOT NULL));

-- Unique on folder + (group or layer)
CREATE UNIQUE INDEX IF NOT EXISTS folder_layer_roles_unique
  ON public.folder_layer_roles (folder_id, COALESCE(group_id, layer_id));

-- Simplify role check to the 4 values used by the new UI
ALTER TABLE public.folder_layer_roles
  DROP CONSTRAINT IF EXISTS folder_layer_roles_role_check;
ALTER TABLE public.folder_layer_roles
  ADD CONSTRAINT folder_layer_roles_role_check
    CHECK (role IN ('competencia', 'complementario', 'ancla', 'irrelevante'));

-- Index on group_id for fast lookups
CREATE INDEX IF NOT EXISTS idx_folder_layer_roles_group
  ON public.folder_layer_roles (group_id);