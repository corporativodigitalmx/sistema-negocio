create table public.site_visit_sessions (
  session_hash text primary key check (session_hash ~ '^[a-f0-9]{64}$'),
  country_code char(2) not null default 'XX'
    check (country_code = 'XX' or country_code ~ '^[A-Z]{2}$'),
  visited_at timestamptz not null default now()
);

create index site_visit_sessions_country_code_idx
  on public.site_visit_sessions (country_code);

alter table public.site_visit_sessions enable row level security;

create policy "Superusuarios consultan visitas de la tienda"
  on public.site_visit_sessions
  for select to authenticated
  using (public.is_superadmin());

create or replace view public.site_visit_country_summary
with (security_invoker = true)
as
select country_code, count(*)::bigint as visits
from public.site_visit_sessions
group by country_code;

revoke all on public.site_visit_sessions from public, anon, authenticated, service_role;
grant select on public.site_visit_sessions to authenticated;
grant insert on public.site_visit_sessions to service_role;

revoke all on public.site_visit_country_summary from public, anon, authenticated;
grant select on public.site_visit_country_summary to authenticated;

notify pgrst, 'reload schema';
