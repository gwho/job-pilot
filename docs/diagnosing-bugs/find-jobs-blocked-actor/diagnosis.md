# Diagnosis — Blocked JobsDB Actor Returns Fake Success

## What broke

Clicking Find Jobs with "sales coordinator / Hong Kong" showed the banner:

```
Found 0 jobs — all already saved.
```

The same search had worked earlier (returned 20 real jobs). Subsequent runs showed the actor
getting 403 responses from JobsDB, finishing in under 10 seconds, and reporting 0 dataset items.

## Failure mode: SUCCEEDED with empty dataset

This is a **silent success masking upstream failure**. The actor run completed without error from
Apify's perspective (status = SUCCEEDED), but no data was produced because the search page was
blocked before any job cards loaded.

Signs that pointed to this mode:
- Server logs showed `Request blocked - received 403 status code` with 3 retries.
- Logs showed `PlaywrightCrawler: Finished! Total 1 requests: 0 succeeded, 1 failed.`
- Logs showed `[jobsdb-actor] Done. Pushed 0 jobs across up to 1 page(s).`
- Yet the Next.js route returned HTTP 200 with `success: true`.
- The word "failed" never appeared in the route logs.

## The full four-step failure chain (confirmed from code)

```
1. Crawlee retries page-1 search 3× → failedRequestHandler logs but does NOT call Actor.fail()
2. Actor reaches Actor.exit() normally → Apify marks run SUCCEEDED, dataset = []
3. lib/apify.ts: run.status === "SUCCEEDED" → no throw → returns []
4. route.ts: [] treated as valid result → records.length === 0 → "all already saved"
```

Each step is individually defensible in isolation; the bug exists in the gap between them.

## Second bug discovered during diagnosis (trace-2 repro)

A second variant was also confirmed from server logs:
- Runs for `sales coordinator` with increasing `maxPages` (1, 2, 3)
- Pages 1–2 found 20 real jobs; page 3 ran and got 403 → actor SUCCEEDED with 0 items
- The route's pagination loop did: `allActorJobs = await discoverJobsDbJobs(...)` on every call
- Call 3 assigned `allActorJobs = []`, **overwriting the 20 jobs found in calls 1–2**
- Result: "Found 0 jobs — all already saved."

This is a **monotonic invariant violation**: a later call was allowed to shrink the discovered set.

## Feedback loop used

Unit tests at the route seam (`POST /api/agent/find`):

```ts
// blocked-actor.test.ts
vi.mocked(discoverJobsDbJobs)
  .mockResolvedValueOnce(page1DupActorJobs)    // call 1: 10 dups
  .mockResolvedValueOnce(allPage2DupActorJobs) // call 2: 20 dups
  .mockResolvedValueOnce([]);                  // call 3: blocked → []

// Assertion (RED before fix):
expect(data.jobsFound).toBeGreaterThanOrEqual(20);
```

Five test scenarios written before implementation:
1. Trace-2 repro: `[]` on call 3 after 20 dup results
2. Legit empty: `[]` on call 1 (actor genuinely found nothing)
3. Blocked upstream: call 1 throws (existing correct path)
4. Partial block (dups): call 3 throws after 20 dups
5. Partial block (new jobs): call 2 throws after mixed results

All five were confirmed RED before writing a single line of implementation code.

The actor-side classification helpers (`classifySearchPage`, `shouldFailRun`) were tested as pure
functions in `actor-search-outcome.test.ts` — no Playwright mocking required.
