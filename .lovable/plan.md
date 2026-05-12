# Team Billion Dashboard — Build Plan

A polished, no-auth SaaS dashboard prototype for a commission-based influencer marketing team. All data is mock; integration points are clearly marked in code for later wiring.

## Routes (TanStack Start)

```
src/routes/
  __root.tsx          → shared shell (sidebar + header + AI chat dock)
  index.tsx           → Dashboard (overview)
  deals.tsx           → Google Sheet Deals view (mock spreadsheet)
  goals.tsx           → Editable Weekly Goals
  leaderboard.tsx     → Full team leaderboard
  assets.tsx          → Team Assets (quick-link cards)
```

The dashboard at `/` is the default landing surface — no login screen.

## Layout

- Persistent collapsible left sidebar (shadcn `Sidebar`) with: Dashboard, Deals, Goals, Leaderboard, Assets.
- Top header: Team Billion logo/wordmark, week selector chip, notification bell (decorative), avatar group of teammates.
- Floating "AI Work Assistant" launcher (bottom-right) opening a `Sheet` side panel with chat UI.
- Fully responsive: sidebar collapses to icons on tablet, off-canvas on mobile.

## Dashboard (`/`) sections

1. **KPI row (4 cards)**: Total Team Commission (MTD), This Week Commission, Deals Closed (week), Avg Deal Size. Each with trend arrow and sparkline.
2. **Weekly Team Goal Progress** — large card with a `Progress` bar, $ raised vs $ goal, days remaining, contributing teammates strip.
3. **Leaderboard (top 5)** — ranked list with avatar, name, $ commission, deal count, % to personal goal. "View full leaderboard" link → `/leaderboard`.
4. **Recent Closed Deals** — table (last 8): Date, Closer, Brand, Creator, Deal Value, Commission, Status badge.
5. **Weekly Activity Summary** — small grid of metrics: Outreach Sent, Replies, Calls Booked, Contracts Signed; plus a 7-day bar chart (recharts).
6. **Editable Weekly Goals (inline)** — list of goals with inline-editable target fields (team revenue, outreach count, calls booked, contracts). Save persists to `localStorage` only. Clear `// TODO: persist to backend` comments.

## Deals page (`/deals`) — Mock Google Sheet

- Card framed to look like an embedded sheet: monospace header, faint grid lines, "Synced from Team Sheet · 2 min ago" pill, "Open in Google Sheets" button (placeholder URL).
- `Table` with columns matching a real deal sheet: Date, Closer, Brand, Creator Handle, Platform, Deal Type, Gross Value, Commission %, Commission $, Status, Notes.
- 25–40 mock rows in `src/data/deals.ts`.
- Filter chips (status, closer) and search input — client-side only.
- Top-of-file comment block:
  ```ts
  // TODO(integration): Replace mock rows with Google Sheets API.
  // Suggested approach: TanStack server function in src/lib/sheets.functions.ts
  // using the lovable connector gateway at
  // https://connector-gateway.lovable.dev/google_sheets/v4/spreadsheets/{id}/values/{range}
  ```

## Goals page (`/goals`)

- Editable list of weekly team & individual goals (target $, target activities).
- Add / remove / edit goals; persisted to `localStorage`.
- Marked as the source of truth for the dashboard's goal progress card.

## Assets page (`/assets`)

Grid of quick-link cards with icons + short descriptions, opening in new tab:
Slack, Discord, Team Google Sheet, Notion Handbook, Google Drive, Training Resources. URLs are `https://example.com/...` placeholders, centralized in `src/data/assets.ts`.

## AI Work Assistant

- `Sheet` (right side) with chat transcript, suggested-question chips, and prompt input.
- Built with AI Elements primitives (`Conversation`, `Message`, `MessageResponse`, `PromptInput`, `PromptInputTextarea`, `PromptInputFooter`, `PromptInputSubmit`, `Shimmer`).
- **Mock responses only** — a small switch in `src/lib/assistant-mock.ts` returns canned answers for the seeded example questions and a generic fallback.
- Suggested chips: "How do I follow up with a creator?", "What do I do if a brand asks for rates?", "Where can I find the outreach script?"
- Clearly commented integration hook:
  ```ts
  // TODO(integration): Replace mockReply() with a TanStack server function
  // that calls the Lovable AI Gateway via the Vercel AI SDK (streamText).
  // Training source: Notion handbook — fetch + chunk + embed at index time,
  // then retrieve top-k passages to ground the prompt.
  ```

## Mock data layout

```
src/data/
  team.ts        → 8 teammates (name, avatar initial, role, weekToDate $, monthToDate $)
  deals.ts       → 30+ closed deals
  activity.ts    → 7-day activity series
  goals.ts       → default weekly goals
  assets.ts      → quick-link cards
```

## Design system

- Modern SaaS look: light default + dark mode ready, generous whitespace, soft shadows, 1px borders, rounded-xl cards.
- Typography: Inter via system fallback (kept simple for prototype).
- Accent palette in `src/styles.css` using oklch — a confident green for "money/won" semantics, neutral slate surfaces, amber for at-risk goals. All colors as semantic tokens (`--success`, `--warning`, `--accent`, etc.); no hard-coded hex in components.
- Recharts for sparkline + activity bar chart, themed via CSS variables.

## Reusable components

```
src/components/
  layout/AppSidebar.tsx
  layout/AppHeader.tsx
  dashboard/KpiCard.tsx
  dashboard/GoalProgressCard.tsx
  dashboard/LeaderboardCard.tsx
  dashboard/RecentDealsCard.tsx
  dashboard/ActivitySummaryCard.tsx
  dashboard/EditableGoalsCard.tsx
  deals/SheetDealsTable.tsx
  assets/AssetCard.tsx
  assistant/AssistantPanel.tsx
  assistant/AssistantLauncher.tsx
```

## Out of scope (this pass)

- No auth, no Lovable Cloud, no real Google Sheets fetch, no real LLM calls, no payments.
- All "integration" work is left as `TODO(integration):` comments at the exact call sites so it's trivial to wire up later in GitHub/Codex.

## Technical notes

- TanStack Start file-based routing; each page route sets its own `head()` meta.
- localStorage is used only for the editable Goals card; everything else is in-memory mock data so the build stays SSR-safe.
- All shadcn components installed on demand; AI Elements installed via `bun x ai-elements@latest add conversation message prompt-input shimmer`.
