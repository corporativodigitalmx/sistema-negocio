create or replace function public.inventory_assignment_statuses()
returns table(inventory_account_id uuid, available_profiles integer, account_occupied boolean)
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
        >= coalesce(i.profile_capacity, 5)
  from public.inventario_cuentas i
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
