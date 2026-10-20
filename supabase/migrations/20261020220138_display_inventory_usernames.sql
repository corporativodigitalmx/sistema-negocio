drop function if exists public.available_inventory_accounts(text, date, text);
create function public.available_inventory_accounts(
  p_service text,
  p_sale_date date,
  p_delivery_type text
)
returns table(inventory_account_id uuid, account_label text, available_profiles integer, account_username text)
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
           - coalesce(usage.profiles, 0), 0)::integer,
         trim(cred.username)
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

drop function if exists public.inventory_assignment_statuses();
create function public.inventory_assignment_statuses()
returns table(inventory_account_id uuid, available_profiles integer, account_occupied boolean, account_username text)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if auth.uid() is null
    or not (public.has_permission('inventory_edit') or public.has_permission('inventory_all')) then
    raise exception 'No tienes permiso para consultar el estado de las cuentas' using errcode = '42501';
  end if;

  return query
  select i.id,
    case when i.inventory_operational_status = 'available'
      and i.purchase_date + 28 >= current_date
      and not coalesce(usage.has_full_account, false)
      then greatest(coalesce(i.profile_capacity, 5)
        - coalesce(usage.profile_count, 0)
        - case when jsonb_typeof(i.customers) = 'array' then jsonb_array_length(i.customers) else 0 end, 0)::integer
      else 0 end,
    i.inventory_operational_status <> 'available'
      or i.purchase_date + 28 < current_date
      or coalesce(usage.has_full_account, false)
      or coalesce(usage.profile_count, 0)
        + case when jsonb_typeof(i.customers) = 'array' then jsonb_array_length(i.customers) else 0 end
        >= coalesce(i.profile_capacity, 5),
    coalesce(trim(cred.username), '')
  from public.inventario_cuentas i
  left join private.inventory_account_credentials cred on cred.inventory_account_id = i.id
  left join lateral (
    select count(*) filter (where ca.delivery_type = 'profile')::integer as profile_count,
           coalesce(bool_or(ca.delivery_type = 'full_account'), false) as has_full_account
    from public.client_account_assignments ca
    where ca.inventory_account_id = i.id
      and ca.assignment_status = 'active'
      and ca.starts_on <= current_date
      and ca.expires_on >= current_date
  ) usage on true
  where i.user_id = auth.uid() or public.has_permission('inventory_all');
end;
$function$;

revoke all on function public.inventory_assignment_statuses() from public, anon;
grant execute on function public.inventory_assignment_statuses() to authenticated;
