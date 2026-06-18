# Calendly Discord Reminder With Stored Rows

This sends a Discord reminder 15 minutes after a Calendly booking is created.

It is row-based, not scan-based.

## How It Works

```text
Calendly invitee.created webhook
-> dashboard webhook creates or updates one reminder row
-> reminderSendAt = bookedAt + 15 minutes
-> GitHub Actions cron runs every 5 minutes
-> cron reads pending reminder rows only
-> cron sends due rows to Discord one by one
-> each successful row is immediately marked sent
```

The cron does not query Calendly.

The cron does not scan historical Calendly events.

The webhook does not send Discord messages.

## Webhook URL

Add this URL in Calendly as an `invitee.created` webhook:

```text
https://YOUR-DASHBOARD-DOMAIN.com/api/calendly-reminders/webhook
```

Replace `YOUR-DASHBOARD-DOMAIN.com` with the live dashboard domain.

## Reminder Sheet

The workflow stores reminders in a Google Sheet tab called:

```text
Calendly Reminders
```

The tab is created automatically if it does not exist.

Columns:

```text
id
calendlyInviteeUri
creatorName
creatorEmail
meetingName
meetingStartTime
bookedAt
reminderSendAt
status
sentAt
retryCount
lastError
```

## Duplicate Protection

The unique key is:

```text
calendlyInviteeUri
```

If Calendly sends the same webhook twice, the existing row is updated instead of duplicated.

If a row already has:

```text
status = sent
```

it is ignored and never sent again.

## Cron Selector

The cron selects only rows where:

```text
status = pending
reminderSendAt <= now
reminderSendAt >= now - 24 hours
```

Rows older than the 24-hour due window are logged as skipped expired reminders.

## GitHub Workflow

The workflow is:

```text
.github/workflows/calendly-discord-reminders.yml
```

It runs every 5 minutes:

```text
*/5 * * * *
```

This is safe because it only checks stored reminder rows. It no longer calls Calendly every 5 minutes.

## Required GitHub Actions Secrets

Create these in:

```text
GitHub -> Settings -> Secrets and variables -> Actions -> New repository secret
```

Required:

```text
CALENDLY_DISCORD_WEBHOOK_URL
GOOGLE_SERVICE_ACCOUNT_EMAIL
GOOGLE_PRIVATE_KEY
CALENDLY_REMINDERS_SPREADSHEET_ID
```

`CALENDLY_API_TOKEN` is not used by this reminder workflow anymore.

## Required Dashboard Environment Variables

The dashboard webhook also needs access to the same Google Sheet.

Set these in the dashboard hosting environment:

```text
GOOGLE_SERVICE_ACCOUNT_EMAIL
GOOGLE_PRIVATE_KEY
CALENDLY_REMINDERS_SPREADSHEET_ID
```

Optional:

```text
CALENDLY_REMINDERS_SHEET_NAME
CALENDLY_WEBHOOK_SECRET
```

If `CALENDLY_WEBHOOK_SECRET` is set, the webhook requires the same value in one of these places:

```text
x-calendly-webhook-secret header
x-webhook-secret header
?secret=YOUR_SECRET query parameter
```

## Discord Message

The Discord message includes:

```text
Creator
Email
Meeting
Meeting time
Booking created
Reminder due
Workflow ran
Notification delay
```

## Cron Logging

Each run logs:

```text
now
totalPendingReminders
dueRemindersSelected
skippedExpiredReminders
skippedExpiredReminderIds
sentReminderIds
failedReminderIds
```

The same summary is uploaded as the GitHub Actions artifact:

```text
calendly-discord-reminder-summary
```

## Validation Logic

Local validation is available:

```text
node scripts/calendly-discord-reminders.mjs --self-test
```

Expected behavior:

```text
Fake booking A booked at 10:00 -> reminderSendAt 10:15
Fake booking B booked at 10:30 -> reminderSendAt 10:45
Cron at 10:16 -> only A sends
Cron at 10:46 -> only B sends
Cron at 10:47 -> nothing sends
```

## What This Fixes

The old workflow scanned Calendly for bookings and could send several discovered bookings together.

The new workflow cannot blast historical Calendly bookings because it never queries Calendly.

Calendly creates rows.

GitHub Actions sends due rows.
