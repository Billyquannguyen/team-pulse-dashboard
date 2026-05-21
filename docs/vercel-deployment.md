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
```

Keep `TEAM_DASHBOARD_PASSWORD` and `ADMIN_PASSWORD` different.

The app checks these on the server. The browser only receives a signed session cookie containing the authenticated role: `team` or `admin`.

Google Sheets credentials are also server-side only. Do not add passwords, private keys, or service account credentials to Billy GPT files, Notion exports, markdown knowledge files, vector stores, or frontend code.

After adding or changing env vars in Vercel, redeploy the project.

For Team Assets, the spreadsheet must have a worksheet tab named `Team Assets` with `title` and `url` columns. Optional columns are `subtitle`, `icon`, `color`, `category`, `enabled`, and `sort_order`.
