# Google Sheets Setup

This dashboard is set up to use this Team Billion workbook:

`1oetKgRHC6ucAAvr4G99UGgqWJyWrNCZcc8mhcDwMULI`

For the current prototype, the Sheet is read from the public "anyone with the link can view" share setting. The production setup should use a Google service account, not a public spreadsheet link.

## Recommended Access Model

1. Create a Google Cloud service account.
2. Enable the Google Sheets API for that Google Cloud project.
3. Copy the service account email.
4. Share the Team Billion Google Sheet with that service account email.
5. Store the service account credentials as private environment variables in the app host.
6. Let the app server read the Sheet and send cleaned dashboard data to the frontend.

## Current Workbook Assumption

Each closer/team member has their own worksheet tab.

Current fallback member tabs:

- `KTrang` using sheet ID `13676943`
- `HYen` using sheet ID `1179706816`
- `BNgan` using sheet ID `872122388`
- `LNgoc` using sheet ID `997875421`

The app now auto-discovers worksheet tabs from the workbook, cleans hidden whitespace in tab names, and only treats tabs with the deal-sheet headers as member tabs. If discovery fails, it falls back to the sheet IDs above.

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

This holds the spreadsheet ID, fallback member sheet IDs, and column aliases.

`src/lib/sheet-normalizer.ts`

This converts raw Sheet rows into dashboard data. It is intentionally flexible, so headers like `Deal Value`, `Revenue`, or `Amount` can all map into the same dashboard field.

`src/lib/sheets-public.ts`

This auto-discovers public member tabs, combines the real deal rows, skips cancelled deals, and pulls member summary values from `S2`, `S4`, and `S6`.

## Needed From Anh Quan

If there is a separate creator/database tab, paste that tab name and header row too.

## Admin Goals

The dashboard keeps goals editable only for an `admin` session.

Passwords are checked server-side through Vercel environment variables. The browser only receives the authenticated role. Goal values are still saved in this browser for now, so shared goal storage should move to a backend store before the team relies on it across devices.
