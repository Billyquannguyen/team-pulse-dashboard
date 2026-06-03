# Opportunity Ingestion Runner

This runner scans Gmail with the Gmail API, extracts creator opportunity records, and writes them into the approved Team Billion Opportunity Intelligence Database.

It is built for full historical ingestion, but it does not run automatically. Run a dry test first.

## What It Does

- Reads Gmail with pagination.
- Saves a local checkpoint after each batch.
- Resumes after interruption.
- Reads the approved Google Sheet structure.
- Applies approved Alias Mapping rows.
- Detects and skips duplicate Source Email IDs.
- Updates existing opportunity rows when new extraction has stronger confidence.
- Appends new Opportunities.
- Appends new Brands, Organizations, Contacts, Extraction Review rows, and Alias Mapping review suggestions.
- Writes and updates Ingestion Log.
- Extends formulas in intelligence tabs without changing the schema.
- Keeps `Recommended Priority Tier` as `Insufficient Data` when Total Opportunities is below 3.

## Files

- Runner: `scripts/opportunity-ingestion/runner.mjs`
- Checkpoint folder: `.opportunity-ingestion/`
- Local env file: `.env.opportunity-ingestion`

The checkpoint and local env file are ignored by Git.

## Required Environment Variables

Create `.env.opportunity-ingestion` in the project root:

```bash
GMAIL_CLIENT_ID=your_google_oauth_client_id
GMAIL_CLIENT_SECRET=your_google_oauth_client_secret
GMAIL_REFRESH_TOKEN=your_gmail_refresh_token

GOOGLE_SERVICE_ACCOUNT_EMAIL=your_service_account_email
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

OPPORTUNITY_DATABASE_SPREADSHEET_ID=1T6jjHFb5ujsIqw2GvZ26lIVhHf9mPkAU6fihosqonZQ
```

## Gmail OAuth Setup

The Google service account can write to Google Sheets, but it cannot read your personal Gmail inbox.

For Gmail you need a normal Google OAuth refresh token for your account.

Use scope:

```text
https://www.googleapis.com/auth/gmail.readonly
```

Recommended setup:

1. Go to Google Cloud Console.
2. Use the same project or create a new one.
3. Enable Gmail API.
4. Create OAuth Client ID.
5. Choose Desktop app.
6. Copy the client ID and client secret.
7. Generate a refresh token with Gmail readonly scope.
8. Put the values in `.env.opportunity-ingestion`.

Do not commit this file.

## Google Sheets Setup

Use the existing service account already used by the dashboard.

The Opportunity Intelligence Database must be shared with the service account as Editor.

Sheet:

```text
https://docs.google.com/spreadsheets/d/1T6jjHFb5ujsIqw2GvZ26lIVhHf9mPkAU6fihosqonZQ/edit
```

Rollback backups use Google Sheets API only. Google Drive API access is not required.

The backup is saved locally on your Mac as a timestamped JSON snapshot. It stores tab metadata plus the values/formulas from each tab.

## Commands

Validate credentials without scanning Gmail:

```bash
npm run opportunity:validate-credentials
```

Run the full pre-ingestion health check:

```bash
npm run opportunity:preflight
```

This checks Gmail auth, Sheets auth, backup capability, required tabs, Alias Mapping, spreadsheet edit capability, local checkpoint storage, intelligence formula readiness, and Gmail result-size estimate.

It does not read email bodies, write opportunity rows, create records, or create a backup file.

Create a timestamped Google Sheet backup before live ingestion:

```bash
npm run opportunity:create-backup
```

Preview restore instructions without changing the sheet:

```bash
npm run opportunity:restore-backup
```

Restore from the latest backup:

```bash
npm run opportunity:restore-backup -- --confirm
```

Restore from a specific backup manifest:

```bash
npm run opportunity:restore-backup -- --backup ".opportunity-ingestion/backups/backup-YYYY-MM-DDTHH-MM-SS-000Z.json" --confirm
```

