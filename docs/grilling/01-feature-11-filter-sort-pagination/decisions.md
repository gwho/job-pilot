# Feature 11 — Filter + Sort + Pagination: Decision Record

Grilling session on 2026-06-28. All decisions reached through structured questioning before any implementation began.

---

## Decision 1 — Filter/sort/pagination logic lives client-side

**What:** All filtering, sorting, and pagination runs via `useMemo` inside `FindJobsClient`. No DB query fires per interaction.

**Why:** The build plan said "wire to real InsForge DB data" — but Feature 10b already replaced mocks. The page fetches all of a user's jobs once on mount. Client-side slicing of a 50–200 item list is instant and invisible.

**Alternative rejected:** DB-side pagination (query per interaction). Would require URL params or Server Actions per state change, plus count queries for totals. Adds real complexity for no perceptible benefit at current dataset scale.

**Deferred, not dropped:** If a user accumulates thousands of jobs, DB-side pagination is the right move. The decision is scale-dependent, not architectural.

---

## Decision 2 — After search, merge into saved job history (not replace)

**What:** `handleSearch()` no longer calls `setJobs(data.jobs)`. Instead it merges the returned jobs into the existing list, deduplicating by `id`.

**Why:** Before this fix, running a search silently discarded all previously saved jobs from the view. On initial page load the Server Component fetches all of a user's saved job history — but after a search, only the latest run's jobs were visible until page refresh. This is data loss from the user's perspective.

**Implementation:** Functional `setJobs` form to avoid stale closure if searches overlap or React batches updates. The callback always receives the current array, not the snapshot from when `handleSearch` was called:

```ts
setJobs((currentJobs) => {
  const merged = new Map(currentJobs.map((job) => [job.id, job]));
  for (const job of data.jobs as Job[]) {
    merged.set(job.id, job);
  }
  return [...merged.values()];
});
```

After the merge, `page` resets to 1 via `router.replace()`, preserving `q`, `match`, and `sort` in the URL — these are the user's deliberate refinement preferences.

---

## Decision 3 — SOURCE column replaced with PROVIDER column

**What:** The `JobsTable` SOURCE column (which would have shown "Search" or "URL" based on `job.source`) is replaced with a PROVIDER column showing `job.source_provider` ("JobsDB" / "Adzuna"). Null shows "—".

**Why:** `job.source` is `'search' | 'url'` — how a job entered the system. All current jobs have `source = 'search'`, making the column uniformly uninformative. `job.source_provider` distinguishes JobsDB from Adzuna — two real values in the current dataset.

**Key distinction:** `source` and `source_provider` are orthogonal columns and must never be conflated (established in Feature 10b).

---

## Decision 4 — Fix broken windowed pagination

**What:** Replace the broken `pageNumbers` logic with a windowed algorithm: always show first page, last page, current page ± 1 neighbour, ellipsis fills gaps.

**Why:** The prior logic (`if totalPages <= 5: show all, else: [1, 2, 3, "...", totalPages]`) omits the current page from the list when you are past page 3 of more than 5 total pages. If you are on page 6 of 10, you see `[1, 2, 3, … 10]` — page 6 is not shown.

**Correct output examples:**
- On page 1 of 10: `[1, 2, … 10]`
- On page 5 of 10: `[1, … 4, 5, 6, … 10]`
- On page 9 of 10: `[1, … 8, 9, 10]`

---

## Decision 5 — Row click navigation deferred to Feature 12

**What:** Feature 11 does not add row navigation. `JobsTable` rows get no `onClick` handler in this feature.

**Why:** Feature 12 builds the Job Details page. Adding `router.push(\`/find-jobs/${job.id}\`)` now creates a link to a 404. A cursor that signals future interactivity is better UX than a navigation that errors.

**Scope note:** Feature 12 owns the actual row-click affordance and `router.push()` behavior.

---

## Decision 6 — PAGE_SIZE changes from 6 to 20

**What:** The production page size is 20 jobs per page.

**Why:** 6 was a development convenience — useful for seeing pagination work with few items. The build plan spec is 20. This is a one-constant change.

**Implementation note:** `FindJobsClient` should own the `PAGE_SIZE = 20` constant because it performs the slicing. `JobsPagination` should receive `pageSize` as a prop for the "Showing X to Y" end bound rather than defining a second independent constant.

---

## Decision 7 — Filter/sort/page state lives in URL query string

**What:** `q`, `match`, `sort`, and `page` are encoded in the URL (`/find-jobs?match=high&sort=newest&page=2`). All changes use `router.replace()`, not `router.push()`.

**Why:** Initially recommended as client `useState`. Changed after user challenged: Feature 12 is the very next feature and adds row navigation. When a user clicks a job and presses back, client state is gone — they lose their filter position. URL state costs one `<Suspense>` wrapper; migrating later costs touching the same code twice.

**`router.replace()` rule:** Filter/sort/page changes are refinements of the same view, not navigation to a new page. `replace` overwrites the current history entry — back button goes to the previous meaningful page, not a previous filter state.

---

## Decision 8 — `jobTitle` and `location` stay in `useState`

**What:** The two agent input fields (`jobTitle`, `location`) are NOT encoded in the URL.

