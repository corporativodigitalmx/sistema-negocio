-- Keep public storefront catalog behind a narrow, explicit data boundary.
-- Only inventory explicitly published for the store may contribute public prices or availability.
create or replace function private._store_catalog_rows(p_reseller boolean)
returns table (
  item_id uuid,
  service text,
  store_title text,
  store_description text,
  profile_capacity integer,
  available_profiles integer,
  full_account_available boolean,
  profile_price numeric(12,2),
  account_price numeric(12,2),
  available_full_accounts integer
)
language sql
stable
security definer
set search_path = ''
as $function$
  with inventory_rows as (
    select i.service,
           coalesce(nullif(trim(i.store_title), ''), i.service) as store_title,
           coalesce(nullif(trim(i.store_description), ''), 'Servicio digital disponible para entrega.') as store_description,
           coalesce(i.profile_capacity, 5) as profile_capacity,
           case when i.inventory_operational_status = 'available'
                      and i.purchase_date + 28 >= current_date
                      and not coalesce(a.full_account, false)
                then greatest(coalesce(i.profile_capacity, 5) - coalesce(a.profiles, 0)
                     - case when jsonb_typeof(i.customers) = 'array' then jsonb_array_length(i.customers) else 0 end, 0)::integer
                else 0 end as available_profiles,
           (i.inventory_operational_status = 'available'
            and i.purchase_date + 28 >= current_date
            and coalesce(a.full_account, false) = false
            and coalesce(a.profiles, 0) = 0
            and case when jsonb_typeof(i.customers) = 'array' then jsonb_array_length(i.customers) else 0 end = 0) as full_account_available,
           case when p_reseller then i.store_reseller_profile_price else i.store_public_profile_price end as profile_price,
           case when p_reseller then i.store_reseller_account_price else i.store_public_account_price end as account_price
    from public.inventario_cuentas i
    join public.user_access owner_access
      on owner_access.user_id = i.user_id and owner_access.role = 'superadmin'
    join private.inventory_account_credentials cred
      on cred.inventory_account_id = i.id
    left join lateral (
      select count(*) filter (where ca.delivery_type = 'profile')::integer as profiles,
             coalesce(bool_or(ca.delivery_type = 'full_account'), false) as full_account
      from public.client_account_assignments ca
      where ca.inventory_account_id = i.id
        and ca.assignment_status = 'active'
        and ca.starts_on <= current_date
        and ca.expires_on >= current_date
    ) a on true
    where i.store_published is true
      and trim(coalesce(cred.username, '')) <> ''
      and trim(coalesce(cred.password, '')) <> ''
  ),
  platform_catalog as (
    select service,
           coalesce(max(nullif(trim(store_title), '')), service) as store_title,
           coalesce(max(nullif(trim(store_description), '')), 'Servicio digital disponible para entrega.') as store_description,
           max(profile_capacity)::integer as profile_capacity,
           coalesce(sum(available_profiles), 0)::integer as available_profiles,
           count(*) filter (where full_account_available)::integer as available_full_accounts,
           (min(profile_price) filter (where available_profiles > 0))::numeric(12,2) as profile_price,
           (min(account_price) filter (where full_account_available))::numeric(12,2) as account_price
    from inventory_rows
    group by service
  )
  select null::uuid, service, store_title, store_description, profile_capacity,
         available_profiles, available_full_accounts > 0,
         profile_price, account_price, available_full_accounts
  from platform_catalog;
$function$;

revoke all on function private._store_catalog_rows(boolean) from public, anon, authenticated;

create or replace function private.public_store_catalog_rows()
returns table (
  item_id uuid,
  service text,
  store_title text,
  store_description text,
  profile_capacity integer,
  available_profiles integer,
  full_account_available boolean,
  profile_price numeric(12,2),
  account_price numeric(12,2),
  available_full_accounts integer
)
language sql
stable
security definer
set search_path = ''
as $function$
  select * from private._store_catalog_rows(false);
$function$;

create or replace function private.reseller_store_catalog_rows()
returns table (
  item_id uuid,
  service text,
  store_title text,
  store_description text,
  profile_capacity integer,
  available_profiles integer,
  full_account_available boolean,
  profile_price numeric(12,2),
  account_price numeric(12,2),
  available_full_accounts integer
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not exists (
    select 1 from public.store_customer_profiles p where p.user_id = auth.uid()
  ) then
    return;
  end if;

  return query select * from private._store_catalog_rows(true);
end;
$function$;

revoke all on function private.public_store_catalog_rows() from public, anon, authenticated;
revoke all on function private.reseller_store_catalog_rows() from public, anon, authenticated;
grant usage on schema private to anon, authenticated;
grant execute on function private.public_store_catalog_rows() to anon, authenticated;
grant execute on function private.reseller_store_catalog_rows() to authenticated;

create or replace view public.public_store_catalog
with (security_barrier = true, security_invoker = true)
as
select item_id, service, store_title, store_description, profile_capacity,
       available_profiles, full_account_available,
       profile_price::numeric(12,2) as profile_price,
       account_price::numeric(12,2) as account_price,
       available_full_accounts
from private.public_store_catalog_rows();

create or replace view public.reseller_store_catalog
with (security_barrier = true, security_invoker = true)
as
select item_id, service, store_title, store_description, profile_capacity,
       available_profiles, full_account_available,
       profile_price::numeric(12,2) as profile_price,
       account_price::numeric(12,2) as account_price,
       available_full_accounts
from private.reseller_store_catalog_rows();

grant select on public.public_store_catalog to anon, authenticated;
grant select on public.reseller_store_catalog to authenticated;

-- These routines already check the signed-in user in their bodies. Keep only
-- pg_catalog on the search path so untrusted schemas cannot shadow built-ins.
alter function public.assign_client_account(uuid, uuid, text, date, text) set search_path = pg_catalog;
alter function public.can_assign_client_account(uuid, uuid, uuid) set search_path = pg_catalog;
alter function public.create_inventory_sale(uuid, uuid, text, date, numeric, text) set search_path = pg_catalog;
alter function public.create_user_access_for_auth_user() set search_path = pg_catalog;
alter function public.is_superadmin() set search_path = pg_catalog;
alter function public.register_sale_payment(uuid, numeric, text, date, text, text) set search_path = pg_catalog;
alter function public.report_inventory_issue(uuid, text) set search_path = pg_catalog;
alter function public.resolve_inventory_issue(uuid, text, uuid) set search_path = pg_catalog;

-- The auth trigger creates profiles with owner privileges; direct open-ended inserts are unnecessary.
drop policy if exists "Allow insert" on public.profiles;
