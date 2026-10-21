# Durable authentication and deployment

Accounts and bcrypt password hashes are stored in Cloudflare D1's `auth_users` table, independently of Botkeep source updates. Apply `api/migrations/0004_auth_users.sql` and deploy the Worker before deploying the server. Preserve the existing D1 database binding, `D1_API_SECRET`, and `JWT_SECRET` across deployments. Never delete or recreate the D1 database as part of a source deployment.

`AUTH_DB_PATH` is a legacy migration source, outside the public frontend directory. Existing accounts are copied to D1 without overwriting existing remote passwords. The local file remains unchanged. Back it up before changing its path; D1 cannot recover accounts from an already deleted SQLite file.

When D1 contains no accounts, the server can provision the first account using `USER_EMAIL` and `USER_PASSWORD` from Botkeep secrets. The normalized email must be in `ADMIN_EMAILS`, and the password must contain at least 12 characters and at most 72 UTF-8 bytes. A conditional insert prevents concurrent first boot requests from creating multiple bootstrap accounts. Updating these secrets later does **not** reset an existing password. Additional accounts use the operator-authenticated registration endpoint.

Missing credentials, schema, or D1 connectivity fail initialization; the server never silently creates a replacement local account database. Login storage failures return 503, while incorrect credentials retain a generic 401. Internal startup checks report only booleans for account presence, operator authorization and bootstrap password consistency; no passwords, hashes or email addresses are logged.

After deployment, check `/api/ready`, the startup authentication check, and login through the dashboard. Retain D1 backups/Time Travel according to the account's retention plan: persistence across deployment does not protect against deliberate database deletion. A stable `JWT_SECRET` preserves existing sessions; rotating it intentionally invalidates them.
