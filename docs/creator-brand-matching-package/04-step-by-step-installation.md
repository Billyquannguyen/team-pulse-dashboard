# Step By Step Installation

This guide assumes the owner wants the system to scan their own Gmail inbox, write to their own Google Sheet, email them monthly, and optionally post to Discord.

## Before You Start

You need:

- Gmail account to scan
- Google Cloud account
- Google Sheet for the database
- GitHub repository
- Resend account for monthly email
- Optional Discord server/channel
- Someone who can run or deploy the code

Recommended:

- Use a private GitHub repository.
- Use a dedicated Google Cloud project.
- Use a dedicated sending email like `updates@yourdomain.com`.

## Step 1: Prepare The Google Sheet Database

Create one Google Sheet called:

```text
Creator Brand Matching Opportunity Intelligence Database
```

The working Team Billion version uses these tabs:

- Opportunities
- Organizations
- Brands
- Contacts
- Extraction Review
- Ingestion Log
- Brand Intelligence
- Agency Intelligence
- Contact Intelligence
- Creator Matching Signals
- Alias Mapping

The code expects these tabs to exist.

Use `09-google-sheet-database-template.md` for what each tab means and which starter headers to add.

If you are installing from this repo, run the existing preflight command after credentials are connected. It will tell you if required tabs are missing.

## Step 2: Create Google Cloud Credentials

You need two Google credential sets:

1. Gmail OAuth credentials for reading the inbox.
2. Service account credentials for writing to the Google Sheet.

Plain English:

- Gmail OAuth asks the human mailbox owner for permission.
- Service account acts like a robot editor for the spreadsheet.

Follow `03-secrets-and-api-keys-guide.md` for exact values.

## Step 3: Share The Google Sheet

After creating the service account, copy its email.

Share the database Google Sheet with that service account email.

Give it Editor access.

If this step is missed, Gmail auth may work but Sheets will fail with a permission error.

## Step 4: Add GitHub Secrets

Open the repository in GitHub.

Go to:

Settings -> Secrets and variables -> Actions -> New repository secret

Add every secret listed in `templates/github-secrets-checklist.md`.

## Step 5: Configure Resend

Resend sends the monthly report email.

1. Add a sending domain in Resend.
2. Add the DNS records to your domain provider.
3. Wait until Resend says the domain is verified.
4. Create an API key.
5. Add it to GitHub as `EMAIL_PROVIDER_API_KEY`.
6. Add the sender as `MONTHLY_REFRESH_EMAIL_FROM`.
7. Add recipient email as `MONTHLY_REFRESH_EMAIL_TO`.

## Step 6: Optional Discord Summary

If the owner wants a team summary in Discord:

1. Create a Discord channel webhook.
2. Copy the webhook URL.
3. Add it to GitHub as `DISCORD_WEBHOOK_URL`.

Discord receives summary only.

Discord does not receive the ZIP package or private files.

## Step 7: Install Dependencies

In the project folder, run:

```bash
npm install
```

If using GitHub Actions only, the workflow installs dependencies in the cloud.

## Step 8: Validate Credentials

Run:

```bash
npm run opportunity:validate-credentials
```

This checks:

- Gmail permission works.
- Google Sheet permission works.
- Private key format is accepted.
- Spreadsheet ID is correct.

It does not scan Gmail.

## Step 9: Run Preflight

Run:

```bash
npm run opportunity:preflight
```

This checks:

- required tabs exist
- spreadsheet is writable
- backup can be created
- local checkpoint storage works
- intelligence tabs can refresh
- Gmail search has estimated results

It does not ingest email bodies.

## Step 10: Create Backup

Run:

```bash
npm run opportunity:create-backup
```

Do this before any live ingestion.

## Step 11: Dry Run

Run:

```bash
npm run opportunity:ingest:dry-run
```

This scans a small sample and writes nothing.

Review the output before a live scan.

## Step 12: Controlled Live Test

Run:

```bash
node scripts/opportunity-ingestion/runner.mjs --max-emails 100
```

This writes real rows, but only for a small controlled batch.

Check the Google Sheet after this.

## Step 13: Full Live Ingestion

If the controlled test looks good:

```bash
npm run opportunity:ingest
```

If it stops, run the same command again. It resumes from checkpoint.

## Step 14: Refresh Quality And Exports

Run:

```bash
npm run opportunity:quality-cleanup
npm run opportunity:export
```

This creates the GPT-ready knowledge files.

## Step 15: Run Monthly Workflow In GitHub

Open GitHub:

Actions -> Monthly Opportunity Intelligence Refresh -> Run workflow

For a real monthly run, leave the test checkbox unticked.

For notification testing only, tick:

```text
Send test email + Discord message only
```

## Step 16: Update Custom GPT Knowledge Manually

After a successful monthly run:

1. Download `team-billion-gpt-knowledge-refresh`.
2. Unzip it.
3. Open GPT Builder.
4. Delete old Knowledge files.
5. Upload the new files.
6. Save the GPT.
