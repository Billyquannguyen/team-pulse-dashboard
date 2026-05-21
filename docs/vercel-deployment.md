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
```

Keep them different.

The app checks these on the server. The browser only receives a signed session cookie containing the authenticated role: `team` or `admin`.

Do not add these passwords to Billy GPT files, Notion exports, markdown files, vector stores, or frontend code.
