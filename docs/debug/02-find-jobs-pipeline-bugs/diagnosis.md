# Diagnosis — Find Jobs Pipeline Bugs

Session date: 2026-06-29  
Skills used: `/diagnosing-bugs`, `/apify-ultimate-scraper`  
Areas covered: Apify JobsDB actor (duplicate sourceUrls + pagination), Find Jobs UI/API seam (banner copy)

---

## Area 1 — Apify Actor: Duplicate sourceUrl Risk

### Symptom

Suspicion that the JobsDB Apify actor could produce duplicate `sourceUrl` values in its dataset, causing the same job to appear more than once in the DB.

### Feedback loop built

**Script:** `scripts/test-jobsdb-duplicates.mjs`  
**Command:** `APIFY_TOKEN=... node scripts/test-jobsdb-duplicates.mjs <datasetId>`

The script:
1. Fetches all items from a completed Apify dataset run
2. Asserts ≥ 2 jobs returned
3. Asserts no `sourceUrl` is empty
4. Asserts all `sourceUrl` values are unique (RED if any duplicate)

Self-tested with synthetic payloads before running against real data — confirmed it correctly goes RED for duplicate/empty/short inputs and GREEN for clean data.

### Run 1 result (1 page / 10 items)

Dataset `JJ2ooHv49k7JcYuRr` — **GREEN**: 10 jobs, 10 unique sourceUrls.

### Instrumentation — Crawlee uniqueKey trace

A key finding came from tracing how Crawlee computes `uniqueKey` for the `enqueueLinks` dedup:

```js
// Same JobsDB job appearing as featured card AND regular card:
const featuredHref = 'https://hk.jobsdb.com/job/111?pos=1&ao=featured&sxsrf=abc';
const regularHref  = 'https://hk.jobsdb.com/job/111?pos=8&ao=regular&sxsrf=xyz';

// After canonicalJobUrl (strips all query string):
// both → https://hk.jobsdb.com/job/111  ✓ Crawlee deduplicates

// Without canonicalJobUrl (raw href to enqueueLinks):
// Crawlee uniqueKey includes the full URL + sorted QS
// → two different keys → both pages visited → DUPLICATE in dataset
```

**Confirmed**: `canonicalJobUrl` is the only thing preventing dataset duplicates when featured cards exist alongside regular cards in the DOM. The function is applied outside `extractSearchResults` with no explicit dedup inside the function itself — a fragile implicit contract.

### Latent bug 1 — `extractSearchResults` relied on downstream dedup

```typescript
// Old code: slice inside page.evaluate, no explicit dedup
const cards = Array.from(document.querySelectorAll('[data-testid="job-card"]')).slice(0, max);
const links = cards.map(card => a?.href ?? '').filter(Boolean);
return links.map(canonicalJobUrl);  // ← no Set, no dedup
```

If a featured card and a regular card both pointed to `/job/111`, `links` would contain the canonical URL twice. Crawlee's `enqueueLinks` would dedup it (because both are the same URL after canonicalisation), but this was never stated in the function's contract. A future refactor removing `canonicalJobUrl` would silently reintroduce duplicates.

### Latent bug 2 — Coverage gap from `slice(0, max)` inside `page.evaluate`

`slice(0, max)` ran inside the browser context BEFORE dedup. If 2 of the first 10 cards were the same featured job, only 9 unique detail pages were visited even though 10 were requested.

### Actor fix

Rewrote `apify/jobsdb-hk-actor/src/main.ts`:

1. **Extracted `extractCardLinks`** — returns ALL raw hrefs (no slice, no canon inside `page.evaluate`)
2. **Shared `seenUrls: Set<string>`** — dedup + canonicalisation done in the SEARCH handler, shared across all pages
3. **`slice` moved to after dedup** — `if (seenUrls.size >= maxItems) break` — only stops when `maxItems` UNIQUE URLs collected
4. **Scroll before extraction** — scrolls the left-panel card container before querying DOM to load any lazy-rendered cards
5. **Removed dead variables** — `detailUrls[]` and `results[]` were populated but never used for output

---

## Area 2 — Apify Actor: Pagination

### Feature gap

The actor only fetched page 1 of JobsDB search results. The search UI shows numbered pages (1, 2, 3, Next). No scrolling/infinite-load — traditional numbered pagination.

