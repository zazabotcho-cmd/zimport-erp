-- Existing users retain legacy permissions (NULL); new users receive an explicit page list.
alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists allowed_pages text[];
create unique index if not exists profiles_username_unique on public.profiles (lower(username)) where username is not null;
alter table public.profiles add constraint profiles_username_format check (username is null or username ~ '^[a-zA-Z0-9_.-]{3,40}$');
create or replace function public.winglobal_table_access(table_name text) returns boolean
language sql stable security invoker set search_path=public as $fn$
 select coalesce((select active and (role='admin' or allowed_pages is null or allowed_pages &&
 case table_name
 when 'agencies' then array['agencies','tenders','items','tender-suppliers','tender-supplier-items','worker-list','calculator','supplier-items-page','po-page','proformas','transportation','dashboard']::text[]
 when 'suppliers' then array['calculator','supplier-items-page','tender-suppliers','tender-supplier-items','po-page','proformas','archived-pos','transportation','archived-transportation','inventory-stock','inventory-in-stock','inventory-financial-regu-seas-other','dashboard']::text[]
 when 'items' then array['items','tenders','worker-list','tender-supplier-items','submissions','tender-winners','archived-tenders','all-proposals','dashboard']::text[]
 when 'tenders' then array['tenders','worker-list','items','submissions','tender-winners','archived-tenders','all-proposals','tender-suppliers','tender-supplier-items','country-opportunities','country-dashboard','country-candidates','country-archived-candidates','country-winners','dashboard']::text[]
 when 'worker_submissions' then array['worker-list','tenders','country-opportunities','country-candidates','country-dashboard','dashboard']::text[]
 when 'submitted_items' then array['submissions','all-proposals','tender-winners','archived-tenders','country-candidates','country-archived-candidates','country-dashboard','dashboard']::text[]
 when 'winners' then array['tender-winners','all-proposals','po-page','country-winners','country-dashboard','dashboard']::text[]
 when 'archived_tenders' then array['archived-tenders','all-proposals','country-winners','dashboard']::text[]
 when 'purchase_orders' then array['po-page','proformas','archived-pos','transportation','archived-transportation','financial','supplier-payments','supplier-payments-2','inventory-stock','inventory-in-stock','inventory-financial-regu-seas-other','tender-winners','dashboard']::text[]
 when 'shipments' then array['transportation','archived-transportation','po-page','archived-pos','financial','inventory-stock','inventory-in-stock','inventory-financial-regu-seas-other','dashboard']::text[]
 when 'supplier_invoices' then array['all-invoices','financial','all-other-invoices','other-invoices-new','archived-invoices','supplier-payments','supplier-payments-2','inventory-financial-regu-seas-other','dashboard']::text[]
 when 'settings' then array['settings','program-settings','country-dashboard','country-opportunities','country-wineries','country-candidates','country-archived-candidates','country-winners','country-manager-notes','country-manager-recycle-bin','country-performance','inventory-stock','inventory-in-stock-office','inventory-financial-regu-seas-other','internal-mail','country-contact-person','country-internal-mail','heads-recycle-bin']::text[]
 when 'recycle_bin' then array['recycle-bin','heads-recycle-bin','dashboard']::text[]
 when 'activity_log' then array['dashboard','dashboard']::text[]
 else array[]::text[] end) from public.profiles where id=(select auth.uid())),false);
$fn$;
revoke all on function public.winglobal_table_access(text) from public,anon;
grant execute on function public.winglobal_table_access(text) to authenticated;
create policy winglobal_page_access on public.agencies as restrictive for all to authenticated using (public.winglobal_table_access('agencies')) with check (public.winglobal_table_access('agencies'));
create policy winglobal_page_access on public.suppliers as restrictive for all to authenticated using (public.winglobal_table_access('suppliers')) with check (public.winglobal_table_access('suppliers'));
create policy winglobal_page_access on public.items as restrictive for all to authenticated using (public.winglobal_table_access('items')) with check (public.winglobal_table_access('items'));
create policy winglobal_page_access on public.tenders as restrictive for all to authenticated using (public.winglobal_table_access('tenders')) with check (public.winglobal_table_access('tenders'));
create policy winglobal_page_access on public.worker_submissions as restrictive for all to authenticated using (public.winglobal_table_access('worker_submissions')) with check (public.winglobal_table_access('worker_submissions'));
create policy winglobal_page_access on public.submitted_items as restrictive for all to authenticated using (public.winglobal_table_access('submitted_items')) with check (public.winglobal_table_access('submitted_items'));
create policy winglobal_page_access on public.winners as restrictive for all to authenticated using (public.winglobal_table_access('winners')) with check (public.winglobal_table_access('winners'));
create policy winglobal_page_access on public.archived_tenders as restrictive for all to authenticated using (public.winglobal_table_access('archived_tenders')) with check (public.winglobal_table_access('archived_tenders'));
create policy winglobal_page_access on public.purchase_orders as restrictive for all to authenticated using (public.winglobal_table_access('purchase_orders')) with check (public.winglobal_table_access('purchase_orders'));
create policy winglobal_page_access on public.shipments as restrictive for all to authenticated using (public.winglobal_table_access('shipments')) with check (public.winglobal_table_access('shipments'));
create policy winglobal_page_access on public.supplier_invoices as restrictive for all to authenticated using (public.winglobal_table_access('supplier_invoices')) with check (public.winglobal_table_access('supplier_invoices'));
create policy winglobal_page_access on public.settings as restrictive for all to authenticated using (public.winglobal_table_access('settings')) with check (public.winglobal_table_access('settings'));
create policy winglobal_page_access on public.recycle_bin as restrictive for all to authenticated using (public.winglobal_table_access('recycle_bin')) with check (public.winglobal_table_access('recycle_bin'));
create policy winglobal_page_access on public.activity_log as restrictive for all to authenticated using (public.winglobal_table_access('activity_log')) with check (public.winglobal_table_access('activity_log'));
