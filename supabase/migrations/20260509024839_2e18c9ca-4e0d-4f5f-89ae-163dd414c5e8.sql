-- Custom roles definidos por admin
CREATE TABLE public.custom_roles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  -- permissions: { "<section_key>": { "view": bool, "edit": bool } }
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.custom_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authed read custom roles" ON public.custom_roles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins ins custom roles" ON public.custom_roles
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins upd custom roles" ON public.custom_roles
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins del custom roles" ON public.custom_roles
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_custom_roles_updated
  BEFORE UPDATE ON public.custom_roles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Asignación usuario -> custom role (puede tener varios)
CREATE TABLE public.user_role_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  custom_role_id UUID NOT NULL REFERENCES public.custom_roles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, custom_role_id)
);

ALTER TABLE public.user_role_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own assignments" ON public.user_role_assignments
  FOR SELECT TO authenticated USING (
    auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role)
  );
CREATE POLICY "Admins ins assignments" ON public.user_role_assignments
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins upd assignments" ON public.user_role_assignments
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins del assignments" ON public.user_role_assignments
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_ura_user ON public.user_role_assignments(user_id);

-- Función: permisos efectivos del usuario (unión OR de sus roles)
CREATE OR REPLACE FUNCTION public.user_section_permissions(_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB := '{}'::jsonb;
  rec RECORD;
  k TEXT;
  v JSONB;
BEGIN
  -- Admin siempre tiene todo
  IF public.has_role(_user_id, 'admin'::app_role) THEN
    RETURN '{"__admin": true}'::jsonb;
  END IF;
  FOR rec IN
    SELECT cr.permissions
      FROM public.user_role_assignments ura
      JOIN public.custom_roles cr ON cr.id = ura.custom_role_id
     WHERE ura.user_id = _user_id
  LOOP
    FOR k, v IN SELECT * FROM jsonb_each(rec.permissions) LOOP
      result := jsonb_set(
        result,
        ARRAY[k],
        jsonb_build_object(
          'view', COALESCE((result->k->>'view')::bool, false) OR COALESCE((v->>'view')::bool, false),
          'edit', COALESCE((result->k->>'edit')::bool, false) OR COALESCE((v->>'edit')::bool, false)
        ),
        true
      );
    END LOOP;
  END LOOP;
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.user_section_permissions(UUID)
  TO authenticated, anon, service_role;

-- Vista útil para el panel admin: lista de usuarios con email
-- (auth.users no es accesible vía PostgREST, usamos función SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE(user_id UUID, email TEXT, created_at TIMESTAMPTZ, is_admin BOOLEAN)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
    SELECT u.id, u.email::text, u.created_at,
           EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role = 'admin'::app_role)
      FROM auth.users u
     ORDER BY u.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;