-- Let authorized sales staff choose whether a new sale is paid or pending.
-- The existing atomic assignment RPC still selects inventory and creates the sale.
create or replace function public.create_inventory_sale_with_payment(
  p_client_id uuid,
  p_client_name text,
  p_client_phone text,
  p_service text,
  p_delivery_type text,
  p_sale_date date,
  p_amount numeric,
  p_notes text,
  p_payment_status text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_result jsonb;
  v_sale_id uuid;
begin
  if auth.uid() is null or not public.has_permission('sales_edit') then
    raise exception 'No tienes permiso para registrar ventas' using errcode = '42501';
  end if;
  if p_payment_status not in ('pending', 'paid') then
    raise exception 'Selecciona un estado de pago válido';
  end if;

  v_result := public.create_inventory_sale_auto(
    p_client_id, p_client_name, p_client_phone, p_service,
    p_delivery_type, p_sale_date, p_amount, p_notes
  );
  v_sale_id := (v_result ->> 'sale_id')::uuid;

  update public.sales
    set status = p_payment_status
    where id = v_sale_id and user_id = auth.uid();
  if not found then
    raise exception 'No se pudo actualizar el estado de pago de la venta';
  end if;

  return jsonb_set(v_result, '{status}', to_jsonb(p_payment_status), true);
end;
$function$;

revoke all on function public.create_inventory_sale_with_payment(uuid, text, text, text, text, date, numeric, text, text) from public, anon;
grant execute on function public.create_inventory_sale_with_payment(uuid, text, text, text, text, date, numeric, text, text) to authenticated;