Dry test, reads 25 candidate emails and writes nothing:

```bash
npm run opportunity:ingest:dry-run
```

Quality validation dry run, reads up to 100 candidate emails and writes nothing:

```bash
npm run opportunity:validate-sample
```

This prints the relevance distribution, 10 sample classifications, and safety warnings before a full scan.

Live full scan:

```bash
npm run opportunity:ingest
```

Resume after laptop closes:

```bash
npm run opportunity:ingest
```

Run Sheet quality cleanup after ingestion:

```bash
npm run opportunity:quality-cleanup
```

Preview cleanup without changing the Sheet:

```bash
npm run opportunity:quality-cleanup:dry-run
```

This does not scan Gmail. It approves only obvious high-confidence alias merges, summarizes the review queue, refreshes intelligence formulas, and logs a cleanup report.

Reset checkpoint:

```bash
npm run opportunity:reset-checkpoint
```

This only removes local checkpoint files. It does not delete Sheet rows, backups, or extracted data.

Controlled live test:

```bash
node scripts/opportunity-ingestion/runner.mjs --max-emails 100
```

## Safe Run Strategy

Recommended order:

1. Validate credentials.
2. Run preflight.
3. Create a backup.
4. Run the 100-email validation sample.
5. Inspect relevance distribution, sample classifications, and safety warnings.
6. Reset the checkpoint if you intentionally want to restart from the beginning.
7. Run a controlled live test only if the validation sample looks clean.
8. Inspect Opportunities and Extraction Review.
9. Create another backup if the controlled live test looks good.
10. Run full live ingestion.
11. Review Alias Mapping additions.
12. Run quality cleanup.
13. Review Top 50 Brand and Agency intelligence before building Creator Matching GPT.
14. Create a GPT export pack for the custom GPT knowledge upload.

## Creator Matching GPT Export

The Gmail scan writes the full raw database into Google Sheets. Do not upload the whole raw Sheet directly into a custom GPT first. The raw data includes useful opportunities, duplicates, historical signals, affiliate-only rows, and some noisy extracted names.

Create a cleaner local export pack with:

```bash
npm run opportunity:gpt-export
```

This reads the Google Sheet and creates CSV/Markdown files in:

```text
.opportunity-ingestion/gpt-exports/
```

The export does not scan Gmail and does not write to the Sheet. It creates a safer knowledge pack with curated opportunity rows, brand intelligence, agency intelligence, creator matching signals, and a short instruction file for the custom GPT.

## Preflight Health Check

Run:

```bash
npm run opportunity:preflight
```

Checks performed:

- Gmail auth valid
- Sheets auth valid
- Drive API not required
- Backup system operational
- Alias Mapping tab exists
- Required tabs exist
- Spreadsheet writable
- Resume checkpoint system operational
- Intelligence tabs have refreshable formulas
- Estimated Gmail result count for the ingestion query

The Gmail estimate uses Gmail search metadata only. It does not read email bodies.

## Rollback Backups

The backup command creates a timestamped local snapshot using the Google Sheets API.

It also stores a local manifest in:

```text
.opportunity-ingestion/backups/
```

Each manifest stores:

- original spreadsheet ID
- timestamp
- row counts by tab
- sheet metadata
- tab values/formulas
- restore instructions

The latest backup is also saved as:

```text
.opportunity-ingestion/backups/latest-backup.json
```

Restore is guarded. Running this command alone does not change the spreadsheet:

```bash
npm run opportunity:restore-backup
```

It prints the backup it would restore and the exact confirm command.

To actually restore:

```bash
npm run opportunity:restore-backup -- --confirm
```

Restore keeps the same original spreadsheet ID, clears the saved tab ranges, and writes the backed-up values/formulas back into those tabs.

If ingestion fails:

