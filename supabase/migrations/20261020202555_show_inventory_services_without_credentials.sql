-- Show eligible inventory platforms even when credentials have not been saved yet.
-- Sales still require credentials in create_inventory_sale_auto.
drop function if exists public.available_inventory_services(date, text);

create function public.available_inventory_services(p_sale_date date, p_delivery_type text)
returns table(service text, accounts_available integer, accounts_with_credentials integer)
language plpgsql stable security definer set search_path = pg_catalog
as $function$
begin
  if auth.uid() is null or not public.has_permission('sales_edit') then
    raise exception 'No tienes permiso para consultar plataformas disponibles' using errcode = '42501';
  end if;
  if p_delivery_type not in ('profile', 'full_account') then
    raise exception 'Tipo de entrega no válido';
  end if;

  return query
  select i.service,
    count(*)::integer as accounts_available,
    count(*) filter (
      where nullif(btrim(cred.username), '') is not null
        and nullif(cred.password, '') is not null
    )::integer as accounts_with_credentials
  from public.inventario_cuentas i
  left join private.inventory_account_credentials cred on cred.inventory_account_id = i.id
  left join lateral (
    select count(*) filter (where a.delivery_type = 'profile')::integer as profiles,
      coalesce(bool_or(a.delivery_type = 'full_account'), false) as full_account
    from public.client_account_assignments a
    where a.inventory_account_id = i.id and a.assignment_status = 'active'
      and a.starts_on <= coalesce(p_sale_date, current_date) + 28
      and a.expires_on >= coalesce(p_sale_date, current_date)
  ) usage on true
  where i.user_id = auth.uid()
    and i.inventory_operational_status = 'available'
    and i.purchase_date + 28 >= coalesce(p_sale_date, current_date)
    and case when jsonb_typeof(i.customers) = 'array'
      then jsonb_array_length(i.customers) else 0 end
      + coalesce(usage.profiles, 0) < i.profile_capacity
    and not coalesce(usage.full_account, false)
    and (p_delivery_type <> 'full_account' or (
      coalesce(usage.profiles, 0) = 0
      and case when jsonb_typeof(i.customers) = 'array'
        then jsonb_array_length(i.customers) else 0 end = 0
    ))
  group by i.service
  order by i.service;
end;
$function$;

revoke all on function public.available_inventory_services(date, text) from public, anon;
grant execute on function public.available_inventory_services(date, text) to authenticated;
