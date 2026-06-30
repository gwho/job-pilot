# Explanation — Find Jobs Pipeline Bugs

Deep reasoning behind each bug: why it existed, what made it hard to see, and what the correct mental model is going forward.

---

## 1. Why the dedup chain was fragile

### The implicit contract

The old actor code had a dedup chain that worked, but no single piece of it was *responsible* for dedup:

```
extractSearchResults()      ← returned unsorted raw hrefs, no dedup
  ↓ .map(canonicalJobUrl)  ← stripped tracking params
  ↓
enqueueLinks({ urls })     ← Crawlee dedups by uniqueKey (= full URL)
```

The chain was correct *because* `canonicalJobUrl` happened to strip the exact params that would cause Crawlee's `uniqueKey` to diverge. But that reasoning lived nowhere in the code. The function signature said "here are the URLs" — it didn't say "these may contain duplicates" or "downstream dedup is required."

### What Crawlee's uniqueKey actually does

Crawlee's `Request.uniqueKey` defaults to the full URL including query string, with params sorted alphabetically:

```
https://hk.jobsdb.com/job/111?ao=featured&pos=1  →  uniqueKey includes QS
https://hk.jobsdb.com/job/111?ao=regular&pos=8   →  different uniqueKey
```

So two raw hrefs for the same job — featured card at position 1, regular card at position 8 — produce *different* uniqueKeys. Crawlee would visit both and push two dataset items for the same job.

`canonicalJobUrl` stripped the QS before `enqueueLinks`, so Crawlee saw identical URLs and deduplicated. Remove `canonicalJobUrl` (or move it after `enqueueLinks`) and you get dataset duplicates.

### The new contract is explicit

After the fix, `extractCardLinks` returns raw hrefs from all cards (no canonicalisation, no dedup). The SEARCH handler is explicitly responsible for canonicalising and deduplicating using a shared `seenUrls: Set<string>`. The responsibility is stated, not assumed.

---

## 2. Why `slice(0, max)` inside `page.evaluate` was a coverage bug

### The old slice

```typescript
// Inside page.evaluate (browser context):
const cards = Array.from(document.querySelectorAll('[data-testid="job-card"]')).slice(0, max);
```

This took the first `max` DOM elements. If the first 10 cards included a featured card that duplicated card 8, you'd have 10 DOM nodes but only 9 unique jobs. After Crawlee deduped, 9 detail pages were visited — one fewer than `maxItems` requested.

### Why this matters for `maxPages`

With pagination, the cost of a coverage gap compounds. If page 1 yields 9 unique jobs (not 10), you either get fewer total results OR must fetch an extra page to fill the gap. The new code avoids this: it collects ALL card links from the page, deduplicates against `seenUrls`, and stops only when `seenUrls.size >= maxItems`. The slice happens *after* dedup, not before.

---

## 3. How `seenUrls` achieves cross-page dedup safely

### The concern

A shared mutable Set in a concurrent crawlee handler might race. If two SEARCH handlers ran simultaneously and both read `seenUrls` before either wrote to it, the same URLs could end up in `seenUrls` twice.

### Why it's safe here

The architecture prevents concurrent SEARCH handlers:

1. The crawler starts with ONE request: page 1 as SEARCH
2. The SEARCH handler for page 1 completes, THEN enqueues page 2
3. Page 2 is never in the queue while page 1 is being processed

So SEARCH handlers run sequentially. `seenUrls` is only mutated in SEARCH handlers. Detail pages read `seenUrls` never — they only call `Dataset.pushData`. There is no race.

This is different from the DB-level race condition in `route.ts` (two concurrent HTTP requests from the same user, both fetching `existingUrls` before either inserts). That race *is* possible but was not fixed this session — it requires a DB-level unique constraint or an upsert, and is low-frequency in practice.

---

## 4. The pagination architecture decision

### Why not `crawler.run` with all page URLs pre-generated?

