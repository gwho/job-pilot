# Resolution — Blocked JobsDB Actor Returns Fake Success

## Root cause (one sentence)

The actor's `failedRequestHandler` only logged the 403 failure instead of calling `Actor.fail()`,
so Apify marked the run SUCCEEDED, and the route had no way to distinguish "nothing found" from
"blocked before finding anything."

## What was changed

### Layer 1: Actor (`apify/jobsdb-hk-actor/src/`)

**New file: `search-outcome.ts`** — pure classification helpers:

```ts
export function classifySearchPage(input: SearchPageInput): SearchOutcome
// → "ok" | "login-redirect" | "legit-empty" | "suspicious-empty"

export function shouldFailRun({ page1Outcome, jobsPushed }): boolean
// true only when page-1 was blocked/suspicious AND 0 jobs were pushed
```

Detection priority for zero-card pages:
1. Known empty-state DOM selector (`[data-automation="searchZeroResults"]`) → **legit-empty** (authoritative)
2. Text fallback alone (`/no results.../i`) → **NOT sufficient** → suspicious-empty
3. Default zero-card with no evidence → **suspicious-empty**

**Updated: `main.ts`**:
- `extractCardLinks` now returns `{ links, outcome }` instead of `string[]`
- `failedRequestHandler` sets `page1Outcome = "suspicious-empty"` when the SEARCH label fails
- After `crawler.run()`: calls `Actor.fail(message)` if `shouldFailRun` returns true

```ts
if (shouldFailRun({ page1Outcome, jobsPushed })) {
  await Actor.fail(
    `Search page blocked or returned no results (page-1 outcome: ${page1Outcome}) — no jobs discovered.`
  );
} else {
  await Actor.exit();
}
```

Actor deployed as build **0.1.8**.

### Layer 2: Route (`app/api/agent/find/route.ts`)

**Monotonic accumulation guard** — replaced `allActorJobs` (replaced on every iteration) with
`bestActorJobs` (only grows):

```ts
// If a later call returns fewer items than what we already have, treat it as a
// suspicious shrink and stop the loop, keeping bestActorJobs intact.
if (pageResult.length < bestActorJobs.length) {
  if (bestActorJobs.length > 0) searchIncomplete = true;
  break;
}
bestActorJobs = pageResult;
```

**Partial-block handling** — error after real results is now a soft failure, not a 500:

```ts
if (jobsDbError && bestActorJobs.length === 0) {
  // Hard failure: blocked before finding anything → 500
} else if (jobsDbError) {
  // Soft failure: blocked mid-pagination → proceed with bestActorJobs, set searchIncomplete
}
```

**Message policy**:

| Condition | Message |
|---|---|
| `totalFound === 0` | "Found 0 jobs. Try different keywords." |
| All dups, incomplete | "Found N jobs — all already saved. Some later pages could not be searched." |
| New jobs, incomplete | "Found N jobs and saved X new jobs. Some later pages could not be searched, so results may be incomplete." |

### Layer 3: `lib/apify.ts`

Minor: `run.statusMessage` included in thrown error so route logs show why the actor failed:

```ts
const detail = run.statusMessage ? ` — ${run.statusMessage}` : "";
throw new Error(`JobsDB actor run ${run.status}${detail} (runId: ${run.id})`);
```

### Layer 4: UI (`components/find-jobs/FindJobsClient.tsx`)

`catch` block now sets error banner instead of silently returning:

```ts
} catch (error) {
  console.error("[FindJobsClient] search error:", error);
  setSearchStatus({ message: "Search failed. Please try again.", isError: true }); // added
} finally {
```

## What was learned about the codebase

- `Actor.fail()` is a first-class SDK method (not just `exitCode: 1`). It sets run `statusMessage`
  and produces a clean FAILED status that `lib/apify.ts`'s existing guard already handles.
- The `scoreJobs` mock in test files returns a plain array, not a `Promise` — a pre-existing type
  error in the test harness. Does not affect runtime; Vitest runs without typechecking.
- The route's "all already saved" path had no guard for `totalFound === 0` — it would say
  "Found 0 jobs — all already saved" for any run that returned an empty array, including
  legitimate zero-result searches (different user experience than "try different keywords").

## Tests added

- `__tests__/find-jobs/blocked-actor.test.ts` — 5 route-level scenarios (15 assertions)
- `__tests__/find-jobs/actor-search-outcome.test.ts` — 10 pure-function unit tests
- `__tests__/find-jobs/seam.test.tsx` — extended with 2 network-error UI cases

Total: 71 tests pass after the fix (was 55 before this session).
