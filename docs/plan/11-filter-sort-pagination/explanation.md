# Feature 11 — Deep Technical Explanation

## Why URL state instead of `useState`

The natural first choice for filter/sort/page state is `useState`. It is simpler and faster. But it has a structural flaw: React component state is destroyed on navigation and re-created on mount.

When a user is on the Find Jobs page at page 3 of "High Match" filtered results, clicks a job row (Feature 12), reads the job detail, and presses back — they land back on Find Jobs. But if filter state lives in `useState`, the component is freshly mounted with empty state: page 1, no filter, no sort. The user's context is gone.

URL query params persist across navigation. `?match=high&page=3&sort=score` exists in the browser's history entry regardless of what React mounted or unmounted. When the user presses back, the URL is restored and `useSearchParams()` reads the same values.

The only things that belong in `useState` are:
- State that should NOT survive back-navigation (e.g., a half-finished form, modals)
- State the URL shouldn't know about (ephemeral UI, loading states)

Filter/sort/page are view state — part of "what I am looking at," not "what I am typing." They belong in the URL.

---

## `useSearchParams()` as reactive state

`useSearchParams()` in Next.js App Router is not a one-time read. It returns a reactive `ReadonlyURLSearchParams` object. When the URL changes — from any source — the hook triggers a re-render.

"Any source" includes:
- `router.replace()` from a handler
- `router.push()` from row navigation
- The browser back/forward buttons

This is what makes URL state practical. You do not write a `useEffect` to watch the URL for changes. You just read `searchParams.get("q")` in the render function, and React handles re-renders.

---

## The Suspense requirement

`useSearchParams()` needs a `<Suspense>` boundary because of how Next.js App Router handles server rendering. During SSR, the URL is not yet available to the client component. Next.js suspends rendering until the client has the URL, then hydrates. Without a `<Suspense>` wrapper, Next.js cannot properly boundary the suspension.

`fallback={null}` is sufficient here because the Server Component (`FindJobsPage`) already fetches `initialJobs` and streams the rendered HTML. The user sees the page before `FindJobsClient` hydrates. There is no meaningful loading state to show — no spinner, no skeleton makes sense when the initial render is already present.

---

## The text input problem: why two pieces of state

The text filter input cannot be a direct controlled input on the URL. If typing "react" into the search box called `router.replace()` on every keystroke, you would get five consecutive URL updates for `r`, `re`, `rea`, `reac`, `react`. Each triggers a re-render. The input would feel laggy or broken.

The solution: decouple display state from view state.

**Display state** (`filterTextDraft` in `useState`) — what the user sees. Updates on every keystroke synchronously.

**View state** (URL `q` param) — what drives the filter. Updated 300ms after the user stops typing.

The text input is controlled by `filterTextDraft`. The `useMemo` filter reads `q` from `searchParams.get("q")`. They are different values until the debounce settles.

---

## The two-`useEffect` pattern and its guard

Two effects cooperate to keep `filterTextDraft` and URL `q` in sync across all scenarios:

**Effect 1 — sync URL → draft (back-navigation):**
```ts
useEffect(() => {
  // eslint-disable-next-line react-hooks/set-state-in-effect
  setFilterTextDraft(q);
}, [q]);
```
When the user presses back, the URL `q` changes. This effect fires and resets the input to match.

**Effect 2 — debounce draft → URL (typing):**
```ts
useEffect(() => {
  if (filterTextDraft === q) return;
  const timeout = window.setTimeout(() => {
    replaceViewState({ q: filterTextDraft, page: 1 });
  }, 300);
  return () => window.clearTimeout(timeout);
}, [filterTextDraft]);
```
When the user types, `filterTextDraft` changes. This effect schedules a URL update 300ms later.

**The guard is what prevents a loop.** Without `if (filterTextDraft === q) return`:

1. User presses back → URL `q` changes to "react"
2. Effect 1 fires → `setFilterTextDraft("react")`
3. Effect 2 fires (filterTextDraft changed) → `replaceViewState({ q: "react" })`
4. URL changes → Effect 1 fires again → `setFilterTextDraft("react")`
5. Loop continues forever

