# Feature 11 — Architect Session: Deep Discussion

This file records the reasoning behind each decision in full — not just what was chosen, but why the alternatives fail and what the session revealed about building filter UIs in Next.js App Router.

---

## Why the URL state recommendation reversed mid-session

The architect session opened with a recommendation for client `useState` for filter/sort/page. The rationale: "job filter URLs aren't shared, and the Suspense wrapper adds complexity."

The user challenged this. The challenge was correct.

**The error in the initial reasoning** was treating the cost of client state as a cosmetic UX issue. The actual cost is structural: Feature 12 is the very next feature and adds row-click navigation to job detail pages. When a user is on page 3 of "High Match" filtered results, clicks a job, reads it, and presses back — with client state, they land on page 1 with no filter applied. That is not cosmetic. It is the primary use pattern of the entire Find Jobs page.

**The "wait for evidence" principle failed here** because we already had the evidence. Feature 12 was one feature away and its behaviour was certain. "Do it when we see the problem" is appropriate when the problem is speculative. When it is certain and one sprint away, the right call is to do it now.

**The real cost of URL state** is one `<Suspense>` wrapper and a handful of `router.replace()` calls instead of `setState`. Not ongoing complexity — a one-time setup cost that pays forward into Feature 12 immediately.

This is a broader lesson: when evaluating "do it now vs later," ask whether the "later" trigger is speculative or certain. Here it was certain. Do it now.

---

## The browser history stack: `push` vs `replace`

The browser maintains a stack of URL entries. Forward/back navigation moves the pointer. `router.push()` adds a new entry at the current position (discarding any forward entries). `router.replace()` overwrites the current entry in place.

For filter UIs, this distinction is critical.

**The `push` failure mode — step by step:**

1. User loads `/find-jobs`. History: `[find-jobs*]`
2. Sets match filter to "High". With `push`: `[find-jobs, find-jobs?match=high*]`
3. Changes sort to "Newest". With `push`: `[find-jobs, find-jobs?match=high, find-jobs?match=high&sort=newest*]`
4. Clicks a job row (Feature 12). With `push`: `[..., find-jobs?match=high&sort=newest, find-jobs/42*]`
5. Presses back. Lands on `find-jobs?match=high&sort=newest` — correct.
6. Presses back again. Lands on `find-jobs?match=high` — wrong. User is still on Find Jobs.
7. Presses back again. Lands on `find-jobs` — no filters, wrong.
8. Presses back again. Finally leaves Find Jobs.

That is four presses to leave the page. Every filter change the user made adds another press.

**With `replace`:**

1. Same steps 1–3. History stays: `[find-jobs?match=high&sort=newest*]` — each filter change replaces, not adds.
2. Clicks a job. History: `[find-jobs?match=high&sort=newest, find-jobs/42*]`
3. Presses back. Lands on `find-jobs?match=high&sort=newest` — correct filter state restored.
4. Presses back. Leaves Find Jobs entirely.

Two presses from the job detail to leaving the page. Filter position is perfectly restored.

**The rule derived:** `replace` for refinements of the same view. `push` for navigating to a conceptually different page. The question to ask: "is the user changing how they see this page, or going to a different page?"

---

## The text input: why two pieces of state are necessary

When `q` lives in the URL, a naive implementation would make the text input a controlled component reading directly from `searchParams.get("q")` — no local state. Every keystroke would call `router.replace()`. 

This does not work. The URL is a shared DOM resource; updating it on every keystroke triggers a re-render cycle that introduces noticeable lag in the input. The input would feel broken.

The solution is to split the state:

1. **Display state** (`filterTextDraft` in `useState`) — what the user sees while typing. Updates on every keystroke with no delay. Pure React state, fast.
2. **View state** (URL `q` param) — what the filter actually uses. Updated via `router.replace()` after a 300ms debounce. `useMemo` reads from here, not from the draft.

The input is controlled by the display state. The filter is driven by the URL. They are decoupled.

**Why the debounce lives in `FindJobsClient`, not `JobFilters`:** Debounced URL writing is not a filter component concern — it is URL synchronisation logic. `FindJobsClient` owns the URL (via `router.replace()`). Putting the debounce there keeps URL concerns in one place. `JobFilters` stays a pure component: values in, callbacks out, no knowledge of URLs.

**The back-navigation sync problem:** When the user presses back, the URL `q` changes externally. The draft `filterTextDraft` is stale — it still shows what the user typed, not what the URL now says. A `useEffect([q])` syncs them: when `q` changes, reset the draft to match.

