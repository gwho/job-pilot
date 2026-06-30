# Plan: Fix Find Jobs Repeated-Search Bug

## Context

Clicking "Find Jobs" twice with the same keyword returns "Found N jobs — all already saved." instead of fetching new jobs from deeper pages. The root cause is that the route always calls the Apify actor with `maxPages=1`, which re-fetches the same page-1 listing every time. Once those ~10 jobs are in the DB, no new jobs are ever found. The fix adds a server-side pagination loop that increments `maxPages` until 10 new canonical URLs are discovered or 5 pages are exhausted.

---

## Root Cause (confirmed)

`app/api/agent/find/route.ts` line 84:
```typescript
jobsDbJobs = await discoverJobsDbJobs(jobTitle, location, maxPages * 10, maxPages);
```
`maxPages` defaults to 1 (client never sends it). The Apify actor always starts from page 1; same search = same page-1 jobs = all already in DB → `records.length === 0` → "all already saved" (line 186). Never tries page 2.

**Actor constraint:** always starts fresh at page 1. Calling with `maxPages=2` returns pages 1+2 combined (actor-deduplicated via `seenUrls`). Each call is a new Apify run.

---

## Fix: Two files change

### 1. `app/api/agent/find/route.ts`

**Step 1 — Remove `maxPages` from body parse** (lines 29–35)

Delete `maxPages?: number` from the body type and the `const maxPages = ...` line. The client never sends it; pagination is now entirely server-driven.

**Step 2 — Move `existingByUrl` query before the actor call**

Cut lines 109–136 (the `existingJobsResult` DB query, error check, and `existingByUrl` Map construction) and paste them immediately after `captureServerEvent` (after line 79), before the actor call. Error handling stays identical.

**Step 3 — Replace the single actor call with a fetch-until-enough loop**

Replace lines 82–96 (the single `discoverJobsDbJobs` try/catch) with:

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

**Step 4 — Rename `jobsDbJobs` → `allActorJobs`** on line 100 (the dedup filter input). Everything from the dedup step onward is unchanged.

**Final route order:**
```
auth → parse body (jobTitle, location only) → profile → agent_run insert →
captureServerEvent(job_search_started) →
[MOVED] build existingByUrl →
[NEW]   for page 1..5: discoverJobsDbJobs, break when ≥10 fresh or exhausted →
[UNCHANGED] dedup → newJobs filter → score → insert → events → response
```

### 2. `__tests__/find-jobs/repeated-search.test.ts` (new file)

Red-capable regression test that exercises the POST handler directly. Write it first; it must be RED on the current route (actor called once, returns "all already saved") and GREEN after the fix.

**Mocks (at top of file, hoisted by Vitest):**
```typescript
vi.mock("@/lib/insforge-server", () => ({ createInsforgeServer: vi.fn() }));
vi.mock("@/agent/jobsdb",        () => ({ discoverJobsDbJobs: vi.fn(), toScoringInput: (j) => j }));
vi.mock("@/agent/job-matcher",   () => ({ scoreJobs: vi.fn() }));
vi.mock("@/lib/posthog-server",  () => ({ captureServerEvent: vi.fn().mockResolvedValue(undefined) }));
```

**DB chain builder helper** (inside test file): return value from `createInsforgeServer` must handle chained `.from().select().eq().eq()` (awaited directly, no `.single()`), `.insert([]).select()` (awaited directly), `.insert([]).select().single()`, and `.update().eq().eq()`. Add a `then` property on the chain object so direct awaits work. Sequence the two `from("jobs")` calls (select then insert) using `mockReturnValueOnce`.

**Scenario for key tests:**
- `existingJobs` = 10 DB rows with `source_url: "https://hk.jobsdb.com/job/p1-{i}"`
- Actor call 1 (`maxPages=1`): returns `page1ActorJobs` (same 10 URLs as DB)
- Actor call 2 (`maxPages=2`): returns `page1ActorJobs + page2ActorJobs` (10 new URLs)
- `scoreJobs` mock: `inputs.map(() => ({ matchScore: 50, matchReason: "", matchedSkills: [], missingSkills: [] }))`

**Key assertions (all RED on current code):**
```typescript
expect(discoverJobsDbJobs).toHaveBeenCalledTimes(2);                    // loop ran twice
expect(discoverJobsDbJobs).toHaveBeenLastCalledWith("Engineer", "HK", 20, 2);  // second call
expect(data.newJobs).toBeGreaterThan(0);                                 // found new jobs
expect(data.successMessage).not.toMatch(/all already saved/i);           // correct message
```

---

## Gotchas

- **`freshCount` guard**: use `j.sourceUrl && !existingByUrl.has(j.sourceUrl)` — same as the existing `newJobs` filter on line 139. Empty-URL jobs would inflate the count otherwise.
- **Exhaustion signal**: `allActorJobs.length < page * 10` — when the actor returns fewer than a full page, there are no more listings.
- **`allActorJobs` is replaced each iteration**, not accumulated — the actor already returns cumulative pages 1..N deduplicated.
- **Two `from("jobs")` calls** in the test: sequence with `mockReturnValueOnce` (first for select/existing query, second for insert).
- **DB mock `then` property**: the `existingByUrl` query and `jobs` insert are both awaited directly (no `.single()`). Make the chain thenable.
- **`maxDuration = 300` stays** — 5 actor calls × ~60s each fits within the cap.

---

## Verification

```bash
# 1. Run the new regression test — must be RED before touching route.ts
npm run test:run -- __tests__/find-jobs/repeated-search.test.ts

# 2. Apply the fix to route.ts

# 3. Run again — must be GREEN
npm run test:run -- __tests__/find-jobs/repeated-search.test.ts

# 4. Full suite — must still be 37 passing (no regressions)
npm run test:run

# 5. Build check
npm run build
```

Manual verification: search for "sales coordinator" twice. Second search should return new jobs from page 2, not "all already saved."
