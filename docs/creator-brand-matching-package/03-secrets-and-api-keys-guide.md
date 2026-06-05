# Secrets And API Keys Guide

This page explains the private values needed to run the system.

## What Is A Secret?

A secret is a private value that lets the automation access an account or service.

Think of it like a password for a robot.

Examples:

- Gmail refresh token
- Google private key
- Resend API key
- Discord webhook URL

Never put secrets inside Custom GPT Knowledge files.

Never paste secrets into a public GitHub file.

Never send secrets in Discord.

## What Is An API Key?

An API key is a private code from a service.

It tells that service:

"This request is allowed to use my account."

For this system, the email provider API key lets GitHub Actions send the monthly report email.

## What Is A Refresh Token?

A refresh token is long-term permission for an app to access a Google account.

In this system, it lets the scanner read Gmail using read-only access.

It should be treated like a password.

## What Is A Service Account?

A service account is a Google robot account.

It is not a human Gmail inbox.

This system uses:

- human Google account for Gmail reading
- service account for Google Sheet reading and writing

That separation is important.

## Required GitHub Secrets

Add these in GitHub:

Repository -> Settings -> Secrets and variables -> Actions -> New repository secret

Required:

- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `OPPORTUNITY_DATABASE_SPREADSHEET_ID`
- `EMAIL_PROVIDER_API_KEY`
- `MONTHLY_REFRESH_EMAIL_TO`
- `MONTHLY_REFRESH_EMAIL_FROM`

Optional:

- `DISCORD_WEBHOOK_URL`

## Where Each Secret Comes From

### GMAIL_CLIENT_ID

Comes from Google Cloud OAuth credentials.

How to get it:

1. Open Google Cloud Console.
2. Create or select a project.
3. Enable the Gmail API.
4. Go to APIs and Services -> Credentials.
5. Click Create Credentials.
6. Choose OAuth client ID.
7. Choose Desktop app.
8. Copy the Client ID.

### GMAIL_CLIENT_SECRET

Comes from the same Google OAuth client.

How to get it:

1. Stay on the OAuth client page.
2. Copy the Client secret.
3. Store it as `GMAIL_CLIENT_SECRET`.

### GMAIL_REFRESH_TOKEN

Comes from authorizing the Gmail account once.

Beginner-friendly route:

1. Open Google OAuth Playground: https://developers.google.com/oauthplayground
2. Click the settings icon.
3. Tick "Use your own OAuth credentials."
4. Paste `GMAIL_CLIENT_ID`.
5. Paste `GMAIL_CLIENT_SECRET`.
6. In the scope box, use:

```text
https://www.googleapis.com/auth/gmail.readonly
```

7. Authorize the Gmail account you want scanned.
8. Exchange the authorization code for tokens.
9. Copy the refresh token.
10. Store it as `GMAIL_REFRESH_TOKEN`.

Use the mailbox owner's real account. Do not use the service account for Gmail.

### GOOGLE_SERVICE_ACCOUNT_EMAIL

Comes from Google Cloud service account JSON.

How to get it:

1. Open Google Cloud Console.
2. Go to IAM and Admin -> Service Accounts.
3. Create a service account.
4. Create a JSON key for it.
5. Open the downloaded JSON file.
6. Copy the `client_email` value.
7. Store it as `GOOGLE_SERVICE_ACCOUNT_EMAIL`.

Also share the Opportunity Intelligence Google Sheet with this email as Editor.

### GOOGLE_PRIVATE_KEY

Comes from the same Google service account JSON.

How to get it:

1. Open the downloaded JSON key file.
2. Copy the `private_key` value.
3. Store it as `GOOGLE_PRIVATE_KEY`.

It may look like:

```text
-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----
```

GitHub secrets can accept this with real newlines.

If using a local `.env` file, escaped `\n` newlines are also accepted by the scripts.

### OPPORTUNITY_DATABASE_SPREADSHEET_ID

This is not really a password, but store it with the other secrets.

How to get it:

1. Open the Opportunity Intelligence Google Sheet.
2. Look at the browser URL.
3. Copy the value between `/d/` and `/edit`.

Example format:

```text
https://docs.google.com/spreadsheets/d/SPREADSHEET_ID_HERE/edit
```

### EMAIL_PROVIDER_API_KEY

This comes from Resend.

How to get it:

1. Create or open a Resend account.
2. Verify a sending domain.
3. Go to API Keys.
4. Create a new API key.
5. Copy it once.
6. Store it as `EMAIL_PROVIDER_API_KEY`.

### MONTHLY_REFRESH_EMAIL_TO

This is the email address that receives the monthly report.

Example:

```text
owner@example.com
```

For multiple recipients, use commas:

```text
owner@example.com,manager@example.com
```

### MONTHLY_REFRESH_EMAIL_FROM

This must be a sender address allowed by Resend.

Example:

```text
Creator Brand Matching <updates@yourdomain.com>
```

The domain must be verified in Resend.

### DISCORD_WEBHOOK_URL

This is optional.

It lets the workflow post a monthly summary into a Discord channel.

How to get it:

1. Open Discord.
2. Go to the server.
3. Open the target channel settings.
4. Go to Integrations.
5. Open Webhooks.
6. Create a webhook.
7. Copy the webhook URL.
8. Store it as `DISCORD_WEBHOOK_URL`.

Anyone with this URL can post into that channel. Treat it like a password.

## Local Env File For Testing

For local testing only, create:

```text
.env.opportunity-ingestion
```

Use `templates/env.example` as the template.

Do not commit it.
