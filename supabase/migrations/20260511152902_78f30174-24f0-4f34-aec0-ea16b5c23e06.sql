DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id, email, created_at FROM auth.users ORDER BY created_at LOOP
    RAISE NOTICE 'USER % | % | %', r.id, r.email, r.created_at;
  END LOOP;
END $$;