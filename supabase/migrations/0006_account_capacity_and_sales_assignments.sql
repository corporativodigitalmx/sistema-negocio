-- Capacity and controlled delivery flow for inventory-backed sales.
alter table public.inventario_cuentas
  add column if not exists profile_capacity integer not null default 5;
alter table public.inventario_cuentas
  drop constraint if exists inventario_cuentas_profile_capacity_check;
alter table public.inventario_cuentas
  add constraint inventario_cuentas_profile_capacity_check check (profile_capacity between 1 and 20);

alter table public.client_account_assignments
  add column if not exists delivery_type text not null default 'profile';
alter table public.client_account_assignments
  drop constraint if exists client_account_assignments_delivery_type_check;
alter table public.client_account_assignments
  add constraint client_account_assignments_delivery_type_check check (delivery_type in ('profile','full_account'));

alter table public.sales
  add column if not exists client_id uuid references public.clients(id) on delete restrict;
alter table public.sales
  add column if not exists inventory_account_id uuid references public.inventario_cuentas(id) on delete restrict;
alter table public.sales
  add column if not exists delivery_type text;
alter table public.sales
  drop constraint if exists sales_delivery_type_check;
alter table public.sales
  add constraint sales_delivery_type_check check (delivery_type is null or delivery_type in ('profile','full_account'));

alter table public.client_account_assignments
  add column if not exists sale_id uuid references public.sales(id) on delete set null;
create index if not exists client_account_assignments_active_inventory_idx
  on public.client_account_assignments(inventory_account_id, starts_on, expires_on);
create index if not exists sales_inventory_account_idx on public.sales(inventory_account_id, sale_date desc);

-- Existing customer assignments count as profile usage. A whole-account delivery
-- occupies the account until its 28-day assignment expires.
create or replace view public.inventory_account_availability
with (security_invoker = true)
as
select i.id as inventory_account_id,
       i.user_id,
       i.service,
       i.account_label,
       i.provider,
       i.profile_capacity,
       (coalesce(a.assigned_profiles, 0) + case when jsonb_typeof(i.customers) = 'array' then jsonb_array_length(i.customers) else 0 end)::integer as assigned_profiles,
       greatest(i.profile_capacity - coalesce(a.assigned_profiles, 0) - case when jsonb_typeof(i.customers) = 'array' then jsonb_array_length(i.customers) else 0 end, 0)::integer as available_profiles,
       coalesce(a.has_full_account, false) as has_full_account,
       case when coalesce(a.has_full_account, false)
            or coalesce(a.assigned_profiles, 0) + case when jsonb_typeof(i.customers) = 'array' then jsonb_array_length(i.customers) else 0 end >= i.profile_capacity
            then 'occupied' else 'available' end as status
from public.inventario_cuentas i
left join lateral (
  select count(*) filter (where ca.delivery_type = 'profile') as assigned_profiles,
         coalesce(bool_or(ca.delivery_type = 'full_account'), false) as has_full_account
  from public.client_account_assignments ca
  where ca.inventory_account_id = i.id
    and ca.starts_on <= current_date
    and ca.expires_on >= current_date
) a on true;
grant select on public.inventory_account_availability to authenticated;

-- Allow sales staff to find their own clients and inventory without granting
-- inventory editing rights. Account ownership remains isolated by user.
drop policy if exists "Cada usuario consulta su inventario" on public.inventario_cuentas;
create policy "Cada usuario consulta su inventario" on public.inventario_cuentas
  for select to authenticated
  using ((user_id = auth.uid() and (public.has_permission('inventory_view')
       or public.has_permission('accounts_view') or public.has_permission('inventory_edit')
       or public.has_permission('clients_edit')
       or public.has_permission('dashboard_view')))
       or public.has_permission('inventory_all'));

