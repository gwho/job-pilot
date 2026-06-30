# Reasoning — Find Jobs Repeated-Search Bug

## Why the feedback loop came first

The diagnosing-bugs skill insists on a red-capable test before forming any
hypothesis. The reason: without a test, debugging is guessing. You pick the most
plausible cause, make a change, manually verify, and move on. If there were two
interacting causes, you'd fix one and conclude the bug is gone — until a user hits
the second cause a week later.

A red-capable test catches the exact user symptom. When the test goes green, you
know the symptom is gone. When it stays red after a fix, you know there's more to find.
The test is not documentation of the fix — it is the diagnostic instrument.

---

## Why this seam (route handler) and not another

Three seam options existed:

1. **Frontend seam (`FindJobsClient`)** — already covered by `seam.test.tsx`. The
   client correctly displays whatever the API returns. The bug was not in the client.

2. **Route handler seam (chosen)** — the `POST` function from `app/api/agent/find/route.ts`
   accepts a `Request`, calls external dependencies, and returns a `Response`. All
   external dependencies (InsForge, Apify actor, Nemotron, PostHog) are mockable at
   module level. This is the closest correct seam to the actual bug.

3. **Actor seam (discoverJobsDbJobs)** — could test that the function is called with
   the right arguments, but wouldn't test the *route's decision to call it again*.
   A test there would have been testing the fix, not the bug.

The route handler seam is correct because it exercises the control flow that decides
whether to call the actor a second time. The bug lives in that control flow.

---

## Why the actor can't start from page 2

The Apify actor (`apify/jobsdb-hk-actor/src/main.ts`) always starts its crawl at
page 1 (line 212):

```typescript
await crawler.run([
  { url: jobsDbSearchUrl(query, location, 1), label: "SEARCH", userData: { page: 1 } },
]);
```

It advances to subsequent pages only when `currentPage < maxPages`. This means:
- A call with `maxPages=1` visits page 1 only.
- A call with `maxPages=2` visits pages 1 and 2 — the actor re-visits page 1 fresh.
- A call with `maxPages=N` always returns a cumulative, deduplicated set of pages 1..N.

The actor's internal `seenUrls` set deduplicates across pages *within a single run*.
But each new API call is a new run with a fresh `seenUrls`. So calling with `maxPages=2`
always re-fetches page 1.

**Implication for the fix:** The loop approach works because:
- Iteration 1 (`maxPages=1`): actor returns 10 jobs, all in DB → 0 fresh
- Iteration 2 (`maxPages=2`): actor returns 20 jobs (pages 1+2), actor deduplicates
  within the run → 10 old from page 1 + 10 new from page 2 → 10 fresh → loop exits

We pay for re-fetching page 1 on each iteration. For N previous searches, we make
at most N+1 actor calls before finding new jobs, or 5 calls maximum. Each call is
an Apify actor run; cost scales with pages fetched.

---

## Why `existingByUrl` was moved before the loop

Original order: call actor → build `existingByUrl` → filter new.

The problem: the loop needs to check freshness *during* each iteration to know
whether to continue. If `existingByUrl` is built after the loop, the loop has no
freshness signal and must either always run all 5 pages (wasteful) or use a
separate query per iteration (expensive).

Moving `existingByUrl` before the loop means:
1. One DB query, executed once, before any actor calls.
2. Each loop iteration checks `existingByUrl` in-memory — zero extra DB round-trips.
3. If the DB query fails, we mark the run failed *before* paying for any actor call.

The DB snapshot is taken once and treated as immutable for the duration of the loop.
This is correct because:
- The actor calls are read-only (no DB writes happen inside the loop).
- The only race condition risk (two concurrent searches) was already noted as a known
  deferred issue — moving the query up doesn't change that risk profile.

---

## The freshCount guard: why `j.sourceUrl &&`

```typescript
const freshCount = allActorJobs.filter(
  (j) => j.sourceUrl && !existingByUrl.has(j.sourceUrl),
).length;
```

The `j.sourceUrl &&` check mirrors the identical guard in the downstream `newJobs`
filter (line 139 of the original). An actor result can have an empty `sourceUrl`
if the job card link extraction failed. Without the guard, an empty string would
pass `!existingByUrl.has("")` (the map has no empty-string key) and inflate
`freshCount` — making the loop exit early thinking it found new jobs, when it
actually found empty-URL results.

---

## The exhaustion signal: `allActorJobs.length < page * 10`

When JobsDB has fewer than 10 results on a given page, the actor returns fewer items.
If we requested 20 items (2 pages × 10) but got only 15, it means page 2 is the last
page and there are only 5 new results there. The loop should stop rather than trying
page 3 (which would return nothing new).

The signal `allActorJobs.length < page * 10` catches this: if the total items returned
are fewer than `maxPages * 10`, the actor ran out of listings.

Edge case: if the actor returns exactly `page * 10` items but page N was genuinely
the last page (coincidentally exactly 10 results), we'd make one unnecessary extra
call. The extra call returns ≤ the same results (nothing new), `freshCount` stays < 10,
the loop exits naturally next iteration. No correctness issue — just one wasted call.

---

## The DB chain mock: why a thenable

The InsForge client's query chains are designed to be awaited at any point in the
chain — you don't have to call `.single()` or `.maybeSingle()`. This is how the
existing-jobs query works:

```typescript
const existingJobsResult = await insforge.database
  .from("jobs")
  .select("*")
  .eq("user_id", userId)
  .eq("source_provider", "jobsdb_hk");
// ↑ directly awaited — no .single()
```

JavaScript's `await` operator resolves a thenable: if the value has a `.then`
method, it calls `.then(resolve, reject)` rather than wrapping in `Promise.resolve()`.
So `await chain` calls `chain.then(resolve, reject)`.

By adding:
```typescript
chain.then = (onFulfilled, onRejected) =>
  Promise.resolve(resolvedValue).then(onFulfilled, onRejected);
```
...the chain becomes directly awaitable. The `maybeSingle()` and `single()` methods
still work as before (they return proper Promises), but now you can also `await`
the chain at any intermediate point in the method chain.

Without this, tests would fail with `undefined` when the route awaits a chain
without calling a terminal method.

---

## Why call count per table, not per absolute call order

An alternative mock approach: sequence ALL `from()` calls by absolute order regardless
of table name. The problem: the fix reorders the calls. Before the fix, the order was:
`profiles → agent_runs → (actor) → jobs.select → agent_runs`. After the fix:
`profiles → agent_runs → jobs.select → (actor loop) → jobs.insert → agent_runs`.

A sequence-by-absolute-order mock would return wrong values when the code path changes.
The test would fail for the wrong reason (mock returning wrong data, not the bug).

The per-table call count approach (`callCounts["jobs"]`) is resilient to reordering
between code versions. As long as the semantic meaning (first jobs call = select,
second jobs call = insert) stays stable, the mock remains correct through the fix.

---

## Why `TARGET_NEW = 10` and `MAX_PAGES = 5` as named constants

These aren't magic numbers — they encode a business decision. `TARGET_NEW = 10`
says "a successful search saves up to 10 new jobs." `MAX_PAGES = 5` says "we're
willing to fetch up to 5 Apify pages per search." Making them named constants means:
- They're searchable in the codebase.
- Their purpose is self-documenting.
- They can be changed in one place without hunting for literals.

The original code had `maxPages` as a client-provided parameter (clamped 1–5).
Removing that and baking the values server-side removes a confusing API surface
(why would a client dictate how many actor pages to fetch?) and prevents a client
from accidentally sending `maxPages=0` and getting a no-op search.
