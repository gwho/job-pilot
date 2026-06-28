# Feature 11 — Filter + Sort + Pagination

## What was built

Client-side filter, sort, and pagination for the Find Jobs table — with URL as the live source of truth for view state.

### Files modified

| File | Change |
|---|---|
| `app/find-jobs/page.tsx` | Added `<Suspense fallback={null}>` wrapper around `FindJobsClient` |
| `components/find-jobs/FindJobsClient.tsx` | Major refactor — URL view state, debounced text filter, functional merge, windowed pagination |
| `components/find-jobs/JobsTable.tsx` | Provider column, null score display (`—`), two empty states, `hasNoHistory` prop |
| `components/find-jobs/JobsPagination.tsx` | Added `pageSize` prop, removed independent local constant |
| `docs/architect/11-filter-sort-pagination/` | Three architect session docs |

### What changed and why

**URL as view state** — `q`, `match`, `sort`, `page` are now URL query params read via `useSearchParams()`. Previously they were `useState`. This was required because Feature 12 (row navigation to job detail) means the user navigates away from the table and must return to their exact filter position via back-nav. Client state is wiped on navigation; URL state survives it.

**Debounced text filter** — The text input holds local draft state (`filterTextDraft`), which debounces into the URL `q` param after 300ms. The URL param drives the actual filter, not the draft. A two-`useEffect` pattern with a guard (`filterTextDraft === q`) prevents a replace loop when back-nav changes the URL externally.

**Functional merge after search** — When a new search returns jobs, they are merged into the existing list by `id` (newest data wins). The functional form of `setJobs` (`setJobs(current => ...)`) avoids stale closures if searches overlap. Previously `setJobs(data.jobs)` replaced all history with only the latest run's results.

**PAGE_SIZE = 20, single owner** — `FindJobsClient` defines `PAGE_SIZE = 20` and slices the array. `JobsPagination` receives `pageSize={PAGE_SIZE}` for the "Showing X to Y" label. Previously both had independent constants (6) that could drift.

**Windowed pagination** — Page number list shows first, last, current±1, with ellipses for gaps. Previously showed only `[1, 2, 3, ..., last]` — no current page appeared past page 3.

**Null score semantics** — Unscored jobs (`match_score == null`) show `—` in the score cell and only appear in "All Matches" — never in High or Low. Previously `?? 0` would place them in Low Match.

**Two empty states** — `hasNoHistory` (zero jobs ever saved) → "Run a search above to find your first jobs." `filtered.length === 0 && jobs.length > 0` → "No jobs match your filters."

**Provider column** — New column showing `source_provider` (e.g. "JobsDB", "Adzuna"). Positioned after Match Score.

**Suspense wrapper** — `useSearchParams()` requires a `<Suspense>` boundary in Next.js App Router. `fallback={null}` is sufficient because the Server Component delivers data before hydration.

---

## Key invariants

- `replaceViewState()` is the only path to URL changes — all filter/sort/page handlers funnel through it
- `filterTextDraft` is display state — never the filter; the filter uses `q` from the URL
- `PAGE_SIZE` has one definition in `FindJobsClient`; `JobsPagination` receives it as a prop
- `match_score != null` (loose, covers `undefined`) for all score presence checks
- Unscored jobs appear only in All Matches — never High or Low
- `jobTitle` and `location` are agent inputs; they are never cleared after a search completes
