# Feature 11 — Filter + Sort + Pagination: Architectural Decisions

Architect session on 2026-06-29. All decisions locked before implementation began.

---

## Decision 1 — `useSearchParams()` as live source of truth

**What:** `q`, `match`, `sort`, and `page` are derived from `useSearchParams()` on every render. They are never stored in `useState` or mirrored in any local variable that outlives the render.

**How it works:** Next.js App Router's `useSearchParams()` returns a reactive `ReadonlyURLSearchParams` object. When the URL changes — whether via `router.replace()` from a handler or via browser back/forward — the component re-renders and reads the new values automatically.

**Why not `useState` mirror:** Two sources of truth that must stay in sync always drift. Back/forward navigation changes the URL but cannot call `setState`, so a `useState` mirror goes stale immediately. Fixing it requires a `useEffect` to sync URL → state, which is the "effect as synchronisation" anti-pattern and introduces its own edge cases.

**Alternative cost:** With mirrored state you write every handler twice (update state AND update URL), add a sync `useEffect`, and still have subtle bugs when the URL changes from outside the component.

---

## Decision 2 — `filterTextDraft` is the one `useState` exception

**What:** The text search input has two separate pieces of state:
- `filterTextDraft` — local `useState`, controls what the user sees while typing, updates on every keystroke
- URL `q` param — drives the actual `useMemo` filter, updated via debounced `router.replace()`

**How it works — two `useEffect`s with a guard:**

```ts
const q = parseQ(searchParams.get("q"));
const [filterTextDraft, setFilterTextDraft] = useState(q);

// Sync: when URL q changes externally (back/forward), reset the draft
useEffect(() => {
  setFilterTextDraft(q);
}, [q]);

// Debounce: when draft changes, write to URL after 300ms
useEffect(() => {
  if (filterTextDraft === q) return; // guard prevents loop
  const timeout = window.setTimeout(() => {
    replaceViewState({ q: filterTextDraft, page: 1 });
  }, 300);
  return () => window.clearTimeout(timeout);
}, [filterTextDraft]);
```

**Why the guard is required:** Without `if (filterTextDraft === q) return`, the two effects form a cycle:
1. Back-nav changes URL `q` → sync effect sets `filterTextDraft = q` → debounce effect fires → `replaceViewState()` → URL updates → sync effect fires again → loop.
The guard breaks the cycle: when the draft already matches the URL `q`, the debounce effect is a no-op.

**Why the filter uses URL `q`, not `filterTextDraft`:** The draft is display state. It is never the filter. `useMemo` reads from `searchParams.get("q")` so the filter only changes when the URL changes (after debounce settles).

---

## Decision 3 — `router.replace()` for all view state changes

**What:** Every handler that changes `match`, `sort`, `page`, or `q` calls `router.replace()`, not `router.push()`.

**Why:** Filter/sort/page changes are refinements of the same view. The user is not navigating to a different page — they are adjusting how the current page's data is projected. `replace` overwrites the current history entry; `push` adds a new one.

**The failure mode with `push`:** A user who loads the page, sets a filter, and then changes the sort has three history entries: `/find-jobs`, `/find-jobs?match=high`, `/find-jobs?match=high&sort=newest`. When they click a job and press back, they land on the correct URL — but pressing back again navigates to `?match=high` instead of leaving the page. Three presses to leave Find Jobs.

**Rule derived:** `replace` for refinements. `push` for navigation to a conceptually different page. Feature 12 row clicks use `push` — navigating to `/find-jobs/[id]` is navigation.

---

## Decision 4 — Draft state and debounce stay in `FindJobsClient`

**What:** `filterTextDraft`, its `useState`, and the two debounce `useEffect`s live in `FindJobsClient`. `JobFilters` stays purely presentational: values in, callbacks out.

**Why:** Debounced `q` is not a filter component concern — it is part of synchronising display state to URL view state. That synchronisation belongs in the component that owns the URL (via `router.replace()`). Moving debounce into `JobFilters` would introduce a semi-controlled component — a new pattern in the codebase — for one input, without reducing complexity.

