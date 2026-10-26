-- Present one catalog row per platform while keeping inventory rows private.
-- Platforms with existing credentials remain visible when their stock is exhausted.
create or replace view public.public_store_catalog
with (security_barrier = true, security_invoker = false)
as
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
         i.store_public_profile_price as profile_price,
         i.store_public_account_price as account_price,
         i.store_reseller_profile_price as reseller_profile_price,
         i.store_reseller_account_price as reseller_account_price
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
  where trim(coalesce(cred.username, '')) <> ''
    and trim(coalesce(cred.password, '')) <> ''
), platform_catalog as (
  select service,
         coalesce(max(nullif(trim(store_title), '')), service) as store_title,
         coalesce(max(nullif(trim(store_description), '')), 'Servicio digital disponible para entrega.') as store_description,
         max(profile_capacity)::integer as profile_capacity,
         coalesce(sum(available_profiles), 0)::integer as available_profiles,
         count(*) filter (where full_account_available)::integer as available_full_accounts,
         (min(profile_price) filter (where available_profiles > 0))::numeric(12,2) as profile_price,
         (min(account_price) filter (where full_account_available))::numeric(12,2) as account_price,
         (min(reseller_profile_price) filter (where available_profiles > 0))::numeric(12,2) as reseller_profile_price,
         (min(reseller_account_price) filter (where full_account_available))::numeric(12,2) as reseller_account_price
  from inventory_rows
  group by service
)
select null::uuid as item_id, service, store_title, store_description, profile_capacity,
       available_profiles, available_full_accounts > 0 as full_account_available,
       profile_price, account_price, available_full_accounts
from platform_catalog;
grant select on public.public_store_catalog to anon, authenticated;

