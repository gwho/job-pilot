# Feedback Loop — Find Jobs Repeated-Search Bug

## The bug

Clicking "Find Jobs" twice with the same keyword and location returned:

```
"Found 10 jobs — all already saved."
```

The table showed the same 10 results from the first search. No new jobs were ever
discovered, regardless of how many times the user searched.

---

## Phase 1 — Building the feedback loop

**Seam chosen:** Direct call to the `POST` route handler from a Vitest test,
with all external dependencies mocked. This was the tightest seam that reached
the actual bug code path — the frontend was already correct (it displays whatever
the API returns).

**Why not a curl/integration test:** The actor call is expensive and non-deterministic
in a real environment. A mocked unit test runs in ~10ms and fails on the exact symptom.

**Mock architecture for `__tests__/find-jobs/repeated-search.test.ts`:**

Four modules mocked at the top level (hoisted by Vitest before imports):

```typescript
vi.mock("@/lib/insforge-server", () => ({ createInsforgeServer: vi.fn() }));
vi.mock("@/agent/jobsdb", () => ({
  discoverJobsDbJobs: vi.fn(),
  toScoringInput: (j) => ({ title: j.title, company: j.company, ... }),
}));
vi.mock("@/agent/job-matcher", () => ({ scoreJobs: vi.fn() }));
vi.mock("@/lib/posthog-server", () => ({
  captureServerEvent: vi.fn().mockResolvedValue(undefined),
}));
```

**DB chain builder helper:** InsForge query chains are deeply nested
(`.from().select().eq().eq()` awaited directly). A `createChain(resolvedValue)`
helper makes every chain method return `this`, and adds a `then` property so the
chain resolves correctly when directly awaited without a terminal `.single()`.

```typescript
function createChain(resolvedValue: unknown) {
  const chain: Record<string, any> = {};
  for (const m of ["select", "insert", "update", "delete", "eq"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.maybeSingle = vi.fn().mockResolvedValue(resolvedValue);
  chain.single = vi.fn().mockResolvedValue(resolvedValue);
  chain.then = (onFulfilled, onRejected) =>
    Promise.resolve(resolvedValue).then(onFulfilled, onRejected);
  return chain;
}
```

The `buildInsforgeMock` function tracked call counts per table name, returning
different chains for the first and second `from("jobs")` call (select vs insert).

**Scenario:**
- `existingJobs` = 10 DB rows with `source_url: "https://hk.jobsdb.com/job/p1-{i}"`
- Actor mock, call 1 (`maxPages=1`): returns those same 10 URLs
- Actor mock, call 2 (`maxPages=2`): returns pages 1+2 combined (10 old + 10 new)

**Five assertions — all RED on current code:**

| Assertion | Current result |
|---|---|
| `discoverJobsDbJobs` called 2× | Called 1× |
| Last call args: `(query, loc, 20, 2)` | Last call args: `(query, loc, 10, 1)` |
| `data.newJobs > 0` | `data.newJobs === 0` |
| `successMessage` ≠ "all already saved" | `"Found 10 jobs — all already saved."` |
| Response includes `/job/p2-` URLs | No page-2 URLs |

All five confirmed RED in a single test run before any fix was applied.

---

## Phase 2 — Root cause

Reading `app/api/agent/find/route.ts` line 84:

```typescript
jobsDbJobs = await discoverJobsDbJobs(jobTitle, location, maxPages * 10, maxPages);
```

`maxPages` defaults to `1` (the client never sends it). The Apify actor always starts
from page 1 and fetches exactly `maxPages` pages. Every search with the same keyword
yields the same page-1 results. After the first search those 10 jobs are in the DB,
so `records.length === 0` on every subsequent search → path A → "all already saved."

**Actor constraint confirmed from source (`apify/jobsdb-hk-actor/src/main.ts` line 190):**
```typescript
if (currentPage < maxPages && seenUrls.size < maxItems) {
  await addRequests([{ url: jobsDbSearchUrl(query, location, currentPage + 1), ... }]);
}
```
The actor always starts crawling from page 1 (line 212) and advances only if
`currentPage < maxPages`. With `maxPages=1` it never enqueues page 2.

---

## Phase 5 — Fix

**Files changed:** `app/api/agent/find/route.ts` only. New test file also created.

**Three structural changes:**

1. **Removed `maxPages` from body parse.** The client never sends it; pagination
   is now entirely server-driven via constants `TARGET_NEW = 10` and `MAX_PAGES = 5`.

2. **Moved `existingByUrl` DB query before the actor call.** Previously built
   after the actor returned. Moving it up means each loop iteration can check
   freshness against the DB snapshot without an extra query.

3. **Replaced single actor call with a fetch-until-enough loop:**

```typescript
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
```

Everything from the dedup step onward was unchanged. Only renamed `jobsDbJobs`
→ `allActorJobs` on the one downstream reference.

---

## Phase 6 — Verification

```
npm run test:run -- __tests__/find-jobs/repeated-search.test.ts
# 5 passed (5) ✓

npm run test:run
# 42 passed (42) ✓  (37 pre-existing + 5 new)

npm run build
# Compiled successfully ✓
```
