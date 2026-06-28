# Tutorial 20 — Filter, Sort, and Pagination with URL State

**Feature built:** Feature 11 — Filter + Sort + Pagination  
**Files:** `FindJobsClient.tsx`, `JobsTable.tsx`, `JobsPagination.tsx`, `page.tsx`

This tutorial covers six connected concepts. Each builds on the previous one.

---

## Part 1 — URL as View State

### The problem with `useState` for filter/sort/page

When a user filters the Find Jobs table to "High Match, page 3" and then clicks a job row, they leave the page. When they press back, React mounts `FindJobsClient` fresh. Any state stored in `useState` is gone — the user lands on page 1 with no filter.

### The URL solution

URL query params (`?match=high&page=3&sort=score`) persist in the browser's history entry. When the user presses back, the URL is restored. `useSearchParams()` reads the exact same values. The table renders in exactly the same state.

```ts
const searchParams = useSearchParams();
const match = parseMatch(searchParams.get("match")); // "high"
const page  = parsePage(searchParams.get("page"));   // 3
const sort  = parseSort(searchParams.get("sort"));   // "score"
```

`useSearchParams()` is reactive — when the URL changes (from any source), the component re-renders and reads the new values.

### Parse helpers coerce invalid params to defaults

A user might type `?match=invalid` in the address bar. Parse helpers normalise this silently:

```ts
function parseMatch(raw: string | null): MatchFilter {
  return (["all", "high", "low"] as const).includes(raw as MatchFilter)
    ? (raw as MatchFilter)
    : "all"; // fallback to default
}
```

Same pattern for `sort`, `page`, and `q`. Invalid → default. No error, no crash.

### The Suspense requirement

`useSearchParams()` requires a `<Suspense>` boundary in Next.js App Router:

```tsx
// app/find-jobs/page.tsx
<Suspense fallback={null}>
  <FindJobsClient initialJobs={jobs} />
</Suspense>
```

`fallback={null}` is correct here because the Server Component already delivered the initial HTML before client hydration starts.

---

## Part 2 — `router.replace()` vs `router.push()`

### The history stack

The browser keeps a history stack. `router.push()` adds a new entry. `router.replace()` overwrites the current one.

### Why filter changes must use `replace`

With `router.push()`, every filter change adds a history entry. If the user changes the match filter, then the sort, then the page — that is three entries for "still on Find Jobs." Pressing back navigates through each intermediate filter state instead of leaving the page. Three filter adjustments = four back-presses to leave.

With `router.replace()`, all filter changes write to the same history entry. One back-press from a job detail returns to Find Jobs. One more back-press leaves Find Jobs.

**The rule:** `replace` for refinements of the same view. `push` for navigating to a new page.

```ts
// Filter change — same view, different projection
replaceViewState({ match: "high", page: 1 }); // router.replace()

// Row click — different page
router.push(`/find-jobs/${job.id}`);           // router.push()
```

---

## Part 3 — Two Pieces of State for One Input

### The problem

The text filter can't be controlled directly by the URL. Typing "react" (5 characters) would fire 5 `router.replace()` calls, each triggering a re-render. The input would feel broken.

### Display state vs view state

Split the text input into two separate pieces of state:

| State | Variable | Updated | Drives |
|---|---|---|---|
| Display | `filterTextDraft` | Every keystroke | The text input (controlled) |
| View | URL `q` param | After 300ms debounce | The `useMemo` filter |

```ts
const q = parseQ(searchParams.get("q")); // view state — drives filter
const [filterTextDraft, setFilterTextDraft] = useState(q); // display state — drives input
```

### The two `useEffect`s

**Effect 1 — sync URL → draft (when back-nav changes the URL):**
```ts
useEffect(() => {
  // eslint-disable-next-line react-hooks/set-state-in-effect
  setFilterTextDraft(q);
}, [q]);
```

**Effect 2 — debounce draft → URL (when the user types):**
```ts
useEffect(() => {
  if (filterTextDraft === q) return; // guard: prevents loop
  const timeout = window.setTimeout(() => {
    replaceViewState({ q: filterTextDraft, page: 1 });
  }, 300);
  return () => window.clearTimeout(timeout);
}, [filterTextDraft]);
```

