# Opportunity Intelligence Pipeline

This pilot creates an Opportunity Intelligence Database from Gmail into Google Sheets.

## Source

Gmail query used for the pilot:

```text
in:anywhere -in:spam -in:trash -from:quan@stride-social.com
(campaign OR brief OR creator OR collaboration OR partnership OR affiliate OR song OR "music promotion" OR UGC OR whitelisting OR "paid usage" OR ambassador OR gifted OR PR OR influencer OR creators)
```

The pilot scanned the newest 200 matching Gmail results. It did not scan the full inbox.

## Database

Google Sheet:

```text
Team Billion Opportunity Intelligence Database
```

Tabs:

- Opportunities
- Organizations
- Brands
- Contacts
- Extraction Review
- Ingestion Log

## Matching Schema

The database is structured for future creator-to-opportunity ranking, not just a static brand list.

Ranking should eventually combine:

- creator fit
- commercial quality
- relationship warmth
- communication recency
- disqualifier penalties

Historical opportunities should usually be kept when they reveal useful brand preference patterns. An older campaign can still show that a brand, agency, or contact tends to look for creators by country, gender, niche, language, platform, audience, or budget range.

The v2 schema adds fields for:

- account ownership and member tags
- brand preference tags
- creator match tags
- requirement confidence
- commercial quality and budget concerns
- last communication date and relationship status
- historical value and matching usefulness
- future scoring fields
- pitch angles and suggested opening lines

Blank scoring fields are intentional until a specific creator profile is being evaluated.

The v3 matching schema adds stronger sales prioritization fields:

- budget floor concern
- fixed fee, affiliate present, affiliate only, and song promotion exception flags
- historical outcome and win/loss signals
- revenue generated and approximate deal value
- historical preference score
- budget, affiliate, success, agency usefulness, and disqualifier scores
- brand-level historical signal counts
- agency usefulness and opportunity volume
- contact-level win/loss connection signals

Agencies should be treated as opportunity gateways. Their value comes from useful briefs, responsiveness, budget quality, and access to multiple clients, not from stable niche preference alone.

Pure affiliate offers should usually receive a heavy penalty. Song promotions are the main exception because lower fees can still be commercially acceptable in that category.

## Opportunity Detection

An email is treated as an opportunity when it appears to contain one of these:

- paid creator campaign
- affiliate program
- song promotion
- PR gifting
- UGC request
- whitelisting or paid usage
- ambassador program
- event invite
- app promotion
- agency or brand brief

Emails are skipped when they look like:

- receipts or invoices without campaign context
- login or security emails
- automated delivery failures
- out-of-office replies
- newsletters with no creator opportunity
- personal creator replies
- internal chatter without an opportunity

## Extraction Rules

The main object is the opportunity, not the brand.

For each opportunity, the pipeline extracts:

- brand
- source organization
- contact
- opportunity type
- creator requirements
- platforms
- niche
- deliverables
- budget or commission
- usage rights
- whitelisting or paid media
- exclusivity
- timeline
- application process
- matching keywords

The sender organization is not assumed to be the brand. Agencies, PR firms, music platforms, and affiliate networks can represent multiple brands.

## Confidence Scoring

Scores are from 0 to 100.

High confidence usually means:

- clear brand
- clear opportunity type
- clear contact/source organization
- clear creator requirement or platform
- clear deliverables, budget, usage, or timeline

Records need review when:

- brand is unclear
- source organization vs brand is unclear
- opportunity type is unclear
- creator requirements are vague
- confidence is below 70
- duplicate matching is uncertain

## Deduplication

Pilot deduplication checks:

- source email ID
- normalized brand + opportunity name
- normalized brand + campaign summary
- similar subject lines
- same contact + same brand + similar recent date

Do not over-merge opportunities from agencies. Agencies often send multiple different campaigns.

## Pilot Result

The first pilot wrote:

- 20 opportunity rows
- 18 organization rows
- 20 brand rows
- 19 contact rows
- 6 review rows
- 1 ingestion log row

## Before Full Inbox Scan

Review the pilot quality first:

- check if brands are separated correctly from agencies
- check if opportunity types feel useful
- decide how much body text is enough for extraction
- decide whether attachments should be parsed later
- review uncertain rows
- approve a resume-safe historical scan

Future full scan should add:

- pagination across historical Gmail
- resume from last scanned date or email ID
- duplicate-safe updates
- weekly incremental ingestion
- manual review resolution
- app diagnostics for scan status

## Production Runner

The production Gmail ingestion runner now lives at:

```text
scripts/opportunity-ingestion/runner.mjs
```

Setup and run instructions are in:

```text
docs/opportunity-ingestion-runner.md
```

The runner is checkpoint-based and safe to resume after interruption. It should be tested with dry-run and a small live batch before the full historical scan.
