-- Account issue reports, safe inventory blocking, and atomic customer replacements.
alter table public.inventario_cuentas
  add column if not exists inventory_operational_status text not null default 'available';
alter table public.inventario_cuentas
  drop constraint if exists inventario_cuentas_operational_status_check;
alter table public.inventario_cuentas
  add constraint inventario_cuentas_operational_status_check
  check (inventory_operational_status in ('available','reported','replaced'));

alter table public.client_account_assignments
  add column if not exists assignment_status text not null default 'active';
alter table public.client_account_assignments
  drop constraint if exists client_account_assignments_assignment_status_check;
alter table public.client_account_assignments
  add constraint client_account_assignments_assignment_status_check
  check (assignment_status in ('active','replaced','ended'));
create index if not exists client_assignments_active_account_idx
  on public.client_account_assignments(inventory_account_id, assignment_status, starts_on, expires_on);

create table if not exists public.inventory_issue_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  inventory_account_id uuid not null references public.inventario_cuentas(id) on delete restrict,
  description text not null check (char_length(trim(description)) between 3 and 1000),
  status text not null default 'open' check (status in ('open','reenabled','replaced')),
  replacement_account_id uuid references public.inventario_cuentas(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists inventory_issue_reports_user_status_idx
  on public.inventory_issue_reports(user_id, status, created_at desc);
alter table public.inventory_issue_reports enable row level security;
revoke all on public.inventory_issue_reports from anon, authenticated;
grant select, insert on public.inventory_issue_reports to authenticated;
drop policy if exists inventory_issue_reports_read on public.inventory_issue_reports;
create policy inventory_issue_reports_read on public.inventory_issue_reports
  for select to authenticated
  using (user_id = auth.uid() and (public.has_permission('reports_view') or public.has_permission('inventory_edit'))
         or public.has_permission('inventory_all'));
drop policy if exists inventory_issue_reports_insert on public.inventory_issue_reports;
create policy inventory_issue_reports_insert on public.inventory_issue_reports
  for insert to authenticated
  with check (user_id = auth.uid() and created_by = auth.uid()
    and (public.has_permission('inventory_edit') or public.has_permission('inventory_all')));

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
       case when i.inventory_operational_status <> 'available' then 'blocked'
            when coalesce(a.has_full_account, false)
              or coalesce(a.assigned_profiles, 0) + case when jsonb_typeof(i.customers) = 'array' then jsonb_array_length(i.customers) else 0 end >= i.profile_capacity
            then 'occupied' else 'available' end as status
from public.inventario_cuentas i
left join lateral (
  select count(*) filter (where ca.delivery_type = 'profile') as assigned_profiles,
         coalesce(bool_or(ca.delivery_type = 'full_account'), false) as has_full_account
  from public.client_account_assignments ca
  where ca.inventory_account_id = i.id and ca.assignment_status = 'active'
    and ca.starts_on <= current_date and ca.expires_on >= current_date
) a on true;
grant select on public.inventory_account_availability to authenticated;

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
  where ca.inventory_account_id = i.id and ca.assignment_status = 'active'
    and ca.starts_on <= current_date and ca.expires_on >= current_date
) a on true
where i.store_published = true and trim(i.store_title) <> ''
  and i.inventory_operational_status = 'available';
grant select on public.public_store_catalog to anon, authenticated;

