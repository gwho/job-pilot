# Find Jobs — Blocked Actor Error Fix

## What was built

Fixed a silent failure where a JobsDB search blocked by a 403 response was returning "Found 0 jobs — all already saved." instead of an error.

## Root cause

The failure chain had four steps:
1. JobsDB search URL returns 403; Crawlee's `failedRequestHandler` only logged the error.
2. The actor reached `Actor.exit()` normally → Apify run status **SUCCEEDED**, dataset empty.
3. `lib/apify.ts` saw SUCCEEDED and returned `[]`.
4. `app/api/agent/find/route.ts` treated `[]` as a valid empty result and returned "Found 0 jobs — all already saved."

A second bug was also confirmed from logs: when pages 1–2 found 20 real jobs and page 3 was blocked, the route overwrote `allActorJobs` with `[]`, discarding the previous results entirely.

## Files changed

| File | Change |
|---|---|
| `apify/jobsdb-hk-actor/src/search-outcome.ts` | New — pure classification helpers |
| `apify/jobsdb-hk-actor/src/main.ts` | Calls `Actor.fail()` on blocked/suspicious page-1 |
| `lib/apify.ts` | Includes `statusMessage` in thrown error |
| `app/api/agent/find/route.ts` | Monotonic guard, partial-block handling, legit-empty message |
| `components/find-jobs/FindJobsClient.tsx` | `catch` block now sets error banner |
| `__tests__/find-jobs/blocked-actor.test.ts` | New regression tests (5 scenarios) |
| `__tests__/find-jobs/actor-search-outcome.test.ts` | New unit tests for classification helpers |
| `__tests__/find-jobs/seam.test.tsx` | Extended with 2 network-error cases |

## Policy

| Scenario | Result |
|---|---|
| Page 1 blocked (403) or suspicious empty | Actor fails → route 500, error banner, run failed |
| Page 1 verified legit empty | Actor succeeds → route 200, "Found 0 jobs. Try different keywords." |
| Later page blocked after jobs found | Route 200 with discovered jobs + warning suffix |
| All discovered jobs already in DB | Route 200, "Found N jobs — all already saved." |
| New jobs discovered | Route 200, "Found N jobs and saved X new jobs." |
