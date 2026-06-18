# Calendly Discord Booking Notification

This sends a Discord message immediately when someone books a Calendly meeting.

It does not use Google Sheets.

It does not use GitHub Actions cron.

It does not wait 15 minutes.

## How It Works

```text
Calendly invitee.created webhook
-> dashboard webhook receives the booking
-> dashboard sends Discord message immediately
-> dashboard returns success
```

## Webhook URL

Add this URL in Calendly as an `invitee.created` webhook:

```text
https://YOUR-DASHBOARD-DOMAIN.com/api/calendly-reminders/webhook
```

Replace `YOUR-DASHBOARD-DOMAIN.com` with the live dashboard domain.

The route name still says `calendly-reminders` so existing Calendly setup does not need to change, but the behavior is now immediate notification.

## Required Environment Variables

Set this in the dashboard hosting environment:

```text
CALENDLY_DISCORD_WEBHOOK_URL
```

Optional:

```text
CALENDLY_WEBHOOK_SECRET
```

If `CALENDLY_WEBHOOK_SECRET` is set, the webhook requires the same value in one of these places:

```text
x-calendly-webhook-secret header
x-webhook-secret header
?secret=YOUR_SECRET query parameter
```

## Not Required

These are not used by the Calendly Discord notification:

```text
GOOGLE_SERVICE_ACCOUNT_EMAIL
GOOGLE_PRIVATE_KEY
CALENDLY_REMINDERS_SPREADSHEET_ID
CALENDLY_API_TOKEN
```

`CALENDLY_API_TOKEN` is only useful for one-time setup if you want the repo to check or create the Calendly webhook subscription for you.

## One-Time Calendly Webhook Subscription Setup

The dashboard does not register Calendly webhooks at runtime.

Calendly must already have a webhook subscription that sends `invitee.created` events to:

```text
https://YOUR-DASHBOARD-DOMAIN.com/api/calendly-reminders/webhook
```

If you still have the old Personal Access Token from:

```text
https://calendly.com/integrations/api_webhooks
```

you can check whether the subscription exists:

```text
CALENDLY_API_TOKEN=your_token \
CALENDLY_WEBHOOK_CALLBACK_URL=https://YOUR-DASHBOARD-DOMAIN.com/api/calendly-reminders/webhook \
npm run calendly:webhook:check
```

If the subscription does not exist, create it once:

```text
CALENDLY_API_TOKEN=your_token \
CALENDLY_WEBHOOK_CALLBACK_URL=https://YOUR-DASHBOARD-DOMAIN.com/api/calendly-reminders/webhook \
npm run calendly:webhook:create
```

After that, the dashboard runtime only needs:

```text
CALENDLY_DISCORD_WEBHOOK_URL
```

If you use `CALENDLY_WEBHOOK_SECRET`, set the same value when running the setup command. The script will add it to the Calendly callback URL as a `secret` query parameter so the existing dashboard verification can read it.

## Discord Message

The Discord message includes:

```text
Creator name
Creator email
Meeting name
Meeting time
Booking time
```

## Validation

To test the real flow:

1. Create a fake Calendly booking.
2. Confirm Discord receives the message immediately.
3. Create another fake booking later.
4. Confirm the second message arrives separately.

There is no Google Sheet row to check.

There is no GitHub Action cron run to check.
