# Team Billion Monthly Opportunity Refresh

The monthly Opportunity Intelligence refresh now runs from the Team Billion dashboard on Vercel. It no longer sends email and no longer depends on a scheduled GitHub Action.

Google Sheets is unchanged. The refresh continues to update the existing Opportunity Intelligence spreadsheet using the existing service-account variables.

## What Runs

Every run:

1. checks Gmail and Google Sheets access
2. runs the extraction safety checks
3. creates a private rollback backup
4. scans Gmail in resumable batches
5. updates the existing Opportunity Intelligence Sheet
6. runs the data cleanup and GPT export
7. creates a private downloadable GPT Knowledge package
8. posts success or failure to Discord

The package remains a manual GPT Knowledge upload. It is available only to an authenticated admin in Goals & Analytics.

## Dashboard Control

Sign in as an admin and open `Goals & Analytics`.

The `Monthly opportunity refresh` panel shows:

- current status and stage
- last start or completion time
- number of Gmail messages scanned
- a `Run monthly refresh` button
- a private package download after a successful run

Members and admin member-preview mode do not see this control.

## Automatic Schedule

Vercel calls `/api/monthly-opportunity-refresh` on:

`0 8 1 * *`

That is the first day of every month at 08:00 UTC. The endpoint fails closed unless Vercel supplies the correct `CRON_SECRET`.

The old GitHub Actions workflow has been removed, so it cannot run a duplicate scan or depend on the retired Gmail OAuth client.

## Required Vercel Variables

Gmail:

- `MASTER_GMAIL_CLIENT_ID`
- `MASTER_GMAIL_CLIENT_SECRET`
- `MASTER_GMAIL_REFRESH_TOKEN`

Existing Google Sheets access, unchanged:

- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `OPPORTUNITY_DATABASE_SPREADSHEET_ID`

Runtime services:

- `CRON_SECRET`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `BLOB_STORE_ID` (added automatically when the private Blob store is connected)
- `DISCORD_WEBHOOK_URL` or the existing `WEEKLY_GMAIL_REPORT_DISCORD_WEBHOOK_URL`
- `OPENROUTER_API_KEY`
- `OPENROUTER_DEFAULT_MODEL`
- `OPENROUTER_FALLBACK_MODEL` (optional)
- `DASHBOARD_PUBLIC_URL`

The private Blob store uses Vercel's deployment identity automatically. Do not create or copy a Blob read/write token. Backups and generated packages remain private.

## Discord

Discord is the only notification channel. There is no monthly refresh email or Resend dependency.

The success message includes the scan counts and tells the admin to download the package from Goals & Analytics. Failure messages include the failed stage and a short error. Files and credentials are never posted to Discord.

## Storage and Recovery

Upstash stores only the small run status, worker checkpoint, and lock. The private Blob store keeps the latest safety backups and generated packages. Old files are pruned automatically.

If a run fails, the dashboard shows `Needs attention`, Discord receives the error, and the admin can retry from Goals & Analytics. The safety backup is retained for recovery.
