# Vercel Deployment

## Build Settings

Use these settings in Vercel:

`Install Command`

```bash
npm install
```

`Build Command`

```bash
npm run build
```

`Output Directory`

Leave this blank. This is a TanStack Start full-stack app using Nitro, so Vercel should use the server/client build output instead of treating `dist/client` as a static-only site.

## Environment Variables

Add these in Vercel Project Settings:

```text
TEAM_DASHBOARD_PASSWORD=your shared team password
HERMES_DASHBOARD_PASSWORD=your Hermes read-only password
ADMIN_PASSWORD=your separate admin password
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n
TEAM_BILLION_SPREADSHEET_ID=1oetKgRHC6ucAAvr4G99UGgqWJyWrNCZcc8mhcDwMULI
CREATOR_SOURCING_SPREADSHEET_ID=1cE0PlyvZH5-kqyGOBuM6eaWO_kWIhtfJ_jEIOuaPPv4
TEAM_ASSETS_SPREADSHEET_ID=your-team-assets-spreadsheet-id
ACTIVE_BRANDS_SPREADSHEET_ID=1U-y2oiob1uenmvNiRGMILhmWWORMTye2mBxi2mgVxvs
NOTION_API_TOKEN=secret_from_your_notion_internal_integration
NOTION_HANDBOOK_ROOT_PAGE_ID=your_handbook_root_page_id
BRAVE_SEARCH_API_KEY=optional_for_stronger_live_web_search
OPENAI_API_KEY=your_openai_api_key
OPENAI_CONTRACT_REVIEW_MODEL=gpt-5.4-mini
OPENROUTER_API_KEY=your_openrouter_api_key
OPENROUTER_DEFAULT_MODEL=your_preferred_openrouter_model
OPENROUTER_FALLBACK_MODEL=your_backup_openrouter_model
SLACK_USER_TOKEN=xoxp-your-personal-user-token
SLACK_OWNER_USER_ID=your_slack_user_id
SLACK_BOT_TOKEN=xoxb-your-bot-token-if-used
SLACK_SIGNING_SECRET=your_slack_signing_secret
CRON_SECRET=long_random_secret_for_vercel_cron
UPSTASH_REDIS_REST_URL=https://your-upstash-url.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_upstash_rest_token
```

Keep `TEAM_DASHBOARD_PASSWORD`, `HERMES_DASHBOARD_PASSWORD`, and `ADMIN_PASSWORD` different.

The app checks these on the server. The browser only receives a signed session cookie containing the authenticated role: `team`, `hermes_readonly`, or `admin`.

`TEAM_DASHBOARD_PASSWORD` keeps the normal team login behavior. `HERMES_DASHBOARD_PASSWORD` lets Hermes view dashboard analytics with read-only access. Hermes cannot create Gmail drafts, edit Google Sheets records, dismiss Slack reminders, save meeting notes, edit team members, or trigger admin actions.

Google Sheets credentials are also server-side only. Do not add passwords, private keys, or service account credentials to Billy GPT files, Notion exports, markdown knowledge files, vector stores, or frontend code.

Notion credentials are server-side only too. Billy GPT reads the handbook through `NOTION_API_TOKEN`, indexes it on the server, and never sends the token to the browser.

OpenAI credentials are server-side only. Billy GPT uses `OPENAI_API_KEY` for clean assistant responses and PDF contract review. `OPENAI_CONTRACT_REVIEW_MODEL` is optional and defaults to `gpt-5.4-mini`.

OpenRouter credentials are server-side only. Billy GPT Personal Report uses `OPENROUTER_API_KEY` to rewrite the existing rule-based report into a clearer manager summary. `OPENROUTER_DEFAULT_MODEL` is the first model tried. `OPENROUTER_FALLBACK_MODEL` is optional and is used only if the default model fails. The browser never receives the OpenRouter key.

After adding or changing env vars in Vercel, redeploy the project.

For Team Assets, the spreadsheet must have a worksheet tab named `Team Assets` with `title` and `url` columns. Optional columns are `subtitle`, `icon`, `color`, `category`, `enabled`, and `sort_order`.

Team Assets admin add/edit/remove writes to Google Sheets server-side. Share the Team Assets spreadsheet with the service account as Editor, not just Viewer.

For Active Brands, the spreadsheet must have a worksheet tab named `Active Contacts`. The app displays that tab as a raw table and does not use it in dashboard totals.

For Billy GPT, create a Notion internal integration, share the handbook root page with it, then add the integration secret as `NOTION_API_TOKEN` and the root page ID as `NOTION_HANDBOOK_ROOT_PAGE_ID`. Admins can sync the handbook from the Billy GPT panel after deployment. Billy GPT uses handbook context first, Active Brands Google Sheet context second, and web context only for enrichment. More detail lives in `docs/notion-billy-gpt-setup.md`.

For contract review, Billy GPT accepts PDF uploads in chat, extracts readable text server-side, and sends only extracted text plus source-labeled context to OpenAI. Uploaded PDFs are processed in memory only and are not permanently stored by the app.

For Slack DM follow-ups, the app uses `SLACK_USER_TOKEN` because personal DM history belongs to your Slack user, not the bot. `SLACK_OWNER_USER_ID` should be your own Slack user ID. The hourly Vercel Cron job calls `/api/slack-followups` and is protected by `CRON_SECRET`. Notifications are stored in Upstash Redis using `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, then displayed inside the dashboard bell.

The Slack user token needs permission to list IM conversations and read IM history. In Slack terms, expect scopes like `im:read`, `im:history`, and `users:read`. Private DM text is checked server-side only. The dashboard only receives a small reminder record with the person name, timestamp, overdue age, Slack open link, and a short safe snippet.

For local testing only, you can set `SLACK_FOLLOWUP_THRESHOLD_MINUTES=1` before starting the dev server. Production ignores this and keeps the real 24-hour threshold.
