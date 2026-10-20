-- Store listing and pricing are managed only by superusers, including direct API writes.
create or replace function public.guard_store_listing_changes()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if public.is_superadmin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.store_published is distinct from false
       or new.store_title is distinct from ''
       or new.store_description is distinct from ''
       or new.store_public_profile_price is not null
       or new.store_public_account_price is not null
       or new.store_reseller_profile_price is not null
       or new.store_reseller_account_price is not null then
      raise exception 'Solo un superusuario puede publicar cuentas en la tienda o cambiar sus precios.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.store_published is distinct from old.store_published
     or new.store_title is distinct from old.store_title
     or new.store_description is distinct from old.store_description
     or new.store_public_profile_price is distinct from old.store_public_profile_price
     or new.store_public_account_price is distinct from old.store_public_account_price
     or new.store_reseller_profile_price is distinct from old.store_reseller_profile_price
     or new.store_reseller_account_price is distinct from old.store_reseller_account_price then
    raise exception 'Solo un superusuario puede publicar cuentas en la tienda o cambiar sus precios.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_store_listing_changes on public.inventario_cuentas;
create trigger guard_store_listing_changes
before insert or update on public.inventario_cuentas
for each row execute function public.guard_store_listing_changes();
