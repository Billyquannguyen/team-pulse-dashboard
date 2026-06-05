# Plain English System Overview

## What Problem This Solves

Most creator managers receive useful brand and agency opportunities by email, but those opportunities disappear into the inbox.

This system turns the inbox into a structured opportunity database.

It helps answer questions like:

- Which brands have contacted us before?
- Which agencies are worth pitching?
- Which opportunities are fixed-fee, affiliate-only, gifting, or song promotion?
- Which brands fit a UK lifestyle creator?
- Which agencies often send beauty briefs?
- Which relationships are warm enough to contact again?
- What should be uploaded to the Custom GPT this month?

## The System Flow

Gmail

to

Opportunity Intelligence Google Sheet

to

Intelligence Layer

to

GPT Export Files

to

Manual Custom GPT Knowledge Upload

to

Creator Brand Matching GPT

## What Runs Automatically

GitHub Actions runs the monthly automation in the cloud.

That means:

- The owner's laptop does not need to be on.
- Codex does not need to be open.
- ChatGPT does not need to be open.
- The scanner can keep working even if the owner stops using Codex.

The monthly workflow does this:

1. Checks credentials.
2. Checks the database.
3. Creates a backup.
4. Scans Gmail.
5. Updates the Google Sheet.
6. Refreshes intelligence.
7. Creates GPT export files.
8. Creates a ZIP package for GPT Builder.
9. Creates a monthly summary.
10. Emails the owner.
11. Posts a Discord summary if configured.

## What Stays Manual

Custom GPT Knowledge upload stays manual.

The automation creates the files, but a human still opens GPT Builder, deletes old Knowledge files, uploads the new ones, and saves.

This is intentional. It avoids fragile browser automation and avoids giving an automated script control over GPT Builder.

## What The Custom GPT Does

The Custom GPT does not scan email.

The Custom GPT reads the uploaded knowledge files and ranks matches for a creator profile.

The user gives the GPT a creator profile. The GPT extracts country, platform, niche, audience, follower size, and commercial needs. Then it ranks brand and agency opportunities using the uploaded knowledge.

## Who Uses This

Owner or admin:

- Sets up keys.
- Runs tests.
- Receives monthly email.
- Uploads new GPT Knowledge files.

Creator manager:

- Uses the Custom GPT.
- Submits creator profiles.
- Reviews ranked outreach recommendations.

Developer or Codex:

- Installs or customizes the workflow.
- Changes scan keywords.
- Fixes failures.

## What Success Looks Like

Success is not just "the scanner ran."

Success means:

- The database contains real creator-brand opportunity history.
- Review rows catch unclear or risky extraction.
- The monthly email tells the owner if the month was worth uploading.
- The Custom GPT can rank outreach options without inventing brands, budgets, or relationships.
