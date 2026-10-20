create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check(char_length(trim(name)) between 2 and 120), contact_name text not null default '', phone text not null default '',
  email text not null default '', notes text not null default '', active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists suppliers_user_name_idx on public.suppliers(user_id, lower(name));
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  client_name text not null check(char_length(trim(client_name)) between 2 and 120), service text not null,
  profile_name text not null default '', sale_date date not null default current_date, amount numeric(12,2) not null check(amount>=0),
  status text not null default 'pending' check(status in ('pending','paid','cancelled')), notes text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists sales_user_date_idx on public.sales(user_id,sale_date desc);
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete restrict, amount numeric(12,2) not null check(amount>0),
  method text not null default 'transferencia' check(method in ('efectivo','transferencia','tarjeta','otro')),
  paid_at date not null default current_date, reference text not null default '', notes text not null default '', created_at timestamptz not null default now()
);
create index if not exists payments_user_date_idx on public.payments(user_id,paid_at desc);
create index if not exists payments_sale_idx on public.payments(sale_id);
alter table public.suppliers enable row level security; alter table public.sales enable row level security; alter table public.payments enable row level security;
revoke all on public.suppliers,public.sales,public.payments from anon;
grant select,insert,update,delete on public.suppliers,public.sales,public.payments to authenticated;
drop policy if exists suppliers_select on public.suppliers; create policy suppliers_select on public.suppliers for select to authenticated using((user_id=auth.uid() and public.has_permission('suppliers_view')) or public.has_permission('suppliers_all'));
drop policy if exists suppliers_write on public.suppliers; create policy suppliers_write on public.suppliers for all to authenticated using(user_id=auth.uid() and public.has_permission('suppliers_edit')) with check(user_id=auth.uid() and public.has_permission('suppliers_edit'));
drop policy if exists sales_select on public.sales; create policy sales_select on public.sales for select to authenticated using((user_id=auth.uid() and (public.has_permission('sales_view') or public.has_permission('payments_view'))) or public.has_permission('sales_all'));
drop policy if exists sales_write on public.sales; create policy sales_write on public.sales for all to authenticated using(user_id=auth.uid() and public.has_permission('sales_edit')) with check(user_id=auth.uid() and public.has_permission('sales_edit'));
drop policy if exists payments_select on public.payments; create policy payments_select on public.payments for select to authenticated using((user_id=auth.uid() and public.has_permission('payments_view')) or public.has_permission('payments_all'));
drop policy if exists payments_write on public.payments; create policy payments_write on public.payments for all to authenticated using(user_id=auth.uid() and public.has_permission('payments_edit')) with check(user_id=auth.uid() and public.has_permission('payments_edit') and exists(select 1 from public.sales s where s.id=sale_id and s.user_id=auth.uid()));
drop policy if exists "Cada usuario consulta su inventario" on public.inventario_cuentas;
create policy "Cada usuario consulta su inventario" on public.inventario_cuentas for select to authenticated using((user_id=auth.uid() and (public.has_permission('inventory_view') or public.has_permission('accounts_view'))) or public.has_permission('inventory_all'));
create or replace function public.register_sale_payment(p_sale_id uuid,p_amount numeric,p_method text,p_paid_at date,p_reference text default '',p_notes text default '')
returns uuid language plpgsql security definer set search_path=public as $$
declare v_sale public.sales%rowtype; v_total numeric; v_payment_id uuid;
begin
  if auth.uid() is null or not public.has_permission('payments_edit') then raise exception 'No tienes permiso para registrar pagos'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'El importe debe ser mayor a cero'; end if;
  select * into v_sale from public.sales where id=p_sale_id and user_id=auth.uid() and status <> 'cancelled' for update;
  if not found then raise exception 'La venta no existe o no pertenece a tu cuenta'; end if;
  select coalesce(sum(amount),0) into v_total from public.payments where sale_id=p_sale_id;
  if v_total + p_amount > v_sale.amount then raise exception 'El pago excede el saldo pendiente'; end if;
  insert into public.payments(user_id,sale_id,amount,method,paid_at,reference,notes)
  values(auth.uid(),p_sale_id,p_amount,p_method,coalesce(p_paid_at,current_date),coalesce(p_reference,''),coalesce(p_notes,'')) returning id into v_payment_id;
  if v_total + p_amount >= v_sale.amount then update public.sales set status='paid',updated_at=now() where id=p_sale_id; end if;
  return v_payment_id;
