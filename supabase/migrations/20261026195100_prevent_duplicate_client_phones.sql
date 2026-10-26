-- Prevent duplicate customer phone numbers per account, even when punctuation differs.
-- An advisory transaction lock closes the race between concurrent sales registrations.
create or replace function public.prevent_duplicate_client_phone()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_phone_digits text;
begin
  v_phone_digits := regexp_replace(coalesce(new.phone, ''), '[^0-9]', '', 'g');
  if v_phone_digits = '' then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(new.user_id::text || ':' || v_phone_digits, 0)
  );

  if exists (
    select 1
    from public.clients c
    where c.user_id = new.user_id
      and c.id is distinct from new.id
      and regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') = v_phone_digits
  ) then
    raise exception 'Número ya existe en la base de datos' using errcode = '23505';
  end if;

  return new;
end;
$function$;

revoke all on function public.prevent_duplicate_client_phone() from public, anon, authenticated;

drop trigger if exists clients_prevent_duplicate_phone on public.clients;
create trigger clients_prevent_duplicate_phone
before insert or update of phone, user_id on public.clients
for each row execute function public.prevent_duplicate_client_phone();