create or replace view public.reseller_store_catalog
with (security_barrier = true, security_invoker = false)
as
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
         i.store_reseller_profile_price as profile_price,
         i.store_reseller_account_price as account_price
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
  where trim(coalesce(cred.username, '')) <> ''
    and trim(coalesce(cred.password, '')) <> ''
), platform_catalog as (
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
select null::uuid as item_id, c.service, c.store_title, c.store_description, c.profile_capacity,
       c.available_profiles, c.available_full_accounts > 0 as full_account_available,
       c.profile_price, c.account_price, c.available_full_accounts
from platform_catalog c
where exists (
  select 1 from public.store_customer_profiles p where p.user_id = auth.uid()
);
grant select on public.reseller_store_catalog to authenticated;

-- Store orders begin as unpaid requests. Inventory is assigned only after an
-- authorized operator confirms payment, so browsing or clicking cannot consume stock.
create or replace function public.request_store_purchase(p_service text, p_delivery_type text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_client public.clients%rowtype;
  v_amount numeric(12,2);
  v_sale_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Inicia sesión para solicitar una compra' using errcode = '42501';
  end if;
  if p_delivery_type not in ('profile', 'full_account') then
    raise exception 'Tipo de entrega no válido';
  end if;
  if coalesce(trim(p_service), '') = '' or char_length(trim(p_service)) > 100 then
    raise exception 'Selecciona una plataforma válida';
  end if;

  select c.* into v_client
  from public.clients c
  join public.store_customer_profiles p on p.user_id = c.auth_user_id
  join public.user_access owner_access on owner_access.user_id = c.user_id and owner_access.role = 'superadmin'
  where c.auth_user_id = auth.uid()
  limit 1;
  if not found then
    raise exception 'No encontramos tu perfil de cliente de tienda';
  end if;

  select case when p_delivery_type = 'profile' then c.profile_price else c.account_price end
    into v_amount
  from public.reseller_store_catalog c
  where c.service = trim(p_service)
    and case when p_delivery_type = 'profile' then c.available_profiles > 0 else c.full_account_available end;
  if not found then
    raise exception 'Esta plataforma o tipo de entrega ya no tiene existencias';
  end if;
  if v_amount is null then
    raise exception 'El precio de esta opción todavía no está configurado';
  end if;

  insert into public.sales(user_id, client_id, inventory_account_id, delivery_type,
      client_name, service, profile_name, sale_date, amount, status, notes)
  values (v_client.user_id, v_client.id, null, p_delivery_type, v_client.full_name,
      trim(p_service), 'Pendiente de pago', current_date, v_amount, 'pending',
      'Solicitud de compra en tienda: pendiente de pago.')
  returning id into v_sale_id;

  return jsonb_build_object('sale_id', v_sale_id, 'service', trim(p_service),
      'delivery_type', p_delivery_type, 'amount', v_amount, 'status', 'pending');
end;
$function$;
revoke all on function public.request_store_purchase(text, text) from public, anon;
grant execute on function public.request_store_purchase(text, text) to authenticated;

create or replace function public.confirm_store_purchase_payment(p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_sale public.sales%rowtype;
  v_account public.inventario_cuentas%rowtype;
  v_profiles integer;
  v_full_account boolean;
  v_legacy_customers integer;
  v_profile text;
  v_slot integer;
  v_assignment_id uuid;
begin
  if auth.uid() is null or not public.has_permission('sales_edit') then
    raise exception 'No tienes permiso para confirmar pagos de tienda' using errcode = '42501';
  end if;

  select s.* into v_sale
  from public.sales s
  where s.id = p_sale_id
    and s.user_id = auth.uid()
    and s.status = 'pending'
    and s.inventory_account_id is null
    and s.notes like 'Solicitud de compra en tienda:%'
  for update;
  if not found then
    raise exception 'La solicitud ya fue procesada o no está disponible';
  end if;

  select i.* into v_account
  from public.inventario_cuentas i
  join private.inventory_account_credentials cred on cred.inventory_account_id = i.id
  left join lateral (
    select count(*) filter (where a.delivery_type = 'profile')::integer as profiles,
           coalesce(bool_or(a.delivery_type = 'full_account'), false) as full_account
    from public.client_account_assignments a
    where a.inventory_account_id = i.id
      and a.assignment_status = 'active'
      and a.starts_on <= current_date
      and a.expires_on >= current_date
  ) usage on true
  where i.user_id = v_sale.user_id
    and i.service = v_sale.service
    and i.inventory_operational_status = 'available'
    and i.purchase_date + 28 >= current_date
    and trim(coalesce(cred.username, '')) <> ''
    and trim(coalesce(cred.password, '')) <> ''
    and not coalesce(usage.full_account, false)
    and case when jsonb_typeof(i.customers) = 'array' then jsonb_array_length(i.customers) else 0 end
        + coalesce(usage.profiles, 0) < i.profile_capacity
    and (v_sale.delivery_type <> 'full_account' or (
      coalesce(usage.profiles, 0) = 0
      and case when jsonb_typeof(i.customers) = 'array' then jsonb_array_length(i.customers) else 0 end = 0
    ))
  order by i.purchase_date asc, i.created_at asc, i.id
  for update of i skip locked
  limit 1;
  if not found then
    raise exception 'El pago no se confirmó: ya no hay inventario disponible para asignar';
  end if;

  if v_sale.delivery_type = 'full_account' then
    v_profile := 'Cuenta completa';
  else
    v_legacy_customers := case when jsonb_typeof(v_account.customers) = 'array' then jsonb_array_length(v_account.customers) else 0 end;
    for v_slot in 1..v_account.profile_capacity loop
      if not exists (
        select 1 from public.client_account_assignments a
        where a.inventory_account_id = v_account.id
          and a.assignment_status = 'active'
          and a.starts_on <= current_date
          and a.expires_on >= current_date
          and lower(a.profile_name) = lower('Perfil ' || v_slot)
      ) then
        v_profile := 'Perfil ' || v_slot;
        exit;
      end if;
    end loop;
    if v_profile is null then
      raise exception 'No se pudo asignar un perfil libre';
    end if;
  end if;

  insert into public.client_account_assignments(user_id, client_id, inventory_account_id,
      profile_name, starts_on, duration_days, notes, delivery_type, sale_id)
  values (v_sale.user_id, v_sale.client_id, v_account.id, v_profile, current_date, 28,
      'Compra confirmada desde tienda.', v_sale.delivery_type, v_sale.id)
  returning id into v_assignment_id;

  update public.sales
    set inventory_account_id = v_account.id,
        profile_name = v_profile,
        status = 'paid',
        notes = 'Solicitud de compra en tienda: pago confirmado y entrega asignada.'
    where id = v_sale.id;

  return jsonb_build_object('sale_id', v_sale.id, 'assignment_id', v_assignment_id,
      'service', v_account.service, 'delivery_type', v_sale.delivery_type,
      'profile_name', v_profile, 'status', 'paid');
end;
$function$;
revoke all on function public.confirm_store_purchase_payment(uuid) from public, anon;
grant execute on function public.confirm_store_purchase_payment(uuid) to authenticated;
