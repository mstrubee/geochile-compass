-- INVENTARIO DEL ESQUEMA BASE — SOLO LECTURA.  Córrelo en el SQL editor de TU Supabase real y pégame las 9 salidas.
-- Todas son SELECT sobre catálogos del sistema: no modifican nada. No selecciona contraseñas, claves, correos ni el
-- texto de `cron.job.command` (podría contener secretos). Las cuentas de `user_roles` se agregan por rol, sin identificar a nadie.
-- Con tus respuestas se escribe un stub de test MARCADO COMO STUB (hoy no se inventa: ver docs/salud/HALLAZGOS_FASE0.md §8).

-- 1. Roles de base de datos que el repo da por existentes
select rolname, rolsuper, rolbypassrls, rolcanlogin from pg_roles
where rolname in ('anon','authenticated','service_role','authenticator','postgres','supabase_admin') order by 1;

-- 2. Columnas reales de auth.users (los tests insertan: instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, ...)
select column_name, data_type, is_nullable from information_schema.columns where table_schema = 'auth' and table_name = 'users' order by ordinal_position;

-- 3. Definición de auth.uid / auth.role / auth.jwt / auth.email (los tests fijan el usuario con set_config('request.jwt.claims', ...))
select p.proname, pg_get_functiondef(p.oid) as definicion from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'auth' and p.proname in ('uid','role','jwt','email') order by 1;

-- 4. storage: columnas de buckets y objects, y si objects tiene RLS
select table_name, column_name, data_type from information_schema.columns where table_schema = 'storage' and table_name in ('buckets','objects') order by table_name, ordinal_position;
select relname, relrowsecurity from pg_class where relnamespace = 'storage'::regnamespace and relname in ('buckets','objects');

-- 5. Extensiones instaladas (el repo asume pg_cron, pg_trgm, postgis, pgcrypto; el stub NO tiene pg_cron real)
select extname, extversion, extnamespace::regnamespace as esquema from pg_extension order by 1;
select jobid, jobname, schedule from cron.job order by jobid;     -- sin la columna `command`

-- 6. Rol admin (regla 5): valores del enum, cuántos usuarios hay por rol y la definición REAL de has_role con sus grants
select unnest(enum_range(null::public.app_role)) as valor_enum;
select role, count(*) as usuarios from public.user_roles group by role order by 1;
select pg_get_functiondef('public.has_role(uuid, public.app_role)'::regprocedure) as has_role_public;
select pg_get_functiondef('private.has_role(uuid, public.app_role)'::regprocedure) as has_role_private;
select p.oid::regprocedure as funcion, a.grantee::regrole as quien, a.privilege_type
from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
where p.oid in ('public.has_role(uuid, public.app_role)'::regprocedure, 'private.has_role(uuid, public.app_role)'::regprocedure) order by 1, 2;

-- 7. Esquemas expuestos por la API (regla 5: el esquema restringido de conteos completos debe quedar FUERA de esta lista)
select rolname, rolconfig from pg_roles where rolname = 'authenticator';

-- 8. Objetos que el repo referencia y NINGUNA migración crea (o crea después de usarlos)
select to_regclass('public.custom_layers') as custom_layers, to_regclass('public.comercial_carpetas') as comercial_carpetas,
       to_regprocedure('public.fn_marcas_categoria(text)') as fn_marcas_categoria;
select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = 'custom_layers' order by ordinal_position;
select column_name from information_schema.columns where table_schema = 'public' and table_name = 'comercial_carpetas' order by ordinal_position;

-- 9. ¿Cuáles de las migraciones «PROPUESTA (NO APLICADA)» están ya aplicadas en tu base?
select t as tabla, to_regclass('public.' || t) is not null as existe
from unnest(array['comunas','data_sources','source_snapshots','building_permit_statistics','thematic_layers','ine_pe_points','ine_crf_polygons',
                  'building_projects','api_quota_config','poi_isochrones','layer_nodes','pipeline_settings']) as t
order by 1;
