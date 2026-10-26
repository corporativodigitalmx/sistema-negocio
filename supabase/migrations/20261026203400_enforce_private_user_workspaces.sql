-- Give every signed-in user a private operational workspace.
-- Global *_all permissions are deliberately never honored, including for superusers.
create or replace function public.has_permission(permission_name text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select case
    when permission_name = any (array[
      'clients_all', 'inventory_all', 'sales_all', 'payments_all', 'suppliers_all'
    ]::text[]) then false
    else public.is_superadmin() or coalesce((
      select (ua.permissions ->> permission_name)::boolean
      from public.user_access ua
      where ua.user_id = (select auth.uid())
    ), false)
  end;
$function$;
revoke all on function public.has_permission(text) from public, anon;
grant execute on function public.has_permission(text) to authenticated;

-- Restrictive policies compose with existing feature permissions and prevent any
-- permissive *_all or support-management policy from crossing account boundaries.
do $migration$
declare
  v_table text;
begin
  foreach v_table in array array[
    'clients',
    'client_account_assignments',
    'inventario_cuentas',
    'inventory_accounts',
    'inventory_issue_reports',
    'sales',
    'payments',
    'suppliers',
    'support_tickets',
    'store_customer_profiles'
  ] loop
    execute format('drop policy if exists tenant_owner_isolation on public.%I', v_table);
    execute format(
      'create policy tenant_owner_isolation on public.%I as restrictive for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      v_table
    );
  end loop;
end;
$migration$;

-- Tasks remain assignable, but each person sees only tasks they created or received.
drop policy if exists tenant_owner_isolation on public.tasks;
create policy tenant_owner_isolation on public.tasks as restrictive for all to authenticated
using (created_by = (select auth.uid()) or assigned_to = (select auth.uid()))
with check (created_by = (select auth.uid()) or assigned_to = (select auth.uid()));

-- Keep stored credentials private even if table grants or permissive policies are added later.
drop policy if exists tenant_owner_isolation on private.inventory_account_credentials;
create policy tenant_owner_isolation on private.inventory_account_credentials as restrictive for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- The status RPC must obey the same creator/assignee boundary instead of bypassing it for superusers.
create or replace function public.set_task_status(task_id uuid, next_status text)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if next_status not in ('pending', 'in_progress', 'completed') then
    raise exception 'Estado de tarea no válido';
  end if;

  update public.tasks
  set status = next_status, updated_at = now()
  where id = task_id
    and (
      (assigned_to = (select auth.uid()) and public.has_permission('tasks_view'))
      or (created_by = (select auth.uid()) and public.has_permission('tasks_manage'))
    );

  if not found then
    raise exception 'Tarea no encontrada o sin permiso para actualizarla';
  end if;
end;
$function$;
revoke all on function public.set_task_status(uuid, text) from public, anon;
grant execute on function public.set_task_status(uuid, text) to authenticated;