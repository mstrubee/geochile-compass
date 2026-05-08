CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  );
$$;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM authenticated;
REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated;

ALTER POLICY "Admins can view all roles" ON public.user_roles
USING (private.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY "Admins manage roles del" ON public.user_roles
USING (private.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY "Admins manage roles ins" ON public.user_roles
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY "Admins manage roles upd" ON public.user_roles
USING (private.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY "Admins del features" ON public.territorial_features
USING (private.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY "Admins ins features" ON public.territorial_features
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY "Admins upd features" ON public.territorial_features
USING (private.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY "Admins del groups" ON public.territorial_layer_groups
USING (private.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY "Admins ins groups" ON public.territorial_layer_groups
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY "Admins upd groups" ON public.territorial_layer_groups
USING (private.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY "Admins del layers" ON public.territorial_layers
USING (private.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY "Admins ins layers" ON public.territorial_layers
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY "Admins upd layers" ON public.territorial_layers
USING (private.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY "Admins del source files" ON public.territorial_source_files
USING (private.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY "Admins ins source files" ON public.territorial_source_files
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY "Admins upd source files" ON public.territorial_source_files
USING (private.has_role(auth.uid(), 'admin'::public.app_role));