create or replace function public.poi_counts_by_folder()
returns table(folder_id uuid, cnt bigint)
language sql
stable
security definer
set search_path = public
as $$
  select folder_id, count(*)::bigint as cnt
    from public.pois
   where user_id = auth.uid()
     and deleted_at is null
   group by folder_id;
$$;