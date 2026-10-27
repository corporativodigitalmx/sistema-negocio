create unique index if not exists client_procedure_orders_user_id_id_uidx
  on public.client_procedure_orders (user_id, id);
create unique index if not exists suppliers_user_id_id_uidx
  on public.suppliers (user_id, id);
create unique index if not exists sales_user_id_id_uidx
  on public.sales (user_id, id);

alter table public.sales
  add column if not exists procedure_order_id uuid;

create unique index if not exists sales_user_procedure_order_id_id_uidx
  on public.sales (user_id, procedure_order_id, id);

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sales_procedure_order_owner_fkey'
      and conrelid = 'public.sales'::regclass
  ) then
    alter table public.sales
      add constraint sales_procedure_order_owner_fkey
      foreign key (user_id, procedure_order_id)
      references public.client_procedure_orders (user_id, id);
  end if;
end
$migration$;

create index if not exists sales_procedure_order_idx
  on public.sales (user_id, procedure_order_id)
  where procedure_order_id is not null;

create table if not exists public.client_procedure_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  procedure_order_id uuid not null,
  sale_id uuid not null unique,
  amount numeric(12,2) not null check (amount > 0),
  method text not null check (method in ('efectivo', 'transferencia', 'tarjeta', 'otro')),
  paid_at date not null default current_date,
  reference text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  constraint client_procedure_payments_order_owner_fkey
    foreign key (user_id, procedure_order_id)
    references public.client_procedure_orders (user_id, id),
  constraint client_procedure_payments_sale_order_owner_fkey
    foreign key (user_id, procedure_order_id, sale_id)
    references public.sales (user_id, procedure_order_id, id)
);

create index if not exists client_procedure_payments_owner_order_date_idx
  on public.client_procedure_payments (user_id, procedure_order_id, paid_at desc);

create table if not exists public.procedure_supplier_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  procedure_order_id uuid not null,
  supplier_id uuid,
  supplier_name text not null check (char_length(trim(supplier_name)) between 2 and 120),
  amount numeric(12,2) not null check (amount > 0),
  method text not null check (method in ('efectivo', 'transferencia', 'tarjeta', 'otro')),
  paid_at date not null default current_date,
  reference text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  constraint procedure_supplier_payments_order_owner_fkey
    foreign key (user_id, procedure_order_id)
    references public.client_procedure_orders (user_id, id),
  constraint procedure_supplier_payments_supplier_owner_fkey
    foreign key (user_id, supplier_id)
    references public.suppliers (user_id, id)
);

create index if not exists procedure_supplier_payments_owner_date_idx
  on public.procedure_supplier_payments (user_id, paid_at desc);
create index if not exists procedure_supplier_payments_order_idx
  on public.procedure_supplier_payments (user_id, procedure_order_id);

alter table public.client_procedure_payments enable row level security;
alter table public.procedure_supplier_payments enable row level security;
revoke all on public.client_procedure_payments, public.procedure_supplier_payments from public, anon, authenticated;
grant select on public.client_procedure_payments to authenticated;
grant select, insert on public.procedure_supplier_payments to authenticated;

drop policy if exists client_procedure_payments_select on public.client_procedure_payments;
create policy client_procedure_payments_select
  on public.client_procedure_payments
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and ((select public.has_permission('payments_view')) or (select public.has_permission('payments_edit')))
  );

drop policy if exists client_procedure_payments_tenant_owner on public.client_procedure_payments;
create policy client_procedure_payments_tenant_owner
  on public.client_procedure_payments
  as restrictive
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists procedure_supplier_payments_select on public.procedure_supplier_payments;
create policy procedure_supplier_payments_select
  on public.procedure_supplier_payments
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (
      (select public.has_permission('payments_view'))
      or (select public.has_permission('payments_edit'))
      or (select public.has_permission('dashboard_view'))
      or (select public.has_permission('reports_view'))
    )
  );

drop policy if exists procedure_supplier_payments_insert on public.procedure_supplier_payments;
create policy procedure_supplier_payments_insert
  on public.procedure_supplier_payments
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.has_permission('payments_edit'))
    and exists (
      select 1
      from public.client_procedure_orders o
      where o.id = procedure_order_id
        and o.user_id = (select auth.uid())
        and o.status <> 'cancelled'
    )
    and (
      supplier_id is null
      or exists (
        select 1 from public.suppliers s
        where s.id = supplier_id
          and s.user_id = (select auth.uid())
      )
    )
  );

