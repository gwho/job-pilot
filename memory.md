# Memory — Debugging Session: Actor URL Fix + Silent Error Path Fix + Teaching Start

Last updated: 2026-06-30

## What was built

### Actor: SEO path URL format (build 0.1.7)

- `apify/jobsdb-hk-actor/src/urls.ts` — NEW file extracted from `main.ts`:
  - `toPathSlug(text)` — converts "sales coordinator" → "sales-coordinator", `&` → "and"
  - `jobsDbSearchUrl(query, location, page)` — builds SEO path: `https://hk.jobsdb.com/sales-coordinator-jobs/in-Hong-Kong`
  - `canonicalJobUrl(rawUrl)` — strips query string + hash; returns `${origin}${pathname}` only
- `__tests__/find-jobs/jobsdb-urls.test.ts` — NEW: 4 tests covering SEO URL building (with/without location), pagination param, canonicalisation

Root cause: `?q=sales+coordinator&l=Hong+Kong` URL form returns generic/irrelevant listings. SEO path form returns exact keyword matches. Build 0.1.7 deployed, 9/10 results verified as exact keyword matches.

### Find Jobs: silent error path fix

- `components/find-jobs/FindJobsClient.tsx`:
  - `SearchStatus` type gains `isError?: boolean`
  - Error path (`!res.ok || !data.success`) now calls `setSearchStatus({ message: ..., isError: true })` instead of silently returning
- `components/find-jobs/SearchControls.tsx`:
  - Banner conditionally applies `bg-error/10 text-error` (error) vs `bg-success-lightest text-success-foreground` (success)
  - `AlertCircle` icon for errors, `Sparkles` icon for success

### Testing: seam.test.tsx 7 → 10 tests

- `__tests__/find-jobs/seam.test.tsx` — 3 new tests:
  - Consecutive search (keyword B replaces keyword A) — GREEN before fix; confirmed state updates correctly
  - Error path shows banner — RED before fix, GREEN after
  - Loading state clears after error — GREEN before fix; confirmed `finally` block already correct

### Session docs + tutorials

- `docs/debug/02-find-jobs-pipeline-bugs/` — completed: diagnosis.md, explanation.md, ai-discussion-topics.md
- `docs/diagnosing-bugs/find-jobs-silent-error/` — feedback-loop.md, reasoning.md, ai-discussion-topics.md (20 questions)
- `docs/fixes/find-jobs-error-feedback/` — plan.md, explanation.md, ai-discussion-topics.md (18 questions)
- `docs/tutorials/21-find-jobs-error-feedback/README.md` — 7-part tutorial, 5 CS concepts, end-to-end trace, 3 challenges

### Teaching workspace

- `NOTES.md` — updated: teaching now covers full lifecycle (features, debugging, testing, fixing)
- `learning-records/0004-debugging-with-feedback-loops.md` — key insight: debugging as scientific method, red-capable test before hypothesis
- `lessons/0005-debugging-with-feedback-loops.html` — 4-part lesson: silent failure, feedback loop, GREEN test as hypothesis eliminator, minimal fix

## Decisions made

- **SEO path URL is the correct form** — `?q=...` returns generic listings; `/keyword-jobs/in-Location` returns relevant results. `urls.ts` owns this conversion and must be kept in sync with any URL format changes JobsDB makes.
- **`isError?: boolean` optional on `SearchStatus`** — not required, so success-path callers don't change. `undefined` is falsy → success banner. Fewer call sites to touch, no risk of breaking existing paths.
- **`finally` for `setIsLoading(false)` is correct RAII** — loading state is always released on every exit (return, throw, normal). Do not move it into individual branches.
- **Minimal change principle for bug fixes** — banner mechanism already existed; the error path just wasn't using it. No new components, no new state slots.

## Problems solved

- **Actor returning irrelevant jobs** — root cause was URL format, not query content. `?q=` form is a generic job board search. SEO path is a curated category page. Fixed by `jobsDbSearchUrl()` in `urls.ts`.
- **User saw old results after search** — root cause was silent failure: `handleSearch` returned early on API error without calling `setSearchStatus`, so no banner appeared and the table was unchanged. Indistinguishable from "search found no new results" without a test.
- **Duplicate jobs from actor** — fixed in prior session (build 0.1.6 / `seenUrls` dedup). Still in place.

## Current state

- Actor build `0.1.7` deployed, GREEN
- All **37 Vitest tests** passing (`npm run test:run`)
- Build clean (`npm run build`)
- Feature 12 (Job Details Page) is next
- Teaching workspace: 5 lessons complete (0001–0005), covers URL state, TDD, GitHub issues, Feature 11, debugging methodology

## Next session starts with

Run `/remember restore`, then begin Feature 12 — Job Details Page. Start with `/architect feature 12` before writing any code.

## Open questions

- **`catch` path still silent** — `handleSearch`'s `catch` block only calls `console.error` on network errors (fetch throws). Needs `setSearchStatus({ message: "Network error...", isError: true })` + test with `mockRejectedValueOnce`. Intentionally deferred.
- **GitHub Issue #19** — `job_found` PostHog event fires only for `match_score >= 70`. Fix in `app/api/agent/find/route.ts` — deferred until before Feature 17.
- **JobsDB session expiry** — re-capture needed ~mid-July 2026. Run `node scripts/capture-jobsdb-session.mjs`.
- **DB-level race condition** — two concurrent `/api/agent/find` requests from same user could both insert the same jobs before either sees `existingUrls`. Needs DB unique constraint to fix properly. Low-frequency; deferred.
- **"New this search" row tagging** — showing which rows came from the current `run_id` would clarify history vs current-search split. Deferred.
- **`APIFY_SESSION_STORE_ID` in `.env.local`** — only used by the capture script, not the Next.js app. Could be removed once workflow is stable.
