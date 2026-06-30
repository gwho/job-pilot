# Tutorial 22 — Find Jobs Repeated-Search: Diagnosing Pagination Starvation with a Route-Handler Seam

**After completing this tutorial you will understand:** why "all already saved" is a valid success path and how to distinguish it from a bug; how to select the tightest correct seam for a route-handler control-flow bug; why the Apify actor always re-fetches page 1 and what a fetch-until-enough loop does about it; how `existingByUrl` as a pre-loop snapshot eliminates per-iteration DB round-trips; and how the JavaScript thenable protocol makes InsForge query chains directly awaitable without a terminal `.single()`.

---

> [!NOTE]
> **Prerequisites:** Tutorial 21 (`../21-find-jobs-error-feedback/README.md`) — introduces the diagnosing-bugs skill, seam tests, the route lifecycle, and the `finally`-based loading cleanup this tutorial builds on. Tutorial 20 (`../20-filter-sort-pagination/README.md`) — establishes the `FindJobsClient` state architecture that calls this route.
>
> Open [`app/api/agent/find/route.ts`](../../../app/api/agent/find/route.ts) and [`__tests__/find-jobs/repeated-search.test.ts`](../../../__tests__/find-jobs/repeated-search.test.ts) alongside this tutorial.

---

## CS & language concepts in this tutorial

| Concept | Where it appears | Category |
|---------|-----------------|----------|
| Hash Map (O(1) lookup) | `existingByUrl` Map — dedup and freshness check per URL | Data structures |
| Fetch-until-enough loop | `for page = 1..MAX_PAGES` with two early-exit conditions | Algorithms |
| JavaScript thenable protocol | `chain.then` on InsForge mock — `await` resolves via `.then` | Language |
| Test seam selection | Route handler seam chosen over frontend/actor seams | System design |
| Named constants | `TARGET_NEW = 10`, `MAX_PAGES = 5` — encode business decisions | System design |

---

## How to use an LLM before this tutorial

Budget 20–30 minutes on these five concepts before reading code.

### Concept 1 — Hash Map for membership and deduplication

> "Explain how a Hash Map (JavaScript `Map` or `Set`) achieves O(1) membership checks. Compare it to scanning an array for the same element. Give a concrete example where you need to check thousands of URLs for duplicates — explain why `map.has(url)` is fast and `array.find(j => j.url === url)` is slow. Quiz me on the performance gap with 10,000 items."

*What to listen for:* A hash map computes a key's position via a hash function — no scan needed. `map.has(url)` is O(1) regardless of map size. `array.find(...)` is O(n) — it scans from the front. For 10,000 URLs the array scan is 10,000× slower in the worst case. The Map is the standard solution when you need repeated membership checks over a fixed set.

*Practice question:* A search returns 50 actor jobs. Your DB has 5,000 saved URLs. How many comparisons does `existingByUrl.has(url)` need per job? How many does `existingJobs.some(j => j.source_url === url)` need per job in the worst case?

---

### Concept 2 — Fetch-until-enough loops

> "Explain the pattern of a 'fetch-until-enough' loop — a loop that calls an external paginated API, checks if the result satisfies a target count, and only calls again if the target is not yet met. What are the two exit conditions: target satisfied and source exhausted? Why should both be checked, not just the target? Give a concrete example and quiz me on what happens when the source runs dry before the target is reached."

