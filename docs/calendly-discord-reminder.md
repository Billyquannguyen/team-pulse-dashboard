# Calendly Discord Reminder

This sends a Discord message whenever someone books a Calendly meeting.

Plain English flow:

```text
Calendly booking
-> dashboard webhook URL
-> Discord channel reminder
-> team checks Gmail and prepares a recap for Billy
```

## What The Message Says

The reminder includes:

- creator name if Calendly sends it
- creator email
- meeting name
- meeting time if Calendly sends it
- booking form answers if available
- a clear team action

Default action text:

```text
Please revisit Gmail, find the latest email thread for this creator, and compose a short recap for Billy.
```

## Required Environment Variables

Add these in Vercel:

```text
CALENDLY_DISCORD_WEBHOOK_URL
CALENDLY_DISCORD_REMINDER_SECRET
```

`CALENDLY_DISCORD_WEBHOOK_URL` is the Discord channel webhook URL.

`CALENDLY_DISCORD_REMINDER_SECRET` is a random private password for the webhook URL. Use a long random value. Do not share it in Discord.

If `CALENDLY_DISCORD_WEBHOOK_URL` is missing, the app will fall back to `DISCORD_WEBHOOK_URL`.

## Test Discord First

After deploying, open this private URL in your browser:

```text
https://YOUR-DASHBOARD-DOMAIN.com/api/calendly-discord-reminder?secret=YOUR_SECRET&test=1
```

Expected result:

- browser shows `ok: true`
- Discord receives a test reminder

If Discord does not receive it, fix the Discord webhook before touching Calendly.

## Connect Calendly

In Calendly, create a webhook subscription for booked invitees.

Use this webhook URL:

```text
https://YOUR-DASHBOARD-DOMAIN.com/api/calendly-discord-reminder?secret=YOUR_SECRET
```

Use this event:

```text
invitee.created
```

That means "someone booked a meeting."

Do not use canceled meeting events for this reminder.

## Suggested Discord Message

The app posts something like:

```text
New Calendly meeting booked

Creator: Example Creator
Email: creator@example.com
Meeting: Creator call

Please revisit Gmail, find the latest email thread for this creator, and compose a short recap for Billy.
```

## Safety Notes

Keep the webhook URL private because it contains the secret.

If the URL leaks, change `CALENDLY_DISCORD_REMINDER_SECRET` in Vercel and update the Calendly webhook URL.

This reminder does not read Gmail.

It only tells the team to check Gmail and write the recap.
