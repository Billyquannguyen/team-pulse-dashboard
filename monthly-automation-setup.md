# Team Billion Monthly Opportunity Refresh Automation

This setup runs the Opportunity Intelligence refresh in GitHub Actions once per month.

It does not depend on Codex, ChatGPT, your laptop, or Vercel Cron.

The Custom GPT upload still stays manual because GPT Knowledge files cannot be safely updated automatically from this workflow.

The automation belongs to your GitHub repo, your Google credentials, and your email provider account. Codex is only used to edit or improve the system. If you stop using Codex later, this scheduled workflow keeps running as long as the repo, secrets, Google access, and email provider remain active.

## What Runs

Every monthly run does this:

1. Installs dependencies with `npm ci`
2. Validates Gmail and Google Sheets credentials
3. Runs preflight checks
4. Creates a rollback backup
5. Runs Gmail ingestion
6. Refreshes the intelligence layer with quality cleanup
7. Generates the GPT export
8. Creates `team-billion-gpt-knowledge-refresh.zip`
9. Creates `monthly-gpt-refresh-summary.md`
10. Uploads the package as a GitHub Actions artifact
11. Emails the refresh result
12. Optionally posts a no-files summary to Discord if `DISCORD_WEBHOOK_URL` is configured

## GitHub Secrets Setup

In GitHub, open the repo, then go to:

`Settings` → `Secrets and variables` → `Actions` → `New repository secret`

Add these secrets:

