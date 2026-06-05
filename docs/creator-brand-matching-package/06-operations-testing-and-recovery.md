# Operations, Testing, And Recovery

This is the day-to-day operating guide after setup.

## Test Email And Discord Only

Use this after adding or changing Resend, recipient email, sender email, or Discord webhook.

GitHub path:

Actions -> Monthly Opportunity Intelligence Refresh -> Run workflow

Tick:

```text
Send test email + Discord message only
```

Expected result:

- email arrives with subject `Team Billion Monthly Refresh Notification Test`
- Discord receives a test message
- no Gmail ingestion runs
- no Sheet rows change
- no GPT export files regenerate

## Monthly Real Run

The monthly workflow runs automatically on the first day of every month at 08:00 UTC.

To run manually:

Actions -> Monthly Opportunity Intelligence Refresh -> Run workflow

Do not tick the test checkbox.

The real run:

1. validates credentials
2. runs preflight
3. creates backup
4. scans Gmail
5. writes database updates
6. refreshes intelligence
7. creates GPT export files
8. creates ZIP package
9. sends email
10. posts Discord summary if configured

## What The Monthly Email Includes

The success email includes:

- monthly summary
- emails scanned
- new opportunities
- updated opportunities
- new brands
- new agencies
- new contacts
- opportunities moved to review
- Priority A opportunities added
- top new brands
- top new agencies
- backup confirmation
- GPT upload instructions
- ZIP attachment if small enough
- GitHub Actions run link

If the ZIP is too large, the email links to the GitHub Actions artifact instead.

## What Discord Includes

Discord includes:

- emails scanned
- new opportunities
- updated opportunities
- Priority A added
- moved to review
- new brands
- new agencies
- priority distribution
- short top brand list
- short top agency list
- GitHub Actions run link

Discord does not receive files.

## How To Download The GPT Package

1. Open the successful GitHub Actions run.
2. Scroll to Artifacts.
3. Download `team-billion-gpt-knowledge-refresh`.
4. Unzip it.
5. Upload the approved files to GPT Builder.

## Weekly Scan Later

The current package is monthly.

If someone later wants weekly scanning and monthly GPT packaging, the clean change is:

- keep monthly workflow for GPT ZIP package
- add a separate weekly ingestion workflow
- weekly flow scans Gmail and updates the database
- monthly flow packages and emails the GPT files

That is a small developer change. It does not require rebuilding the whole system.

## Failure Email

If the workflow fails, the owner should receive an email with:

- failed step
- error message
- backup status
- suggested recovery action
- GitHub Actions run link

## Common Failures

### Gmail auth fails

Likely causes:

- wrong Gmail refresh token
- Gmail API not enabled
- OAuth app not allowed
- token was revoked

Fix:

1. Generate a new refresh token.
2. Update `GMAIL_REFRESH_TOKEN` in GitHub secrets.
3. Rerun notification test if email settings changed.
4. Rerun full workflow when ready.

### Google Sheets auth fails

Likely causes:

- wrong service account email
- wrong private key
- private key pasted with missing lines
- Google Sheet not shared with service account
- Google Sheets API not enabled

Fix:

1. Check `GOOGLE_SERVICE_ACCOUNT_EMAIL`.
2. Check `GOOGLE_PRIVATE_KEY`.
3. Share the Sheet with service account email as Editor.
4. Rerun.

### Resend email fails

Likely causes:

- domain not verified
- API key wrong
- `MONTHLY_REFRESH_EMAIL_FROM` does not match verified domain
- recipient email typo

Fix:

1. Confirm Resend domain says verified.
2. Regenerate API key if needed.
3. Update GitHub secrets.
4. Run notification test only.

### Discord message fails

Likely causes:

- webhook URL copied wrong
- webhook deleted
- channel permissions changed

Fix:

1. Create a new webhook.
2. Update `DISCORD_WEBHOOK_URL`.
3. Run notification test only.

### Sheet data looks wrong after live ingestion

Use backup.

Local restore command:

```bash
npm run opportunity:restore-backup
```

Actual restore requires confirmation:

```bash
npm run opportunity:restore-backup -- --confirm
```

Only restore after checking the backup timestamp.

## Owner Monthly Checklist

1. Check monthly email.
2. Check Discord summary.
3. Look at new opportunities and review count.
4. Decide if GPT Knowledge is worth updating this month.
5. If yes, download ZIP.
6. Upload approved files to GPT Builder.
7. Save GPT.