create or replace function public.report_inventory_issue(p_inventory_account_id uuid, p_description text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  v_account public.inventario_cuentas%rowtype;
  v_issue_id uuid;
  v_description text := trim(coalesce(p_description, ''));
begin
  if auth.uid() is null or not (public.has_permission('inventory_edit') or public.has_permission('inventory_all')) then
    raise exception 'No tienes permiso para reportar cuentas';
  end if;
  if char_length(v_description) < 3 or char_length(v_description) > 1000 then
    raise exception 'Describe el problema en 3 a 1000 caracteres';
  end if;
  select * into v_account from public.inventario_cuentas
    where id = p_inventory_account_id
      and (user_id = auth.uid() or public.has_permission('inventory_all'))
    for update;
  if not found then raise exception 'No se encontró una cuenta disponible para reportar'; end if;
  if v_account.inventory_operational_status <> 'available' then
    raise exception 'Esta cuenta ya tiene una incidencia abierta o está reemplazada';
  end if;
  update public.inventario_cuentas set inventory_operational_status = 'reported', updated_at = now()
    where id = v_account.id;
  insert into public.inventory_issue_reports(user_id, inventory_account_id, description, created_by)
    values (v_account.user_id, v_account.id, v_description, auth.uid()) returning id into v_issue_id;
  return v_issue_id;
end;
$$;
revoke all on function public.report_inventory_issue(uuid,text) from public, anon;
grant execute on function public.report_inventory_issue(uuid,text) to authenticated;

create or replace function public.resolve_inventory_issue(
  p_issue_id uuid,
  p_action text,
  p_replacement_account_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_issue public.inventory_issue_reports%rowtype;
  v_source public.inventario_cuentas%rowtype;
  v_target public.inventario_cuentas%rowtype;
  v_profiles integer;
  v_full boolean;
  v_target_profiles integer;
  v_target_full boolean;
begin
  if auth.uid() is null or not (public.has_permission('inventory_edit') or public.has_permission('inventory_all')) then
    raise exception 'No tienes permiso para resolver incidencias';
  end if;
  if p_action not in ('reenable','replace') then raise exception 'Acción no válida'; end if;
  select * into v_issue from public.inventory_issue_reports
    where id = p_issue_id and (user_id = auth.uid() or public.has_permission('inventory_all'))
    for update;
  if not found or v_issue.status <> 'open' then raise exception 'El reporte ya fue resuelto o no existe'; end if;

  if p_action = 'reenable' then
    update public.inventario_cuentas set inventory_operational_status = 'available', updated_at = now()
      where id = v_issue.inventory_account_id and user_id = v_issue.user_id
      returning * into v_source;
    if not found then raise exception 'No se encontró la cuenta reportada'; end if;
    update public.inventory_issue_reports set status = 'reenabled', resolved_at = now()
      where id = v_issue.id;
    return jsonb_build_object('status', 'reenabled');
  end if;

  if p_replacement_account_id is null or p_replacement_account_id = v_issue.inventory_account_id then
    raise exception 'Selecciona otra cuenta del inventario para el reemplazo';
  end if;
  perform 1 from public.inventario_cuentas
    where id in (v_issue.inventory_account_id, p_replacement_account_id)
    order by id for update;
  select * into v_source from public.inventario_cuentas where id = v_issue.inventory_account_id;
  select * into v_target from public.inventario_cuentas
    where id = p_replacement_account_id and user_id = v_issue.user_id;
  if not found then raise exception 'La cuenta de reemplazo debe pertenecer al mismo inventario'; end if;
  if v_target.service <> v_source.service then raise exception 'El reemplazo debe ser del mismo servicio'; end if;
  if v_target.inventory_operational_status <> 'available' then raise exception 'La cuenta de reemplazo tiene un reporte o ya fue sustituida'; end if;
  if coalesce(jsonb_array_length(case when jsonb_typeof(v_source.customers) = 'array' then v_source.customers else '[]'::jsonb end), 0) > 0 then
    raise exception 'La cuenta reportada tiene clientes antiguos sin vínculo individual. Vincúlalos primero desde Clientes para conservar su historial';
  end if;

  select count(*) filter (where delivery_type = 'profile'),
         coalesce(bool_or(delivery_type = 'full_account'), false)
    into v_profiles, v_full
  from public.client_account_assignments
  where inventory_account_id = v_source.id and assignment_status = 'active' and expires_on >= current_date;
  select count(*) filter (where delivery_type = 'profile'),
         coalesce(bool_or(delivery_type = 'full_account'), false)
    into v_target_profiles, v_target_full
  from public.client_account_assignments
  where inventory_account_id = v_target.id and assignment_status = 'active' and expires_on >= current_date;
  v_target_profiles := v_target_profiles + case when jsonb_typeof(v_target.customers) = 'array' then jsonb_array_length(v_target.customers) else 0 end;
  if v_full and (v_target_full or v_target_profiles > 0) then raise exception 'La cuenta de reemplazo debe estar completamente libre para una cuenta completa'; end if;
  if not v_full and (v_target_full or v_target_profiles + v_profiles > v_target.profile_capacity) then
    raise exception 'La cuenta elegida no tiene suficientes perfiles disponibles';
  end if;

  insert into public.client_account_assignments(user_id, client_id, inventory_account_id, profile_name,
      starts_on, duration_days, notes, delivery_type, sale_id, assignment_status)
  select user_id, client_id, v_target.id, profile_name, starts_on, duration_days,
      left(concat_ws(' · ', nullif(notes, ''), 'Reemplazo de reporte ' || v_issue.id), 1000),
      delivery_type, null, 'active'
  from public.client_account_assignments
  where inventory_account_id = v_source.id and assignment_status = 'active' and expires_on >= current_date;
  update public.client_account_assignments set assignment_status = 'replaced',
      notes = left(concat_ws(' · ', nullif(notes, ''), 'Reemplazada por reporte ' || v_issue.id), 1000)
  where inventory_account_id = v_source.id and assignment_status = 'active' and expires_on >= current_date;
  update public.inventario_cuentas set inventory_operational_status = 'replaced', updated_at = now()
    where id = v_source.id;
  update public.inventory_issue_reports set status = 'replaced', replacement_account_id = v_target.id, resolved_at = now()
    where id = v_issue.id;
  return jsonb_build_object('status', 'replaced', 'replacement_account_id', v_target.id,
    'customers_notified', v_profiles + case when v_full then 1 else 0 end);
end;
$$;
revoke all on function public.resolve_inventory_issue(uuid,text,uuid) from public, anon;
grant execute on function public.resolve_inventory_issue(uuid,text,uuid) to authenticated;

-- Assignment writers must reject reported/replaced accounts and ignore replaced history.
create or replace function public.assign_client_account(
  p_client_id uuid, p_inventory_account_id uuid, p_profile_name text,
  p_starts_on date default current_date, p_notes text default ''
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_client public.clients%rowtype; v_account public.inventario_cuentas%rowtype;
  v_active_profiles integer; v_full_account boolean; v_profile text;
  v_requested text := trim(coalesce(p_profile_name, '')); v_slot integer;
  v_assignment_id uuid; v_start date := coalesce(p_starts_on, current_date);
begin
  select * into v_client from public.clients where id = p_client_id;
  if not found or not public.can_assign_client_account(v_client.user_id, p_client_id, p_inventory_account_id) then raise exception 'Cliente o cuenta no disponibles para esta asignación'; end if;
  select * into v_account from public.inventario_cuentas where id = p_inventory_account_id for update;
  if not found or v_account.inventory_operational_status <> 'available' then raise exception 'La cuenta no está disponible: revisa sus reportes en el módulo Reportes'; end if;
  if v_account.purchase_date + 28 < v_start then raise exception 'La cuenta de inventario está vencida para esa fecha'; end if;
  select count(*) filter (where delivery_type = 'profile'), coalesce(bool_or(delivery_type = 'full_account'), false)
    into v_active_profiles, v_full_account from public.client_account_assignments
  where inventory_account_id = p_inventory_account_id and assignment_status = 'active' and starts_on <= v_start + 28 and expires_on >= v_start;
  v_active_profiles := v_active_profiles + case when jsonb_typeof(v_account.customers) = 'array' then jsonb_array_length(v_account.customers) else 0 end;
  if v_full_account then raise exception 'La cuenta completa ya está asignada durante esas fechas'; end if;
  if v_active_profiles >= v_account.profile_capacity then raise exception 'La cuenta ya no tiene perfiles disponibles'; end if;
  if v_requested <> '' and not exists (select 1 from public.client_account_assignments where inventory_account_id = p_inventory_account_id and assignment_status = 'active' and starts_on <= v_start + 28 and expires_on >= v_start and lower(profile_name) = lower(v_requested)) then v_profile := v_requested;
  else
    for v_slot in 1..v_account.profile_capacity loop
      if not exists (select 1 from public.client_account_assignments where inventory_account_id = p_inventory_account_id and assignment_status = 'active' and starts_on <= v_start + 28 and expires_on >= v_start and lower(profile_name) = lower('Perfil ' || v_slot)) then v_profile := 'Perfil ' || v_slot; exit; end if;
    end loop;
  end if;
  if char_length(v_profile) < 1 or char_length(v_profile) > 80 then raise exception 'No se pudo determinar un nombre válido para el perfil'; end if;
  insert into public.client_account_assignments(user_id, client_id, inventory_account_id, profile_name, starts_on, duration_days, notes, delivery_type)
  values (v_client.user_id, p_client_id, p_inventory_account_id, v_profile, v_start, 28, coalesce(p_notes, ''), 'profile') returning id into v_assignment_id;
  return jsonb_build_object('assignment_id', v_assignment_id, 'profile_name', v_profile);
end;
$$;
revoke all on function public.assign_client_account(uuid,uuid,text,date,text) from public, anon;
grant execute on function public.assign_client_account(uuid,uuid,text,date,text) to authenticated;

create or replace function public.create_inventory_sale(
  p_client_id uuid, p_inventory_account_id uuid, p_delivery_type text,
  p_sale_date date default current_date, p_amount numeric default 0, p_notes text default ''
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_client public.clients%rowtype; v_account public.inventario_cuentas%rowtype;
  v_active_profiles integer; v_full_account boolean; v_profile text; v_slot integer;
  v_sale_id uuid; v_assignment_id uuid; v_start date := coalesce(p_sale_date, current_date);
begin
  if auth.uid() is null or not public.has_permission('sales_edit') then raise exception 'No tienes permiso para asignar ventas'; end if;
  if p_delivery_type not in ('profile','full_account') then raise exception 'Tipo de entrega no válido'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'El importe no puede ser negativo'; end if;
  select * into v_client from public.clients where id = p_client_id and user_id = auth.uid();
  if not found then raise exception 'El cliente no existe en tu cuenta'; end if;
  select * into v_account from public.inventario_cuentas where id = p_inventory_account_id and user_id = auth.uid() for update;
  if not found or v_account.inventory_operational_status <> 'available' then raise exception 'La cuenta no está disponible: revisa sus reportes en el módulo Reportes'; end if;
  if v_account.purchase_date + 28 < v_start then raise exception 'La cuenta de inventario está vencida para esa fecha'; end if;
  select count(*) filter (where delivery_type = 'profile'), coalesce(bool_or(delivery_type = 'full_account'), false)
    into v_active_profiles, v_full_account from public.client_account_assignments
  where inventory_account_id = p_inventory_account_id and assignment_status = 'active' and starts_on <= v_start + 28 and expires_on >= v_start;
  v_active_profiles := v_active_profiles + case when jsonb_typeof(v_account.customers) = 'array' then jsonb_array_length(v_account.customers) else 0 end;
  if p_delivery_type = 'full_account' then
    if v_full_account or v_active_profiles > 0 then raise exception 'La cuenta no está disponible completa porque tiene perfiles asignados'; end if;
    v_profile := 'Cuenta completa';
  else
    if v_full_account then raise exception 'La cuenta completa está ocupada'; end if;
    if v_active_profiles >= v_account.profile_capacity then raise exception 'Ya se agotaron los perfiles de esta cuenta'; end if;
    for v_slot in 1..v_account.profile_capacity loop
      if not exists (select 1 from public.client_account_assignments where inventory_account_id = p_inventory_account_id and assignment_status = 'active' and starts_on <= v_start + 28 and expires_on >= v_start and lower(profile_name) = lower('Perfil ' || v_slot)) then v_profile := 'Perfil ' || v_slot; exit; end if;
    end loop;
    if v_profile is null then raise exception 'No hay un perfil disponible en esta cuenta'; end if;
  end if;
  insert into public.sales(user_id, client_id, inventory_account_id, delivery_type, client_name, service, profile_name, sale_date, amount, status, notes)
  values (auth.uid(), v_client.id, v_account.id, p_delivery_type, v_client.full_name, v_account.service, v_profile, v_start, p_amount, case when p_amount = 0 then 'paid' else 'pending' end, coalesce(p_notes, '')) returning id into v_sale_id;
  insert into public.client_account_assignments(user_id, client_id, inventory_account_id, profile_name, starts_on, duration_days, notes, delivery_type, sale_id)
  values (v_client.user_id, v_client.id, v_account.id, v_profile, v_start, 28, coalesce(p_notes, ''), p_delivery_type, v_sale_id) returning id into v_assignment_id;
  return jsonb_build_object('sale_id', v_sale_id, 'assignment_id', v_assignment_id, 'profile_name', v_profile, 'status', case when p_amount = 0 then 'paid' else 'pending' end);
end;
$$;
revoke all on function public.create_inventory_sale(uuid,uuid,text,date,numeric,text) from public, anon;
grant execute on function public.create_inventory_sale(uuid,uuid,text,date,numeric,text) to authenticated;
