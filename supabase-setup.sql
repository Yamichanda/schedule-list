-- Run once in this project's Supabase SQL Editor. No passwords or secret keys needed.
begin;
create table if not exists public.shiori_calendars (
 user_id uuid primary key references auth.users(id) on delete cascade,
 events jsonb not null default '[]'::jsonb,
 templates jsonb not null default '[]'::jsonb,
 revision bigint not null default 1 check (revision > 0),
 updated_at timestamptz not null default now(),
 constraint shiori_events_array check (jsonb_typeof(events)='array' and jsonb_array_length(events)<=5000),
 constraint shiori_templates_array check (jsonb_typeof(templates)='array' and jsonb_array_length(templates)<=100),
 constraint shiori_payload_limit check (octet_length(events::text)+octet_length(templates::text)<=2000000)
);
alter table public.shiori_calendars enable row level security;
revoke all on public.shiori_calendars from anon;
revoke all on public.shiori_calendars from authenticated;
grant select,insert,update on public.shiori_calendars to authenticated;
drop policy if exists shiori_owner_select on public.shiori_calendars;
drop policy if exists shiori_owner_insert on public.shiori_calendars;
drop policy if exists shiori_owner_update on public.shiori_calendars;
create policy shiori_owner_select on public.shiori_calendars for select to authenticated using ((select auth.uid())=user_id);
create policy shiori_owner_insert on public.shiori_calendars for insert to authenticated with check ((select auth.uid())=user_id);
create policy shiori_owner_update on public.shiori_calendars for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create or replace function public.shiori_save(p_revision bigint,p_events jsonb,p_templates jsonb)
returns setof public.shiori_calendars
language plpgsql security invoker set search_path = '' as $$
declare uid uuid := auth.uid(); saved public.shiori_calendars%rowtype;
begin
 if uid is null then raise exception 'authentication_required' using errcode='42501'; end if;
 if p_revision is null or p_revision<0 then raise exception 'invalid_revision' using errcode='22023'; end if;
 if p_revision=0 then
  insert into public.shiori_calendars(user_id,events,templates,revision) values(uid,p_events,p_templates,1)
  on conflict(user_id) do nothing returning * into saved;
 else
  update public.shiori_calendars set events=p_events,templates=p_templates,revision=revision+1,updated_at=now()
  where user_id=uid and revision=p_revision returning * into saved;
 end if;
 if saved.user_id is null then raise exception 'shiori_conflict' using errcode='40001'; end if;
 return next saved;
end;
$$;
revoke all on function public.shiori_save(bigint,jsonb,jsonb) from public,anon;
grant execute on function public.shiori_save(bigint,jsonb,jsonb) to authenticated;
commit;