### Why the guard is required

Without `if (filterTextDraft === q) return`:

1. Back-nav changes URL to `?q=react`
2. Effect 1 sets `filterTextDraft = "react"`
3. Effect 2 fires (`filterTextDraft` changed) → calls `replaceViewState({ q: "react" })`
4. URL change → Effect 1 fires again → loop

With the guard: at step 3, `filterTextDraft === q` (both "react") → early return. Loop broken.

---

## Part 4 — Merging Jobs After Search

### The data loss bug (before Feature 11)

The previous implementation:
```ts
setJobs(data.jobs); // replaces ALL history with only the latest search run
```

If a user ran two searches, they could only see jobs from the second one.

### The merge fix

```ts
setJobs((currentJobs) => {
  const merged = new Map(currentJobs.map((job) => [job.id, job]));
  for (const job of data.jobs as Job[]) {
    merged.set(job.id, job); // newer data wins on id collision
  }
  return [...merged.values()];
});
```

Deduplicates by `id`. Old jobs preserved. New jobs added. Updated jobs overwritten with fresh data.

### Why the functional form matters

The closure form `setJobs(merged)` captures `jobs` from the outer scope at the time `handleSearch` was called. If two searches overlap, the second one's closure has a stale `jobs` — it could overwrite the first search's merged results.

The functional form `setJobs(current => ...)` always receives the actual current state at execution time. React guarantees this regardless of batching or concurrency.

---

## Part 5 — Null Score Semantics

### The `?? 0` trap

```ts
// Wrong — puts unscored jobs in Low Match
const score = job.match_score ?? 0;
```

An unscored job (DB `match_score IS NULL`) becomes 0% — filtered into Low Match. If the user selects "High Match" AND "Low Match" they still don't see unscored jobs. The job is effectively hidden.

### The correct approach

```ts
// High Match — explicitly exclude null
result.filter(j => j.match_score != null && j.match_score >= MATCH_THRESHOLD)

// Low Match — explicitly exclude null  
result.filter(j => j.match_score != null && j.match_score < MATCH_THRESHOLD)

// Score cell display
job.match_score != null
  ? <MatchScoreBar score={job.match_score} />
  : <span className="text-sm text-text-muted">—</span>
```

Unscored jobs appear only in "All Matches" — the default view. A neutral `—` in the score cell signals "not yet scored."

`!= null` (loose inequality) catches both `null` and `undefined`. This is intentional: TypeScript allows both, and JSON deserialisation can produce either.

---

## Part 6 — Windowed Pagination

### The problem with simple pagination

```ts
// Naive — current page absent past position 3
[1, 2, 3, "...", totalPages]
```

At page 7 of 20, the user has no idea where they are in the list.

### The windowed algorithm

```ts
const pageNumbers = useMemo((): (number | "...")[] => {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  // Always include: first, last, current, current-1, current+1
  const neighbours = new Set(
    [1, totalPages, safePage, safePage - 1, safePage + 1]
      .filter(p => p >= 1 && p <= totalPages)
  );
  const sorted = [...neighbours].sort((a, b) => a - b);
  const result: (number | "...")[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push("...");
    result.push(sorted[i]);
  }
  return result;
}, [totalPages, safePage]);
```

At page 7 of 20: `[1, "...", 6, 7, 8, "...", 20]`

The user always sees where they are. `safePage` is clamped to `totalPages` so filters that reduce results never show an empty page — they clamp to the last valid page.

### `PAGE_SIZE` ownership

`FindJobsClient` defines `PAGE_SIZE = 20` and slices the array. It passes `pageSize={PAGE_SIZE}` to `JobsPagination` for the "Showing X to Y of Z" label. One constant, one owner.

```ts
const PAGE_SIZE = 20; // defined here, used for slice
// ...
<JobsPagination pageSize={PAGE_SIZE} ... />
```

If `JobsPagination` had its own `PAGE_SIZE = 6`, the slice and the label would diverge silently.
