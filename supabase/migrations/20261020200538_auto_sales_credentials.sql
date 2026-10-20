-- Keep credentials outside exposed public schemas; only guarded RPCs may read them.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.inventory_account_credentials (
  inventory_account_id uuid primary key references public.inventario_cuentas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  username text not null default '',
  password text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table private.inventory_account_credentials enable row level security;
revoke all on table private.inventory_account_credentials from public, anon, authenticated, service_role;

create or replace function public.get_inventory_account_credentials(p_inventory_account_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog
as $function$
declare v_username text; v_password text;
begin
  if auth.uid() is null or not (public.has_permission('inventory_edit') or public.has_permission('inventory_all')) then
    raise exception 'No tienes permiso para consultar accesos de inventario' using errcode = '42501';
  end if;
  if not exists (select 1 from public.inventario_cuentas i where i.id = p_inventory_account_id
    and (i.user_id = auth.uid() or public.has_permission('inventory_all'))) then
    raise exception 'La cuenta no existe o no pertenece a tu inventario' using errcode = '42501';
  end if;
  select c.username, c.password into v_username, v_password
  from private.inventory_account_credentials c where c.inventory_account_id = p_inventory_account_id;
  return jsonb_build_object('username', coalesce(v_username, ''), 'password', coalesce(v_password, ''));
end;
$function$;
revoke all on function public.get_inventory_account_credentials(uuid) from public, anon;
grant execute on function public.get_inventory_account_credentials(uuid) to authenticated;

create or replace function public.save_inventory_account_credentials(p_inventory_account_id uuid, p_username text, p_password text)
returns void language plpgsql security definer set search_path = pg_catalog
as $function$
declare v_owner_id uuid;
begin
  if auth.uid() is null or not (public.has_permission('inventory_edit') or public.has_permission('inventory_all')) then
    raise exception 'No tienes permiso para editar accesos de inventario' using errcode = '42501';
  end if;
  if char_length(coalesce(p_username, '')) > 254 or char_length(coalesce(p_password, '')) > 500 then
    raise exception 'El usuario o la contraseña excede el largo permitido';
  end if;
  select i.user_id into v_owner_id from public.inventario_cuentas i where i.id = p_inventory_account_id
    and (i.user_id = auth.uid() or public.has_permission('inventory_all'));
  if not found then raise exception 'La cuenta no existe o no pertenece a tu inventario' using errcode = '42501'; end if;
  if coalesce(trim(p_username), '') = '' and coalesce(p_password, '') = '' then
    delete from private.inventory_account_credentials where inventory_account_id = p_inventory_account_id;
    return;
  end if;
  insert into private.inventory_account_credentials(inventory_account_id, user_id, username, password)
  values (p_inventory_account_id, v_owner_id, coalesce(trim(p_username), ''), coalesce(p_password, ''))
  on conflict (inventory_account_id) do update set user_id = excluded.user_id,
    username = excluded.username, password = excluded.password, updated_at = now();
end;
$function$;
revoke all on function public.save_inventory_account_credentials(uuid, text, text) from public, anon;
grant execute on function public.save_inventory_account_credentials(uuid, text, text) to authenticated;

create or replace function public.available_inventory_services(p_sale_date date, p_delivery_type text)
returns table(service text, accounts_available integer)
language plpgsql stable security definer set search_path = pg_catalog
as $function$
begin
  if auth.uid() is null or not public.has_permission('sales_edit') then
    raise exception 'No tienes permiso para consultar plataformas disponibles' using errcode = '42501';
  end if;
  if p_delivery_type not in ('profile', 'full_account') then raise exception 'Tipo de entrega no válido'; end if;
  return query
  select i.service, count(*)::integer
  from public.inventario_cuentas i
  join private.inventory_account_credentials cred on cred.inventory_account_id = i.id
  left join lateral (
    select count(*) filter (where a.delivery_type = 'profile')::integer as profiles,
      coalesce(bool_or(a.delivery_type = 'full_account'), false) as full_account
    from public.client_account_assignments a
    where a.inventory_account_id = i.id and a.assignment_status = 'active'
      and a.starts_on <= coalesce(p_sale_date, current_date) + 28
      and a.expires_on >= coalesce(p_sale_date, current_date)
  ) usage on true
  where i.user_id = auth.uid() and i.inventory_operational_status = 'available'
    and i.purchase_date + 28 >= coalesce(p_sale_date, current_date)
    and trim(cred.username) <> '' and cred.password <> ''
    and case when jsonb_typeof(i.customers) = 'array' then jsonb_array_length(i.customers) else 0 end
      + coalesce(usage.profiles, 0) < i.profile_capacity
    and not coalesce(usage.full_account, false)
    and (p_delivery_type <> 'full_account' or (
      coalesce(usage.profiles, 0) = 0
      and case when jsonb_typeof(i.customers) = 'array' then jsonb_array_length(i.customers) else 0 end = 0
    ))
  group by i.service order by i.service;
end;
$function$;
revoke all on function public.available_inventory_services(date, text) from public, anon;
grant execute on function public.available_inventory_services(date, text) to authenticated;

-- Create a sale atomically: the client may be new, and inventory selection is server-side.
create or replace function public.create_inventory_sale_auto(
  p_client_id uuid, p_client_name text, p_client_phone text, p_service text,
  p_delivery_type text, p_sale_date date, p_amount numeric, p_notes text
)
returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $function$
declare
  v_client public.clients%rowtype;
  v_account public.inventario_cuentas%rowtype;
  v_username text;
  v_password text;
  v_profiles integer;
  v_full boolean;
  v_legacy_customers integer;
  v_profile text;
  v_slot integer;
  v_sale_id uuid;
  v_assignment_id uuid;
  v_start date := coalesce(p_sale_date, current_date);
begin
  if auth.uid() is null or not public.has_permission('sales_edit') then
    raise exception 'No tienes permiso para registrar ventas' using errcode = '42501';
  end if;
  if p_delivery_type not in ('profile', 'full_account') then raise exception 'Tipo de entrega no válido'; end if;
  if coalesce(trim(p_service), '') = '' or char_length(p_service) > 100 then raise exception 'Selecciona una plataforma válida'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'El importe no puede ser negativo'; end if;

  if p_client_id is null then
    if not public.has_permission('clients_edit') then raise exception 'No tienes permiso para registrar un cliente nuevo' using errcode = '42501'; end if;
    if char_length(trim(coalesce(p_client_name, ''))) not between 2 and 120 then raise exception 'Escribe el nombre completo del cliente'; end if;
    if char_length(trim(coalesce(p_client_phone, ''))) not between 10 and 24 then raise exception 'Escribe un WhatsApp válido del cliente'; end if;
  else
    select * into v_client from public.clients c where c.id = p_client_id and c.user_id = auth.uid();
    if not found then raise exception 'El cliente no existe en tu cuenta'; end if;
  end if;

  select i.* into v_account
  from public.inventario_cuentas i
  join private.inventory_account_credentials cred on cred.inventory_account_id = i.id
  left join lateral (
    select count(*) filter (where a.delivery_type = 'profile')::integer as profiles,
      coalesce(bool_or(a.delivery_type = 'full_account'), false) as full_account
    from public.client_account_assignments a
    where a.inventory_account_id = i.id and a.assignment_status = 'active'
      and a.starts_on <= v_start + 28 and a.expires_on >= v_start
  ) usage on true
  where i.user_id = auth.uid() and i.service = trim(p_service)
    and i.inventory_operational_status = 'available' and i.purchase_date + 28 >= v_start
    and trim(cred.username) <> '' and cred.password <> ''
    and case when jsonb_typeof(i.customers) = 'array' then jsonb_array_length(i.customers) else 0 end
      + coalesce(usage.profiles, 0) < i.profile_capacity
    and not coalesce(usage.full_account, false)
    and (p_delivery_type <> 'full_account' or (
      coalesce(usage.profiles, 0) = 0
      and case when jsonb_typeof(i.customers) = 'array' then jsonb_array_length(i.customers) else 0 end = 0
    ))
  order by i.purchase_date asc, i.created_at asc, i.id
  for update of i skip locked
  limit 1;
  if not found then
    raise exception 'No hay cuentas con usuario y contraseña disponibles para % (%).', trim(p_service),
      case when p_delivery_type = 'full_account' then 'cuenta completa' else 'perfil' end;
  end if;

  select cred.username, cred.password into v_username, v_password
  from private.inventory_account_credentials cred where cred.inventory_account_id = v_account.id;
  if p_delivery_type = 'full_account' then
    v_profile := 'Cuenta completa';
  else
    select count(*) filter (where a.delivery_type = 'profile')::integer,
      coalesce(bool_or(a.delivery_type = 'full_account'), false)
      into v_profiles, v_full
    from public.client_account_assignments a
    where a.inventory_account_id = v_account.id and a.assignment_status = 'active'
      and a.starts_on <= v_start + 28 and a.expires_on >= v_start;
    v_legacy_customers := case when jsonb_typeof(v_account.customers) = 'array' then jsonb_array_length(v_account.customers) else 0 end;
    for v_slot in 1..v_account.profile_capacity loop
      if not exists (
        select 1 from public.client_account_assignments a
        where a.inventory_account_id = v_account.id and a.assignment_status = 'active'
          and a.starts_on <= v_start + 28 and a.expires_on >= v_start
          and lower(a.profile_name) = lower('Perfil ' || v_slot)
      ) then v_profile := 'Perfil ' || v_slot; exit; end if;
    end loop;
    if v_profile is null and coalesce(v_profiles, 0) + v_legacy_customers < v_account.profile_capacity then
      v_profile := 'Perfil ' || (coalesce(v_profiles, 0) + v_legacy_customers + 1);
    end if;
    if v_profile is null then raise exception 'Esta cuenta ya no tiene perfiles disponibles'; end if;
  end if;

  if p_client_id is null then
    insert into public.clients(user_id, full_name, phone)
    values (auth.uid(), trim(p_client_name), trim(p_client_phone)) returning * into v_client;
  end if;
  insert into public.sales(user_id, client_id, inventory_account_id, delivery_type, client_name, service,
      profile_name, sale_date, amount, status, notes)
  values (auth.uid(), v_client.id, v_account.id, p_delivery_type, v_client.full_name, v_account.service,
      v_profile, v_start, p_amount, case when p_amount = 0 then 'paid' else 'pending' end, coalesce(p_notes, ''))
  returning id into v_sale_id;
  insert into public.client_account_assignments(user_id, client_id, inventory_account_id, profile_name,
      starts_on, duration_days, notes, delivery_type, sale_id)
  values (auth.uid(), v_client.id, v_account.id, v_profile, v_start, 28, coalesce(p_notes, ''), p_delivery_type, v_sale_id)
  returning id into v_assignment_id;

  return jsonb_build_object(
    'sale_id', v_sale_id, 'assignment_id', v_assignment_id, 'client_id', v_client.id,
    'client_name', v_client.full_name, 'client_phone', v_client.phone,
    'service', v_account.service, 'account_label', v_account.account_label, 'provider', v_account.provider,
    'delivery_type', p_delivery_type, 'profile_name', v_profile, 'expires_on', v_start + 28,
    'access_username', v_username, 'access_password', v_password,
    'amount', p_amount, 'status', case when p_amount = 0 then 'paid' else 'pending' end
  );
end;
$function$;
revoke all on function public.create_inventory_sale_auto(uuid, text, text, text, text, date, numeric, text) from public, anon;
grant execute on function public.create_inventory_sale_auto(uuid, text, text, text, text, date, numeric, text) to authenticated;
