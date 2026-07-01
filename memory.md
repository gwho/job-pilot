# Memory — Debugging Session: Repeated-Search Pagination Fix + Tutorial 22

Last updated: 2026-06-30

## What was built

### Repeated-search pagination fix

- `__tests__/find-jobs/repeated-search.test.ts` — NEW: 5-test regression suite exercising the `POST` route handler directly. All 5 were RED before the fix, GREEN after. Key infrastructure: `createChain(resolvedValue)` thenable mock helper, `buildInsforgeMock(existingJobs, insertResult)` per-table call-count mock, two-call `discoverJobsDbJobs` mock sequence (page1 returns all existing, page1+2 returns 10 new).

- `app/api/agent/find/route.ts` — MODIFIED (pagination loop fix):
  - Removed `maxPages?: number` from body type (client never sent it)
  - Moved `existingByUrl` DB query BEFORE the actor call (was after)
  - Replaced single `discoverJobsDbJobs` call with fetch-until-enough loop (`TARGET_NEW = 10`, `MAX_PAGES = 5`)
  - Renamed `jobsDbJobs` → `allActorJobs` on the dedup filter line
  - Everything from dedup step onward unchanged

### Session docs + plan + tutorial

- `docs/diagnosing-bugs/find-jobs-repeated-search/` — NEW folder: `feedback-loop.md` (what happened), `reasoning.md` (why each decision), `ai-discussion-topics.md` (21 questions in 5 groups)
- `docs/plan/repeated-search-pagination/plan.md` — NEW: exact copy of approved plan file
- `docs/tutorials/22-find-jobs-repeated-search/README.md` — NEW: 7-part tutorial covering seam selection, actor pagination model, existingByUrl snapshot, fetch-until-enough loop, thenable mock, per-table call counting; all 21 discussion questions woven in as checkpoints

## Decisions made

- **Pagination is server-driven, not client-controlled.** `maxPages` removed from the request body. Client sends `jobTitle` and `location` only. Budget constants (`TARGET_NEW`, `MAX_PAGES`) live server-side where cost decisions belong.
- **`existingByUrl` built once before the loop.** One DB query, zero per-iteration round-trips. Snapshot is immutable during the loop because no DB inserts happen inside it.
- **Actor always starts at page 1.** Each call with `maxPages=N` re-fetches pages 1..N cumulative (actor deduplicates via `seenUrls` within a run). The loop pays for page-1 re-fetches; there is no way to start the actor mid-stream without actor changes.
- **Two-phase error handling: `break` then check after loop.** Re-throwing inside `catch` would bypass the specific "Job search failed" message and `agent_runs.status = "failed"` write, falling through to the generic outer catch.
- **Per-table call counting in DB mock.** Resilient to fix-induced reordering between RED and GREEN states. Absolute call-order mocking would have broken the test.

## Problems solved

- **Repeated search always returned "all already saved"** — root cause: route called `discoverJobsDbJobs` with `maxPages=1` (default) every time. Actor always starts at page 1. After the first search, all page-1 jobs were in DB → `records.length === 0` → Path A every time. Fix: fetch-until-enough loop.
- **TypeScript error after first edit (`maxPages` still referenced)** — expected; fixed by the second edit replacing the entire actor call block with the loop.
- **`JobsDbJob` declared but never read** — caused by using `import("@/agent/jobsdb").JobsDbJob[]` inline instead of the static import. Fixed by using the statically imported type.

## Current state

- **42 Vitest tests passing** (`npm run test:run`) — 37 pre-existing + 5 new regression tests
- **Build clean** (`npm run build`)
- Actor build `0.1.7` still deployed and GREEN
- Teaching workspace: 22 tutorials complete (0001–0022), lessons 0001–0005
- Feature 12 (Job Details Page) is the next feature in `context/build-plan.md`

## Next session starts with

Run `/remember restore`, then begin **Feature 12 — Job Details Page**. Start with `/architect feature 12` before writing any code.

## Open questions

- **`catch` path still silent** — `handleSearch`'s `catch` block only calls `console.error` on network errors (fetch throws). Needs `setSearchStatus({ message: "Network error...", isError: true })` + test with `mockRejectedValueOnce`. Intentionally deferred.
- **GitHub Issue #19** — `job_found` PostHog event fires only for `match_score >= 70`. Fix in `app/api/agent/find/route.ts` — deferred until before Feature 17.
- **DB-level race condition** — two concurrent `/api/agent/find` requests from same user could both insert the same jobs before either sees `existingByUrl`. Needs `UNIQUE (user_id, source_url)` constraint. Low-frequency; deferred.
- **JobsDB session expiry** — re-capture needed ~mid-July 2026. Run `node scripts/capture-jobsdb-session.mjs`.
- **"New this search" row tagging** — showing which rows came from the current `run_id` would clarify history vs current-search split. Deferred.
- **`APIFY_SESSION_STORE_ID` in `.env.local`** — only used by the capture script, not the Next.js app. Could be removed once workflow is stable.
