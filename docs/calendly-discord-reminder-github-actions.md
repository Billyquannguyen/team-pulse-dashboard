# Calendly Discord Reminder With GitHub Actions

This sends a Discord reminder when someone books a Calendly meeting.

It does not use Vercel.

It does not require dashboard environment variables.

It runs from GitHub Actions using GitHub Secrets.

## How It Works

```text
GitHub Actions runs every 15 minutes
-> checks Calendly for active scheduled meetings
-> compares bookings against saved processed state
-> sends Discord message for new bookings only
-> saves processed state for the next run
```

The workflow also has a manual run button.

## Discord Message

The message includes:

- creator name
- creator email
- meeting name
- meeting time
- booking created time
- workflow execution time
- notification delay in minutes

Example:

```text
New Calendly meeting booked

Creator: Example Creator
Email: creator@example.com
Meeting: Creator intro call
Meeting time: 12 Jun 2026, 14:00
Booking created: 12 Jun 2026, 09:32 (2026-06-12T08:32:00.000Z)
Workflow ran: 12 Jun 2026, 09:47 (2026-06-12T08:47:00.000Z)
Notification delay: 15 minutes

Please revisit Gmail, find the latest email thread for this creator, and compose a short recap for Billy.
```

## Required GitHub Secrets

Create these in:

```text
GitHub -> Settings -> Secrets and variables -> Actions -> New repository secret
```

Required:

```text
CALENDLY_API_TOKEN
CALENDLY_DISCORD_WEBHOOK_URL
```

## Where To Get CALENDLY_API_TOKEN

In Calendly:

```text
Integrations and apps -> API and webhooks -> Personal access tokens
```

Create a personal access token and copy it once.

Store it in GitHub as:

```text
CALENDLY_API_TOKEN
```

Treat it like a password.

## Where To Get CALENDLY_DISCORD_WEBHOOK_URL

In Discord:

```text
Server Settings -> Integrations -> Webhooks -> New Webhook
```

Choose the channel where Calendly reminders should appear.

Copy the webhook URL.

Store it in GitHub as:

```text
CALENDLY_DISCORD_WEBHOOK_URL
```

This is separate from the Gmail report Discord webhook, so Calendly reminders can go to a different channel.

## Workflow File

The workflow is:

```text
.github/workflows/calendly-discord-reminders.yml
```

It runs every 15 minutes:

```text
*/15 * * * *
```

That is intentionally not every 5 minutes. Five minutes creates too many runs and can become noisy or unreliable. Fifteen minutes is a better balance for this reminder.

## Timing And Duplicate Logic

The workflow asks GitHub to run every 15 minutes.

GitHub scheduled workflows are not real-time webhooks, so a run can start later than the exact scheduled minute.

The Calendly scan uses a rolling time window:

```text
Default lookback: 48 hours
Default lookahead: 90 days
```

The script scans active scheduled events in that window, then checks their invitees.

Duplicate protection comes from the saved processed-booking state. If a booking was already processed, it should not post again.

Manual reruns can post an older booking only if that booking is still inside the recent window and has not already been saved in processed state. The setup-only option for notifying existing recent bookings should normally stay unticked.

## First Run Behavior

The first real run silently records existing active bookings so the team does not get spammed with old meetings.

After that, only new bookings are sent to Discord.

If you want to test Discord, use the test option instead.

## Test The Discord Notification

Go to:

```text
GitHub -> Actions -> Calendly Discord Booking Reminders -> Run workflow
```

Tick:

```text
Send a test Discord notification only.
```

Then click:

```text
Run workflow
```

Expected result:

- GitHub run succeeds
- Discord receives a test Calendly reminder
- No Calendly data is processed

## Manually Check For New Bookings

Go to:

```text
GitHub -> Actions -> Calendly Discord Booking Reminders -> Run workflow
```

Leave both checkboxes unticked.

Click:

```text
Run workflow
```

This checks Calendly immediately.

## If You Want To Notify Existing Recent Bookings

Only use this during first setup if you want Discord to receive reminders for bookings that already exist.

Go to manual run and tick:

```text
Only for first setup: notify recent bookings instead of silently bootstrapping state.
```

Usually, leave this unticked.

## State And Duplicate Protection

The workflow stores processed bookings in GitHub Actions cache.

That means:

- old bookings are not posted twice
- the dashboard does not need to stay online
- Vercel is not involved
- Codex is not involved after the workflow is committed

## Files Added

```text
.github/workflows/calendly-discord-reminders.yml
scripts/calendly-discord-reminders.mjs
docs/calendly-discord-reminder-github-actions.md
```

## Files Removed

The previous Vercel API route was removed.

No Vercel environment variables are required for this feature.