*What to listen for:* A fetch-until-enough loop is a bounded polling pattern. Exit on target satisfied (you have what you need) or source exhausted (there's nothing more to fetch). Without the exhaustion check, the loop makes unnecessary API calls that all return the same result. The bound (`MAX_PAGES`) prevents unbounded calls to a paid external API.

*Practice question:* The loop runs with `MAX_PAGES = 5`, `TARGET_NEW = 10`. After 4 iterations, the actor has returned 8 new jobs and there are no more pages left. What does the loop do on iteration 4, and does it call the actor a 5th time?

---

### Concept 3 — JavaScript thenables

> "Explain the JavaScript thenable protocol. What makes an object 'thenable'? When you `await` an object that is not a Promise, what exactly does JavaScript check for? Give a concrete example of a chainable API object (like a query builder) that should resolve when awaited at any point in the chain. Show what property it needs and why that lets `await chain` work without calling `.single()`. Quiz me on the difference between awaiting a Promise and awaiting a plain object with a `then` method."

*What to listen for:* An object is thenable if it has a `.then(onFulfilled, onRejected)` method. `await x` calls `x.then(resolve, reject)` if `x.then` is a function. This is how `await` interoperates with non-standard Promise implementations — no need to extend the built-in `Promise` class.

*Practice question:* A mock chain has `.select = vi.fn().mockReturnValue(chain)` and no `.then` property. What does `await chain.select("*")` return?

---

### Concept 4 — Test seam selection

> "Explain what a 'test seam' is in a layered system. A seam is a point where one component can be replaced with a test double. Give a concrete example in a system with three layers: UI → API route → external actor. Why is the seam choice important — what can a seam at the UI layer test versus a seam at the API route layer? When should you place the seam at the closest correct layer to the bug? Quiz me."

*What to listen for:* A seam too close to the outside (UI layer for a route-control-flow bug) means the bug code path is never exercised. A seam at the correct layer tests the actual decision that is wrong. Misidentifying the seam is a common cause of tests that go green before the bug is actually fixed.

*Practice question:* A bug is in how many times a route calls an external actor. Which seam lets you assert on call count: the UI seam or the route handler seam?

---

### Concept 5 — Named constants vs. magic numbers

> "Explain the 'magic number' problem in programming. What makes a bare literal like `10` or `5` a magic number? Show how extracting it to a named constant like `TARGET_NEW = 10` improves the code, and explain why the name communicates something the number alone cannot. Give an example of a file where two different literal `10`s mean entirely different things. Quiz me on when to extract a constant versus when a literal is fine."

*What to listen for:* A magic number is a literal with no explanatory context. `for page <= 5` could mean anything — budget, page count, retry limit. `for page <= MAX_PAGES` announces the business decision it encodes. Named constants are also searchable: `grep TARGET_NEW` finds every relevant reference; `grep 10` finds hundreds of unrelated matches.

*Practice question:* Two literals `10` appear in the same file: `page * 10` (items per page) and `freshCount >= 10` (target new jobs). Why should only one become a named constant?

---

## Architecture overview

```
User clicks "Find Jobs" (same keyword, repeat search)
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│  Browser (FindJobsClient.tsx)                  [CLIENT]     │
│  handleSearch() → fetch POST /api/agent/find                │
└─────────────────────────────────────────────────────────────┘
          │ POST { jobTitle, location }
          ▼
┌─────────────────────────────────────────────────────────────┐
│  app/api/agent/find/route.ts                   [SERVER]     │
│                                                             │
│  1. auth + profile + agent_run insert                       │
│  2. existingByUrl ← SELECT jobs WHERE user_id+provider      │  ← MOVED before loop
│  3. for page 1..5:                                          │  ← NEW loop
│       allActorJobs ← discoverJobsDbJobs(maxPages=page)      │
│       freshCount = jobs not in existingByUrl                │
│       break if freshCount ≥ 10 OR actor < full page         │
│  4. dedup → newJobs → score → insert → events               │
│  5. return { jobs, newJobs, successMessage }                │
└─────────────────────────────────────────────────────────────┘
          │ calls (up to 5×)
          ▼
┌─────────────────────────────────────────────────────────────┐
│  Apify actor (jobsdb-hk-actor)             [EXTERNAL]       │
│  Always starts crawl at page 1.                             │
│  maxPages=1 → page 1 only (10 jobs)                         │
│  maxPages=2 → pages 1+2 cumulative, actor-deduplicated      │
└─────────────────────────────────────────────────────────────┘
```

**Key invariants:**
1. `existingByUrl` is built once before the loop — never inside it; each iteration checks freshness in-memory with zero extra DB calls.
2. The actor always returns pages 1..N cumulative — `allActorJobs` is **replaced** each iteration, not accumulated.
3. The loop exits on two conditions: `freshCount >= TARGET_NEW` (enough found) or `allActorJobs.length < page * 10` (source exhausted).

---

## Part 1 — The symptom: a valid success path masquerading as a bug

Open [`app/api/agent/find/route.ts`](../../../app/api/agent/find/route.ts) at lines 204–227:

```typescript
if (records.length === 0) {
  const displayJobs = uniqueJobsDbJobs
    .map((job) => existingByUrl.get(job.sourceUrl))
    .filter((job): job is Job => Boolean(job));

  // All discovered jobs already in DB — still mark run complete.
  await insforge.database
    .from("agent_runs")
    .update({
      status: "completed",
      jobs_found: totalFound,
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId)
    .eq("user_id", userId);

  return NextResponse.json({
    success: true,
    jobs: displayJobs,
    jobsFound: totalFound,
    newJobs: 0,
    successMessage: `Found ${totalFound} jobs — all already saved.`,
  });
}
```

This is Path A — the legitimate "no new jobs" response. It is not an error. The route returns `success: true`, the run is marked `completed`, and the display shows previously saved jobs. A user running their first search against a fresh keyword legitimately lands here too — if page 1 has all low-match or previously-saved jobs, Path A fires correctly.

The bug was not that Path A fires. The bug was that Path A fired on a repeat search when page 2 existed and contained new jobs — because the route only ever checked page 1. The path A response and the "genuinely exhausted" response are byte-for-byte identical to the client. The only layer that can distinguish them is one that controls what the actor returns.

> **System design — Seam testing:** The distinction between "Path A fires because there are no new jobs" and "Path A fires because the route never tried page 2" is invisible to the browser. Both return `success: true` with `newJobs: 0`. The only component that can detect the difference is a test at the route level, where the actor response is controllable. A UI test — even a thorough one — cannot distinguish these two paths.

**Checkpoint:** The diagnosing-bugs skill says to build a red-capable feedback loop before forming any hypothesis. Why is this ordering important — what failure mode does skipping it produce?

<details>
<summary>Reveal answer</summary>

Without a feedback loop, debugging is guessing. You pick the most plausible cause, make a change, and manually verify. The failure mode: anchoring bias. The first plausible idea gets disproportionate attention. You change it, manually check, and conclude the bug is gone — even if the real cause is elsewhere. With two interacting causes, you might fix one and conclude the bug is gone until a user hits the second cause.

A red-capable test catches the exact user symptom. When the test goes green, you know the symptom is gone. When it stays red after a fix, you know there's more to find. The test is not documentation of the fix — it is the diagnostic instrument. Reading code first turns debugging into navigation toward a predetermined destination rather than measurement toward an unknown cause.

</details>

**Checkpoint:** How do you distinguish between a legitimate "no new jobs" response and the pagination starvation bug? What made the regression test able to tell the difference?

<details>
<summary>Reveal answer</summary>

From the client's perspective, both are indistinguishable — same `success: true`, same `newJobs: 0`, similar message. The test made them distinguishable by controlling the actor mock: page-1 jobs were seeded into the DB mock, and the actor mock returned new jobs on page 2. In the bugged state, the route stops at page 1 and returns "all already saved." In the fixed state, the route calls the actor a second time and finds the page-2 jobs. The test checked call count, last-call arguments, `newJobs > 0`, and presence of `/job/p2-` URLs — assertions that only pass if the loop ran a second iteration.

</details>

**Checkpoint:** After the fix, `totalFound` in the success message can be 20 (pages 1+2) rather than 10 (page 1 only). Is surfacing "Found 20 jobs" correct, or should it still say "10 jobs found"?

<details>
<summary>Reveal answer</summary>

"Found 20 jobs" is correct. `totalFound = uniqueJobsDbJobs.length` — the total unique jobs the actor returned across all pages in this run. That is what "found" means: the actor discovered these listings. The user sees 10 newly saved + 10 previously saved, for 20 total. Saying "10 jobs" when the actor returned 20 would be misleading. The distinction is `totalFound` (actor discovered this run) vs. `newJobs` (saved this run). The message surfaces both: "Found 20 jobs and saved 10 new jobs."

</details>

---

## Part 2 — Seam selection: the route handler, not the frontend or the actor

Open [`__tests__/find-jobs/repeated-search.test.ts`](../../../__tests__/find-jobs/repeated-search.test.ts) at lines 15–19 and 152–158:

```typescript
import { POST } from "@/app/api/agent/find/route";
```

```typescript
function makePostRequest() {
  return new Request("http://localhost/api/agent/find", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobTitle: "Engineer", location: "Hong Kong" }),
  }) as unknown as Parameters<typeof POST>[0];
}
```

The test calls `POST` — the exported route handler function — directly. No running server, no HTTP stack, no browser. Three seam options existed:

**Seam 1 — Frontend (`FindJobsClient.tsx`):** Already covered by `seam.test.tsx`. The client correctly displays whatever the API returns. Even if the API always returned the same stale response, the client would render it faithfully. The bug was not in the client — the client's job is to show what it receives.

**Seam 2 — Route handler (chosen):** The `POST` function accepts a `Request` and returns a `Response`. All external dependencies — InsForge, the Apify actor, Nemotron, PostHog — are module-level imports that Vitest can replace with mocks. This is the closest correct seam to the bug: the loop that decides whether to call the actor again lives here.

**Seam 3 — Actor (`discoverJobsDbJobs`):** Could test that the function is called with the right arguments, but would not test the *route's decision to call it again*. A test at this seam would verify what arguments the actor receives — not whether the route ever decides to make a second call. It tests the fix in isolation from the decision logic that produces the fix.

The principle: pick the seam closest to where the wrong decision is made. The wrong decision was in the route handler — call the actor exactly once. The seam had to encompass that decision.

> **System design — Test seam selection:** A seam is a boundary where one component can be replaced with a test double without changing the component under test. The seam choice determines what code is exercised. A seam too far outside (UI) exercises only rendering; a seam too far inside (actor args) exercises only wiring. The correct seam for a control-flow bug is at the layer where the wrong control flow decision is made.

**Checkpoint:** Why is the route handler seam more appropriate than a seam at `discoverJobsDbJobs` for this bug?

<details>
<summary>Reveal answer</summary>

A seam at `discoverJobsDbJobs` lets you assert that the function received certain arguments — but it cannot test whether the route *decided* to call it a second time. In the bugged state, `discoverJobsDbJobs` is called once. A test at this seam that asserts "called once" would pass before the fix. A test that asserts "called twice" would fail before the fix — but when it goes green, it only confirms the argument was passed, not that the control-flow loop is correct. The route handler seam exercises the complete decision path: all five assertions (call count, final arguments, `newJobs`, message, page-2 URLs) come from the same `POST()` call. The actor seam would require a separate test per assertion.

</details>

**Checkpoint:** How do you decide whether to test at the unit, integration, or end-to-end level when diagnosing a bug?

<details>
<summary>Reveal answer</summary>

The deciding factor is: where does the bug's decision live, and what is the minimum set of real code that exercises that decision? This bug's decision lives in the route handler's control flow. The route handler is a function that takes a `Request`, calls injectable dependencies, and returns a `Response`. All dependencies are module-level mocks — no server needed, no HTTP stack. That makes a direct function call with mocked deps the tightest correct seam: fast (~10ms), deterministic, and agent-runnable. An e2e test would catch the same bug but would take 60+ seconds, require a live Apify actor, and be non-deterministic. The rule: go as close to the bug as the architecture allows, as long as you still exercise the buggy code path.

</details>

**Checkpoint:** This test runs in ~10ms with everything mocked. What does it verify that a real integration test wouldn't — and vice versa?

<details>
<summary>Reveal answer</summary>

The mocked test verifies: control-flow correctness — that the route makes the right number of calls with the right arguments given predictable actor responses. It cannot verify: actor behaviour (does the real Apify actor return cumulative pages?), real InsForge behaviour (does the DB query return actual rows?), or timing (does the route complete within `maxDuration = 300`)?

A real integration test verifies the opposite: actual data flows end-to-end, but it cannot cheaply control the actor's response to simulate a repeat-search scenario with a known DB state. The mocked test owns "the route makes the right decisions"; the integration test owns "the system produces correct end-user outcomes." For diagnosing a control-flow bug, the mocked test is the right starting point.

</details>

**Checkpoint:** The test was written before reading the code to form a hypothesis. Why is this ordering important — what cognitive bias does it protect against?

<details>
<summary>Reveal answer</summary>

Writing the test first protects against anchoring bias: the tendency to latch onto the first plausible explanation and fit all subsequent evidence to it. When you read code and form a hypothesis first, you look for code that confirms the hypothesis rather than code that falsifies it. The test forces a different question: "what is the exact user symptom?" rather than "what might cause it?" The test then becomes a measuring instrument — when the fix is right, the test goes green; when it's wrong, the test stays red. Reading code first turns debugging into navigation toward a predetermined destination rather than measurement toward an unknown cause.

</details>

---

## Part 3 — The actor always re-fetches page 1

Open [`apify/jobsdb-hk-actor/src/main.ts`](../../../apify/jobsdb-hk-actor/src/main.ts) at lines 188–196:

```typescript
// Page advancement — only if budget remains
if (currentPage < maxPages && seenUrls.size < maxItems) {
  await addRequests([{
    url: jobsDbSearchUrl(query, location, currentPage + 1),
    label: "SEARCH",
    userData: { query, location, page: currentPage + 1 },
  }]);
}
```

The actor's crawl is always seeded at page 1. `maxPages` controls how many pages the actor visits in a single run — pages 1 through `maxPages` — starting from 1 every time. The actor maintains a `seenUrls` set that deduplicates within a single run, but each new actor call is a fresh run with a fresh `seenUrls`.

The implication for the pagination loop:

- Iteration 1: `maxPages=1` → actor returns page 1 only (≤10 jobs).
- Iteration 2: `maxPages=2` → actor returns pages 1+2 combined, actor-deduplicated (≤20 jobs).
- Iteration 3: `maxPages=3` → actor returns pages 1+2+3, actor-deduplicated (≤30 jobs).

On each iteration, the actor re-fetches page 1. The route's `existingByUrl` Map filters out page-1 jobs that were already in the DB before the loop started — so only jobs from the newly-added pages contribute to `freshCount`. The cost is one extra page-1 fetch per loop iteration, bounded by `MAX_PAGES = 5`.

> **Algorithms — Fetch-until-enough loop:** A fetch-until-enough loop is a bounded polling pattern with two exit conditions: target satisfied (`freshCount >= TARGET_NEW`) and source exhausted (`allActorJobs.length < page * 10`). The loop stops as soon as either condition is true. Without the source-exhausted check, the loop would call the actor `MAX_PAGES` times even when the actor ran out of new listings after page 2. The `MAX_PAGES` bound prevents unbounded calls to a paid external service. This pattern appears wherever a paginated API doesn't support cursor-based resumption: you restart from the beginning and use a freshness check to identify where new content begins.

**Checkpoint:** The actor can't start from page 2. When you call with `maxPages=2`, it re-fetches page 1 plus page 2. Is this wasteful? What would the alternative design cost?

<details>
<summary>Reveal answer</summary>

It is mildly wasteful in Apify credits — page 1 is fetched on every loop iteration. The alternative design (a stateful actor that accepts a `startPage` parameter) would require: persisting crawl state between runs, handling cases where page-1 content has shifted since the last call, and adding a `startPage` input to the actor schema. Given that `MAX_PAGES = 5`, the worst case is fetching pages 1+2+3+4+5 on iteration 5 — but in the typical repeat-search case, the loop exits after iteration 2 (page 2 has fresh results). The cost is at most one wasted page-1 fetch per iteration, bounded by 5 total iterations. That's acceptable for the simplicity gained by not needing to maintain actor-side resumption state.

</details>

**Checkpoint:** The exhaustion signal is `allActorJobs.length < page * 10`. Why is this the right heuristic? What edge case does it miss, and does that edge case matter?

<details>
<summary>Reveal answer</summary>

If the actor returned fewer than `page * 10` total jobs, it means the last page wasn't full — JobsDB had fewer than 10 results on that final page, so there are no more listings to fetch. The heuristic is correct in the common case.

The edge case it misses: if the final page happens to have exactly 10 results, `allActorJobs.length === page * 10` is true and the loop continues. The next call returns ≤ the same results (nothing new from the non-existent next page), `freshCount` doesn't increase, and the loop continues to exhaustion or `MAX_PAGES`. No correctness issue — just at most one extra wasted actor call. Given `MAX_PAGES = 5` already caps the maximum, this costs at most one additional call, which is acceptable.

</details>

**Checkpoint:** If JobsDB changes its page size from 10 to 20 results per page, which part of the system breaks first? How would you detect this in production?

<details>
<summary>Reveal answer</summary>

The exhaustion signal `allActorJobs.length < page * 10` would break: the system would exit early when the actor returns 15 items (treating it as a partial page), when in a 20-item world 15 is genuinely partial — but the signal was calibrated for 10-item pages, so `15 < 1 * 10` is false on iteration 1, `15 < 2 * 10` is true on iteration 2. The early exit might coincidentally be correct, but for 20-item pages the signal should be `< page * 20`. Detection in production: monitor `totalFound` per search. If it drops from ~20 to ~10 on searches that previously returned more, the page-size heuristic has drifted from the API's actual behaviour.

</details>

---

## Part 4 — `existingByUrl` as a pre-loop snapshot

Open [`app/api/agent/find/route.ts`](../../../app/api/agent/find/route.ts) at lines 79–108:

```typescript
// URL-based deduplication: build existingByUrl BEFORE the actor loop so
// each iteration can check freshness without an extra DB round-trip.
const existingJobsResult = await insforge.database
  .from("jobs")
  .select("*")
  .eq("user_id", userId)
  .eq("source_provider", "jobsdb_hk");

if (existingJobsResult.error) {
  console.error("[api/agent/find] existing jobs query error:", existingJobsResult.error);
  await insforge.database
    .from("agent_runs")
    .update({ status: "failed", completed_at: new Date().toISOString() })
    .eq("id", runId)
    .eq("user_id", userId);
  return NextResponse.json(
    { success: false, error: "Could not check saved jobs" },
    { status: 500 },
  );
}

// InsForge's dynamic query surface does not expose table generics here;
// the selected columns are the full jobs table row shape.
const existingJobs = (existingJobsResult.data ?? []) as Job[];
const existingByUrl = new Map<string, Job>();
for (const job of existingJobs) {
  if (job.source_url) {
    existingByUrl.set(job.source_url, job);
  }
}
```

This block was originally placed after the actor call. The fix moved it here — before the loop — for three reasons:

**One DB query, zero per-iteration round-trips.** If `existingByUrl` were rebuilt inside each loop iteration, 5 iterations would produce 5 SELECT queries, each adding 50–200ms of latency. Moved up: one query, used across all iterations via in-memory Map lookup.

**Fail early, before paying for actor calls.** If the DB query fails, the route marks the run failed and returns before spending Apify credits on any actor run. In the original ordering, the route spent credits first, then failed on the DB query.

**`freshCount` needs the snapshot inside the loop.** The loop checks freshness per iteration to decide whether to continue. Without `existingByUrl`, there is no freshness signal — the loop would have to either always run all `MAX_PAGES` iterations (wasteful) or query the DB per iteration (expensive).

The snapshot is treated as immutable for the duration of the loop. The only write that happens inside the loop is the actor call — no DB inserts occur until after the loop exits. The snapshot therefore stays accurate throughout all iterations.

> **Data structures — Hash Map (O(1) lookup):** `existingByUrl` is a `Map<string, Job>` keyed by canonical URL. Each freshness check — `existingByUrl.has(j.sourceUrl)` — is O(1) regardless of how many jobs are in the DB. The equivalent array scan — `existingJobs.some(j => j.source_url === url)` — is O(n): for each actor job, it scans all DB jobs linearly. With 1,000 existing jobs and 50 actor jobs, the Map version costs 50 lookups total; the array scan costs up to 50,000 comparisons. The Map is the standard solution when you need repeated membership checks over a fixed set.

**Checkpoint:** Why was `existingByUrl` moved before the actor loop rather than being queried inside each loop iteration? What does moving it up cost, and what does it gain?

<details>
<summary>Reveal answer</summary>

Cost of moving: one DB query at startup, before any actor call. If the user has no saved jobs, this is a lightweight empty-result query — negligible. The gain: (1) zero additional DB round-trips across all loop iterations — each iteration does an in-memory lookup instead of a round-trip; (2) fail-fast before paying Apify credits if the DB is unavailable; (3) a clean freshness signal inside the loop that doesn't require re-querying.

The alternative — querying inside each iteration — would cost one DB round-trip per iteration, adding 50–200ms per call in a loop that might run 5 times. More importantly, the query result would be identical across iterations (the DB doesn't change between actor calls — no inserts happen inside the loop), so the extra queries buy nothing. Redundant round-trips to satisfy a fixed snapshot is pure waste.

</details>

**Checkpoint:** The loop exits when `freshCount >= TARGET_NEW`. `freshCount` is computed from `allActorJobs` (cumulative pages 1..N). Could `freshCount` ever decrease between iterations? Why or why not?

<details>
<summary>Reveal answer</summary>

No. `allActorJobs` is replaced each iteration — iteration 2 returns pages 1+2, iteration 3 returns pages 1+2+3. Because the actor returns cumulative, deduplicated results, iteration N's results are always a superset of iteration N-1's results. The page-1 jobs appear in every subsequent iteration. Since `existingByUrl` is a fixed pre-loop snapshot that doesn't grow during the loop (no DB inserts happen inside the loop), a URL that was not in `existingByUrl` at iteration 1 cannot become "existing" by iteration 3. Therefore `freshCount` is non-decreasing across iterations — once a URL is counted as fresh, it stays fresh.

</details>

---

## Part 5 — The fetch-until-enough loop

Open [`app/api/agent/find/route.ts`](../../../app/api/agent/find/route.ts) at lines 110–144:

```typescript
// Paginate the actor until we have ≥TARGET_NEW jobs not already in the DB,
// or we exhaust MAX_PAGES pages. Each iteration calls the actor with an
// increasing maxPages so it returns pages 1..N cumulatively (actor dedupes
// within its own run via seenUrls). We stop early when the actor returns
// fewer than a full page (no more listings available).
const TARGET_NEW = 10;
const MAX_PAGES = 5;
let allActorJobs: JobsDbJob[] = [];
let jobsDbError: Error | null = null;

for (let page = 1; page <= MAX_PAGES; page++) {
  try {
    allActorJobs = await discoverJobsDbJobs(jobTitle, location, page * 10, page);
  } catch (err) {
    jobsDbError = err as Error;
    break;
  }
  const freshCount = allActorJobs.filter(
    (j) => j.sourceUrl && !existingByUrl.has(j.sourceUrl),
  ).length;
  if (freshCount >= TARGET_NEW || allActorJobs.length < page * 10) break;
}

if (jobsDbError) {
  console.error("[api/agent/find] jobsdb error:", jobsDbError);
  await insforge.database
    .from("agent_runs")
    .update({ status: "failed", completed_at: new Date().toISOString() })
    .eq("id", runId)
    .eq("user_id", userId);
  return NextResponse.json(
    { success: false, error: "Job search failed. Please try again." },
    { status: 500 },
  );
}
```

Four design decisions in this block:

**1. `j.sourceUrl &&` in the freshCount filter.** This mirrors the identical guard in the downstream `newJobs` filter at line 157. An actor result can have an empty `sourceUrl` if the job card link extraction failed. Without the guard, an empty string passes `!existingByUrl.has("")` (the Map has no empty-string key) and inflates `freshCount` — making the loop exit early thinking it found new jobs when it actually found empty-URL results that can't be saved.

**2. Two exit conditions, not one.** `freshCount >= TARGET_NEW` exits on success. `allActorJobs.length < page * 10` exits on exhaustion. Without the second condition, the loop would run all `MAX_PAGES` iterations even when the actor ran out of listings after page 2 — paying for three unnecessary actor calls that all return the same result.

**3. Two-phase error handling: `break` then check.** The `catch` block sets `jobsDbError` and breaks rather than re-throwing. Why not re-throw inside `catch`? Re-throwing inside the loop would propagate up past the `if (jobsDbError)` block and into the outer `try/catch` at line 300. That outer catch returns a generic "Internal server error" — no `agent_runs` status update, no specific message. The two-phase pattern keeps both the specific "Job search failed" message and the `agent_runs.status = "failed"` update in one explicit place.

**4. Named constants `TARGET_NEW = 10` and `MAX_PAGES = 5`.** The original code accepted `maxPages` from the client request body — but the client never sent it (defaulting to 1). Removing client control eliminates a confusing API surface: why would a client dictate how many Apify pages to fetch? It also prevents a client from accidentally sending `maxPages=0` (a no-op search) or `maxPages=100` (a runaway expensive call).

> **System design — Named constants:** `TARGET_NEW` and `MAX_PAGES` are not magic numbers — they are business decisions. `TARGET_NEW = 10` says "a successful search saves up to 10 new jobs per click." `MAX_PAGES = 5` says "we are willing to spend up to 5 Apify pages per search." Making these constants named and co-located means: they are searchable in the codebase (`grep TARGET_NEW` vs. `grep 10`), their purpose is self-documenting, and they can be changed in one place if the business decision changes.

**Checkpoint:** `TARGET_NEW = 10` and `MAX_PAGES = 5` are now server-side constants. The original code accepted `maxPages` from the client. Why is removing client control the right move? When would you want the client to control this parameter?

<details>
<summary>Reveal answer</summary>

Removing client control is right here because the client has no business context for how many Apify pages to fetch. The client's concern is "give me relevant jobs"; the server's concern is "stay within cost and time budgets." Exposing `maxPages` to the client creates a surface where a bug, a malicious user, or a UI typo could request 0 pages (no-op) or 100 pages (expensive runaway).

The scenario where client control is appropriate: when different users have legitimately different needs the server cannot predict — for example, a "power search" vs. "quick search" mode. Even then, the client would send a semantic parameter (`depth: "deep"`) rather than an implementation detail (`maxPages: 5`), and the server would translate that to actor arguments, applying its own budget constraints.

</details>

**Checkpoint:** The loop uses `break` when an error occurs, then checks `jobsDbError` after the loop. Why not re-throw immediately inside the `catch` block?

<details>
<summary>Reveal answer</summary>

Re-throwing inside `catch` would cause the error to propagate up through the loop, past the `if (jobsDbError)` block, and into the outer `try/catch` at the bottom of `POST`. That outer catch returns a generic 500 with "Internal server error" — neither a specific message nor an `agent_runs` status update. The two-phase pattern keeps both the specific "Job search failed. Please try again." message and the `agent_runs.status = "failed"` write in one explicit, traceable location. It also means any cleanup inside `if (jobsDbError)` is guaranteed to run — unlike a re-throw that might bypass intermediate cleanup in future code.

</details>

**Checkpoint:** The fix was described as "minimal change" — only control flow changed, not scoring, saving, or response shape. Why is minimalism the right principle for a bug fix?

<details>
<summary>Reveal answer</summary>

A bug fix proves exactly one thing: the symptom is gone. A cleanup-while-you're-there adds a second thing: the cleanup is correct and has no regressions. These are easier to verify independently than together. A minimal fix has exactly one reason to fail after it's applied: the fix is wrong. A fix plus cleanup has two reasons to fail: the fix is wrong, or the cleanup introduced a regression. When a test fails after the fix, you know the fix is the cause — not an unrelated change. In code review, a minimal fix is easier to reason about: every changed line serves the fix, nothing else. Cleanup belongs in its own separate commit with its own test coverage.

</details>

---

## Part 6 — The thenable mock: making chains directly awaitable

Open [`__tests__/find-jobs/repeated-search.test.ts`](../../../__tests__/find-jobs/repeated-search.test.ts) at lines 50–64:

```typescript
function createChain(resolvedValue: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {};
  for (const m of ["select", "insert", "update", "delete", "eq"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.maybeSingle = vi.fn().mockResolvedValue(resolvedValue);
  chain.single = vi.fn().mockResolvedValue(resolvedValue);
  // Make the chain directly awaitable (thenable).
  chain.then = (
    onFulfilled: (v: unknown) => unknown,
    onRejected?: (r: unknown) => unknown,
  ) => Promise.resolve(resolvedValue).then(onFulfilled, onRejected);
  return chain;
}
```

InsForge query chains can be awaited at any point without calling a terminal method like `.single()`. The existing jobs query illustrates this:

```typescript
const existingJobsResult = await insforge.database
  .from("jobs")
  .select("*")
  .eq("user_id", userId)
  .eq("source_provider", "jobsdb_hk");
// ↑ directly awaited — no .single()
```

`await x` does not require `x` to be a native Promise. JavaScript's `await` operator checks whether the value has a `.then` method. If it does, `await x` calls `x.then(resolve, reject)`. This is the **thenable protocol**: any object with a `then(onFulfilled, onRejected)` method can be `await`ed as if it were a Promise.

Without `chain.then`, `await chain.select("*").eq("user_id", userId)` returns `chain` — the mock object itself — rather than `{ data: existingJobs, error: null }`. The route then tries to read `chain.error` and `chain.data`, both of which would be `undefined`, and the test fails for the wrong reason: bad mock data, not the control-flow bug under test.

Adding `chain.then` makes the mock object behave exactly like a real InsForge chain. `.maybeSingle()` and `.single()` still work as explicit terminal methods, and direct `await` also works.

> **Language — JavaScript thenable protocol:** The thenable protocol is a duck-typed extension of Promises: any object with a `then(onFulfilled, onRejected)` method is a thenable. `await x` resolves a thenable by calling `x.then(resolve, reject)`. This protocol exists so that non-standard Promise implementations — Bluebird, jQuery Deferred, database query builders — interoperate with native `await` without having to inherit from the built-in `Promise` class. It is also why `Promise.resolve(thenable)` does not wrap the thenable in a second Promise — it calls `thenable.then` instead, assimilating the thenable into the Promise chain.

**Checkpoint:** What is the JavaScript thenable protocol, and how does `await` use it differently from `await`-ing a plain non-thenable object?

<details>
<summary>Reveal answer</summary>

The thenable protocol: if an object has a `then` property that is a function, JavaScript's `await` calls `x.then(resolve, reject)` to schedule resolution — the same call it makes on a native Promise. For a plain object without `then` (e.g., `{ data: null, error: null }`), `await x` immediately resolves with the object itself, wrapped in `Promise.resolve(x)`.

The difference matters for mock chains: without `chain.then`, `await chain.select(...)` returns the chain object. With `chain.then = (onFulfilled, onRejected) => Promise.resolve(resolvedValue).then(onFulfilled, onRejected)`, `await chain.select(...)` returns `resolvedValue`. The chain becomes a valid test double for any InsForge query chain that is awaited at any method in the chain.

</details>

**Checkpoint:** The test mocks `scoreJobs` to return `matchScore: 50` (below the 70 threshold). Why does this simplify the mock? What would break if `matchScore: 80` were used instead?

<details>
<summary>Reveal answer</summary>

`matchScore: 50` keeps all scores below `MATCH_THRESHOLD = 70`, so no `job_found` PostHog events are fired. The route loops over `insertedJobs` and calls `captureServerEvent("job_found")` for each job above the threshold. With `matchScore: 80`, every one of the 10 inserted jobs would trigger a `captureServerEvent` call — the mock would need to handle 10 async event calls and the test would need to assert on their count (or risk them interfering with mock state). Using `matchScore: 50` sidesteps this entirely: `captureServerEvent` is still mocked, but only the `job_search_started` call fires. The test remains focused on the control flow under test (loop iterations, new job count) without entangling the PostHog event system.

</details>

---

## Part 7 — Per-table call counting: mocks resilient to fix-induced reordering

Open [`__tests__/find-jobs/repeated-search.test.ts`](../../../__tests__/find-jobs/repeated-search.test.ts) at lines 69–105:

```typescript
function buildInsforgeMock(existingJobs: Job[], insertResult: Job[]) {
  const callCounts: Record<string, number> = {};

  return {
    auth: {
      getCurrentUser: vi.fn().mockResolvedValue({
        data: { user: { id: "user-1" } },
        error: null,
      }),
    },
    database: {
      from: vi.fn().mockImplementation((table: string) => {
        callCounts[table] = (callCounts[table] ?? 0) + 1;
        const n = callCounts[table];

        if (table === "profiles") {
          return createChain({ data: null, error: null });
        }
        if (table === "agent_runs") {
          // 1st call: insert([...]).select().single()
          // 2nd call: update({...}).eq().eq()  — direct await
          return n === 1
            ? createChain({ data: { id: "run-1" }, error: null })
            : createChain({ error: null });
        }
        if (table === "jobs") {
          // 1st call: select("*").eq().eq()  — direct await (existingByUrl query)
          // 2nd call: insert([...]).select() — direct await (new-jobs insert)
          return n === 1
            ? createChain({ data: existingJobs, error: null })
            : createChain({ data: insertResult, error: null });
        }
        return createChain({ data: null, error: null });
      }),
    },
  };
}
```

The mock tracks call count *per table name* (`callCounts["jobs"]`, `callCounts["agent_runs"]`) rather than tracking absolute call order across all `from()` calls.

The reason: the fix reorders the calls. Before the fix:

```
from("profiles") → from("agent_runs") insert → (actor) → from("jobs") select → from("agent_runs") update
```

After the fix:

```
from("profiles") → from("agent_runs") insert → from("jobs") select → (actor loop) → from("jobs") insert → from("agent_runs") update
```

`from("jobs") select` moved from position 4 to position 3. An absolute-position mock — "3rd `from()` call gets this chain" — would return the wrong data in the RED state and the right data in the GREEN state, making the test fail for the wrong reason: "mock returned bad data" instead of "actor called once." That masks the bug.

Per-table counting is resilient to interleaving: as long as "first `from("jobs")` = select, second `from("jobs")` = insert" remains semantically stable, the mock survives the reorder.

**Checkpoint:** Why does the DB mock use per-table call counting rather than absolute call order? What would break if it used absolute order?

<details>
<summary>Reveal answer</summary>

In the RED state (before the fix), `from("jobs")` is the 4th `from()` call overall. In the GREEN state (after the fix), it is the 3rd. An absolute-order mock that returns `existingJobs` for the 3rd call overall would return `existingJobs` for `from("agent_runs")` insert in the RED state — the wrong data, causing `run.data` to be `{ data: existingJobs }` instead of `{ data: { id: "run-1" } }`. The route would fail at `const runId = run.id` with `undefined`, throwing an error — and the test would fail for the wrong reason (mock data error, not the bug).

Per-table counting is decoupled from interleaving with other tables. The first `from("jobs")` call always returns `existingJobs`, regardless of how many `from("agent_runs")` or `from("profiles")` calls preceded it. The test correctly goes RED because the actor is called only once, not because the mock fed wrong data.

</details>

**Checkpoint:** The test uses `vi.mocked(discoverJobsDbJobs).mockReset()` in `beforeEach`. Why `mockReset()` specifically, rather than `mockClear()` or `mockRestore()`?

<details>
<summary>Reveal answer</summary>

- `mockClear()` — clears call history (`.mock.calls`, `.mock.results`) but preserves the mock's return-value implementations. If the previous test set `mockResolvedValueOnce(page1ActorJobs)`, those queued values survive into the next test, interfering with the next test's setup.

- `mockReset()` — clears both call history AND all queued/default return-value implementations. The mock returns `undefined` until configured. `beforeEach` then sets fresh `mockResolvedValueOnce` values for each test from a clean slate.

- `mockRestore()` — removes the mock entirely, restoring the original module export. This is for `vi.spyOn` mocks created per-test. Here the mock was created by top-level `vi.mock("@/agent/jobsdb", ...)` — `mockRestore()` would break subsequent tests by removing the mock from the module system.

`mockReset()` is correct in `beforeEach` when each test independently configures a fresh return-value sequence.

</details>

---

## Full data flow: a repeat search that escapes "all already saved"

This trace follows a second "Find Jobs" click with the same keyword after 10 page-1 jobs are already saved.

**1. User clicks "Find Jobs"** ([`components/find-jobs/FindJobsClient.tsx`](../../../components/find-jobs/FindJobsClient.tsx))
`handleSearch()` fires. `setIsLoading(true)`. `fetch POST /api/agent/find` with `{ jobTitle: "Engineer", location: "Hong Kong" }`.

**2. Auth + profile + run insert** (`route.ts:16–71`)
`getCurrentUser()` validates the session. A row is inserted into `agent_runs` with `status: "running"`. `captureServerEvent("job_search_started")` fires.

**3. `existingByUrl` built from DB** (`route.ts:81–108`)
One SELECT against `jobs` where `user_id` and `source_provider = "jobsdb_hk"` returns 10 rows (page-1 jobs from the first search). A `Map<string, Job>` is built: 10 entries keyed by `source_url`.

**4. Loop iteration 1: `page=1`, `maxPages=1`** (`route.ts:120–131`)
`discoverJobsDbJobs("Engineer", "Hong Kong", 10, 1)` calls the actor.
Actor returns 10 jobs — all matching `existingByUrl` keys.
`freshCount = 0`. Neither exit condition met (`0 < 10`, `10 === 1 * 10`). Loop continues.

**5. Loop iteration 2: `page=2`, `maxPages=2`** (`route.ts:120–131`)
`discoverJobsDbJobs("Engineer", "Hong Kong", 20, 2)` calls the actor.
Actor returns 20 jobs — pages 1+2 combined, actor-deduplicated. 10 are page-1 jobs (in `existingByUrl`). 10 are page-2 jobs (not in `existingByUrl`).
`freshCount = 10`. `freshCount >= TARGET_NEW` → `break`.

**6. Dedup** (`route.ts:147–154`)
`uniqueJobsDbJobs` filters `allActorJobs` for unique `sourceUrl` — 20 jobs. (The actor already deduplicated within its run, but this is a defensive pass.)

**7. Filter new jobs** (`route.ts:156–158`)
`newJobs = uniqueJobsDbJobs.filter(j => !existingByUrl.has(j.sourceUrl))` — 10 jobs (the page-2 ones). Page-1 jobs are excluded from saving.

**8. Score** (`route.ts:163–166`)
`scoreJobs(newJobs.map(toScoringInput), profile)` returns 10 score objects via Nemotron.

**9. Insert 10 new jobs** (`route.ts:230–234`)
`from("jobs").insert(records).select()` saves 10 rows. `insertedJobs` is the 10 new DB rows with assigned IDs.

**10. `agent_runs` marked complete** (`route.ts:282–290`)
`from("agent_runs").update({ status: "completed", jobs_found: 20, ... })`.

**11. Response returned** (`route.ts:292–299`)
```json
{
  "success": true,
  "jobs": [20 display jobs — 10 old + 10 new],
  "jobsFound": 20,
  "newJobs": 10,
  "successMessage": "Found 20 jobs and saved 10 new jobs."
}
```

**12. Client updates** ([`components/find-jobs/FindJobsClient.tsx`](../../../components/find-jobs/FindJobsClient.tsx))
`setJobs(data.jobs)` — table shows all 20 jobs. `setSearchStatus({ message: "Found 20 jobs and saved 10 new jobs." })` — green banner appears. `finally` block: `setIsLoading(false)` — button re-enables.

---

## Extend it (challenges)

### Challenge 1 — Trace the actor arguments across all 5 loop iterations (15–20 min)

Assume `MAX_PAGES = 5`, `TARGET_NEW = 10`. The DB has 40 jobs already saved from four prior searches (pages 1–4). Trace through the loop manually:

- What arguments does each call to `discoverJobsDbJobs` receive?
- What does `freshCount` equal after each iteration?
- Which iteration triggers the `break`, and on which condition?

Write your trace as a table:

```
| iteration | maxItems | maxPages | allActorJobs.length | freshCount | exits? |
```

Then answer: what does `totalFound` equal in the final response, and how does it compare to `newJobs`?

<details>
<summary>Hint</summary>

The actor returns cumulative pages. `maxItems = page * 10`. With 40 jobs already in DB (pages 1–4), page 5 is the first source of fresh content. Iteration 5 calls `discoverJobsDbJobs(query, loc, 50, 5)`, actor returns pages 1–5 combined (50 jobs). 40 of these are in `existingByUrl`. 10 are from page 5. `freshCount = 10`. Break on `freshCount >= TARGET_NEW`. `totalFound = 50` (all unique actor jobs), `newJobs = 10` (the page-5 saves).

</details>

---

### Challenge 2 — Add a `skipPages` starting hint to reduce redundant fetches (20–30 min)

The current loop always fetches from page 1 because the actor does. Suppose the actor gains a `startPage` input parameter that lets it skip to a specific page. Design the change in the route:

1. How would `agent/jobsdb.ts`'s `discoverJobsDbJobs` signature change?
2. How would the loop use `Math.floor(existingByUrl.size / 10)` as a starting page hint?
3. How would the exhaustion signal `allActorJobs.length < page * 10` change when the actor no longer fetches from page 1?
4. What happens if `existingByUrl.size` is not evenly divisible by 10 — for example, 13 saved jobs?

Write out the new loop code (no need to implement the actor change).

<details>
<summary>Hint</summary>

`startPage = Math.floor(existingByUrl.size / 10)` — the floor gives the last full page already saved. 13 saved jobs → `startPage = 1` (start requesting from page 2). The loop starts at `page = startPage + 1`. The exhaustion signal becomes `allActorJobs.length < (page - startPage) * 10` — the actor returns `page - startPage` pages, so a full result from iteration 1 would have `10` items. Watch for `startPage = 0` (no existing jobs): the loop should start at page 1 as before.

</details>

---

### Challenge 3 — Design a fix for the concurrent-search race condition (30–45 min)

The code has a known deferred issue documented in `memory.md`: two concurrent POST requests from the same user can both read `existingByUrl` before either inserts, then both insert the same page-2 jobs, creating duplicates. Design a fix:

1. What DB-level mechanism prevents two simultaneous inserts of the same `(user_id, source_url)` pair? Write the SQL.
2. How should the route handle an insert error caused by a unique constraint violation — fatal error or graceful partial success?
3. What Postgres error code identifies a unique constraint violation, and how do you detect it in the insert error object?
4. Sketch the test: what does the `from("jobs").insert()` chain mock return to simulate a constraint violation, and what does the test assert?

<details>
<summary>Hint</summary>

`ALTER TABLE jobs ADD CONSTRAINT jobs_user_source_url_unique UNIQUE (user_id, source_url)` prevents DB-level duplicates. Postgres error code `23505` = unique_violation. The route should treat `23505` as a partial success: some rows were saved by the concurrent request. Continue with `insertedJobs = []` (or re-query to get saved rows) and return `success: true` rather than a 500. Test mock: make the `from("jobs")` insert chain's `then` property reject with `{ code: "23505", message: "duplicate key" }`. Assert the route returns `success: true`.

</details>

---

For deeper exploration, `docs/diagnosing-bugs/find-jobs-repeated-search/ai-discussion-topics.md` has 21 prompts across 5 groups: the feedback loop, the Apify actor pagination model, the fix's control flow, mocking strategies, and diagnosing-bugs methodology. Feed them to an LLM *after* forming your own answer first — the gap between what you thought and what you learn is where understanding lands.
