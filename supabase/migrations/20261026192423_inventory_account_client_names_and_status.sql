create or replace function public.inventory_account_client_names()
returns table(inventory_account_id uuid, client_names text[])
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  if auth.uid() is null
    or not (
      public.has_permission('inventory_view')
      or public.has_permission('inventory_edit')
      or public.has_permission('inventory_all')
    ) then
    raise exception 'No tienes permiso para consultar los clientes del inventario'
      using errcode = '42501';
  end if;

  return query
  select i.id,
    coalesce(
      array_agg(distinct c.full_name order by c.full_name)
        filter (where c.id is not null),
      array[]::text[]
    )
  from public.inventario_cuentas i
  left join public.client_account_assignments ca
    on ca.inventory_account_id = i.id
    and ca.user_id = i.user_id
    and ca.assignment_status = 'active'
    and ca.expires_on >= current_date
  left join public.clients c
    on c.id = ca.client_id
    and c.user_id = i.user_id
  where i.user_id = auth.uid()
    or public.has_permission('inventory_all')
  group by i.id;
end;
$function$;

revoke all on function public.inventory_account_client_names() from public, anon;
grant execute on function public.inventory_account_client_names() to authenticated;