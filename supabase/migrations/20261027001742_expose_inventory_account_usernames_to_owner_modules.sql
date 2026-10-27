grant usage on schema private to authenticated;

create or replace function private.inventory_account_display_users()
returns table(inventory_account_id uuid, account_username text)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_can_view_inventory boolean;
begin
  if v_user_id is null
    or not (
      (select public.has_permission('accounts_view'))
      or (select public.has_permission('clients_view'))
      or (select public.has_permission('clients_edit'))
      or (select public.has_permission('reports_view'))
      or (select public.has_permission('inventory_view'))
      or (select public.has_permission('inventory_edit'))
    ) then
    raise exception 'No tienes permiso para consultar usuarios de cuentas'
      using errcode = '42501';
  end if;

  v_can_view_inventory :=
    (select public.has_permission('accounts_view'))
    or (select public.has_permission('clients_edit'))
    or (select public.has_permission('reports_view'))
    or (select public.has_permission('inventory_view'))
    or (select public.has_permission('inventory_edit'));

  return query
  select
    i.id,
    coalesce(nullif(trim(cred.username), ''), '')::text
  from public.inventario_cuentas i
  left join private.inventory_account_credentials cred
    on cred.inventory_account_id = i.id
   and cred.user_id = v_user_id
  where i.user_id = v_user_id
    and (
      v_can_view_inventory
      or exists (
        select 1
        from public.client_account_assignments ca
        where ca.user_id = v_user_id
          and ca.inventory_account_id = i.id
      )
    )
  order by i.service, i.created_at, i.id;
end;
$function$;

revoke all on function private.inventory_account_display_users() from public, anon, authenticated;
grant execute on function private.inventory_account_display_users() to authenticated;

create or replace function public.inventory_account_display_users()
returns table(inventory_account_id uuid, account_username text)
language sql
stable
security invoker
set search_path = pg_catalog
as $function$
  select * from private.inventory_account_display_users();
$function$;

revoke all on function public.inventory_account_display_users() from public, anon;
grant execute on function public.inventory_account_display_users() to authenticated;

comment on function private.inventory_account_display_users() is
  'Returns usernames only for the authenticated owner and only for modules permitted to view the relevant accounts.';
