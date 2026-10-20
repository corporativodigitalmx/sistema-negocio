create or replace function public.assign_inventory_account_to_client(
  p_client_id uuid,
  p_inventory_account_id uuid,
  p_delivery_type text,
  p_starts_on date default current_date,
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_client public.clients%rowtype;
  v_account public.inventario_cuentas%rowtype;
  v_profiles integer;
  v_full_account boolean;
  v_profile text;
  v_slot integer;
  v_start date := coalesce(p_starts_on, current_date);
  v_assignment_id uuid;
begin
  if auth.uid() is null
    or not (public.has_permission('inventory_edit') or public.has_permission('inventory_all')) then
    raise exception 'No tienes permiso para asignar cuentas desde Inventario' using errcode = '42501';
  end if;
  if p_delivery_type not in ('profile', 'full_account') then
    raise exception 'Elige un perfil o la cuenta completa';
  end if;
  if char_length(coalesce(p_notes, '')) > 500 then
    raise exception 'Las notas no pueden exceder 500 caracteres';
  end if;

  select * into v_client
  from public.clients c
  where c.id = p_client_id
    and (c.user_id = auth.uid() or public.has_permission('clients_all'));
  if not found then
    raise exception 'El cliente no existe o no tienes acceso a él';
  end if;

  select * into v_account
  from public.inventario_cuentas i
  where i.id = p_inventory_account_id
    and (i.user_id = auth.uid() or public.has_permission('inventory_all'))
  for update;
  if not found then
    raise exception 'La cuenta no existe o no tienes acceso a ella';
  end if;
  if v_account.inventory_operational_status <> 'available' then
    raise exception 'La cuenta no está disponible: revisa su estado en Reportes';
  end if;
  if v_account.purchase_date + 28 < v_start then
    raise exception 'La cuenta de inventario estará vencida para esa fecha';
  end if;

  select count(*) filter (where ca.delivery_type = 'profile'),
         coalesce(bool_or(ca.delivery_type = 'full_account'), false)
  into v_profiles, v_full_account
  from public.client_account_assignments ca
  where ca.inventory_account_id = p_inventory_account_id
    and ca.assignment_status = 'active'
    and ca.starts_on <= v_start + 28
    and ca.expires_on >= v_start;
  v_profiles := v_profiles
    + case when jsonb_typeof(v_account.customers) = 'array'
      then jsonb_array_length(v_account.customers) else 0 end;

  if p_delivery_type = 'full_account' then
    if v_full_account or v_profiles > 0 then
      raise exception 'La cuenta completa no está libre; tiene perfiles o una asignación vigente';
    end if;
    v_profile := 'Cuenta completa';
  else
    if v_full_account then
      raise exception 'La cuenta completa ya está asignada durante esas fechas';
    end if;
    if v_profiles >= coalesce(v_account.profile_capacity, 5) then
      raise exception 'Ya no hay perfiles disponibles en esta cuenta';
    end if;
    for v_slot in 1..coalesce(v_account.profile_capacity, 5) loop
      if not exists (
        select 1 from public.client_account_assignments ca
        where ca.inventory_account_id = p_inventory_account_id
          and ca.assignment_status = 'active'
          and ca.starts_on <= v_start + 28
          and ca.expires_on >= v_start
          and lower(ca.profile_name) = lower('Perfil ' || v_slot)
      ) then
        v_profile := 'Perfil ' || v_slot;
        exit;
      end if;
    end loop;
    if v_profile is null then raise exception 'No se encontró un perfil libre'; end if;
  end if;

  insert into public.client_account_assignments(
    user_id, client_id, inventory_account_id, profile_name, starts_on,
    duration_days, notes, delivery_type
  )
  values (
    v_client.user_id, v_client.id, v_account.id, v_profile, v_start,
    28, trim(coalesce(p_notes, '')), p_delivery_type
  )
  returning id into v_assignment_id;

  return jsonb_build_object(
    'assignment_id', v_assignment_id,
    'profile_name', v_profile,
    'delivery_type', p_delivery_type,
    'starts_on', v_start,
    'expires_on', v_start + 28,
    'client_id', v_client.id,
    'inventory_account_id', v_account.id
  );
end;
$function$;

revoke all on function public.assign_inventory_account_to_client(uuid, uuid, text, date, text) from public, anon;
grant execute on function public.assign_inventory_account_to_client(uuid, uuid, text, date, text) to authenticated;