**Why:** These are action inputs that trigger an Apify actor run, not view state. Encoding them in the URL would imply that refreshing re-runs the agent, which would be wrong and expensive.

**Terminology established:** The conversation introduced precise language (now in CONTEXT.md):
- *Agent inputs*: `jobTitle`, `location` — drive the discovery run
- *View state*: `q`, `match`, `sort`, `page` — refine the display of saved job history

---

## Decision 9 — After search, preserve view state except page

**What:** When a search completes and new jobs merge in, `q`, `match`, and `sort` are preserved in the URL. Only `page` resets to 1.

**Why:** `q`, `match`, and `sort` represent the user's deliberate refinement preferences. Silently resetting them after a search would undo choices they made. Resetting `page` to 1 ensures the top of the (now larger) merged list is visible.

---

## Decision 10 — Invalid URL params coerce silently to defaults

**What:** If a URL param contains an invalid value (e.g. `?match=foo`, `?page=abc`), it is treated as the default at the read site. No redirect, no error.

**Implementation:**
```ts
const rawMatch = searchParams.get("match");
const match: MatchFilter = ["all", "high", "low"].includes(rawMatch ?? "")
  ? (rawMatch as MatchFilter)
  : "all";
```

**Why:** These are user-facing filter URLs, not API inputs. A user hand-editing the URL to an invalid value deserves silent correction, not a redirect flash or an error state.

---

## Decision 11 — `page` beyond `totalPages` clamps silently

**What:** If the URL says `page=5` but filtered results only have 2 pages, the app renders page 2. No redirect. This is handled by `safePage = Math.min(page, totalPages)`.

**Why:** This is not about dirty URL params — it is about the app's own filter behaviour reducing the result count after the URL was written. A user who switches from "All Matches" (30 jobs, 2 pages) to "High Match" (5 jobs, 1 page) while on page 2 should see page 1 of High Match results, not an empty table.

---

## Decision 12 — Distinguish two empty states

**What:** Two different messages for two different zero-result cases.

| Condition | Message |
|---|---|
| `jobs.length === 0` (no jobs ever saved) | Prompt to run first search |
| `filtered.length === 0 && jobs.length > 0` | "No jobs match your filters." |

**Why:** "No jobs match your filters." is correct when filters exclude everything, but misleading when the user has never run a search and has no job history at all. Treating both cases identically implies the user has jobs that are being filtered out — which is false.

---

## Decision 13 — Null `match_score` excluded from High and Low filters

**What:** High Match and Low Match filters exclude jobs where `match_score IS NULL`. Null-scored jobs only appear under All Matches.

**Old (broken) behavior:** `?? 0` coerced null to 0, putting unscored jobs in Low Match.

**Why:** Null means *unscored* (matching has not yet produced a real score), not *zero match*. Treating an unscored job as a low match misleads the user. CONTEXT.md canonically defines this as "Unscored job."

**Implementation:**
```ts
// High
j.match_score !== null && j.match_score >= MATCH_THRESHOLD
// Low
j.match_score !== null && j.match_score < MATCH_THRESHOLD
```

---

## Decision 14 — Null `match_score` renders "—" in the score cell

**What:** When `job.match_score` is null, the score cell shows "—" instead of the progress bar and "0%".

**Why:** Same reason as Decision 13 — a null score is not a zero score. Displaying "0%" implies the job was scored and came back with no match, which is false.

**Scope note:** No new filter tab for unscored jobs. No explanatory copy. The display fix is the minimum change; the rest would expand scope without clear user value in Feature 11.

---

## Decision 15 — URL view state is read live from `useSearchParams()`

**What:** `q`, `match`, `sort`, and `page` are derived from `useSearchParams()` on every render. They are not mirrored into local `useState`.

**Why:** The URL is the source of truth for the current job list view. Mirroring these params into component state creates drift risk — for example, the URL says `match=high` while local state still says `all`.

**Implementation:** Parse each param defensively at the read site:
- `q`: string, default `""`
- `match`: `"all" | "high" | "low"`, default `"all"`
- `sort`: `"newest" | "score" | "oldest"`, default `"newest"`
- `page`: positive integer, default `1`

Invalid params coerce silently; the URL does not need to be cleaned.

---

## Decision 16 — Text search has separate display state

**What:** The text search input has local display state for the draft value only. The draft is seeded from the URL `q` param, updates immediately on every keystroke, and syncs back when browser back/forward changes `q`.

**Why:** The visible input must remain responsive while typing, but the actual table filter should be driven by URL state. The local draft is display state, not filter state.

**Implementation:** Keep draft state and the 300ms debounce in `FindJobsClient`, not `JobFilters`. `JobFilters` remains presentational: values in, callbacks out.

The debounce updates `q` in the URL with `router.replace()` and resets `page` to 1. It should not call `replace()` when the draft already equals the URL `q`.

---

## Decision 17 — Agent search inputs are preserved after completion

**What:** `jobTitle` and `location` stay populated after a successful discovery search.

**Why:** They provide context for the results and make nearby follow-up searches easy. Clearing them would remove information without adding value. This matches standard search UI behaviour.

**Scope note:** These fields remain local action input state. They are not URL view state and should not be encoded into the query string.
