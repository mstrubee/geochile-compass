-- Lint fix: "Security Definer View" — las vistas corren con permisos del
-- dueño por defecto, saltándose el RLS de quien consulta. Forzar que
-- respeten el RLS del usuario que hace la query.
alter view public.v_conveniencias set (security_invoker = true);
alter view public.v_mejoramiento_hogar set (security_invoker = true);
alter view public.v_supermercados set (security_invoker = true);
alter view public.v_farmacias set (security_invoker = true);
alter view public.v_combustibles set (security_invoker = true);
alter view public.v_bancos set (security_invoker = true);
alter view public.v_retail set (security_invoker = true);
alter view public.v_restaurantes set (security_invoker = true);
alter view public.v_centros_comerciales set (security_invoker = true);
alter view public.v_resumen_comercial set (security_invoker = true);