With the guard: step 3 checks `filterTextDraft === q` — both are "react" — and returns early. The loop is broken.

---

## `router.replace()` vs `router.push()`: the history stack model

The browser maintains a linear history stack. Each entry is a URL. Back/forward moves a pointer. `push` adds a new entry at the pointer position (discarding any forward entries). `replace` overwrites the current entry in place.

For filter changes, `push` creates a problem. Every filter/sort/page change the user makes adds a new history entry. After five filter changes, pressing back navigates through all five intermediate filter states before leaving the page. Users expect one back-press to leave a page — not five.

`replace` means "this is the same page, but the view has changed." Five filter changes leave exactly one history entry for Find Jobs. Back from a job detail returns to Find Jobs with the last filter state. One more back leaves Find Jobs.

The rule: `replace` for refinements of the current view. `push` for navigating to a new page. Feature 12 uses `push` — going to `/find-jobs/[id]` is navigation.

---

## Why `router.refresh()` fails for post-search updates

After a search returns new jobs, a natural impulse is `router.refresh()` — force the Server Component to re-run, return fresh `initialJobs`. This fails.

`FindJobsClient`'s `jobs` is in `useState`:
```ts
const [jobs, setJobs] = useState<Job[]>(initialJobs);
```
`useState(initialJobs)` uses `initialJobs` exactly once — on mount. `router.refresh()` re-runs the Server Component and passes updated `initialJobs` down, but the component is not unmounted. React reconciles it in place. The `useState` ignores the new prop because `useState` only reads its argument on the initial render.

To make `router.refresh()` work, you would need:
```ts
useEffect(() => {
  setJobs(initialJobs);
}, [initialJobs]);
```
This is the "effect as synchronisation" anti-pattern — plus a round trip and a flash as the list resets to the DB state after already showing the merged data.

The API already returned authoritative data. Merging it is the correct approach.

---

## Functional setState and the stale closure problem

The closure form of the merge:
```ts
const merged = new Map(jobs.map((j) => [j.id, j]));
for (const job of data.jobs) merged.set(job.id, job);
setJobs([...merged.values()]);
```

`jobs` here is captured from the outer scope at the time `handleSearch` was called. If a second search fires while the first is still in flight, the second search's `handleSearch` closure captured the same stale `jobs` array. When it calls `setJobs`, it overwrites whatever the first search already wrote.

The functional form:
```ts
setJobs((currentJobs) => {
  const merged = new Map(currentJobs.map((j) => [j.id, j]));
  for (const job of data.jobs as Job[]) merged.set(job.id, job);
  return [...merged.values()];
});
```

React guarantees that `currentJobs` is the actual current state at the time the setter executes, regardless of batching or concurrency. No stale snapshot. The general rule: whenever a state update depends on the previous state value, use the functional form.

---

## Windowed pagination algorithm

The naive approach generates `[1, 2, 3, ..., totalPages]` — current page is missing. The windowed approach:

1. Start with a `Set` of always-visible pages: `{1, totalPages, safePage, safePage-1, safePage+1}`, clamped to valid range.
2. Sort the set ascending.
3. Walk the sorted array: wherever two adjacent values differ by more than 1, insert `"..."`.

Result at page 5 of 12: `[1, "...", 4, 5, 6, "...", 12]` — the user always sees where they are.

At ≤5 total pages, skip the algorithm — just show all pages. Adding ellipsis logic when there are only 3 pages would produce `[1, 2, 3]` anyway, but with unnecessary complexity.

---

## Null score semantics

`match_score` is nullable — a job that was saved before the AI matching ran has no score yet. The failing pattern is `?? 0`: it treats unscored jobs as 0% match and drops them into Low Match. They become invisible until the user selects All Matches.

The correct semantics: unscored jobs are a third category — neither high nor low. They appear only in All Matches (the default view), where a neutral dash `—` is shown in the score cell. High Match and Low Match both explicitly exclude them via `job.match_score != null` checks.

`!= null` (loose) catches both `null` and `undefined`. This is intentional — TypeScript types allow both for optional fields, and JSON deserialisation can produce either.