**Prop interface unchanged:** `JobFilters` receives `filterText={filterTextDraft}` and `onFilterTextChange={setFilterTextDraft}`. The component cannot tell or care that the value it receives is a draft, not the live filter.

---

## Decision 5 — Merge after search using functional `setJobs` form

**What:** After a search run completes, new jobs are merged into the existing `jobs` array by deduplicating on `id`. The functional form of `setJobs` is used.

```ts
setJobs((currentJobs) => {
  const merged = new Map(currentJobs.map((job) => [job.id, job]));
  for (const job of data.jobs as Job[]) {
    merged.set(job.id, job);
  }
  return [...merged.values()];
});
```

**Why functional form:** The closure form `setJobs(merged)` captures `jobs` at the time `handleSearch` was called. If two searches overlap or React batches updates, the merge would operate on a stale snapshot and silently discard jobs added between closure capture and the setter call. The functional form always receives the current array.

**Why not `router.refresh()`:** `router.refresh()` re-runs the Server Component and passes fresh `initialJobs` down — but `FindJobsClient`'s `jobs` is in `useState`, which only uses its initial value on mount. The refresh updates the prop; the state ignores it. Fixing this requires a `useEffect(() => setJobs(initialJobs), [initialJobs])` — which is the effect-as-sync anti-pattern, adds a round trip, and causes a visible flash as the list jumps to the DB state. The API already returned authoritative data; there is nothing stale to correct.

**After merge:** `replaceViewState({ page: 1 })` resets page to 1 while preserving `q`, `match`, and `sort` — the user's deliberate refinement preferences.

---

## Decision 6 — `PAGE_SIZE` has one owner

**What:** `const PAGE_SIZE = 20` is defined once in `FindJobsClient` (which slices the array) and passed as `pageSize={PAGE_SIZE}` to `JobsPagination` (which uses it for the "Showing X to Y of Z" label).

**Why:** `JobsPagination` previously had its own independent `const PAGE_SIZE = 6`. Two independent constants that must be equal is a maintenance hazard — they will drift. The slice shows page N of 20 items while the label says "Showing 1 to 6 of N" is a silent, confusing bug.

**Rule:** The component that performs the computation (slicing) owns the constant. Components that only display derived values receive it as a prop.

---

## Decision 7 — `<Suspense fallback={null}>` wrapper in `page.tsx`

**What:** `FindJobsClient` is wrapped in `<Suspense fallback={null}>` in `app/find-jobs/page.tsx`.

**Why required:** Next.js App Router requires any component that calls `useSearchParams()` to be inside a Suspense boundary. Without it, the build fails with a warning and the component may not render correctly during server-side rendering.

**Why `fallback={null}`:** The Server Component already fetches `initialJobs` and renders synchronously before `FindJobsClient` hydrates. There is no loading state to show — the data arrives with the initial HTML. A skeleton would flash briefly and then be replaced, which is worse than nothing.

---

## Decision 8 — `job.match_score != null` (not `!== null`)

**What:** All null score checks use `!= null` (loose inequality), which covers both `null` and `undefined`.

**Why:** TypeScript types may allow `undefined` as well as `null` for optional fields. The database concept is NULL, but JavaScript may surface it as either. `!= null` is the defensive form that catches both without changing the domain semantics.

**Application:**
- Filter: `j.match_score != null && j.match_score >= MATCH_THRESHOLD` (High)
- Filter: `j.match_score != null && j.match_score < MATCH_THRESHOLD` (Low)
- Display: `job.match_score != null ? <MatchScoreBar /> : <span>—</span>`

Unscored jobs (`match_score == null`) are only visible under All Matches — never in High or Low. See CONTEXT.md for the canonical definition.

---

## Decision 9 — Search form fields preserved after completion

**What:** After `handleSearch` completes successfully, `jobTitle` and `location` retain whatever the user typed. They are never cleared.

**Why:** These are agent inputs in `useState` — `handleSearch` never calls `setJobTitle("")` or `setLocation("")`. Standard search UI behaviour (every major job board, Google) keeps the query populated after results load. Users frequently re-search with small variations (same title, different location). Clearing forces retyping.

The success banner ("Found X jobs and saved Y new jobs") provides completion feedback. A visible form with the search terms provides context for the results.
