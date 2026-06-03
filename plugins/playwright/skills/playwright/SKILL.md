---
name: playwright
description: Use when adding, running, or debugging Playwright end-to-end tests in a web app. Covers setup, smoke tests, browser install checks, local preview verification, screenshots, traces, and CI-safe test commands.
---

# Playwright

Use this skill when the user wants browser-based testing for a web app.

## Process

1. Inspect the project first:
   - package manager
   - framework
   - existing test scripts
   - dev server command
   - auth or env vars needed to reach the first screen

2. Add the smallest useful setup:
   - `@playwright/test`
   - `playwright.config.ts`
   - one smoke test under `tests/e2e`
   - npm scripts for normal, headed, UI, and report modes

3. Use a local web server in config:
   - start the app with the repo's existing dev command
   - use `127.0.0.1`
   - pick a port that avoids the user's active preview
   - reuse an existing server outside CI

4. Keep tests practical:
   - start with "page renders"
   - then test one real workflow at a time
   - avoid brittle selectors
   - prefer accessible names and visible text
   - avoid relying on private production data unless the user asks

5. When auth is required:
   - explain what env vars or test credentials are needed
   - do not hardcode passwords
   - use server-side env vars or Playwright storage state when appropriate

6. Verify:
   - `npm run build`
   - `npx tsc --noEmit` when TypeScript is present
   - `npm run test:e2e -- --list`
   - a real test run when browsers are installed

## Common Commands

```bash
npm install -D @playwright/test
npx playwright install chromium
npm run test:e2e
npm run test:e2e:headed
npm run test:e2e:ui
```

## Output

Always report:

1. files changed
2. how to run the tests
3. whether browser binaries are installed
4. what was verified
5. any local setup still needed
