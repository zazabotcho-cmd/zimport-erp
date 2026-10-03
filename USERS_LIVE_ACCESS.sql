-- Additive user management. Existing profiles keep NULL page lists and legacy access.
alter type public.app_role add value if not exists 'partner_supplier';
alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists allowed_pages text[];
alter table public.profiles add column if not exists allowed_countries text[];
alter table public.profiles add column if not exists allowed_supplier_ids text[];
alter table public.profiles add column if not exists deleted_at timestamptz;
create unique index if not exists profiles_username_unique on public.profiles(lower(username)) where username is not null;
create or replace function public.winglobal_table_access(table_name text) returns boolean language sql stable security invoker set search_path=public as $fn$
select coalesce((select active and deleted_at is null and role::text<>'partner_supplier' and (role::text='admin' or allowed_pages is null or allowed_pages && case table_name
when 'agencies' then array['tender-supplier-items','items','tender-suppliers','agencies','calculator','dashboard','proformas','tenders','po-page','worker-list','supplier-items-page','transportation']::text[]
when 'suppliers' then array['inventory-stock','tender-supplier-items','calculator','tender-suppliers','dashboard','archived-transportation','inventory-financial-regu-seas-other','proformas','inventory-in-stock','po-page','archived-pos','supplier-items-page','transportation']::text[]
when 'items' then array['all-proposals','submissions','tender-supplier-items','tender-winners','items','dashboard','tenders','archived-tenders','worker-list']::text[]
when 'tenders' then array['country-winners','all-proposals','tender-winners','submissions','tender-supplier-items','country-candidates','items','tender-suppliers','country-opportunities','dashboard','country-dashboard','tenders','archived-tenders','country-archived-candidates','worker-list']::text[]
when 'worker_submissions' then array['country-candidates','country-opportunities','dashboard','country-dashboard','tenders','worker-list']::text[]
when 'submitted_items' then array['all-proposals','tender-winners','submissions','country-candidates','dashboard','country-dashboard','archived-tenders','country-archived-candidates']::text[]
when 'winners' then array['country-winners','all-proposals','tender-winners','dashboard','country-dashboard','po-page']::text[]
when 'archived_tenders' then array['country-winners','dashboard','all-proposals','archived-tenders']::text[]
when 'purchase_orders' then array['inventory-stock','tender-winners','supplier-payments','supplier-payments-2','dashboard','archived-transportation','inventory-financial-regu-seas-other','proformas','inventory-in-stock','po-page','archived-pos','financial','transportation']::text[]
when 'shipments' then array['inventory-stock','dashboard','archived-transportation','inventory-financial-regu-seas-other','inventory-in-stock','po-page','archived-pos','financial','transportation']::text[]
when 'supplier_invoices' then array['all-invoices','supplier-payments','other-invoices-new','supplier-payments-2','dashboard','archived-invoices','inventory-financial-regu-seas-other','all-other-invoices','financial']::text[]
when 'settings' then array['country-wineries','program-settings','country-winners','country-manager-recycle-bin','inventory-stock','country-candidates','heads-recycle-bin','country-opportunities','internal-mail','country-contact-person','country-internal-mail','country-dashboard','inventory-financial-regu-seas-other','country-archived-candidates','country-manager-notes','inventory-in-stock-office','settings']::text[]
when 'recycle_bin' then array['dashboard','recycle-bin','heads-recycle-bin']::text[]
when 'activity_log' then array['dashboard']::text[]
else array[]::text[] end) from public.profiles where id=(select auth.uid())),false);
$fn$;
revoke all on function public.winglobal_table_access(text) from public,anon;
grant execute on function public.winglobal_table_access(text) to authenticated;
create policy winglobal_page_access on public.agencies as restrictive for all to authenticated using(public.winglobal_table_access('agencies')) with check(public.winglobal_table_access('agencies'));
create policy winglobal_page_access on public.suppliers as restrictive for all to authenticated using(public.winglobal_table_access('suppliers')) with check(public.winglobal_table_access('suppliers'));
create policy winglobal_page_access on public.items as restrictive for all to authenticated using(public.winglobal_table_access('items')) with check(public.winglobal_table_access('items'));
create policy winglobal_page_access on public.tenders as restrictive for all to authenticated using(public.winglobal_table_access('tenders')) with check(public.winglobal_table_access('tenders'));
create policy winglobal_page_access on public.worker_submissions as restrictive for all to authenticated using(public.winglobal_table_access('worker_submissions')) with check(public.winglobal_table_access('worker_submissions'));
create policy winglobal_page_access on public.submitted_items as restrictive for all to authenticated using(public.winglobal_table_access('submitted_items')) with check(public.winglobal_table_access('submitted_items'));
create policy winglobal_page_access on public.winners as restrictive for all to authenticated using(public.winglobal_table_access('winners')) with check(public.winglobal_table_access('winners'));
create policy winglobal_page_access on public.archived_tenders as restrictive for all to authenticated using(public.winglobal_table_access('archived_tenders')) with check(public.winglobal_table_access('archived_tenders'));
create policy winglobal_page_access on public.purchase_orders as restrictive for all to authenticated using(public.winglobal_table_access('purchase_orders')) with check(public.winglobal_table_access('purchase_orders'));
create policy winglobal_page_access on public.shipments as restrictive for all to authenticated using(public.winglobal_table_access('shipments')) with check(public.winglobal_table_access('shipments'));
create policy winglobal_page_access on public.supplier_invoices as restrictive for all to authenticated using(public.winglobal_table_access('supplier_invoices')) with check(public.winglobal_table_access('supplier_invoices'));
create policy winglobal_page_access on public.settings as restrictive for all to authenticated using(public.winglobal_table_access('settings')) with check(public.winglobal_table_access('settings'));
create policy winglobal_page_access on public.recycle_bin as restrictive for all to authenticated using(public.winglobal_table_access('recycle_bin')) with check(public.winglobal_table_access('recycle_bin'));
create policy winglobal_page_access on public.activity_log as restrictive for all to authenticated using(public.winglobal_table_access('activity_log')) with check(public.winglobal_table_access('activity_log'));

