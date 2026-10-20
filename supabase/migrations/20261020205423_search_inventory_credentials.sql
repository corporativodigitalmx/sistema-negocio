-- Search private inventory credentials without returning username or password values.
create or replace function public.search_inventory_credentials(p_query text)
returns table(inventory_account_id uuid)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  v_query text := lower(trim(coalesce(p_query, '')));
begin
  if auth.uid() is null or not (public.has_permission('inventory_edit') or public.has_permission('inventory_all')) then
    raise exception 'No tienes permiso para buscar accesos de inventario' using errcode = '42501';
  end if;

  if v_query = '' or char_length(v_query) > 500 then
    return;
  end if;

  return query
  select i.id
  from public.inventario_cuentas i
  join private.inventory_account_credentials c on c.inventory_account_id = i.id
  where (i.user_id = auth.uid() or public.has_permission('inventory_all'))
    and (
      position(v_query in lower(c.username)) > 0
      or position(v_query in lower(c.password)) > 0
    )
  limit 500;
end;
$function$;

revoke all on function public.search_inventory_credentials(text) from public, anon;
grant execute on function public.search_inventory_credentials(text) to authenticated;