### What was added

New `maxPages` input parameter (default 1, max 10). The SEARCH handler enqueues the next page URL (with `?page=N`) if budget remains:

```typescript
if (currentPage < maxPages && seenUrls.size < maxItems) {
  await addRequests([{
    url: SEARCH_URL(query, location, currentPage + 1),
    label: "SEARCH",
    userData: { page: currentPage + 1 },
  }]);
}
```

`maxRequestsPerCrawl` updated from `maxItems + 1` to `maxPages + maxItems`.

### Run 2 result (2 pages / 20 items)

Dataset `DsTewMotdeDc1gJR0` — **GREEN**: 20 jobs, 20 unique sourceUrls across both pages. Cross-page dedup confirmed working.

### Integration with JobPilot

`maxPages` threaded through the existing call chain with no UI changes required:
- `lib/apify.ts` — `JobsDbActorInput` type gains `maxPages: number`
- `agent/jobsdb.ts` — `discoverJobsDbJobs(query, location, maxItems, maxPages = 1)`
- `app/api/agent/find/route.ts` — reads `body.maxPages` (clamped 1–5), passes `maxPages * 10` as `maxItems`

The Find Jobs button workflow is unchanged. Pagination is internal to the actor.

---

## Area 3 — Find Jobs UI/API Seam: Success Banner Bug

### Symptom

After searching more than once — especially a repeat search where all results are already in the DB — the success banner showed wrong or missing information. The table appeared unchanged after a repeat search, making it look like the search did nothing.

### API response paths confirmed

The route at `app/api/agent/find/route.ts` has two response paths:

**Path A — all already saved** (lines 175–182):
```json
{ "success": true, "jobs": [], "jobsFound": 10, "newJobs": 0,
  "successMessage": "Found 10 jobs — all already saved." }
```
Note: **`strongMatches` is absent** from this path.

**Path B — new jobs saved** (lines 239–243):
```json
{ "success": true, "jobs": [...], "jobsFound": 10, "newJobs": 5, "strongMatches": 3,
  "successMessage": "Found 10 jobs and saved 5 new jobs." }
```

### What the client did (buggy)

```typescript
// FindJobsClient.tsx — handleSearch
setSearchStatus({
  jobsFound: data.jobsFound,
  strongMatches: data.strongMatches,  // undefined on Path A
});

// SearchControls.tsx — banner
Found {searchStatus.jobsFound} jobs and saved {searchStatus.strongMatches} strong matches.
```

Three bugs in one block:
1. `data.successMessage` — correctly set by the API — was **never read** by the client
2. `data.newJobs` — the meaningful metric — was **never read** by the client
3. On Path A, `data.strongMatches` is absent → `searchStatus.strongMatches === undefined` → React renders it as an empty gap in the banner

### Feedback loop built

**Test file:** `__tests__/find-jobs/seam.test.tsx`  
**Command:** `npm run test:run -- __tests__/find-jobs/seam.test.tsx`

5 tests total:
- 2 RED on buggy code (banner copy assertions)
- 3 GREEN (table behaviour, which was already correct)

The two RED tests confirmed the exact symptoms:

```
banner must reflect the API's successMessage — FAIL
  Expected text "/3 new jobs/i" but found "Found 10 jobs and saved 3 strong matches."

banner must not say 'strong matches' — FAIL
  Found element containing "strong matches" in banner
```

The `undefined` test unexpectedly PASSED on current code — React renders `{undefined}` as empty string (no visible text), not the literal word "undefined". The gap was silent, not visible.

### Fix

```typescript
// FindJobsClient.tsx — SearchStatus type
type SearchStatus = { message: string };

// handleSearch — use API's message directly
setSearchStatus({ message: data.successMessage as string });

// SearchControls.tsx — render it
{searchStatus.message}
```

The API already had correct copy for both paths. The fix was to stop ignoring it.

### Table behaviour (product decision, not a bug)

`mergeJobsById(currentJobs, [])` returns `currentJobs` unchanged. After a repeat search, the table is intentionally unchanged — it shows all-time saved job history, not just the current run. This is correct per the build plan. The confusion came solely from the broken banner.

### Final test result

All 5 seam tests GREEN. Full suite: 30/30 tests passing. Build clean.
