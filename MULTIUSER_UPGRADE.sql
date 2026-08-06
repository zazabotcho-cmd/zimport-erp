-- ZIMPORT MULTI-USER SAFETY UPGRADE
-- Run once in Supabase SQL Editor after the original schema.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['agencies','suppliers','items','tenders','worker_submissions','submitted_items','winners','archived_tenders','purchase_orders','shipments','supplier_invoices','settings','recycle_bin'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1',t);
  END LOOP;
END $$;

-- Let Supabase Realtime broadcast changes from all business tables.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['agencies','suppliers','items','tenders','worker_submissions','submitted_items','winners','archived_tenders','purchase_orders','shipments','supplier_invoices','settings','recycle_bin'] LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;

-- Ensure each update changes audit information without overwriting the version chosen by optimistic locking.
CREATE OR REPLACE FUNCTION public.set_audit_fields() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    NEW.created_by=coalesce(NEW.created_by,auth.uid());
    NEW.created_at=coalesce(NEW.created_at,now());
    NEW.version=coalesce(NEW.version,1);
  END IF;
  NEW.updated_by=coalesce(auth.uid(),NEW.updated_by);
  NEW.updated_at=now();
  RETURN NEW;
END;$$;