1. Stop the ingestion process.
2. Do not reset the checkpoint yet.
3. Run `npm run opportunity:restore-backup`.
4. Confirm it points to the correct backup timestamp.
5. Run `npm run opportunity:restore-backup -- --confirm`.
6. Reopen the Google Sheet and check the tabs.
7. Only reset or rerun ingestion after the sheet looks correct.

## Checkpoints

The runner writes:

```text
.opportunity-ingestion/checkpoint.json
```

It stores:

- Gmail next page token
- processed message IDs
- run counters
- last processed message
- ingestion log row

If the process stops, run the same command again. It resumes from the checkpoint.

Only reset the checkpoint when you intentionally want to restart.

The runner saves the local checkpoint after every processed batch. The Google Sheet ingestion log is updated less often so Sheets quota limits do not stop the actual extraction work.

If Google returns a write quota warning, the runner waits and retries. If a progress-log write fails, the local checkpoint is still saved.

## Duplicate Safety

Primary duplicate key:

```text
Source Email ID
```

If a message already exists:

- Existing manual fields are preserved.
- Empty fields may be filled.
- Higher-confidence extraction may improve non-manual fields.

Additional duplicate checks:

- Gmail thread ID within the current run
- specific subject match when the subject is not generic
- brand + source organization + same calendar week
- brand + similar campaign summary

Generic subjects like “Collaboration opportunity” are not enough on their own to skip a row.

Manual fields preserved:

- Account Owner
- Last Owner
- Member Tag / Deal Code
- Relationship Notes
- Review Notes
- Reviewer Notes

## Alias Handling

The runner reads `Alias Mapping`.

Only rows with:

```text
Suggested Action = Merge
Approved? = Yes
```

are applied automatically.

Low-confidence new aliases are added back to Alias Mapping with:

```text
Approved? = No
```

That means they wait for human review instead of silently merging.

## Extraction Logic

The runner uses deterministic rules. It does not call OpenAI.

Every scanned email is classified as one of:

- Opportunity Created
- Review Needed
- Skipped Irrelevant

It also records a reason code such as:

- Clear brand brief
- Paid campaign detected
- Affiliate offer detected
- Song promotion detected
- PR gifting detected
- Agency brief detected
- Too vague
- Newsletter / mass blast
- No creator opportunity
- Internal / irrelevant
- Duplicate

It extracts:

- opportunity type
- brand
- source organization
- source organization type
- contact
- creator requirements
- platform
- niche
- budget
- affiliate status
- song promotion exception
- usage rights
- whitelisting
- source strength
- confidence score
- review flags

This keeps identical inputs producing identical outputs.

## Important Limitation

This is a rule-based extractor.

It is safer and cheaper than AI, but it can miss subtle emails or produce uncertain records when:

- the brand is only inside an attachment
- a Chinese agency uses a generic Gmail or QQ address
- budget is discussed deep in a long thread
- agency and brand names are mixed together
- old forwarded threads contain multiple campaigns

Those cases should appear in `Extraction Review`.

## Safety Warnings

The runner warns before a bigger scan if quality signals look risky:

- relevant email rate above 85%
- review queue rate above 60%
- duplicate skip rate is 0 after a 100-email sample
- unknown brand rate is high
- unknown agency/source rate is high

Warnings do not block the run. They are there so you can stop and inspect before filling the Sheet with weak rows.

## Sheets Quota Notes

Google Sheets limits how many write requests can happen per minute.

The runner reduces quota pressure by:

- processing larger email batches
- writing rows in grouped batch updates
- updating the ingestion log every 100 scanned emails instead of every batch
- waiting longer when Google returns `429 quota exceeded`

If a full ingestion pauses for a minute, leave it running. If it exits after a quota error, rerun:

```bash
npm run opportunity:ingest
```

It will resume from the local checkpoint.

## Do Not Run Full Scan Until

- `.env.opportunity-ingestion` is complete.
- Dry run works.
- 100-email validation sample looks good.
- controlled live test looks good.
- You are okay with the runner adding many rows.
