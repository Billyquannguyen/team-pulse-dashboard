# Creator Brand Matching Install Package

Name: Creator Brand Matching

Description: Ranks creator-brand opportunities, agencies, and outreach angles using Team Billion's historical opportunity intelligence.

This package explains how to install an email scanning and GPT knowledge refresh system for someone else's inbox.

It is written for a non-coder. The person setting it up does not need to understand the code first. They need to follow the setup steps carefully, keep private keys private, and test each stage before running a full scan.

## What This Package Builds

The system does this:

1. Searches a Gmail inbox for creator, brand, agency, campaign, affiliate, gifting, song promotion, and paid collaboration emails.
2. Skips obvious noise like newsletters, spam, personal emails, receipts, account alerts, and vague marketing blasts.
3. Extracts opportunity details into a Google Sheet database.
4. Builds intelligence about brands, agencies, budget quality, relationship strength, pitch angles, and matching priority.
5. Creates a monthly GPT Knowledge upload package.
6. Emails the owner a monthly summary and the GPT upload package.
7. Posts a no-files monthly summary into Discord if a webhook is connected.
8. Keeps Custom GPT Knowledge upload manual, because GPT Builder Knowledge files cannot be safely updated by this workflow automatically.

## Package Files

Read in this order:

1. `01-plain-english-system-overview.md`
2. `02-what-the-scanner-looks-for.md`
3. `03-secrets-and-api-keys-guide.md`
4. `04-step-by-step-installation.md`
5. `05-custom-gpt-configuration.md`
6. `06-operations-testing-and-recovery.md`
7. `07-customization-guide.md`
8. `08-developer-handoff.md`
9. `09-google-sheet-database-template.md`

Templates:

- `templates/env.example`
- `templates/github-secrets-checklist.md`
- `templates/gmail-search-query-template.txt`
- `templates/google-sheet-tabs-checklist.md`
- `templates/codex-installer-prompt.md`

## The Simplest Install Path

Use this if the installer has access to Codex or another coding agent:

1. Give the installer this whole folder.
2. Give them the target Gmail account, Google Sheet, GitHub repo, Resend account, and Discord channel.
3. Ask them to open `templates/codex-installer-prompt.md`.
4. Have them paste that prompt into Codex inside the target repo.
5. Follow `04-step-by-step-installation.md` for the keys and testing.

## Important Safety Rule

Never paste private keys, refresh tokens, API keys, or webhook URLs into a Custom GPT knowledge file.

Never commit `.env` files to GitHub.

Use GitHub repository secrets for automation.

## Official Setup References

These are the official docs behind the setup:

- GitHub Actions secrets: https://docs.github.com/actions/reference/encrypted-secrets
- GitHub manual workflow runs: https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow
- Gmail API authorization: https://developers.google.com/workspace/gmail/api/auth/web-server
- Google OAuth 2.0 web server flow: https://developers.google.com/identity/protocols/oauth2/web-server
- Google service account keys: https://docs.cloud.google.com/iam/docs/keys-create-delete
- Resend domains: https://resend.com/docs/dashboard/domains/introduction
- Resend API keys: https://resend.com/docs/api-reference/api-keys
- Discord webhooks: https://docs.discord.com/developers/platform/webhooks
