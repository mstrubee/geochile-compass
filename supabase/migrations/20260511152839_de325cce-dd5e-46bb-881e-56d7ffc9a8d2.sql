-- Otorgar rol admin a matiasstrube@gplanet.cl si existe la cuenta
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'admin'::app_role
  FROM auth.users u
 WHERE lower(u.email) = 'matiasstrube@gplanet.cl'
ON CONFLICT DO NOTHING;