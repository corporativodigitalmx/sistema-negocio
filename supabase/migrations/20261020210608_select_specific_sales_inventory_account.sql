-- List only the signed-in user's current, usable accounts for a selected service.
create or replace function public.available_inventory_accounts(
  p_service text,
  p_sale_date date,
  p_delivery_type text
)
returns table(inventory_account_id uuid, account_label text, available_profiles integer)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  v_start date := coalesce(p_sale_date, current_date);
begin
  if auth.uid() is null or not public.has_permission('sales_edit') then
    raise exception 'No tienes permiso para consultar cuentas disponibles' using errcode = '42501';
  end if;
  if coalesce(trim(p_service), '') = '' or char_length(p_service) > 100 then
    raise exception 'Selecciona una plataforma válida';
  end if;
  if p_delivery_type not in ('profile', 'full_account') then
    raise exception 'Tipo de entrega no válido';
  end if;

  return query
  select i.id,
         i.account_label,
         greatest(coalesce(i.profile_capacity, 5)
           - case when jsonb_typeof(i.customers) = 'array' then jsonb_array_length(i.customers) else 0 end
           - coalesce(usage.profiles, 0), 0)::integer
  from public.inventario_cuentas i
  join private.inventory_account_credentials cred on cred.inventory_account_id = i.id
  left join lateral (
    select count(*) filter (where a.delivery_type = 'profile')::integer as profiles,
           coalesce(bool_or(a.delivery_type = 'full_account'), false) as full_account
    from public.client_account_assignments a
    where a.inventory_account_id = i.id
      and a.assignment_status = 'active'
      and a.starts_on <= v_start + 28
      and a.expires_on >= v_start
  ) usage on true
  where i.user_id = auth.uid()
    and i.service = trim(p_service)
    and i.inventory_operational_status = 'available'
    and i.purchase_date + 28 >= v_start
    and trim(cred.username) <> ''
    and cred.password <> ''
    and case
      when p_delivery_type = 'profile' then
        not coalesce(usage.full_account, false)
        and case when jsonb_typeof(i.customers) = 'array' then jsonb_array_length(i.customers) else 0 end
          + coalesce(usage.profiles, 0) < coalesce(i.profile_capacity, 5)
      else
        not coalesce(usage.full_account, false)
        and coalesce(usage.profiles, 0) = 0
        and case when jsonb_typeof(i.customers) = 'array' then jsonb_array_length(i.customers) else 0 end = 0
    end
  order by i.purchase_date, i.created_at, i.id;
end;
$function$;

revoke all on function public.available_inventory_accounts(text, date, text) from public, anon;
grant execute on function public.available_inventory_accounts(text, date, text) to authenticated;

-- Manual selection still delegates assignment to the existing locked transaction,
-- which revalidates account ownership, expiry, status, and remaining capacity.
create or replace function public.create_inventory_sale_with_selected_account(
  p_client_id uuid,
  p_client_name text,
  p_client_phone text,
  p_service text,
  p_delivery_type text,
  p_sale_date date,
  p_amount numeric,
  p_notes text,
  p_payment_status text,
  p_inventory_account_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_client public.clients%rowtype;
  v_account public.inventario_cuentas%rowtype;
  v_username text;
  v_password text;
  v_result jsonb;
  v_sale_id uuid;
  v_start date := coalesce(p_sale_date, current_date);
begin
  if auth.uid() is null or not public.has_permission('sales_edit') then
    raise exception 'No tienes permiso para registrar ventas' using errcode = '42501';
  end if;
  if p_payment_status not in ('pending', 'paid') then
    raise exception 'Selecciona un estado de pago válido';
  end if;
  if p_inventory_account_id is null then
    raise exception 'Selecciona una cuenta disponible';
  end if;

  if p_client_id is null then
    if not public.has_permission('clients_edit') then
      raise exception 'No tienes permiso para registrar un cliente nuevo' using errcode = '42501';
    end if;
    if char_length(trim(coalesce(p_client_name, ''))) not between 2 and 120 then
      raise exception 'Escribe el nombre completo del cliente';
    end if;
    if char_length(trim(coalesce(p_client_phone, ''))) not between 10 and 24 then
      raise exception 'Escribe un WhatsApp válido del cliente';
    end if;
    insert into public.clients(user_id, full_name, phone)
    values (auth.uid(), trim(p_client_name), trim(p_client_phone))
    returning * into v_client;
  else
    select * into v_client
    from public.clients c
    where c.id = p_client_id and c.user_id = auth.uid();
    if not found then
      raise exception 'El cliente no existe en tu cuenta';
    end if;
  end if;

  select * into v_account
  from public.inventario_cuentas i
  where i.id = p_inventory_account_id
    and i.user_id = auth.uid()
    and i.service = trim(p_service)
    and i.inventory_operational_status = 'available'
    and i.purchase_date + 28 >= v_start
  for update;
  if not found then
    raise exception 'La cuenta seleccionada ya no está vigente o disponible para esa plataforma';
  end if;

  select c.username, c.password into v_username, v_password
  from private.inventory_account_credentials c
  where c.inventory_account_id = v_account.id;
  if not found or trim(coalesce(v_username, '')) = '' or coalesce(v_password, '') = '' then
    raise exception 'La cuenta seleccionada no tiene accesos guardados; actualízala en Inventario';
  end if;

  v_result := public.create_inventory_sale(
    v_client.id, v_account.id, p_delivery_type, v_start, p_amount, coalesce(p_notes, '')
  );
  v_sale_id := (v_result ->> 'sale_id')::uuid;

  update public.sales
  set status = p_payment_status
  where id = v_sale_id and user_id = auth.uid();
  if not found then
    raise exception 'No se pudo actualizar el estado de pago de la venta';
  end if;

  return jsonb_build_object(
    'sale_id', v_sale_id,
    'assignment_id', v_result ->> 'assignment_id',
    'client_id', v_client.id,
    'client_name', v_client.full_name,
    'client_phone', v_client.phone,
    'service', v_account.service,
    'account_label', v_account.account_label,
    'provider', v_account.provider,
    'delivery_type', p_delivery_type,
    'profile_name', v_result ->> 'profile_name',
    'expires_on', v_start + 28,
    'access_username', v_username,
    'access_password', v_password,
    'amount', p_amount,
    'status', p_payment_status
  );
end;
$function$;

revoke all on function public.create_inventory_sale_with_selected_account(uuid, text, text, text, text, date, numeric, text, text, uuid) from public, anon;
grant execute on function public.create_inventory_sale_with_selected_account(uuid, text, text, text, text, date, numeric, text, text, uuid) to authenticated;
