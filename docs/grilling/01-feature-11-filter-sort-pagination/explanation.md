# Feature 11 — Grilling Session: Deep Explanation

This file explains the reasoning and principles behind each decision — not just what was chosen, but why the alternatives were worse and what the grilling process itself revealed.

---

## What grilling is for

A grilling session walks every branch of a design tree before any code is written. The goal is not to produce a specification — it is to surface hidden assumptions, expose decisions that seem obvious but aren't, and identify the dependency order between choices.

Feature 11 had fourteen non-trivial decisions. Most of them were invisible until questioned. Without the session, several would have been made implicitly — in the wrong direction.

---

## The most important correction: URL state vs client state

The initial recommendation was client `useState` for filter/sort/page. The rationale was: "no user will share job filter URLs, and the Suspense wrapper adds complexity."

The user challenged this. The challenge was correct.

The error in the initial reasoning: it assumed the cost of URL state was ongoing complexity, and the cost of client state was only a cosmetic UX issue (filter position lost on back-navigate). Both assumptions were wrong.

**The real cost of client state:** Feature 12 is the very next feature and adds row click navigation to job detail pages. When a user is on page 3 of "High Match" results, clicks a job, reads it, and presses back — they land on page 1 with no filter applied. This is not cosmetic. It is the primary navigation pattern of the entire Find Jobs page.

**The real cost of URL state:** One `<Suspense>` wrapper in `page.tsx`. A handful of `router.replace()` calls instead of `setState`. Not ongoing complexity — a one-time setup cost.

**Why this correction mattered:** If Feature 11 shipped with client state, Feature 12 would have immediately revealed the problem, and the fix would have meant touching `FindJobsClient` again for the same reason. Doing it now costs the same work, avoids the mid-Feature-12 interruption, and gives Feature 12 correct back-navigation from day one.

**The `router.replace()` principle:** Every state change that refines the current view (filter, sort, page) uses `router.replace()`. Only navigation to a genuinely different page uses `router.push()`. This keeps the browser history stack clean — pressing back always goes somewhere meaningful, not to the previous filter state.

---

## The text search input: two pieces of state

When `q` lives in the URL, the text input needs two separate pieces of state:

1. **Display state** (`useState`) — the current value of the input field. Updates on every keystroke. Controls what the user sees while typing.
2. **View state** — the `q` URL param that drives the actual filter. Updated via `router.replace()` after a 300ms debounce.

Why the split? Because `useSearchParams()` is not a state setter you can call on every keystroke. It reads from the URL, which is a relatively expensive DOM operation. If the input directly read from and wrote to the URL, there would be visible lag between keystrokes and what appears in the input box.

The debounce ensures the URL (and therefore the filter) updates only when the user has paused typing. The display state ensures the input stays snappy.

This pattern — local state for display, URL state for filtering — is the standard approach for search-as-you-type with URL persistence. It appears in virtually every production filter UI.

The location of that display state matters. `JobFilters` is currently presentational — values in, callbacks out. Keeping the draft state and debounce in `FindJobsClient` preserves that pattern and keeps URL synchronization in the component that owns the current job list view. Moving debounce into `JobFilters` would introduce a semi-controlled component pattern for one input without reducing complexity.

The display state is seeded from the URL `q` param and synced when browser back/forward changes that param, but filtering always uses the URL value. The draft is never the filter itself.

---

## Why `router.push()` vs `router.replace()` matters

The browser maintains a history stack. `router.push()` adds a new entry. `router.replace()` overwrites the current entry.

Consider a user who:
1. Loads `/find-jobs` (history: [find-jobs])
2. Sets filter to "High Match" (history with push: [find-jobs, find-jobs?match=high])
3. Sets sort to "Newest" (history with push: [find-jobs, find-jobs?match=high, find-jobs?match=high&sort=newest])
4. Clicks a job (history: [..., find-jobs?match=high&sort=newest, find-jobs/42])
5. Presses back

With `router.push()` for filter changes: back goes to `find-jobs?match=high&sort=newest` (correct), but pressing back again goes to `find-jobs?match=high`, then to `find-jobs`. The user has to press back three times to actually leave the Find Jobs page.

With `router.replace()` for filter changes: the filter state is always the current history entry. Pressing back from the job detail goes to `find-jobs?match=high&sort=newest`. Pressing back again leaves Find Jobs entirely. This is the correct behaviour.

