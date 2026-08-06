ZIMPORT MULTI-USER UPGRADE

1. In Supabase, open SQL Editor > New Query.
2. Copy everything from MULTIUSER_UPGRADE.sql and click Run.
3. Upload all web files in this folder to your hosting provider.
4. Give each person a separate Supabase user account.
5. Recommended roles: owner = admin, trusted second user = manager, data-entry employee = worker.

WHAT CHANGED
- Record-by-record inserts, updates and deletes.
- Optimistic version checks prevent silent overwrites.
- If two users edit the same record, the second save is stopped and the latest cloud data reloads.
- Realtime refresh shows changes from other users.
- Activity log records create, update, delete and file actions.
- Shared private storage helper functions are included.

IMPORTANT
- Existing old browser-only attachments remain local until re-uploaded.
- New custom attachment fields should use ZimportOnline.uploadFile() and store the returned path in the record.
- Always host the program through HTTPS; do not run production use from file:///.