But now there is a cycle risk: sync sets the draft → debounce effect fires → `replaceViewState()` → URL updates → sync fires again. The guard `if (filterTextDraft === q) return` breaks this cycle. After back-navigation, the sync sets `filterTextDraft = q`. The debounce effect fires, but `filterTextDraft === q` is now true, so it returns early. No replace fires. No cycle.

---

## Why `router.refresh()` fails for the post-search merge

After a search completes, the route has saved new jobs to the DB. A natural instinct is to call `router.refresh()` — re-run the Server Component, get fresh `initialJobs`, display accurate data.

This approach has a fatal flaw: `useState` only uses its initial value on mount.

`FindJobsClient` initialises `jobs` with `useState(initialJobs)`. When `router.refresh()` re-runs the Server Component, it passes a new `initialJobs` prop to `FindJobsClient`. But React reconciles the component tree without unmounting it — `FindJobsClient` is the same component instance, so `jobs` is still the original `useState` value. The new `initialJobs` prop is received but silently ignored.

To make `router.refresh()` work, you would need:

```ts
useEffect(() => {
  setJobs(initialJobs);
}, [initialJobs]);
```

This is the effect-as-sync anti-pattern. It also has a visible failure mode: after a search completes, the UI shows the merged jobs immediately (from the fetch response), then `router.refresh()` fires, then the effect resets `jobs` to whatever the DB returned — causing a visible flash and potentially losing the optimistic update if the DB write was slow.

The merge approach sidesteps all of this. The API route already returns the freshly saved jobs. That data is authoritative at the moment it arrives. Merging it into the local array is not an optimistic update — it is the actual, correct data. No round trip, no flash, no effect-as-sync.

---

## Functional `setJobs` and the stale closure problem

The closure form of state updates:

```ts
const merged = new Map(jobs.map((j) => [j.id, j]));
for (const job of data.jobs) merged.set(job.id, job);
setJobs([...merged.values()]);
```

This captures `jobs` from the outer scope — the value at the time `handleSearch` was called. If a second search starts before the first completes (overlapping requests), or if React batches state updates, `jobs` in the closure is stale. The merge would operate on an outdated list and silently discard any jobs that were added between when `handleSearch` was called and when the setter fires.

The functional form:

```ts
setJobs((currentJobs) => {
  const merged = new Map(currentJobs.map((j) => [j.id, j]));
  for (const job of data.jobs as Job[]) merged.set(job.id, job);
  return [...merged.values()];
});
```

React guarantees that `currentJobs` is always the most current state value at the time the setter fires, regardless of batching or concurrency. No stale closure. No lost jobs.

This is the general rule: when a state update depends on the previous value of that state, always use the functional form.

---

## `PAGE_SIZE` and the one-owner principle

`JobsPagination` previously had its own `const PAGE_SIZE = 6`. `FindJobsClient` also had `const PAGE_SIZE = 6`. Two independent constants, both required to equal each other.

The failure mode: a developer changes `FindJobsClient` to `PAGE_SIZE = 20` for the spec, but misses `JobsPagination`. The array slice now returns 20 items per page, but the label reads "Showing 1 to 6 of 42 results". The label is wrong. This is silent — no TypeScript error, no lint warning.

The fix: `FindJobsClient` owns `PAGE_SIZE` (it performs the slice), passes `pageSize={PAGE_SIZE}` to `JobsPagination` (which only displays a derived value). There is one constant. Changing it in one place changes the behaviour everywhere.

The broader rule: the component that performs a computation owns the constants that govern it. Components that display derived information receive those values as props.

---

## The `!= null` vs `!== null` precision

The domain concept is "unscored job" — a job where the database `match_score` column is NULL. In JavaScript, this surfaces as `null`. But TypeScript types for optional fields may also allow `undefined`, and runtime serialisation can produce `undefined` where the schema says `null`.

`!== null` catches only `null`. `!= null` catches both `null` and `undefined`. The domain semantics are identical — in both cases the score is absent. The defensive form costs nothing and prevents a subtle class of bugs where the check passes for `null` but fails for `undefined`, putting an unscored job in the wrong filter bucket.

The convention throughout Feature 11: `job.match_score != null` for "this job has a score" and `job.match_score == null` for "this job is unscored." Never `=== null` or `!== null` in this context.
