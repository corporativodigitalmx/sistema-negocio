-- Public catalog and store customer profiles. Credentials and inventory identifiers
-- remain private; only explicitly published display fields are exposed.
alter table public.inventario_cuentas
  add column if not exists store_published boolean not null default false,
  add column if not exists store_title text not null default '',
  add column if not exists store_description text not null default '',
  add column if not exists store_public_profile_price numeric(12,2),
  add column if not exists store_public_account_price numeric(12,2),
  add column if not exists store_reseller_profile_price numeric(12,2),
  add column if not exists store_reseller_account_price numeric(12,2);

alter table public.inventario_cuentas drop constraint if exists inventario_cuentas_store_prices_check;
alter table public.inventario_cuentas add constraint inventario_cuentas_store_prices_check check (
  (store_public_profile_price is null or store_public_profile_price >= 0) and
  (store_public_account_price is null or store_public_account_price >= 0) and
  (store_reseller_profile_price is null or store_reseller_profile_price >= 0) and
  (store_reseller_account_price is null or store_reseller_account_price >= 0)
);
alter table public.inventario_cuentas drop constraint if exists inventario_cuentas_store_reseller_discount_check;
alter table public.inventario_cuentas add constraint inventario_cuentas_store_reseller_discount_check check (
  (store_reseller_profile_price is null or store_public_profile_price is null or store_reseller_profile_price < store_public_profile_price) and
  (store_reseller_account_price is null or store_public_account_price is null or store_reseller_account_price < store_public_account_price)
);

create table if not exists public.store_customer_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(trim(full_name)) between 2 and 120),
  email text not null,
  whatsapp text not null check (char_length(trim(whatsapp)) between 8 and 24),
  tier text not null default 'reseller' check (tier in ('reseller')),
  created_at timestamptz not null default now()
);
alter table public.store_customer_profiles enable row level security;
revoke all on public.store_customer_profiles from anon, authenticated;
grant select on public.store_customer_profiles to authenticated;
create policy store_customer_profile_self_read on public.store_customer_profiles
  for select to authenticated using (user_id = auth.uid());

alter table public.clients add column if not exists email text not null default '';
alter table public.clients add column if not exists auth_user_id uuid references auth.users(id) on delete set null;
create unique index if not exists clients_auth_user_id_idx on public.clients(auth_user_id) where auth_user_id is not null;

create or replace function public.create_user_access_for_auth_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.raw_user_meta_data ->> 'buyer_type' = 'store_customer' then
    insert into public.store_customer_profiles(user_id, full_name, email, whatsapp)
    values (new.id,
      coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'Cliente'),
      lower(coalesce(new.email, '')),
      coalesce(new.raw_user_meta_data ->> 'whatsapp', ''))
    on conflict (user_id) do update set
      full_name = excluded.full_name, email = excluded.email, whatsapp = excluded.whatsapp;

    insert into public.clients(user_id, auth_user_id, full_name, email, phone, notes)
    select ua.user_id, new.id,
      coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'Cliente'),
      lower(coalesce(new.email, '')),
      coalesce(new.raw_user_meta_data ->> 'whatsapp', ''),
      'Cliente registrado desde la tienda en línea'
    from public.user_access ua where ua.role = 'superadmin'
    order by ua.created_at limit 1
    on conflict (auth_user_id) where auth_user_id is not null do update set
      full_name = excluded.full_name, email = excluded.email, phone = excluded.phone, updated_at = now();
    return new;
  end if;

  insert into public.user_access (user_id, email, full_name)
  values (new.id, lower(coalesce(new.email, '')), coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (user_id) do update set
    email = excluded.email,
    full_name = case when excluded.full_name = '' then public.user_access.full_name else excluded.full_name end,
    updated_at = now();
  return new;
end;
$$;

create or replace view public.public_store_catalog
with (security_barrier = true, security_invoker = false)
as
select i.id as item_id, i.service, i.store_title, i.store_description,
       i.profile_capacity,
       greatest(i.profile_capacity - coalesce(a.profiles, 0) - case when jsonb_typeof(i.customers) = 'array' then jsonb_array_length(i.customers) else 0 end, 0)::integer as available_profiles,
       (coalesce(a.full_account, false) = false and coalesce(a.profiles, 0) = 0 and case when jsonb_typeof(i.customers) = 'array' then jsonb_array_length(i.customers) else 0 end = 0) as full_account_available,
       i.store_public_profile_price as profile_price,
       i.store_public_account_price as account_price
from public.inventario_cuentas i
join public.user_access owner_access on owner_access.user_id = i.user_id and owner_access.role = 'superadmin'
left join lateral (
  select count(*) filter (where ca.delivery_type = 'profile')::integer as profiles,
         coalesce(bool_or(ca.delivery_type = 'full_account'), false) as full_account
  from public.client_account_assignments ca
  where ca.inventory_account_id = i.id and ca.starts_on <= current_date and ca.expires_on >= current_date
) a on true
where i.store_published = true and trim(i.store_title) <> '';
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
where exists (select 1 from public.store_customer_profiles p where p.user_id = auth.uid());
grant select on public.reseller_store_catalog to authenticated;
