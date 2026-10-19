-- Inventario persistente y aislado por usuario autenticado.
create table if not exists public.inventario_cuentas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  service text not null,
  account_label text not null,
  provider text not null,
  purchase_date date not null,
  duration integer not null check (duration > 0),
  unit text not null check (unit in ('days', 'months', 'years')),
  customers jsonb not null default '[]'::jsonb,
  cost numeric(12, 2),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inventario_cuentas_user_id_idx
  on public.inventario_cuentas (user_id);

alter table public.inventario_cuentas enable row level security;

revoke all on table public.inventario_cuentas from anon;
grant select, insert, update, delete on table public.inventario_cuentas to authenticated;

drop policy if exists "Cada usuario consulta su inventario" on public.inventario_cuentas;
create policy "Cada usuario consulta su inventario"
  on public.inventario_cuentas for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Cada usuario crea su inventario" on public.inventario_cuentas;
create policy "Cada usuario crea su inventario"
  on public.inventario_cuentas for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Cada usuario actualiza su inventario" on public.inventario_cuentas;
create policy "Cada usuario actualiza su inventario"
  on public.inventario_cuentas for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Cada usuario elimina su inventario" on public.inventario_cuentas;
create policy "Cada usuario elimina su inventario"
  on public.inventario_cuentas for delete to authenticated
  using ((select auth.uid()) = user_id);