drop policy if exists procedure_supplier_payments_tenant_owner on public.procedure_supplier_payments;
create policy procedure_supplier_payments_tenant_owner
  on public.procedure_supplier_payments
  as restrictive
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

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
    coalesce(payment_totals.paid_total, 0)::numeric,
    greatest(o.amount - coalesce(payment_totals.paid_total, 0), 0)::numeric
  from public.client_procedure_orders o
  join public.clients c
    on c.id = o.client_id
   and c.user_id = v_user_id
  left join (
    select p.procedure_order_id, sum(p.amount)::numeric as paid_total
    from public.client_procedure_payments p
    where p.user_id = v_user_id
    group by p.procedure_order_id
  ) payment_totals on payment_totals.procedure_order_id = o.id
  where o.user_id = v_user_id
    and o.status = 'pending'
    and o.amount > coalesce(payment_totals.paid_total, 0);
end;
$function$;

create or replace function private.get_procedure_payment_orders()
returns table (
  procedure_order_id uuid,
  client_name text,
  procedure_name text,
  amount numeric,
  status text,
  order_date date,
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
    or not ((select public.has_permission('payments_view')) or (select public.has_permission('payments_edit'))) then
    raise exception 'No tienes permiso para consultar los trámites'
      using errcode = '42501';
  end if;

  return query
  select
    o.id,
    c.full_name,
    o.procedure_name,
    o.amount::numeric,
    o.status::text,
    o.order_date,
    coalesce(sum(pp.amount), 0)::numeric,
    greatest(o.amount - coalesce(sum(pp.amount), 0), 0)::numeric
  from public.client_procedure_orders o
  join public.clients c
    on c.id = o.client_id
   and c.user_id = v_user_id
  left join public.client_procedure_payments pp
    on pp.user_id = v_user_id
   and pp.procedure_order_id = o.id
  where o.user_id = v_user_id
    and o.status <> 'cancelled'
  group by o.id, c.full_name
  order by o.order_date desc, c.full_name, o.procedure_name;
end;
$function$;

create or replace function private.get_procedure_payment_suppliers()
returns table (
  supplier_id uuid,
  name text,
  active boolean
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
    or not ((select public.has_permission('payments_view')) or (select public.has_permission('payments_edit'))) then
    raise exception 'No tienes permiso para consultar proveedores'
      using errcode = '42501';
  end if;

  return query
  select s.id, s.name, s.active
  from public.suppliers s
  where s.user_id = v_user_id
  order by s.active desc, s.name;
end;
$function$;

create or replace function private.register_client_balance_payment(
  p_client_id uuid,
  p_amount numeric,
  p_method text,
  p_paid_at date,
  p_reference text default '',
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_client_name text;
  v_amount numeric(12,2);
  v_total_balance numeric(12,2);
  v_remaining numeric(12,2);
  v_applied numeric(12,2) := 0;
  v_balance numeric(12,2);
  v_item record;
  v_payment_count integer := 0;
  v_sale_id uuid;
begin
  if v_user_id is null or not (select public.has_permission('payments_edit')) then
    raise exception 'No tienes permiso para registrar pagos'
      using errcode = '42501';
  end if;
  if p_client_id is null then
    raise exception 'Selecciona un cliente';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'El importe debe ser mayor a cero';
  end if;
  v_amount := round(p_amount, 2);
  if p_amount <> v_amount then
    raise exception 'El importe admite hasta dos decimales';
  end if;
  if p_method is null or p_method not in ('efectivo', 'transferencia', 'tarjeta', 'otro') then
    raise exception 'El método de pago no es válido';
  end if;

  select c.full_name
    into v_client_name
  from public.clients c
  where c.id = p_client_id
    and c.user_id = v_user_id
  for update;
  if not found then
    raise exception 'El cliente no existe o no pertenece a tu espacio de trabajo';
  end if;

  perform s.id
  from public.sales s
  where s.user_id = v_user_id
    and s.client_id = p_client_id
    and s.status = 'pending'
  order by s.sale_date, s.id
  for update;

  perform o.id
  from public.client_procedure_orders o
  where o.user_id = v_user_id
    and o.client_id = p_client_id
    and o.status = 'pending'
  order by o.order_date, o.id
  for update;

  select coalesce(sum(debts.balance), 0)::numeric(12,2)
    into v_total_balance
  from (
    select greatest(s.amount - coalesce(sum(p.amount), 0), 0)::numeric(12,2) as balance
    from public.sales s
    left join public.payments p
      on p.sale_id = s.id
     and p.user_id = v_user_id
    where s.user_id = v_user_id
      and s.client_id = p_client_id
      and s.status = 'pending'
    group by s.id
    union all
    select greatest(o.amount - coalesce(sum(pp.amount), 0), 0)::numeric(12,2)
    from public.client_procedure_orders o
    left join public.client_procedure_payments pp
      on pp.user_id = v_user_id
     and pp.procedure_order_id = o.id
    where o.user_id = v_user_id
      and o.client_id = p_client_id
      and o.status = 'pending'
    group by o.id
  ) debts;

  if v_total_balance <= 0 then
    raise exception 'El cliente no tiene saldo pendiente';
  end if;
  if v_amount > v_total_balance then
    raise exception 'El pago excede el saldo pendiente del cliente';
  end if;

  v_remaining := v_amount;
  for v_item in
    select debts.item_type, debts.item_id, debts.item_date, debts.balance, debts.label
    from (
      select
        'sale'::text as item_type,
        s.id as item_id,
        s.sale_date as item_date,
        greatest(s.amount - coalesce(sum(p.amount), 0), 0)::numeric(12,2) as balance,
        s.service::text as label
      from public.sales s
      left join public.payments p
        on p.sale_id = s.id
       and p.user_id = v_user_id
      where s.user_id = v_user_id
        and s.client_id = p_client_id
        and s.status = 'pending'
      group by s.id
      union all
      select
        'procedure'::text,
        o.id,
        o.order_date,
        greatest(o.amount - coalesce(sum(pp.amount), 0), 0)::numeric(12,2),
        o.procedure_name::text
      from public.client_procedure_orders o
      left join public.client_procedure_payments pp
        on pp.user_id = v_user_id
       and pp.procedure_order_id = o.id
      where o.user_id = v_user_id
        and o.client_id = p_client_id
        and o.status = 'pending'
      group by o.id
    ) debts
    where debts.balance > 0
    order by debts.item_date, debts.item_type, debts.item_id
  loop
    exit when v_remaining <= 0;
    v_balance := least(v_item.balance, v_remaining);

    if v_item.item_type = 'sale' then
      insert into public.payments (user_id, sale_id, amount, method, paid_at, reference, notes)
      values (
        v_user_id, v_item.item_id, v_balance, p_method, coalesce(p_paid_at, current_date),
        coalesce(p_reference, ''), coalesce(p_notes, '')
      );
      if v_balance >= v_item.balance then
        update public.sales
        set status = 'paid', updated_at = now()
        where id = v_item.item_id
          and user_id = v_user_id;
      end if;
    else
      insert into public.sales (
        user_id, client_name, service, profile_name, sale_date, amount, status, notes,
        client_id, procedure_order_id
      )
      values (
        v_user_id, v_client_name, 'Trámite: ' || v_item.label, '', coalesce(p_paid_at, current_date),
        v_balance, 'paid', coalesce(p_notes, ''), p_client_id, v_item.item_id
      )
      returning id into v_sale_id;

      insert into public.payments (user_id, sale_id, amount, method, paid_at, reference, notes)
      values (
        v_user_id, v_sale_id, v_balance, p_method, coalesce(p_paid_at, current_date),
        coalesce(p_reference, ''), coalesce(p_notes, '')
      );

      insert into public.client_procedure_payments (
        user_id, procedure_order_id, sale_id, amount, method, paid_at, reference, notes
      )
      values (
        v_user_id, v_item.item_id, v_sale_id, v_balance, p_method, coalesce(p_paid_at, current_date),
        coalesce(p_reference, ''), coalesce(p_notes, '')
      );

      if v_balance >= v_item.balance then
        update public.client_procedure_orders
        set status = 'paid', paid_at = coalesce(p_paid_at, current_date), updated_at = now()
        where id = v_item.item_id
          and user_id = v_user_id;
      end if;
    end if;

    v_remaining := v_remaining - v_balance;
    v_applied := v_applied + v_balance;
    v_payment_count := v_payment_count + 1;
  end loop;

  if v_remaining <> 0 then
    raise exception 'No se pudo aplicar el importe completo del pago';
  end if;

  return jsonb_build_object(
    'payment_count', v_payment_count,
    'applied_amount', v_applied,
    'balance_remaining', v_total_balance - v_applied
  );
end;
$function$;

revoke all on function private.register_client_balance_payment(uuid, numeric, text, date, text, text) from public, anon, authenticated;
revoke all on function private.get_procedure_payment_orders() from public, anon, authenticated;
revoke all on function private.get_procedure_payment_suppliers() from public, anon, authenticated;
grant execute on function private.register_client_balance_payment(uuid, numeric, text, date, text, text) to authenticated;
grant execute on function private.get_procedure_payment_orders() to authenticated;
grant execute on function private.get_procedure_payment_suppliers() to authenticated;

create or replace function public.register_client_balance_payment(
  p_client_id uuid,
  p_amount numeric,
  p_method text,
  p_paid_at date,
  p_reference text default '',
  p_notes text default ''
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog
as $function$
  select private.register_client_balance_payment(
    p_client_id, p_amount, p_method, p_paid_at, p_reference, p_notes
  );
$function$;

create or replace function public.get_procedure_payment_orders()
returns table (
  procedure_order_id uuid,
  client_name text,
  procedure_name text,
  amount numeric,
  status text,
  order_date date,
  paid numeric,
  balance numeric
)
language sql
stable
security invoker
set search_path = pg_catalog
as $function$
  select * from private.get_procedure_payment_orders();
$function$;

create or replace function public.get_procedure_payment_suppliers()
returns table (
  supplier_id uuid,
  name text,
  active boolean
)
language sql
stable
security invoker
set search_path = pg_catalog
as $function$
  select * from private.get_procedure_payment_suppliers();
$function$;

revoke all on function public.register_client_balance_payment(uuid, numeric, text, date, text, text) from public, anon;
revoke all on function public.get_procedure_payment_orders() from public, anon;
revoke all on function public.get_procedure_payment_suppliers() from public, anon;
grant execute on function public.register_client_balance_payment(uuid, numeric, text, date, text, text) to authenticated;
grant execute on function public.get_procedure_payment_orders() to authenticated;
grant execute on function public.get_procedure_payment_suppliers() to authenticated;

with created_sales as (
  insert into public.sales (
    user_id, client_name, service, profile_name, sale_date, amount, status, notes,
    client_id, procedure_order_id
  )
  select
    o.user_id,
    c.full_name,
    'Trámite: ' || o.procedure_name,
    '',
    o.paid_at,
    o.amount,
    'paid',
    coalesce(o.notes, ''),
    o.client_id,
    o.id
  from public.client_procedure_orders o
  join public.clients c
    on c.id = o.client_id
   and c.user_id = o.user_id
  where o.status = 'paid'
    and o.paid_at is not null
    and not exists (
      select 1 from public.client_procedure_payments pp
      where pp.user_id = o.user_id
        and pp.procedure_order_id = o.id
    )
  returning id, user_id, procedure_order_id, amount, sale_date
),
created_receipts as (
  insert into public.payments (user_id, sale_id, amount, method, paid_at, reference, notes)
  select
    cs.user_id, cs.id, cs.amount, 'otro', cs.sale_date,
    'Registro histórico de trámite', 'Pago completo registrado antes del registro de abonos'
  from created_sales cs
  returning sale_id
)
insert into public.client_procedure_payments (
  user_id, procedure_order_id, sale_id, amount, method, paid_at, reference, notes
)
select
  cs.user_id, cs.procedure_order_id, cs.id, cs.amount, 'otro', cs.sale_date,
  'Registro histórico de trámite', 'Pago completo registrado antes del registro de abonos'
from created_sales cs
join created_receipts cr on cr.sale_id = cs.id;


drop policy if exists client_procedure_orders_insert on public.client_procedure_orders;
create policy client_procedure_orders_insert
  on public.client_procedure_orders
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
    and paid_at is null
    and (select public.has_permission('clients_edit'))
    and exists (
      select 1 from public.clients c
      where c.id = client_procedure_orders.client_id
        and c.user_id = (select auth.uid())
    )
  );

revoke update on public.client_procedure_orders from authenticated;

create or replace function private.cancel_client_procedure_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_status text;
begin
  if v_user_id is null or not (select public.has_permission('clients_edit')) then
    raise exception 'No tienes permiso para cancelar trámites'
      using errcode = '42501';
  end if;

  select o.status
    into v_status
  from public.client_procedure_orders o
  where o.id = p_order_id
    and o.user_id = v_user_id
  for update;
  if not found then
    raise exception 'El trámite no existe o no pertenece a tu espacio de trabajo';
  end if;
  if v_status <> 'pending' then
    raise exception 'Solo se pueden cancelar trámites pendientes';
  end if;
  if exists (
    select 1
    from public.client_procedure_payments p
    where p.user_id = v_user_id
      and p.procedure_order_id = p_order_id
  ) then
    raise exception 'No se puede cancelar un trámite con abonos registrados';
  end if;

  update public.client_procedure_orders
  set status = 'cancelled', paid_at = null, updated_at = now()
  where id = p_order_id
    and user_id = v_user_id;
end;
$function$;

create or replace function public.cancel_client_procedure_order(p_order_id uuid)
returns void
language sql
security invoker
set search_path = pg_catalog
as $function$
  select private.cancel_client_procedure_order(p_order_id);
$function$;

revoke all on function private.cancel_client_procedure_order(uuid) from public, anon, authenticated;
grant execute on function private.cancel_client_procedure_order(uuid) to authenticated;
revoke all on function public.cancel_client_procedure_order(uuid) from public, anon;
grant execute on function public.cancel_client_procedure_order(uuid) to authenticated;

comment on table public.client_procedure_payments is
  'Abonos a trámites; cada abono se refleja también como una venta y un pago cobrado.';
comment on table public.procedure_supplier_payments is
  'Egresos pagados a proveedores por trámites, asociados al pedido para calcular su ganancia neta.';
