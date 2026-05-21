# Google Sheets Setup

This dashboard reads Google Sheets through a server-side Google service account.

The existing sheet IDs are:

```text
Team Billion deal sheet:
1oetKgRHC6ucAAvr4G99UGgqWJyWrNCZcc8mhcDwMULI

Creator sourcing sheet:
1cE0PlyvZH5-kqyGOBuM6eaWO_kWIhtfJ_jEIOuaPPv4

Team Assets sheet:
Use the spreadsheet ID you add as `TEAM_ASSETS_SPREADSHEET_ID`.

Active Brands sheet:
1U-y2oiob1uenmvNiRGMILhmWWORMTye2mBxi2mgVxvs
```

These IDs belong in Vercel Environment Variables, not frontend code.

## Recommended Access Model

1. Create a Google Cloud service account.
2. Enable the Google Sheets API for that Google Cloud project.
3. Copy the service account email.
4. Share each read-only Google Sheet used by the dashboard with that service account email as Viewer.
5. Share the Team Assets Google Sheet with that service account email as Editor if you want admin add/edit/remove to work from the website.
6. Create a JSON key for the service account.
7. Store the email, private key, and sheet IDs in Vercel Environment Variables.
8. Let the app server read the Sheets and send cleaned dashboard data to the frontend.

## Vercel Environment Variables

Add these in Vercel Project Settings:

```text
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n
TEAM_BILLION_SPREADSHEET_ID=1oetKgRHC6ucAAvr4G99UGgqWJyWrNCZcc8mhcDwMULI
CREATOR_SOURCING_SPREADSHEET_ID=1cE0PlyvZH5-kqyGOBuM6eaWO_kWIhtfJ_jEIOuaPPv4
TEAM_ASSETS_SPREADSHEET_ID=your-team-assets-spreadsheet-id
ACTIVE_BRANDS_SPREADSHEET_ID=1U-y2oiob1uenmvNiRGMILhmWWORMTye2mBxi2mgVxvs
```

Keep `GOOGLE_PRIVATE_KEY` server-side only. Do not put it in `VITE_*` env vars, markdown knowledge files, Billy GPT files, Notion exports, or vector stores.

If Google Sheets access fails on Vercel, the dashboard shows a clear connection error instead of silently showing mock data. Local development can still fall back to demo data when these env vars are missing.

## Team Assets Workbook

The Team Assets page renders cards, but stores the card data in a worksheet tab named:

- `Team Assets`

Expected columns:

- `title`
- `subtitle`
- `url`
- `icon`
- `color`
- `category`
- `enabled`
- `sort_order`

Required columns are `title` and `url`. Empty `enabled` cells count as enabled. Use `false`, `no`, `off`, `hidden`, `inactive`, or `disabled` to hide a row.

The app maps `icon` and `color` through a safe internal list, so raw Tailwind classes or custom SVGs from the Sheet are not trusted by the browser.

Admin add/edit/remove writes back to this worksheet server-side. The service account needs Editor access to this spreadsheet for those controls to work.

## Active Brands Workbook

The Active Brands page reads a worksheet tab named:

- `Active Contacts`

The page displays the columns exactly as they appear in the Sheet. It does not feed dashboard totals.

## Current Workbook Assumption

Each closer/team member has their own worksheet tab.

Current member tabs:

- `KTrang`
- `HYen`
- `BNgan`
- `LNgoc`

The app auto-discovers worksheet tabs from the workbook, cleans hidden whitespace in tab names, and only treats tabs with the deal-sheet headers as member tabs.

The header row is row `1` on each member tab.

Useful deal columns from row `1`:

- `No.`
- `Creator`
- `Platform`
- `Brand name`
- `Contract link`
- `Status`
- `Live Link`
- `Total Pricing (£)`
- `Creator Total (£)`
- `Profit margin`
- `Manager Total (this is still in £ btw)`
- `VND`
- `Net Terms`
- `Manager Total Paid`
- `Manager Paid Current Month`
- `Note`

Important summary cells on each member tab:

- `S2`: pending amount still owed to that member
- `S4`: amount paid this month for last month of work
- `S6`: total amount paid to that member from the start

The dashboard should read every member tab, combine the rows, then calculate:

- Team commission
- Deals closed
- This month commission
- Average deal size
- Member payout summary from `S2`, `S4`, and `S6`
- Leaderboard
- Goals progress

## Files Added For The Integration

`src/data/sheetConfig.ts`

This holds tab-name assumptions and column aliases. Spreadsheet IDs now come from Vercel Environment Variables.

`src/lib/sheet-normalizer.ts`

This converts raw Sheet rows into dashboard data. It is intentionally flexible, so headers like `Deal Value`, `Revenue`, or `Amount` can all map into the same dashboard field.

`src/lib/google-sheets.server.ts`

This creates a short-lived Google access token using the service account and calls the official Google Sheets API. It is server-only.

`src/lib/sheets-public.ts`

This auto-discovers member tabs through the server-side API, combines the real deal rows, skips cancelled deals, and pulls member summary values from `S2`, `S4`, and `S6`.

## Admin Goals

The dashboard keeps goals editable only for an `admin` session.

Passwords are checked server-side through Vercel environment variables. The browser only receives the authenticated role. Goal values are still saved in this browser for now, so shared goal storage should move to a backend store before the team relies on it across devices.
