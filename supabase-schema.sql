-- ZIMPORT PROGRAM ONLINE DATABASE (Supabase / PostgreSQL)
create extension if not exists pgcrypto;

create type public.app_role as enum ('admin','manager','worker','readonly');
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id text not null default 'zimport-global',
  full_name text,
  role public.app_role not null default 'readonly',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.profiles(id,organization_id,full_name,role) values(new.id,'zimport-global',coalesce(new.raw_user_meta_data->>'full_name',new.email),'readonly') on conflict(id) do nothing; return new; end;$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.current_role() returns public.app_role language sql stable security definer set search_path=public as $$select coalesce((select role from public.profiles where id=auth.uid() and active),'readonly'::public.app_role)$$;
create or replace function public.current_org() returns text language sql stable security definer set search_path=public as $$select coalesce((select organization_id from public.profiles where id=auth.uid() and active),'')$$;

-- Every business table stores the complete current record in JSONB while exposing audit columns.
do $$ declare t text; begin
  foreach t in array array['agencies','suppliers','items','tenders','worker_submissions','submitted_items','winners','archived_tenders','purchase_orders','shipments','supplier_invoices','settings','recycle_bin'] loop
    execute format('create table if not exists public.%I (id text primary key, organization_id text not null, data jsonb not null default ''{}''::jsonb, created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_by uuid references auth.users(id), updated_at timestamptz not null default now(), deleted_by uuid references auth.users(id), restore_date timestamptz)',t);
  end loop;
end $$;

create table if not exists public.activity_log (
 id bigint generated always as identity primary key, organization_id text not null, user_id uuid references auth.users(id), action text not null, entity_type text, entity_id text, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

create or replace function public.set_audit_fields() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op='INSERT' then new.created_by=coalesce(new.created_by,auth.uid()); new.created_at=coalesce(new.created_at,now()); end if;
 new.updated_by=coalesce(auth.uid(),new.updated_by); new.updated_at=now(); return new;
end;$$;

do $$ declare t text; begin
 foreach t in array array['agencies','suppliers','items','tenders','worker_submissions','submitted_items','winners','archived_tenders','purchase_orders','shipments','supplier_invoices','settings','recycle_bin'] loop
   execute format('drop trigger if exists audit_%I on public.%I',t,t);
   execute format('create trigger audit_%I before insert or update on public.%I for each row execute function public.set_audit_fields()',t,t);
   execute format('alter table public.%I enable row level security',t);
   execute format('drop policy if exists %I_select on public.%I',t,t);
   execute format('create policy %I_select on public.%I for select using (organization_id=public.current_org())',t,t);
   execute format('drop policy if exists %I_insert on public.%I',t,t);
   execute format('create policy %I_insert on public.%I for insert with check (organization_id=public.current_org() and public.current_role() in (''admin'',''manager'',''worker''))',t,t);
   execute format('drop policy if exists %I_update on public.%I',t,t);
   execute format('create policy %I_update on public.%I for update using (organization_id=public.current_org() and public.current_role() in (''admin'',''manager'',''worker'')) with check (organization_id=public.current_org())',t,t);
   execute format('drop policy if exists %I_delete on public.%I',t,t);
   execute format('create policy %I_delete on public.%I for delete using (organization_id=public.current_org() and public.current_role() in (''admin'',''manager''))',t,t);
 end loop;
end $$;

alter table public.profiles enable row level security;
create policy profiles_self_read on public.profiles for select using (id=auth.uid() or (organization_id=public.current_org() and public.current_role()='admin'));
create policy profiles_admin_update on public.profiles for update using (organization_id=public.current_org() and public.current_role()='admin');
alter table public.activity_log enable row level security;
create policy activity_org_read on public.activity_log for select using (organization_id=public.current_org() and public.current_role() in ('admin','manager'));
create policy activity_org_insert on public.activity_log for insert with check (organization_id=public.current_org() and user_id=auth.uid());

-- Private file bucket and policies
insert into storage.buckets(id,name,public) values('zimport-private-files','zimport-private-files',false) on conflict(id) do update set public=false;
create policy "zimport files read" on storage.objects for select using (bucket_id='zimport-private-files' and (storage.foldername(name))[1]=public.current_org());
create policy "zimport files upload" on storage.objects for insert with check (bucket_id='zimport-private-files' and (storage.foldername(name))[1]=public.current_org() and public.current_role() in ('admin','manager','worker'));
create policy "zimport files update" on storage.objects for update using (bucket_id='zimport-private-files' and (storage.foldername(name))[1]=public.current_org() and public.current_role() in ('admin','manager','worker'));
create policy "zimport files delete" on storage.objects for delete using (bucket_id='zimport-private-files' and (storage.foldername(name))[1]=public.current_org() and public.current_role() in ('admin','manager'));

-- After creating your first user in Authentication, promote that user once:
-- update public.profiles set role='admin', full_name='Zaza Botchorishvili' where id='PASTE_USER_UUID';