You could calculate all page URLs upfront and enqueue them at once. The problem: you don't know how many unique jobs each page yields until you scrape it. If page 1 gives 10 unique jobs (maxItems reached), you don't want to visit page 2 at all.

The "enqueue next page from SEARCH handler" pattern is demand-driven: each page is only enqueued if the budget (`seenUrls.size < maxItems`) still needs filling.

### Why `maxRequestsPerCrawl: maxPages + maxItems`?

- `maxPages` search pages, each consuming 1 request
- `maxItems` detail pages, each consuming 1 request
- Total upper bound: `maxPages + maxItems`

With retries, individual requests may consume more than one slot from Crawlee's internal budget, but `maxRequestsPerCrawl` limits *unique* requests, not attempts.

---

## 5. Why the API's `successMessage` was ignored

### The split between what the API knew and what the client showed

The API route was written first. It had two response paths with carefully worded messages:

```typescript
// Path A — all already saved
successMessage: `Found ${totalFound} jobs — all already saved.`

// Path B — new jobs saved
successMessage: `Found ${totalFound} jobs and saved ${newCount} new jobs.`
```

When the client was written, `SearchControls` already had its own hardcoded template:

```tsx
Found {searchStatus.jobsFound} jobs and saved {searchStatus.strongMatches} strong matches.
```

The `successMessage` field was never wired up. The client invented its own message using `jobsFound` and `strongMatches`.

### Why the `strongMatches` count was a poor choice

`strongMatches` counts jobs with `match_score >= 70`. It is NOT the same as `newJobs` (jobs newly inserted this run). A search that found 10 jobs, all already saved, with 8 previously having high scores, would show:

- Old banner (buggy): "Found 10 jobs and saved [blank] strong matches." (because `strongMatches` was absent from Path A)
- Correct: "Found 10 jobs — all already saved."

The API already knew the right message. The client just needed to use it.

### Why React rendered `{undefined}` silently

When `data.strongMatches` is `undefined` (Path A response) and the banner renders `{searchStatus.strongMatches}`, React outputs nothing — not the string `"undefined"`. This made the bug silent: the banner showed "Found 10 jobs and saved  strong matches." with a gap, which a user might barely notice. The bug was invisible until you compared what the API said to what the banner showed.

---

## 6. The right architecture for API→UI message contracts

### Don't derive the message client-side if the API already has it

The API has all the information: total found, new count, already-saved count. It can produce the right message for each path. The client's job is to display it.

Deriving a message client-side from raw counts (like `strongMatches`) creates a dependency on the API sending specific fields on every path — a contract that's easy to break (as Path A proved by omitting `strongMatches`).

The fix (`searchStatus = { message: string }`) makes the client's role explicit: receive a string, render it. No field-counting on the client side.

### When client-side message construction is appropriate

If the UI needs to *format* the message differently based on locale, or compose it from multiple API fields for layout reasons (e.g., bold the count), client-side construction is justified. In that case, the `searchStatus` type should include every field the template needs, with all optional fields marked `?` and the template guarding against undefined explicitly.

---

## 7. Why `mergeJobsById` with `jobs: []` shows "stale" results

### It's not a bug — it's the design

`mergeJobsById(currentJobs, [])` is correct. `jobs: []` means the API found no *new* jobs this run. The table should not wipe out the user's job history just because a search didn't yield new results.

The table shows all-time saved history for the user — this is stated in the build plan. `initialJobs` loads all of them from the DB on page load. After a search, `mergeJobsById` merges in any new ones.

### Why it feels wrong

The banner was broken. A working banner would say "Found 10 jobs — all already saved." — making it clear that nothing new was added and the table is correct. With the banner showing blank values, users had no signal and assumed the search failed or was showing wrong results.

The fix to the banner is the fix to the perception of "stale" results.

### What would make the distinction clearer (future)

A "last search" run filter or a "New this search" tag on rows from the current `run_id` would let users see which rows came from the most recent run. This requires filtering by `run_id` in the UI — deferred as a future enhancement.
