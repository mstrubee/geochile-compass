create or replace function public.admin_create_user(
  p_email text, p_password text, p_make_admin boolean default false, p_custom_role_id uuid default null
) returns uuid
language plpgsql security definer
set search_path = public, auth, extensions
as $fn$
declare v_uid uuid := gen_random_uuid(); v_email text := lower(trim(p_email));
begin
  if not public.has_role(auth.uid(), 'admin'::app_role) then
    raise exception 'forbidden: se requiere admin';
  end if;
  if v_email is null or v_email = '' or length(p_password) < 6 then
    raise exception 'email y contraseña (mínimo 6) requeridos';
  end if;
  if exists (select 1 from auth.users where email = v_email) then
    raise exception 'Ya existe un usuario con ese email';
  end if;
  insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,phone_change,phone_change_token,reauthentication_token)
  values ('00000000-0000-0000-0000-000000000000',v_uid,'authenticated','authenticated',v_email,crypt(p_password,gen_salt('bf')),now(),now(),now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,false,'','','','','','','','');
  insert into auth.identities (id,user_id,provider_id,provider,identity_data,created_at,updated_at,last_sign_in_at)
  values (gen_random_uuid(),v_uid,v_uid::text,'email',jsonb_build_object('sub',v_uid::text,'email',v_email,'email_verified',true),now(),now(),now());
  if p_make_admin then insert into public.user_roles(user_id,role) values (v_uid,'admin') on conflict do nothing; end if;
  if p_custom_role_id is not null then insert into public.user_role_assignments(user_id,custom_role_id) values (v_uid,p_custom_role_id) on conflict do nothing; end if;
  return v_uid;
end; $fn$;
revoke all on function public.admin_create_user(text,text,boolean,uuid) from public, anon;
grant execute on function public.admin_create_user(text,text,boolean,uuid) to authenticated;
