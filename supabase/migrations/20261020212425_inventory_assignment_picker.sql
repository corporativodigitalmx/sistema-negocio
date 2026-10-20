create or replace function public.list_inventory_assignment_clients()
returns table(id uuid, full_name text, phone text)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if auth.uid() is null
    or not (public.has_permission('inventory_edit') or public.has_permission('inventory_all')) then
    raise exception 'No tienes permiso para consultar clientes desde Inventario' using errcode = '42501';
  end if;

  return query
  select c.id, c.full_name, c.phone
  from public.clients c
  where c.user_id = auth.uid() or public.has_permission('clients_all')
  order by c.full_name;
end;
$function$;

revoke all on function public.list_inventory_assignment_clients() from public, anon;
grant execute on function public.list_inventory_assignment_clients() to authenticated;

create or replace function public.inventory_account_assignment_options(
  p_inventory_account_id uuid,
  p_starts_on date default current_date
)
returns table(available_profiles integer, full_account_available boolean, has_full_account boolean, assigned_profiles integer)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_account public.inventario_cuentas%rowtype;
  v_profiles integer;
  v_full boolean;
  v_legacy_profiles integer;
  v_start date := coalesce(p_starts_on, current_date);
begin
  if auth.uid() is null
    or not (public.has_permission('inventory_edit') or public.has_permission('inventory_all')) then
    raise exception 'No tienes permiso para consultar disponibilidad desde Inventario' using errcode = '42501';
  end if;

  select * into v_account
  from public.inventario_cuentas i
  where i.id = p_inventory_account_id
    and (i.user_id = auth.uid() or public.has_permission('inventory_all'));
  if not found then
    raise exception 'La cuenta no existe o no tienes acceso a ella';
  end if;

  select count(*) filter (where ca.delivery_type = 'profile'),
         coalesce(bool_or(ca.delivery_type = 'full_account'), false)
  into v_profiles, v_full
  from public.client_account_assignments ca
  where ca.inventory_account_id = p_inventory_account_id
    and ca.assignment_status = 'active'
    and ca.starts_on <= v_start + 28
    and ca.expires_on >= v_start;
  v_legacy_profiles := case when jsonb_typeof(v_account.customers) = 'array'
    then jsonb_array_length(v_account.customers) else 0 end;

  return query select
    case when v_account.inventory_operational_status = 'available'
      and v_account.purchase_date + 28 >= v_start
      and not v_full
      then greatest(coalesce(v_account.profile_capacity, 5) - coalesce(v_profiles, 0) - v_legacy_profiles, 0)::integer
      else 0 end,
    v_account.inventory_operational_status = 'available'
      and v_account.purchase_date + 28 >= v_start
      and not v_full and coalesce(v_profiles, 0) = 0 and v_legacy_profiles = 0,
    coalesce(v_full, false),
    coalesce(v_profiles, 0) + v_legacy_profiles;
end;
$function$;

revoke all on function public.inventory_account_assignment_options(uuid, date) from public, anon;
grant execute on function public.inventory_account_assignment_options(uuid, date) to authenticated;
