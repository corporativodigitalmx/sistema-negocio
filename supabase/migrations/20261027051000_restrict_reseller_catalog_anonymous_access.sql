-- Reseller pricing requires an authenticated store customer.
revoke all on public.reseller_store_catalog from public, anon;
grant select on public.reseller_store_catalog to authenticated;
