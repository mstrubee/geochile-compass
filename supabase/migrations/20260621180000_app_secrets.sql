-- app_secrets: API keys / secretos gestionables desde el panel admin.
-- Las edge functions los leen vía service_role (con fallback a variables de entorno).
create table if not exists public.app_secrets (
  key text primary key,
  value text not null default '',
  description text,
  updated_at timestamptz not null default now()
);

alter table public.app_secrets enable row level security;

drop policy if exists "app_secrets_admin_all" on public.app_secrets;
create policy "app_secrets_admin_all" on public.app_secrets
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

grant select, insert, update, delete on public.app_secrets to authenticated;
grant all on public.app_secrets to service_role;

create or replace function public.update_updated_at_column()
returns trigger as $$ begin new.updated_at = now(); return new; end; $$ language plpgsql set search_path = public;

drop trigger if exists update_app_secrets_updated_at on public.app_secrets;
create trigger update_app_secrets_updated_at before update on public.app_secrets
  for each row execute function public.update_updated_at_column();

-- Slots conocidos (vacíos, para que el admin los complete desde la UI)
insert into public.app_secrets (key, description) values
  ('OPENROUTESERVICE_API_KEY', 'Token de OpenRouteService para isócronas — openrouteservice.org'),
  ('GITHUB_TOKEN',             'Personal Access Token de GitHub para trigger-sync'),
  ('GOOGLE_DRIVE_API_KEY',     'API key de Google Cloud para ingesta territorial (Drive)')
on conflict (key) do nothing;
