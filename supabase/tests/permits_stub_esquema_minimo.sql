-- Esquema MÍNIMO que imita lo que ya existe en el repo (solo para probar las migraciones propuestas)
do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if; end $$;
create schema auth; create schema private; create schema cron; create schema storage;
grant usage on schema public, auth, private to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create type public.app_role as enum ('admin','user');
create function public.has_role(_user_id uuid, _role public.app_role) returns boolean language sql stable as $$ select _user_id = '00000000-0000-0000-0000-0000000000aa'::uuid and _role='admin' $$;
create function private.has_role(_user_id uuid, _role public.app_role) returns boolean language sql stable as $$ select public.has_role(_user_id,_role) $$;
create table public._migration_log (id serial primary key, applied_at timestamptz not null default now(), sprint text, notes text);
create table cron.job (jobid serial, jobname text unique, schedule text, command text);
create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job(jobname,schedule,command) values (n,s,c) on conflict (jobname) do update set schedule=excluded.schedule returning jobid::bigint $$;
create function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname=n returning true $$;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid default gen_random_uuid(), bucket_id text);
alter table storage.objects enable row level security;
create extension if not exists postgis;
-- layer_nodes: DDL real del repo (sin trigger guard)
create table public.layer_nodes (
  id uuid primary key default gen_random_uuid(), parent_id uuid references public.layer_nodes(id) on delete cascade,
  kind text not null check (kind in ('folder','layer')), name text not null check (btrim(name) <> ''),
  position text not null collate "C", style jsonb not null default '{}'::jsonb,
  scope text not null default 'shared' check (scope in ('shared','personal')), owner_id uuid references auth.users(id) on delete cascade,
  archived_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create function public._layer_nodes_next_position(p_parent uuid) returns text language sql as
$$ select coalesce((select max(position) from public.layer_nodes where parent_id is not distinct from p_parent),'a') || 'V' $$;
create table public.territorial_layers (id uuid primary key default gen_random_uuid(), group_id uuid not null references public.layer_nodes(id) on delete cascade,
  name text not null, color text, icon text, order_index int not null default 0, source_file_id uuid, feature_count int not null default 0, bbox jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(group_id,name));
create table public.territorial_features (id uuid primary key default gen_random_uuid(), layer_id uuid not null references public.territorial_layers(id) on delete cascade, geometry jsonb not null default '{}');
-- puente legacy (réplica de trg_legacy_layer_before_insert / _after)
create function public.trg_legacy_layer_before_insert() returns trigger language plpgsql as $$ begin
  insert into public.layer_nodes (id,parent_id,kind,name,position,style,scope) values (new.id,new.group_id,'layer',new.name,public._layer_nodes_next_position(new.group_id),jsonb_strip_nulls(jsonb_build_object('color',new.color,'icon',new.icon)),'shared') on conflict (id) do nothing; return new; end $$;
create trigger trg_legacy_layer_before_insert before insert on public.territorial_layers for each row execute function public.trg_legacy_layer_before_insert();
create function public.trg_legacy_layer_after() returns trigger language plpgsql as $$ begin delete from public.layer_nodes where id=old.id and kind='layer'; return old; end $$;
create trigger trg_legacy_layer_after after delete on public.territorial_layers for each row execute function public.trg_legacy_layer_after();
-- datos previos para comprobar "cero pérdida"
insert into public.layer_nodes (id,kind,name,position,style) values ('11111111-1111-1111-1111-111111111111','folder','Carpeta previa','a0','{"slug":"previa"}');
insert into public.territorial_layers (id,group_id,name) values ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','Capa previa');
insert into public.territorial_features (layer_id) values ('22222222-2222-2222-2222-222222222222');
