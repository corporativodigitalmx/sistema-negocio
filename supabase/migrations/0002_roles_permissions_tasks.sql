-- Roles, permisos y tareas. Cada cuenta nueva recibe acceso solo a su inventario.
create table if not exists public.user_access (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role text not null default 'user' check (role in ('user', 'superadmin')),
  permissions jsonb not null default '{"inventory_view": true, "inventory_edit": true}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_access_email_idx on public.user_access (lower(email));

create or replace function public.is_superadmin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_access
    where user_id = (select auth.uid()) and role = 'superadmin'
  );
$$;

create or replace function public.has_permission(permission_name text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.is_superadmin() or exists (
    select 1 from public.user_access
    where user_id = (select auth.uid())
      and coalesce((permissions ->> permission_name)::boolean, false)
  );
$$;

revoke all on function public.is_superadmin() from public, anon;
revoke all on function public.has_permission(text) from public, anon;
grant execute on function public.is_superadmin() to authenticated;
grant execute on function public.has_permission(text) to authenticated;

alter table public.user_access enable row level security;
revoke all on table public.user_access from anon;
grant select, insert, update, delete on table public.user_access to authenticated;

drop policy if exists "Usuarios consultan su propio acceso" on public.user_access;
create policy "Usuarios consultan su propio acceso"
  on public.user_access for select to authenticated
  using (user_id = (select auth.uid()) or public.is_superadmin());

drop policy if exists "Superadmin administra accesos" on public.user_access;
create policy "Superadmin administra accesos"
  on public.user_access for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

create or replace function public.create_user_access_for_auth_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.user_access (user_id, email, full_name)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (user_id) do update set
    email = excluded.email,
    full_name = case when excluded.full_name = '' then public.user_access.full_name else excluded.full_name end,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_access_created on auth.users;
create trigger on_auth_user_access_created
  after insert or update on auth.users
  for each row execute function public.create_user_access_for_auth_user();

-- Crear perfiles para usuarios que ya existían antes de esta migración.
insert into public.user_access (user_id, email, full_name)
select id, lower(coalesce(email, '')), coalesce(raw_user_meta_data ->> 'full_name', '')
from auth.users
on conflict (user_id) do update set
  email = excluded.email,
  full_name = case when excluded.full_name = '' then public.user_access.full_name else excluded.full_name end,
  updated_at = now();

-- Asignar el superusuario solicitado, siempre que esa cuenta exista.
update public.user_access
set role = 'superadmin', updated_at = now()
where lower(email) = 'davidem9211@gmail.com';

-- El superadmin administra todos los inventarios; los demás solo sus propios datos
-- y únicamente si tienen permisos de consulta/edición.
drop policy if exists "Cada usuario consulta su inventario" on public.inventario_cuentas;
create policy "Cada usuario consulta su inventario"
  on public.inventario_cuentas for select to authenticated
  using (
    user_id = (select auth.uid()) and public.has_permission('inventory_view')
    or public.has_permission('inventory_all')
  );

drop policy if exists "Cada usuario crea su inventario" on public.inventario_cuentas;
create policy "Cada usuario crea su inventario"
  on public.inventario_cuentas for insert to authenticated
  with check (
    user_id = (select auth.uid()) and public.has_permission('inventory_edit')
    or public.has_permission('inventory_all')
  );

drop policy if exists "Cada usuario actualiza su inventario" on public.inventario_cuentas;
create policy "Cada usuario actualiza su inventario"
  on public.inventario_cuentas for update to authenticated
  using (
    user_id = (select auth.uid()) and public.has_permission('inventory_edit')
    or public.has_permission('inventory_all')
  )
  with check (
    user_id = (select auth.uid()) and public.has_permission('inventory_edit')
    or public.has_permission('inventory_all')
  );

drop policy if exists "Cada usuario elimina su inventario" on public.inventario_cuentas;
create policy "Cada usuario elimina su inventario"
  on public.inventario_cuentas for delete to authenticated
  using (
    user_id = (select auth.uid()) and public.has_permission('inventory_edit')
    or public.has_permission('inventory_all')
  );

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  created_by uuid not null references auth.users (id) on delete cascade,
  assigned_to uuid references auth.users (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed')),
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_assigned_to_idx on public.tasks (assigned_to, status);
alter table public.tasks enable row level security;
revoke all on table public.tasks from anon;
grant select, insert, update, delete on table public.tasks to authenticated;

drop policy if exists "Usuarios consultan tareas asignadas" on public.tasks;
create policy "Usuarios consultan tareas asignadas"
  on public.tasks for select to authenticated
  using (
    public.is_superadmin()
    or public.has_permission('tasks_manage')
    or (public.has_permission('tasks_view') and (assigned_to = (select auth.uid()) or created_by = (select auth.uid())))
  );

drop policy if exists "Usuarios autorizados asignan tareas" on public.tasks;
create policy "Usuarios autorizados asignan tareas"
  on public.tasks for insert to authenticated
  with check (public.has_permission('tasks_manage') and created_by = (select auth.uid()));

drop policy if exists "Usuarios autorizados editan tareas" on public.tasks;
create policy "Usuarios autorizados editan tareas"
  on public.tasks for update to authenticated
  using (public.has_permission('tasks_manage'))
  with check (public.has_permission('tasks_manage'));

drop policy if exists "Usuarios autorizados eliminan tareas" on public.tasks;
create policy "Usuarios autorizados eliminan tareas"
  on public.tasks for delete to authenticated
  using (public.has_permission('tasks_manage'));

create or replace function public.set_task_status(task_id uuid, next_status text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if next_status not in ('pending', 'in_progress', 'completed') then
    raise exception 'Estado de tarea no válido';
  end if;

  update public.tasks
  set status = next_status, updated_at = now()
  where id = task_id
    and (
      public.is_superadmin()
      or public.has_permission('tasks_manage')
      or (public.has_permission('tasks_view') and assigned_to = (select auth.uid()))
    );

  if not found then
    raise exception 'Tarea no encontrada o sin permiso para actualizarla';
  end if;
end;
$$;

revoke all on function public.set_task_status(uuid, text) from public, anon;
grant execute on function public.set_task_status(uuid, text) to authenticated;
