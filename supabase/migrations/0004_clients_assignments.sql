create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  full_name text not null check (char_length(trim(full_name)) between 2 and 120),
  phone text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
update public.inventario_cuentas set duration = 28, unit = 'days', updated_at = now() where duration <> 28 or unit <> 'days';
alter table public.inventario_cuentas drop constraint if exists inventario_cuentas_cycle_28_days_check;
alter table public.inventario_cuentas add constraint inventario_cuentas_cycle_28_days_check check (duration = 28 and unit = 'days');

create index if not exists clients_user_name_idx on public.clients(user_id, (lower(full_name)));

create table if not exists public.client_account_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  inventory_account_id uuid not null references public.inventario_cuentas(id) on delete restrict,
  profile_name text not null default '',
  starts_on date not null default current_date,
  duration_days integer not null default 28 check (duration_days = 28),
  expires_on date generated always as (starts_on + duration_days) stored,
  notes text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists client_account_assignments_client_idx on public.client_account_assignments(client_id, expires_on desc);
create index if not exists client_account_assignments_inventory_idx on public.client_account_assignments(inventory_account_id);

alter table public.clients enable row level security;
alter table public.client_account_assignments enable row level security;
revoke all on public.clients, public.client_account_assignments from anon;
grant select, insert, update, delete on public.clients, public.client_account_assignments to authenticated;

drop policy if exists "Usuarios consultan sus clientes" on public.clients;
create policy "Usuarios consultan sus clientes" on public.clients for select to authenticated
using ((user_id = (select auth.uid()) and (public.has_permission('clients_view') or public.has_permission('clients_edit'))) or public.has_permission('clients_all'));
drop policy if exists "Usuarios crean clientes autorizados" on public.clients;
create policy "Usuarios crean clientes autorizados" on public.clients for insert to authenticated
with check ((user_id = (select auth.uid()) and public.has_permission('clients_edit')) or public.has_permission('clients_all'));
drop policy if exists "Usuarios editan clientes autorizados" on public.clients;
create policy "Usuarios editan clientes autorizados" on public.clients for update to authenticated
using ((user_id = (select auth.uid()) and public.has_permission('clients_edit')) or public.has_permission('clients_all'))
with check ((user_id = (select auth.uid()) and public.has_permission('clients_edit')) or public.has_permission('clients_all'));
drop policy if exists "Usuarios eliminan clientes autorizados" on public.clients;
create policy "Usuarios eliminan clientes autorizados" on public.clients for delete to authenticated
using ((user_id = (select auth.uid()) and public.has_permission('clients_edit')) or public.has_permission('clients_all'));

drop policy if exists "Usuarios consultan asignaciones de clientes" on public.client_account_assignments;
create policy "Usuarios consultan asignaciones de clientes" on public.client_account_assignments for select to authenticated
using ((user_id = (select auth.uid()) and (public.has_permission('clients_view') or public.has_permission('clients_edit'))) or public.has_permission('clients_all'));
create or replace function public.can_assign_client_account(p_owner_id uuid, p_client_id uuid, p_inventory_account_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select
    (public.has_permission('clients_all') and (public.is_superadmin() or public.has_permission('inventory_all')))
    or (
      p_owner_id = (select auth.uid())
      and public.has_permission('clients_edit')
      and exists (select 1 from public.clients c where c.id = p_client_id and c.user_id = (select auth.uid()))
      and exists (select 1 from public.inventario_cuentas i where i.id = p_inventory_account_id and i.user_id = (select auth.uid()))
    );
$$;
revoke all on function public.can_assign_client_account(uuid, uuid, uuid) from public, anon;
grant execute on function public.can_assign_client_account(uuid, uuid, uuid) to authenticated;

drop policy if exists "Usuarios crean asignaciones autorizadas" on public.client_account_assignments;
create policy "Usuarios crean asignaciones autorizadas" on public.client_account_assignments for insert to authenticated
with check (public.can_assign_client_account(user_id, client_id, inventory_account_id));
drop policy if exists "Usuarios editan asignaciones autorizadas" on public.client_account_assignments;
create policy "Usuarios editan asignaciones autorizadas" on public.client_account_assignments for update to authenticated
using ((user_id = (select auth.uid()) and public.has_permission('clients_edit')) or public.has_permission('clients_all'))
with check ((user_id = (select auth.uid()) and public.has_permission('clients_edit')) or public.has_permission('clients_all'));
drop policy if exists "Usuarios eliminan asignaciones autorizadas" on public.client_account_assignments;
create policy "Usuarios eliminan asignaciones autorizadas" on public.client_account_assignments for delete to authenticated
using ((user_id = (select auth.uid()) and public.has_permission('clients_edit')) or public.has_permission('clients_all'));

-- Las cuentas mensuales simples pasan al ciclo solicitado de 28 días.
update public.inventario_cuentas set duration = 28, unit = 'days', updated_at = now()
where unit = 'months' and duration = 1;