end; $$;
revoke all on function public.register_sale_payment(uuid,numeric,text,date,text,text) from public,anon;
grant execute on function public.register_sale_payment(uuid,numeric,text,date,text,text) to authenticated;
drop policy if exists clients_select on public.clients;
create policy clients_select on public.clients for select to authenticated using((user_id=auth.uid() and (public.has_permission('clients_view') or public.has_permission('clients_edit') or public.has_permission('dashboard_view'))) or public.has_permission('clients_all'));
drop policy if exists sales_select on public.sales;
create policy sales_select on public.sales for select to authenticated using((user_id=auth.uid() and (public.has_permission('sales_view') or public.has_permission('sales_edit') or public.has_permission('payments_view') or public.has_permission('payments_edit') or public.has_permission('dashboard_view'))) or public.has_permission('sales_all'));
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select to authenticated using((user_id=auth.uid() and (public.has_permission('payments_view') or public.has_permission('payments_edit') or public.has_permission('dashboard_view'))) or public.has_permission('payments_all'));
drop policy if exists "Cada usuario consulta su inventario" on public.inventario_cuentas;
create policy "Cada usuario consulta su inventario" on public.inventario_cuentas for select to authenticated using((user_id=auth.uid() and (public.has_permission('inventory_view') or public.has_permission('accounts_view') or public.has_permission('dashboard_view'))) or public.has_permission('inventory_all'));
drop policy if exists client_assign_accounts_read on public.client_account_assignments;
create policy client_assign_accounts_read on public.client_account_assignments for select to authenticated using(user_id=auth.uid() and public.has_permission('accounts_view'));
drop policy if exists clients_accounts_read on public.clients;
create policy clients_accounts_read on public.clients for select to authenticated using(user_id=auth.uid() and public.has_permission('accounts_view'));

drop policy if exists clients_sales_read on public.clients;
create policy clients_sales_read on public.clients for select to authenticated using(user_id=auth.uid() and public.has_permission('sales_edit'));
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null check(char_length(trim(subject)) between 4 and 140), category text not null default 'general' check(category in ('general','access','inventory','billing','other')),
  message text not null check(char_length(trim(message)) between 10 and 4000), status text not null default 'open' check(status in ('open','in_progress','resolved')),
  response text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists support_tickets_user_idx on public.support_tickets(user_id,created_at desc);
alter table public.support_tickets enable row level security; revoke all on public.support_tickets from anon; grant select,insert,update on public.support_tickets to authenticated;
drop policy if exists support_tickets_read on public.support_tickets; create policy support_tickets_read on public.support_tickets for select to authenticated using(user_id=auth.uid() or public.has_permission('support_manage'));
drop policy if exists support_tickets_create on public.support_tickets; create policy support_tickets_create on public.support_tickets for insert to authenticated with check(user_id=auth.uid() and public.has_permission('support_view'));
drop policy if exists support_tickets_manage on public.support_tickets; create policy support_tickets_manage on public.support_tickets for update to authenticated using(public.has_permission('support_manage')) with check(public.has_permission('support_manage'));
drop policy if exists reports_clients_read on public.clients; create policy reports_clients_read on public.clients for select to authenticated using(user_id=auth.uid() and public.has_permission('reports_view'));
drop policy if exists reports_inventory_read on public.inventario_cuentas; create policy reports_inventory_read on public.inventario_cuentas for select to authenticated using(user_id=auth.uid() and public.has_permission('reports_view'));
drop policy if exists reports_assignments_read on public.client_account_assignments; create policy reports_assignments_read on public.client_account_assignments for select to authenticated using(user_id=auth.uid() and public.has_permission('reports_view'));
drop policy if exists reports_sales_read on public.sales; create policy reports_sales_read on public.sales for select to authenticated using(user_id=auth.uid() and public.has_permission('reports_view'));
drop policy if exists reports_payments_read on public.payments; create policy reports_payments_read on public.payments for select to authenticated using(user_id=auth.uid() and public.has_permission('reports_view'));
drop policy if exists reports_suppliers_read on public.suppliers; create policy reports_suppliers_read on public.suppliers for select to authenticated using(user_id=auth.uid() and public.has_permission('reports_view'));