create table if not exists public.supplier_workspaces(
 organization_id text not null, supplier_id text not null, country text not null,
 data jsonb not null default '{}'::jsonb,
 version bigint not null default 1,
 updated_at timestamptz not null default now(),
 primary key(organization_id,supplier_id)
);
alter table public.supplier_workspaces enable row level security;
revoke all on public.supplier_workspaces from anon,authenticated;
grant select on public.supplier_workspaces to authenticated;
create policy supplier_workspace_read on public.supplier_workspaces for select to authenticated using(exists(
 select 1 from public.profiles p where p.id=(select auth.uid()) and p.active and p.deleted_at is null and p.organization_id=supplier_workspaces.organization_id
 and (p.role::text='admin' or p.role::text in ('manager','worker','readonly') and p.allowed_pages is null or
 supplier_workspaces.supplier_id=any(p.allowed_supplier_ids) and supplier_workspaces.country=any(p.allowed_countries))
));
-- Seed only supplier identities. Existing workspace records are never overwritten.
insert into public.supplier_workspaces(organization_id,supplier_id,country,data)
select s.organization_id,x->>'id',x->>'country','{}'::jsonb from public.settings s
cross join lateral jsonb_array_elements(coalesce(s.data->'countryPortfolioSuppliers','[]'::jsonb)) x
where s.id='main' and coalesce(x->>'id','')<>'' and coalesce(x->>'country','')<>'' on conflict do nothing;
create or replace function public.winglobal_file_access(file_path text) returns boolean language sql stable security invoker set search_path=public as $fn$
select coalesce((select active and deleted_at is null and
(role::text<>'partner_supplier' or
 split_part(file_path,'/',1)=organization_id and split_part(file_path,'/',2)='partner' and
 split_part(file_path,'/',3)=any(allowed_supplier_ids) and split_part(file_path,'/',4)=any(allowed_countries))
from public.profiles where id=(select auth.uid())),false);
$fn$;
revoke all on function public.winglobal_file_access(text) from public,anon;
grant execute on function public.winglobal_file_access(text) to authenticated;
create policy winglobal_scoped_files on storage.objects as restrictive for all to authenticated using(bucket_id<>'zimport-private-files' or public.winglobal_file_access(name)) with check(bucket_id<>'zimport-private-files' or public.winglobal_file_access(name));
-- Permit partners to work only with files under their assigned supplier path.
create policy partner_scoped_files_read on storage.objects for select to authenticated using(bucket_id='zimport-private-files' and split_part(name,'/',2)='partner' and public.winglobal_file_access(name));
create policy partner_scoped_files_insert on storage.objects for insert to authenticated with check(bucket_id='zimport-private-files' and split_part(name,'/',2)='partner' and public.winglobal_file_access(name));
create policy partner_scoped_files_update on storage.objects for update to authenticated using(bucket_id='zimport-private-files' and split_part(name,'/',2)='partner' and public.winglobal_file_access(name)) with check(bucket_id='zimport-private-files' and split_part(name,'/',2)='partner' and public.winglobal_file_access(name));
create policy partner_scoped_files_delete on storage.objects for delete to authenticated using(bucket_id='zimport-private-files' and split_part(name,'/',2)='partner' and public.winglobal_file_access(name));
