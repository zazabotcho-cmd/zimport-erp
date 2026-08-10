-- ZIMPORT worker_submissions duplicate-key diagnostic / cleanup
-- Safe to RUN ONLY if the app still reports worker_submissions_pkey after using the fixed build.

-- 1) Inspect worker submission rows:
select id, organization_id, updated_at
from public.worker_submissions
order by updated_at desc;

-- 2) Check whether any worker_submission id is associated with a different organization.
-- The table primary key is currently global on id, so IDs must be unique across organizations.
select id, count(*) as row_count
from public.worker_submissions
group by id
having count(*) > 1;

-- The fixed application now loads worker_submissions into its sync baseline and
-- adopts an existing same-organization row instead of inserting it again.
