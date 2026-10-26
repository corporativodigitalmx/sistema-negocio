create table if not exists public.client_procedure_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  procedure_name text not null check (char_length(trim(procedure_name)) between 2 and 120),
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled')),
  order_date date not null default current_date,
  paid_at date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_procedure_orders_paid_at_check check (status <> 'paid' or paid_at is not null)
);

create index if not exists client_procedure_orders_owner_client_status_idx
  on public.client_procedure_orders (user_id, client_id, status, order_date desc);

alter table public.client_procedure_orders enable row level security;
revoke all on public.client_procedure_orders from anon;
grant select, insert, update on public.client_procedure_orders to authenticated;

drop policy if exists client_procedure_orders_select on public.client_procedure_orders;
create policy client_procedure_orders_select
  on public.client_procedure_orders
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and ((select public.has_permission('clients_view')) or (select public.has_permission('clients_edit')))
  );

drop policy if exists client_procedure_orders_insert on public.client_procedure_orders;
create policy client_procedure_orders_insert
  on public.client_procedure_orders
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.has_permission('clients_edit'))
    and exists (
      select 1 from public.clients c
      where c.id = client_procedure_orders.client_id
        and c.user_id = (select auth.uid())
    )
  );

drop policy if exists client_procedure_orders_update on public.client_procedure_orders;
create policy client_procedure_orders_update
  on public.client_procedure_orders
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.has_permission('clients_edit'))
  )
  with check (
    user_id = (select auth.uid())
    and (select public.has_permission('clients_edit'))
    and exists (
      select 1 from public.clients c
      where c.id = client_procedure_orders.client_id
        and c.user_id = (select auth.uid())
    )
  );

drop policy if exists tenant_owner_isolation on public.client_procedure_orders;
create policy tenant_owner_isolation
  on public.client_procedure_orders
  as restrictive
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create or replace function private.get_client_pending_items()
returns table (
  client_id uuid,
  item_type text,
  item_id uuid,
  label text,
  details text,
  item_date date,
  amount numeric,
  paid numeric,
  balance numeric
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null
    or not ((select public.has_permission('clients_view')) or (select public.has_permission('clients_edit'))) then
    raise exception 'No tienes permiso para consultar saldos de clientes'
      using errcode = '42501';
  end if;

  return query
  select
    s.client_id,
    'sale'::text,
    s.id,
    s.service::text,
    case
      when s.delivery_type = 'full_account' then 'Cuenta completa'
      when nullif(trim(s.profile_name), '') is not null then s.profile_name
      else 'Perfil'
    end::text,
    s.sale_date,
    s.amount::numeric,
    coalesce(payment_totals.paid_total, 0)::numeric,
    greatest(s.amount - coalesce(payment_totals.paid_total, 0), 0)::numeric
  from public.sales s
  join public.clients c
    on c.id = s.client_id
   and c.user_id = v_user_id
  left join (
    select p.sale_id, sum(p.amount)::numeric as paid_total
    from public.payments p
    where p.user_id = v_user_id
    group by p.sale_id
  ) payment_totals on payment_totals.sale_id = s.id
  where s.user_id = v_user_id
    and s.client_id is not null
    and s.status = 'pending'
    and s.amount > coalesce(payment_totals.paid_total, 0)

  union all

  select
    o.client_id,
    'procedure'::text,
    o.id,
    o.procedure_name,
    o.notes,
    o.order_date,
    o.amount::numeric,
    0::numeric,
    o.amount::numeric
  from public.client_procedure_orders o
  join public.clients c
    on c.id = o.client_id
   and c.user_id = v_user_id
  where o.user_id = v_user_id
    and o.status = 'pending';
end;
$function$;

revoke all on function private.get_client_pending_items() from public, anon, authenticated;
grant execute on function private.get_client_pending_items() to authenticated;

create or replace function public.get_client_pending_items()
returns table (
  client_id uuid,
  item_type text,
  item_id uuid,
  label text,
  details text,
  item_date date,
  amount numeric,
  paid numeric,
  balance numeric
)
language sql
stable
security invoker
set search_path = pg_catalog
as $function$
  select * from private.get_client_pending_items();
$function$;

revoke all on function public.get_client_pending_items() from public, anon;
grant execute on function public.get_client_pending_items() to authenticated;

comment on table public.client_procedure_orders is
  'Pedidos de trámites registrados por cliente, con costo y estado de pago dentro del espacio privado del usuario.';
comment on function private.get_client_pending_items() is
  'Devuelve únicamente conceptos pendientes del usuario autenticado, para mostrar saldos en Clientes.';