drop policy if exists client_assign_accounts_read on public.client_account_assignments;
create policy client_assign_accounts_read on public.client_account_assignments
  for select to authenticated
  using (user_id = auth.uid() and (public.has_permission('accounts_view')
       or public.has_permission('clients_edit'))
       or public.has_permission('clients_all'));

-- All assignment writes go through the row-locking functions below so two users
-- cannot consume the same final profile at the same time.
drop policy if exists "Usuarios crean asignaciones autorizadas" on public.client_account_assignments;
create policy "Usuarios crean asignaciones autorizadas" on public.client_account_assignments
  for insert to authenticated with check (false);

create or replace function public.assign_client_account(
  p_client_id uuid,
  p_inventory_account_id uuid,
  p_profile_name text,
  p_starts_on date default current_date,
  p_notes text default ''
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_client public.clients%rowtype;
  v_account public.inventario_cuentas%rowtype;
  v_active_profiles integer;
  v_full_account boolean;
  v_profile text;
  v_requested text := trim(coalesce(p_profile_name, ''));
  v_slot integer;
  v_assignment_id uuid;
  v_start date := coalesce(p_starts_on, current_date);
begin
  select * into v_client from public.clients where id = p_client_id;
  if not found or not public.can_assign_client_account(v_client.user_id, p_client_id, p_inventory_account_id) then
    raise exception 'Cliente o cuenta no disponibles para esta asignación';
  end if;
  select * into v_account from public.inventario_cuentas where id = p_inventory_account_id for update;
  if not found then raise exception 'La cuenta de inventario ya no existe'; end if;
  if v_account.purchase_date + 28 < v_start then raise exception 'La cuenta de inventario está vencida para esa fecha'; end if;

  select count(*) filter (where delivery_type = 'profile'),
         coalesce(bool_or(delivery_type = 'full_account'), false)
    into v_active_profiles, v_full_account
  from public.client_account_assignments
  where inventory_account_id = p_inventory_account_id
    and starts_on <= v_start + 28 and expires_on >= v_start;
  v_active_profiles := v_active_profiles + case when jsonb_typeof(v_account.customers) = 'array' then jsonb_array_length(v_account.customers) else 0 end;
  if v_full_account then raise exception 'La cuenta completa ya está asignada durante esas fechas'; end if;
  if v_active_profiles >= v_account.profile_capacity then raise exception 'La cuenta ya no tiene perfiles disponibles'; end if;
  if v_requested <> '' and not exists (
      select 1 from public.client_account_assignments
      where inventory_account_id = p_inventory_account_id
        and starts_on <= v_start + 28 and expires_on >= v_start
        and lower(profile_name) = lower(v_requested)
    ) then
    v_profile := v_requested;
  else
    for v_slot in 1..v_account.profile_capacity loop
      if not exists (
      select 1 from public.client_account_assignments
      where inventory_account_id = p_inventory_account_id
        and starts_on <= v_start + 28 and expires_on >= v_start
        and lower(profile_name) = lower('Perfil ' || v_slot)
      ) then
        v_profile := 'Perfil ' || v_slot;
        exit;
      end if;
    end loop;
  end if;
  if char_length(v_profile) < 1 or char_length(v_profile) > 80 then
    raise exception 'No se pudo determinar un nombre válido para el perfil';
  end if;

  insert into public.client_account_assignments(user_id, client_id, inventory_account_id,
      profile_name, starts_on, duration_days, notes, delivery_type)
  values (v_client.user_id, p_client_id, p_inventory_account_id, v_profile, v_start, 28,
      coalesce(p_notes, ''), 'profile') returning id into v_assignment_id;
  return jsonb_build_object('assignment_id', v_assignment_id, 'profile_name', v_profile);
end;
$$;
revoke all on function public.assign_client_account(uuid,uuid,text,date,text) from public, anon;
grant execute on function public.assign_client_account(uuid,uuid,text,date,text) to authenticated;

create or replace function public.create_inventory_sale(
  p_client_id uuid,
  p_inventory_account_id uuid,
  p_delivery_type text,
  p_sale_date date default current_date,
  p_amount numeric default 0,
  p_notes text default ''
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_client public.clients%rowtype;
  v_account public.inventario_cuentas%rowtype;
  v_active_profiles integer;
  v_full_account boolean;
  v_profile text;
  v_slot integer;
  v_sale_id uuid;
  v_assignment_id uuid;
  v_start date := coalesce(p_sale_date, current_date);
begin
  if auth.uid() is null or not public.has_permission('sales_edit') then
    raise exception 'No tienes permiso para asignar ventas';
  end if;
  if p_delivery_type not in ('profile','full_account') then raise exception 'Tipo de entrega no válido'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'El importe no puede ser negativo'; end if;
  select * into v_client from public.clients where id = p_client_id and user_id = auth.uid();
  if not found then raise exception 'El cliente no existe en tu cuenta'; end if;
  select * into v_account from public.inventario_cuentas
    where id = p_inventory_account_id and user_id = auth.uid() for update;
  if not found then raise exception 'La cuenta no existe en tu inventario'; end if;
  if v_account.purchase_date + 28 < v_start then raise exception 'La cuenta de inventario está vencida para esa fecha'; end if;

  select count(*) filter (where delivery_type = 'profile'),
         coalesce(bool_or(delivery_type = 'full_account'), false)
    into v_active_profiles, v_full_account
  from public.client_account_assignments
  where inventory_account_id = p_inventory_account_id
    and starts_on <= v_start + 28 and expires_on >= v_start;
  v_active_profiles := v_active_profiles + case when jsonb_typeof(v_account.customers) = 'array' then jsonb_array_length(v_account.customers) else 0 end;

  if p_delivery_type = 'full_account' then
    if v_full_account or v_active_profiles > 0 then
      raise exception 'La cuenta no está disponible completa porque tiene perfiles asignados';
    end if;
    v_profile := 'Cuenta completa';
  else
    if v_full_account then raise exception 'La cuenta completa está ocupada'; end if;
    if v_active_profiles >= v_account.profile_capacity then raise exception 'Ya se agotaron los perfiles de esta cuenta'; end if;
    for v_slot in 1..v_account.profile_capacity loop
      if not exists (
        select 1 from public.client_account_assignments
        where inventory_account_id = p_inventory_account_id
          and starts_on <= v_start + 28 and expires_on >= v_start
          and lower(profile_name) = lower('Perfil ' || v_slot)
      ) then
        v_profile := 'Perfil ' || v_slot;
        exit;
      end if;
    end loop;
    if v_profile is null then raise exception 'No hay un perfil disponible en esta cuenta'; end if;
  end if;

  insert into public.sales(user_id, client_id, inventory_account_id, delivery_type,
      client_name, service, profile_name, sale_date, amount, status, notes)
  values (auth.uid(), v_client.id, v_account.id, p_delivery_type,
      v_client.full_name, v_account.service, v_profile, v_start, p_amount,
      case when p_amount = 0 then 'paid' else 'pending' end, coalesce(p_notes, ''))
  returning id into v_sale_id;
  insert into public.client_account_assignments(user_id, client_id, inventory_account_id,
      profile_name, starts_on, duration_days, notes, delivery_type, sale_id)
  values (v_client.user_id, v_client.id, v_account.id, v_profile, v_start, 28,
      coalesce(p_notes, ''), p_delivery_type, v_sale_id) returning id into v_assignment_id;
  return jsonb_build_object('sale_id', v_sale_id, 'assignment_id', v_assignment_id,
      'profile_name', v_profile, 'status', case when p_amount = 0 then 'paid' else 'pending' end);
end;
$$;
revoke all on function public.create_inventory_sale(uuid,uuid,text,date,numeric,text) from public, anon;
grant execute on function public.create_inventory_sale(uuid,uuid,text,date,numeric,text) to authenticated;
