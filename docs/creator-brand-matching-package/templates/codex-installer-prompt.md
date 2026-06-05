# Codex Installer Prompt

Paste this into Codex inside the target repo.

```text
Install the Creator Brand Matching email scanner and monthly GPT Knowledge refresh system into this repo.

Use the package in docs/creator-brand-matching-package as the source of truth.

Goal:

Gmail -> Opportunity Intelligence Google Sheet -> Intelligence refresh -> GPT export package -> monthly email summary -> optional Discord summary.

Do not automate GPT Builder upload.

Use GitHub Actions for the monthly workflow.

Use Resend for email.

Use Discord webhook only if DISCORD_WEBHOOK_URL is configured.

Keep all secrets in GitHub repository secrets.

Do not commit .env files.

Add or verify scripts for:

- credential validation
- preflight
- backup
- Gmail ingestion
- quality cleanup
- GPT export
- monthly package creation
- email success notification
- email failure notification
- Discord success notification
- notification test only

Use these GitHub secrets:

- GMAIL_CLIENT_ID
- GMAIL_CLIENT_SECRET
- GMAIL_REFRESH_TOKEN
- GOOGLE_SERVICE_ACCOUNT_EMAIL
- GOOGLE_PRIVATE_KEY
- OPPORTUNITY_DATABASE_SPREADSHEET_ID
- EMAIL_PROVIDER_API_KEY
- MONTHLY_REFRESH_EMAIL_TO
- MONTHLY_REFRESH_EMAIL_FROM
- DISCORD_WEBHOOK_URL

After implementation, provide:

1. files added
2. files modified
3. exact setup steps
4. testing steps
5. how to run notification-only test
6. how to run full monthly workflow
7. how to recover from failure
```