**Rule derived:** `replace` for refinements (same conceptual page, different view state). `push` for navigation (moving to a conceptually different page).

---

## The source / source_provider distinction

The build plan listed a SOURCE column. The column was designed around `job.source` (`'search' | 'url'`). All current jobs have `source = 'search'`, so the original column would display "Search" in every row — zero information value.

The user correctly identified that we have two providers: JobsDB and Adzuna. But these are stored in `job.source_provider`, not `job.source`.

The two columns are orthogonal (established in Feature 10b):
- `source` — *how* a job entered the system (via search agent, or via a manually pasted URL)
- `source_provider` — *which* provider discovered it (JobsDB HK, Adzuna)

A future URL-sourced job from JobsDB would have `source = 'url'` and `source_provider = 'jobsdb_hk'`. The columns are never combined.

**Decision:** Replace the SOURCE column with a PROVIDER column showing `source_provider`. This has real, non-uniform data now. Rename the header to "Provider" to match what is actually shown.

---

## The `?? 0` null-score trap

The original filter code used `?? 0` to handle null `match_score`:

```ts
result.filter((j) => (j.match_score ?? 0) >= MATCH_THRESHOLD)  // null → 0 → Low bucket
result.filter((j) => (j.match_score ?? 0) < MATCH_THRESHOLD)   // null → 0 → Low bucket
```

This puts unscored jobs in the "Low Match" filter tab. A user who switches to "Low Match" expecting to see weak-but-real matches would also see unscored jobs — which may be perfectly good matches that simply haven't been scored yet.

CONTEXT.md now has the canonical definition: *Unscored job — a saved job whose match score is unknown because matching has not produced a real score for it. It is not a low match and should only appear in complete views such as All Matches.*

The fix is explicit exclusion:
```ts
j.match_score !== null && j.match_score >= MATCH_THRESHOLD  // High
j.match_score !== null && j.match_score < MATCH_THRESHOLD   // Low
```

Null-scored jobs are only visible under "All Matches" — the view that makes no claim about score quality.

The display fix is the same principle applied to the table: `match_score ?? 0` would show "0%" for unscored jobs. The correct display is "—" — communicating "unknown" rather than "zero."

---

## Two empty states, not one

The table's empty message was "No jobs match your filters." This is correct when filters exclude everything. It is incorrect when the user has no saved job history.

The distinction matters because the two cases require different user actions:
- No history → run a search (call to action pointing upward)
- Filters excluded everything → change the filters (implicit — the filter controls are visible)

Conflating them would tell a first-time user that their (non-existent) jobs don't match their (non-existent) filters. The message is technically accurate in a degenerate sense but practically misleading.

**Implementation signal:** One condition separates the cases:
```ts
if (jobs.length === 0) // never run a search / no history
else if (filtered.length === 0) // filters excluded everything
```

---

## Why `page > totalPages` is a UX problem, not a URL hygiene problem

When discussing invalid URL params, the clamping of `page` beyond `totalPages` was clarified as a separate concern from invalid string values.

Invalid string: user hand-edited `?page=foo`. Coerce to 1. URL hygiene.

Valid integer beyond range: user was on page 3 with All Matches filter (30 jobs). Switched to High Match (5 jobs, 1 page). URL still says `page=3`. The list slice `filtered.slice(40, 60)` returns an empty array. The user sees an empty table with no explanation — it looks like a bug.

The `safePage = Math.min(page, totalPages)` guard is not about cleaning URLs. It is about preventing a confusing state that the app's own filter behaviour can create legitimately. These are different problems that happen to share a fix.

---

## What the grilling process itself revealed

Several decisions that seemed obvious turned out not to be:

1. **"Wire to real DB data" ≠ "move logic to DB."** The build plan phrasing was written when mocks were still in place. By the time Feature 11 started, real data was already in use. The phrase needed reinterpretation, not literal implementation.

2. **Client state seemed correct until Feature 12 was considered.** The back-navigation problem only manifests when row clicks exist. Thinking one feature ahead changed the recommendation entirely.

3. **The SOURCE column was designed for a column that doesn't exist yet.** `source_provider` is the useful column now. The column exists in the design, but the field it should display changed.

4. **`?? 0` is a common default that happens to be semantically wrong here.** Null-to-zero coercion is idiomatic JavaScript. In this domain, it misrepresents an unknown score as a zero score — a meaningful difference from the user's perspective.
