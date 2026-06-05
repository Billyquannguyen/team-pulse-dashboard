# Developer Handoff

This page is for the person installing or maintaining the code.

The user-facing docs are plain English. This file maps those docs to the actual repo files.

## Core Scripts

Gmail ingestion:

```text
scripts/opportunity-ingestion/runner.mjs
```

Preflight:

```text
scripts/opportunity-ingestion/preflight.mjs
```

Backup and restore:

```text
scripts/opportunity-ingestion/backup.mjs
```

Quality cleanup:

```text
scripts/opportunity-ingestion/quality-cleanup.mjs
```

GPT export:

```text
scripts/opportunity-ingestion/gpt-export.mjs
```

Monthly package, email, and Discord:

```text
scripts/opportunity-ingestion/monthly-refresh.mjs
```

GitHub Actions workflow:

```text
.github/workflows/monthly-opportunity-refresh.yml
```

## Main Commands

```bash
npm run opportunity:validate-credentials
npm run opportunity:preflight
npm run opportunity:create-backup
npm run opportunity:ingest:dry-run
npm run opportunity:validate-sample
npm run opportunity:ingest
npm run opportunity:quality-cleanup
npm run opportunity:export
npm run opportunity:monthly-refresh -- prepare
```

## Required Environment Variables

```text
GMAIL_CLIENT_ID
GMAIL_CLIENT_SECRET
GMAIL_REFRESH_TOKEN
GOOGLE_SERVICE_ACCOUNT_EMAIL
GOOGLE_PRIVATE_KEY
OPPORTUNITY_DATABASE_SPREADSHEET_ID
EMAIL_PROVIDER_API_KEY
MONTHLY_REFRESH_EMAIL_TO
MONTHLY_REFRESH_EMAIL_FROM
DISCORD_WEBHOOK_URL
```

`DISCORD_WEBHOOK_URL` is optional.

## Local Test File

Use:

```text
.env.opportunity-ingestion
```

Do not commit it.

Use:

```text
docs/creator-brand-matching-package/templates/env.example
```

## Scanner Design

The scanner is deterministic and rule-based.

It does not call OpenAI during Gmail ingestion.

It classifies emails into:

- Opportunity Created
- Review Needed
- Skipped Irrelevant

It writes review flags for unclear extraction instead of silently trusting weak rows.

## Custom GPT Design

The Custom GPT should not connect to Gmail.

It should only use uploaded Knowledge files.

The monthly automation creates the package, but upload remains manual.

## Production Notes

Use GitHub Actions for the monthly batch process.

Do not use Vercel Cron for this workflow. The job involves Gmail ingestion, Google Sheets writes, exports, backups, packaging, and notifications. GitHub Actions is a better fit for this batch job.

## Before Handing To A New Owner

Confirm:

- Google Cloud project belongs to the owner.
- Gmail refresh token belongs to the mailbox owner.
- Google Sheet belongs to the owner.
- GitHub repo belongs to the owner.
- Resend account belongs to the owner.
- Discord webhook points to the owner's server.
- No Team Billion secrets remain.
- GPT instructions have been renamed if not used for Team Billion.
