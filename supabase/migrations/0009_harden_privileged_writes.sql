-- Protect the superadmin role from client-side escalation and accidental lockout.
create or replace function public.guard_user_access_role_changes()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_other_superadmins integer;
begin
  if tg_op = 'DELETE' then
    if old.role = 'superadmin' then
      if not public.is_superadmin() then
        raise exception 'Solo un superusuario puede eliminar un rol de superusuario.'
          using errcode = '42501';
      end if;

      perform pg_advisory_xact_lock(821644203);
      select count(*) into v_other_superadmins
      from public.user_access
      where role = 'superadmin' and user_id <> old.user_id;

      if v_other_superadmins = 0 then
        raise exception 'No se puede eliminar el único superusuario.'
          using errcode = '23514';
      end if;
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.role = 'superadmin' and not public.is_superadmin() then
      raise exception 'Solo un superusuario puede otorgar el rol de superusuario.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.role is distinct from old.role then
    if not public.is_superadmin() then
      raise exception 'Solo un superusuario puede cambiar roles.'
        using errcode = '42501';
    end if;

    if old.role = 'superadmin' and new.role <> 'superadmin' then
      perform pg_advisory_xact_lock(821644203);
      select count(*) into v_other_superadmins
      from public.user_access
      where role = 'superadmin' and user_id <> old.user_id;

      if v_other_superadmins = 0 then
        raise exception 'No se puede quitar el único rol de superusuario.'
          using errcode = '23514';
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_user_access_role_changes() from public, anon, authenticated;
drop trigger if exists guard_user_access_role_changes on public.user_access;
create trigger guard_user_access_role_changes
before insert or update of role or delete on public.user_access
for each row execute function public.guard_user_access_role_changes();

-- Inventory assignment capacity must only change through the locking RPCs.
-- Remove legacy permissive policies that otherwise override restrictive policies.
drop policy if exists client_assign_insert on public.client_account_assignments;
drop policy if exists client_assign_update on public.client_account_assignments;
drop policy if exists client_assign_delete on public.client_account_assignments;
drop policy if exists "Usuarios editan asignaciones autorizadas" on public.client_account_assignments;
drop policy if exists "Usuarios eliminan asignaciones autorizadas" on public.client_account_assignments;
drop policy if exists client_assignments_no_direct_update on public.client_account_assignments;
drop policy if exists client_assignments_no_direct_delete on public.client_account_assignments;
create policy client_assignments_no_direct_update
on public.client_account_assignments for update to authenticated
using (false) with check (false);
create policy client_assignments_no_direct_delete
on public.client_account_assignments for delete to authenticated
using (false);

-- Sales and payments are created only by validated database functions.
drop policy if exists sales_write on public.sales;
drop policy if exists payments_write on public.payments;

-- These are trigger-only functions and should not be exposed as callable routines.
revoke all on function public.guard_store_listing_changes() from public, anon, authenticated;
