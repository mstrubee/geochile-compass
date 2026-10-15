-- ROLLBACK de 20261015130000_api_quota.sql. Solo borra objetos que esa migración creó
-- (ninguna tabla ni dato previo). Se pierden el consumo del mes y la bitácora de ampliaciones.
drop function if exists public.list_api_quota_extensions();
drop function if exists public.extend_api_quota(text, text);
drop function if exists public.set_api_quota_limit(text, integer, text);
drop function if exists public.set_api_quota_password(text, text);
drop function if exists public.has_api_quota_password();
drop function if exists public.get_api_quota_status();
drop function if exists public.consume_api_quota(text, integer);
drop function if exists public._api_quota_check_password(text);
drop function if exists public._api_quota_require_admin();
drop function if exists public._api_quota_period();
drop table if exists public.api_quota_extensions;
drop table if exists public.api_quota_usage;
drop table if exists public.api_quota_admin;
drop table if exists public.api_quota_config;
