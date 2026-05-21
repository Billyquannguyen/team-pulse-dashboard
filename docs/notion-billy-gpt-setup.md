# Billy GPT Notion Setup

Billy GPT reads the Notion handbook through a server-side Notion internal integration.

The browser never receives the Notion token. Diagnostics only show setup status, counts, and errors.

## Vercel Environment Variables

Add these in Vercel Project Settings:

```text
NOTION_API_TOKEN=secret_from_your_notion_internal_integration
NOTION_HANDBOOK_ROOT_PAGE_ID=your_handbook_root_page_id
BRAVE_SEARCH_API_KEY=optional_for_stronger_live_web_search
```

Do not put either value in frontend code, markdown knowledge files, Google Sheets, or browser storage.

## Create The Notion Integration

1. In Notion, create a new internal integration.
2. Copy the integration secret.
3. Add it to Vercel as `NOTION_API_TOKEN`.
4. Open the root handbook page in Notion.
5. Share that page with the internal integration.
6. Copy the page ID from the Notion page URL.
7. Add it to Vercel as `NOTION_HANDBOOK_ROOT_PAGE_ID`.
8. Redeploy the Vercel project after adding the env vars.

The root page must be shared with the integration. Subpages must either live under that root page or also be accessible to the same integration.

## Sync Flow

1. Log in to the dashboard with the admin password.
2. Open Billy GPT.
3. Click `Sync Notion`.
4. Check `/diagnostics` for:
   - last sync time
   - pages indexed
   - chunks indexed
   - setup errors

Billy GPT searches the synced handbook index first. It can also add Active Brands sheet context and live web context when the question needs it.

Source priority:

- `[handbook]` internal source of truth
- `[sheets]` live operational business data
- `[web]` external enrichment

If Billy GPT cannot find an internal answer in the handbook, it says that clearly instead of pretending the answer is internal.

For web search, the app uses `BRAVE_SEARCH_API_KEY` when present. If that key is missing, it falls back to a limited public web lookup. Add Brave later if you want stronger trend and news-style answers.

## Current Storage Note

The first version stores the synced handbook in a private server-side memory index.

That keeps setup simple and avoids adding a paid vector database before the workflow is proven. On Vercel, memory can reset after a redeploy or server cold start, so admins may need to sync again. If the team starts relying on Billy GPT heavily, move the index to a durable vector store such as Supabase pgvector, Vercel Postgres with pgvector, or Upstash Vector.
