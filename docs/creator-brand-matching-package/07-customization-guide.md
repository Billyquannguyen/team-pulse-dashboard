# Customization Guide

This page explains what to change when installing for a different person or business.

## Change The Gmail Search

The default scanner looks for creator-brand opportunity language.

Template:

```text
in:anywhere -in:spam -in:trash -from:YOUR_EMAIL_HERE {campaign brief creator collaboration partnership affiliate song "music promotion" UGC whitelisting "paid usage" ambassador gifted PR influencer creators sponsorship collab "paid collaboration" partnership sponsorship KOL whitelisting "Spark Ads"}
```

Change `YOUR_EMAIL_HERE` to the mailbox owner email.

Example:

```text
-from:owner@example.com
```

This prevents the scanner from reading the owner's own sent outreach as inbound opportunities.

## Add Industry Terms

If the business is not creator management, adjust the keyword block.

For creator management, good additions might be:

- TikTok Shop
- gifted collaboration
- brand ambassador
- paid partnership
- content usage
- paid media
- creator marketplace
- seeding
- PR package

Do not add too many generic words. Generic words create noisy exports.

## Change Low-Budget Logic

The current logic penalizes low-budget opportunities and affiliate-only offers.

It does not delete them.

That is intentional because a manager may still want them for:

- micro creators
- song promotions
- first-time relationship building
- affiliate-specific outreach

If a business has a different budget floor, a developer should adjust the budget scoring in the scanner and export logic.

## Change GPT Name And Description

If installing outside Team Billion, update:

Name:

```text
Creator Brand Matching
```

Description:

```text
Ranks creator-brand opportunities, agencies, and outreach angles using historical opportunity intelligence.
```

Also remove or replace "Team Billion" in the GPT instructions.

## Change Email Sender

Use a verified domain in Resend.

Example:

```text
Creator Brand Matching <updates@example.com>
```

Do not use an unverified Gmail address as the sender.

## Change Discord Channel

Create a webhook for the exact channel where monthly opportunity summaries should appear.

Use one webhook per channel.

If the team changes channel later, create a new webhook and update GitHub secret `DISCORD_WEBHOOK_URL`.

## Change Schedule

Monthly schedule lives in:

```text
.github/workflows/monthly-opportunity-refresh.yml
```

Current schedule:

```text
0 8 1 * *
```

Plain English:

First day of every month at 08:00 UTC.

If weekly scan is needed later, add a second workflow instead of overloading the monthly GPT packaging workflow.

## Change Knowledge Files

The approved GPT upload package includes only:

- matching intelligence
- priority intelligence
- commercial intelligence
- pitch angle intelligence
- curated opportunities
- brand intelligence
- agency intelligence
- creator matching signals
- playbook

Do not include raw review queue files unless the GPT is specifically designed to help clean the database.
