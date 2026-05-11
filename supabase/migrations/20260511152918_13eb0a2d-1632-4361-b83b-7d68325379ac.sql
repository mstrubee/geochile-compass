CREATE TABLE IF NOT EXISTS public._tmp_users_diag (id uuid, email text, created_at timestamptz);
TRUNCATE public._tmp_users_diag;
INSERT INTO public._tmp_users_diag SELECT id, email, created_at FROM auth.users;
ALTER TABLE public._tmp_users_diag ENABLE ROW LEVEL SECURITY;