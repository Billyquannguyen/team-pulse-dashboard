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
```

Keep `TEAM_DASHBOARD_PASSWORD` and `ADMIN_PASSWORD` different.

The app checks these on the server. The browser only receives a signed session cookie containing the authenticated role: `team` or `admin`.

Google Sheets credentials are also server-side only. Do not add passwords, private keys, or service account credentials to Billy GPT files, Notion exports, markdown knowledge files, vector stores, or frontend code.

Notion credentials are server-side only too. Billy GPT reads the handbook through `NOTION_API_TOKEN`, indexes it on the server, and never sends the token to the browser.

After adding or changing env vars in Vercel, redeploy the project.

For Team Assets, the spreadsheet must have a worksheet tab named `Team Assets` with `title` and `url` columns. Optional columns are `subtitle`, `icon`, `color`, `category`, `enabled`, and `sort_order`.

Team Assets admin add/edit/remove writes to Google Sheets server-side. Share the Team Assets spreadsheet with the service account as Editor, not just Viewer.

For Active Brands, the spreadsheet must have a worksheet tab named `Active Contacts`. The app displays that tab as a raw table and does not use it in dashboard totals.

For Billy GPT, create a Notion internal integration, share the handbook root page with it, then add the integration secret as `NOTION_API_TOKEN` and the root page ID as `NOTION_HANDBOOK_ROOT_PAGE_ID`. Admins can sync the handbook from the Billy GPT panel after deployment. Billy GPT uses handbook context first, Active Brands Google Sheet context second, and web context only for enrichment. More detail lives in `docs/notion-billy-gpt-setup.md`.
