# Technical Explanation — Blocked Actor Error Fix

## Why the actor exited SUCCEEDED with an empty dataset

Apify actors run inside a Crawlee crawler. When Crawlee's `PlaywrightCrawler` retries a request and exhausts all retries, it calls `failedRequestHandler`. That handler is just a log statement — it does not throw or call `Actor.fail()`. After the handler returns, the crawler finishes normally, the actor calls `Actor.exit()`, and Apify marks the run **SUCCEEDED**.

The caller (`lib/apify.ts`) only checks `run.status !== "SUCCEEDED"` to decide whether to throw. A SUCCEEDED run with 0 dataset items passes that check. So an empty array `[]` came back to the route as though it were a valid result.

## Why the route treated [] as "all already saved"

The route builds a set of existing job URLs before calling the actor. After the actor returns, it computes `newJobs = actorJobs.filter(j => !existingByUrl.has(j.sourceUrl))`. When `actorJobs = []`, `newJobs = []` and `records = []`. The existing code path for `records.length === 0` assumed "all actor results were already in the DB" — but it never verified that any actor results existed at all.

## The monotonic accumulation guard

The route calls the actor in a loop, increasing `maxPages` each iteration to paginate. The actor returns ALL pages 1..N cumulatively in a single dataset, so call 2 (maxPages=2) is always a superset of call 1 (maxPages=1) — unless the actor was blocked mid-crawl.

The fix: track `bestActorJobs` (the largest valid result seen so far). If a later call returns fewer items than `bestActorJobs.length`, that's a suspicious shrink — the blocked-crawl pattern. Discard the shrunk result and stop pagination, keeping `bestActorJobs` intact.

## Why Actor.fail() is better than exitCode:1

`Actor.fail(message)` is a first-class SDK method that sets the run status to FAILED and writes the message as the run's `statusMessage`. The existing `run.status !== "SUCCEEDED"` guard in `lib/apify.ts` already converts a FAILED run into a thrown error. No changes were needed to the guard — only the actor itself needed to call fail() instead of exit().

## The search-outcome.ts classification logic

`classifySearchPage` is a pure function with no side effects. Pure functions are easy to test without mocking Playwright. The detection priority:
1. URL contains `/login` or `/sign-in` → redirect (authoritative)
2. Cards found → ok (authoritative)
3. Known empty-state DOM selector fires → legit-empty (authoritative)
4. Text fallback regex alone → **not sufficient** → suspicious-empty

The body-text fallback (`/no results|0 jobs found/i`) could match any page that uses anti-bot challenges with "no results" copy. A specific DOM selector (`[data-automation="searchZeroResults"]`) is authoritative because it requires the real JobsDB UI to have rendered. If the selector is absent, the safest assumption is that the page was blocked or failed to load.

## The partial-block case

The old code treated any thrown error from `discoverJobsDbJobs` as a hard failure (500). But if pages 1–2 found 20 real jobs and only page 3 threw, returning 500 and discarding 20 good results is too harsh.

The fix distinguishes:
- `jobsDbError && bestActorJobs.length === 0` → hard failure (500)
- `jobsDbError && bestActorJobs.length > 0` → soft partial (200 + warning suffix)

The warning suffix tells the user their results may be incomplete without hiding the jobs that were found.

## The UI catch block gap

`handleSearch` wrapped the fetch in try/catch, but the catch block only called `console.error`. When fetch rejects (network outage, DNS failure), the user saw nothing — the old table persisted silently and the loading spinner disappeared. Adding `setSearchStatus({ message: "Search failed. Please try again.", isError: true })` to the catch block makes the failure visible.