| Secret                                | Purpose                                                   |
| ------------------------------------- | --------------------------------------------------------- |
| `GMAIL_CLIENT_ID`                     | Gmail OAuth client ID used by the scanner                 |
| `GMAIL_CLIENT_SECRET`                 | Gmail OAuth client secret                                 |
| `GMAIL_REFRESH_TOKEN`                 | Gmail refresh token for the mailbox                       |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`        | Google service account email                              |
| `GOOGLE_PRIVATE_KEY`                  | Google service account private key                        |
| `OPPORTUNITY_DATABASE_SPREADSHEET_ID` | Opportunity Intelligence database spreadsheet ID          |
| `EMAIL_PROVIDER_API_KEY`              | Resend API key                                            |
| `MONTHLY_REFRESH_EMAIL_TO`            | Recipient email address for monthly reports               |
| `MONTHLY_REFRESH_EMAIL_FROM`          | Verified sender email address in Resend                   |
| `DISCORD_WEBHOOK_URL`                 | Optional Discord channel webhook for team monthly summary |

Keep `GOOGLE_PRIVATE_KEY` exactly as a secret. It can be pasted with real newlines or escaped `\n` newlines because the scripts normalize both formats.

## Email Provider Setup

The workflow uses Resend.

1. Create or open a Resend account.
2. Add and verify the sending domain.
3. Create an API key.
4. Put that API key into GitHub as `EMAIL_PROVIDER_API_KEY`.
5. Set `MONTHLY_REFRESH_EMAIL_FROM` to a verified sender, for example `Team Billion <updates@yourdomain.com>`.
6. Set `MONTHLY_REFRESH_EMAIL_TO` to your email address.

If the ZIP is too large for email, the workflow still uploads it as a GitHub Actions artifact and the email tells you to download it from the run page.

## Monthly Email Contents

The success email includes:

- Emails scanned
- New opportunities
- Updated opportunities
- New brands
- New agencies
- New contacts
- Review queue count
- Opportunities moved to review
- Priority A opportunities added
- Top 20 new brands discovered
- Top 20 new agencies discovered
- Priority distribution
- Backup confirmation
- Upload package instructions
- The GPT Knowledge ZIP attachment when it is small enough

Priority A means a newly added opportunity with a strong priority score or Tier 1 export status.

## Optional Discord Team Notice

Discord is executable through a webhook.

Use this when you want the team to see the monthly opportunity refresh without receiving the GPT upload files.

Setup:

1. In Discord, open the target channel settings.
2. Go to `Integrations` → `Webhooks`.
3. Create a webhook for the channel.
4. Copy the webhook URL.
5. Add it to GitHub as the repository secret `DISCORD_WEBHOOK_URL`.

The Discord message includes:

- Emails scanned
- New opportunities
- Updated opportunities
- Priority A opportunities added
- Opportunities moved to review
- New brands
- New agencies
- Priority distribution
- Short top brand and agency lists
- GitHub Actions run link

The Discord message does not attach GPT files.

## Monthly Schedule

The workflow lives here:

`.github/workflows/monthly-opportunity-refresh.yml`

It runs on this cron schedule:

`0 8 1 * *`

That means the first day of every month at 08:00 UTC.

In Berlin time, this is usually 09:00 during winter time and 10:00 during summer time.

## Test Email And Discord Notifications

Use this after changing Resend, email sender, recipient, or the Discord webhook.

1. Go to GitHub.
2. Open `team-pulse-dashboard`.
3. Click `Actions`.
4. Click `Monthly Opportunity Intelligence Refresh`.
5. Click `Run workflow`.
6. Tick `Send test email + Discord message only`.
7. Click the green `Run workflow` button.

This test does not run Gmail ingestion, does not write to the Google Sheet, and does not regenerate GPT exports.

Expected result:

- Your email receives `Team Billion Monthly Refresh Notification Test`.
- Discord receives `Team Billion monthly refresh notification test`.
- The GitHub Actions run should finish in under one minute.

## If You Later Want Weekly Scanning

Current setup is monthly refresh only.

If you later decide to scan Gmail weekly but only package GPT files monthly, the clean path is:

1. Add a separate weekly GitHub Actions workflow.
2. Run credential validation, preflight, backup, Gmail ingestion, and intelligence refresh.
3. Skip GPT ZIP packaging and GPT upload instructions on weekly runs.
4. Keep this monthly workflow for the GPT Knowledge package.

That is a small Codex change, not a rebuild. After the change is committed and pushed, GitHub runs the weekly schedule automatically. You only need to manually rerun the workflow if you want to test it immediately or trigger a scan before the next scheduled time.

## Monthly Operating Cost

Expected cost is usually $0/month if the repository stays within included GitHub Actions minutes and Resend free email limits.

GitHub Actions runs on `ubuntu-latest`. GitHub includes monthly Actions minutes and artifact storage depending on the account plan. This workflow runs once per month, so it should normally stay inside the included quota.

Resend is used only for one success or failure email per run. The free tier has a daily sending limit, so this monthly notification should normally fit unless the Resend account has other email traffic.

Official pricing pages:

- GitHub Actions billing: https://docs.github.com/en/billing/concepts/product-billing/github-actions
- Resend pricing: https://www.resend.com/pricing

## Manual Run Instructions

Open GitHub:

`Repo` → `Actions` → `Monthly Opportunity Intelligence Refresh` → `Run workflow`

Choose the main branch, then click `Run workflow`.

Use this when:

- You want to test the automation
- The monthly run failed and you fixed the issue
- You want a fresh GPT package before the normal monthly schedule

## How To Download The GPT Package

After a successful run:

1. Open the GitHub Actions run.
2. Scroll to `Artifacts`.
3. Download `team-billion-gpt-knowledge-refresh`.
4. Unzip it locally.

The artifact contains:

- `team-billion-gpt-knowledge-refresh.zip`
- `monthly-gpt-refresh-summary.md`
- `monthly-refresh-artifacts.json`

The inner ZIP contains only the approved GPT Knowledge files.

## GPT Knowledge Files Included

Upload only these files to GPT Knowledge:

- `team-billion-matching-intelligence.csv`
- `opportunity-priority-intelligence.csv`
- `agency-commercial-intelligence.csv`
- `brand-commercial-intelligence.csv`
- `pitch-angle-intelligence.csv`
- `creator-brand-opportunities.csv`
- `brand-intelligence.csv`
- `agency-intelligence.csv`
- `creator-matching-signals.csv`
- `team-billion-brand-matching-playbook.md`

Do not upload these internal QA files:

- `review-before-use-opportunities.csv`
- `gpt-readiness-audit.md`
- `gpt-test-scenarios.md`
- `gpt-evaluation-checklist.md`

## How To Update GPT Knowledge

Manual next step after every monthly refresh:

Open GPT Builder, delete the old Knowledge files, upload the new package files, and save.

Do not automate this step. GPT Knowledge uploads are still manual.

## How To Disable The Automation

Option 1:

Go to `Actions` → `Monthly Opportunity Intelligence Refresh`, then disable the workflow from the GitHub Actions UI.

Option 2:

Edit `.github/workflows/monthly-opportunity-refresh.yml` and remove or comment out the `schedule` trigger.

Manual `workflow_dispatch` can stay enabled if you still want manual runs.

## Failure Recovery

If the workflow fails, you should receive an email with:

- Failed step
- Error message
- Backup status
- Suggested recovery action
- GitHub Actions run link

Recovery flow:

1. Open the failed GitHub Actions run.
2. Download the `monthly-opportunity-refresh-logs` artifact.
3. Check the failed step log.
4. If the failure happened before backup, fix the configuration and rerun.
5. If the failure happened after backup and the Sheet looks wrong, restore from the latest backup.
6. Rerun the workflow manually after the issue is fixed.

Restore command:

```bash
npm run opportunity:restore-backup -- --backup ".opportunity-ingestion/backups/backup-YYYY-MM-DDTHH-MM-SS-000Z.json" --confirm
```

Only restore after checking the Sheet. Restore replaces current Sheet data with the backup snapshot.

## Local Smoke Test

This does not scan Gmail. It only tests package/report creation from the latest existing export folder:

```bash
npm run opportunity:monthly-refresh -- prepare --output-dir /private/tmp/team-billion-monthly-test --logs-dir /private/tmp/no-logs
```

Then inspect:

```bash
unzip -l /private/tmp/team-billion-monthly-test/team-billion-gpt-knowledge-refresh.zip
```

## Notes

The workflow intentionally does not use Vercel Cron.

The workflow intentionally does not upload files into GPT Builder.

The workflow intentionally does not change the Opportunity Intelligence database schema.
