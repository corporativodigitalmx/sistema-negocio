create or replace view public.public_store_catalog
with (security_barrier = true, security_invoker = false)
as
select i.id as item_id,
       i.service,
       coalesce(nullif(trim(i.store_title), ''), i.service) as store_title,
       coalesce(nullif(trim(i.store_description), ''), 'Servicio digital disponible para entrega.') as store_description,
       coalesce(i.profile_capacity, 5) as profile_capacity,
       greatest(coalesce(i.profile_capacity, 5)
         - coalesce(a.profiles, 0)
         - case when jsonb_typeof(i.customers) = 'array' then jsonb_array_length(i.customers) else 0 end, 0)::integer as available_profiles,
       (coalesce(a.full_account, false) = false
         and coalesce(a.profiles, 0) = 0
         and case when jsonb_typeof(i.customers) = 'array' then jsonb_array_length(i.customers) else 0 end = 0) as full_account_available,
       i.store_public_profile_price as profile_price,
       i.store_public_account_price as account_price
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
where i.inventory_operational_status = 'available'
  and i.purchase_date + 28 >= current_date
  and trim(coalesce(cred.username, '')) <> ''
  and trim(coalesce(cred.password, '')) <> '';
grant select on public.public_store_catalog to anon, authenticated;

create or replace view public.reseller_store_catalog
with (security_barrier = true, security_invoker = false)
as
select c.item_id, c.service, c.store_title, c.store_description, c.profile_capacity,
       c.available_profiles, c.full_account_available,
       i.store_reseller_profile_price as profile_price,
       i.store_reseller_account_price as account_price
from public.public_store_catalog c
join public.inventario_cuentas i on i.id = c.item_id
where exists (
  select 1 from public.store_customer_profiles p where p.user_id = auth.uid()
);
grant select on public.reseller_store_catalog to authenticated;
