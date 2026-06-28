# Tutorial 20 — Filter + Sort + Pagination: URL View State, Debounced Inputs, and Client-Side Slicing

**After completing this tutorial you will understand:** how `useSearchParams()` turns the URL into live view state; why text inputs need separate draft state when URL writes are debounced; why Feature 11 uses `router.replace()` for refinements and functional `setJobs()` for search result merging; how null match scores stay distinct from low scores; and how the windowed pagination algorithm keeps the current page visible.

---

> [!NOTE]
> **Prerequisites:** Tutorial 15 (`../15-find-jobs-ui/README.md`) — establishes the Find Jobs component split and pagination basics. Tutorial 17 (`../17-adzuna-job-discovery/README.md`) — explains the job search route that returns the jobs merged in this feature. Tutorial 18 (`../18-jobsdb-hk-discovery-architect-deep-dive/README.md`) — explains `source_provider`, which replaces the old SOURCE column.
>
> Open [`components/find-jobs/FindJobsClient.tsx`](../../../components/find-jobs/FindJobsClient.tsx), [`components/find-jobs/JobFilters.tsx`](../../../components/find-jobs/JobFilters.tsx), [`components/find-jobs/JobsTable.tsx`](../../../components/find-jobs/JobsTable.tsx), [`components/find-jobs/JobsPagination.tsx`](../../../components/find-jobs/JobsPagination.tsx), and [`app/find-jobs/page.tsx`](../../../app/find-jobs/page.tsx) alongside this tutorial.

---

## How to use an LLM before this tutorial

### Concept 1 — URL state as a source of truth

> "Explain the difference between React component state and URL query-string state in a paginated list. Give a concrete example where component state is lost during navigation but URL state survives. Quiz me on which values should live in the URL and which should stay local."

*What to listen for:* URL state represents shareable, restorable view state: what list the user is currently looking at. Local state represents temporary interaction state: what the user is typing, loading flags, and action inputs that should not replay work on refresh.

*Practice question:* Why does `match=high&page=3` belong in the URL, but `jobTitle="Frontend Engineer"` does not?

### Concept 2 — Debouncing

> "Explain debouncing using a search input. What happens on every keystroke, what waits for the timer, and why does this improve UX? Give an example with a 300ms delay and quiz me on the event sequence."

*What to listen for:* Debouncing separates immediate display feedback from delayed expensive work. The input value can update on every keystroke while URL writes, filtering, or network calls wait until typing pauses.

*Practice question:* If the user types `react`, which state should change five times immediately, and which value should change once after the delay?

### Concept 3 — Browser history: push versus replace

> "Explain the browser history stack. Compare `router.push()` and `router.replace()` in Next.js App Router. Give an example where filters should use replace but row navigation should use push. Quiz me on back-button behavior."

*What to listen for:* `push` means "new place"; `replace` means "same place, refined view." Filters should not create a stack of intermediate history entries. Opening a job details page should.

*Practice question:* After five filter changes and one job click, why should one Back press return to the filtered list rather than to the previous filter value?

### Concept 4 — Functional state updates

> "Explain stale closures in React state updates. Show why `setItems([...items, newItem])` can lose data when two async operations overlap, and why `setItems(current => ...)` fixes it. Quiz me with two concurrent searches."

*What to listen for:* A closure captures the value from the render where it was created. Functional state setters receive the current value at the time React applies the update.

*Practice question:* If search A and search B both start from the same `jobs` array, what can the closure form overwrite?

### Concept 5 — Null is not zero

> "Explain the difference between `null`, `undefined`, and `0` in a TypeScript UI. Give an example where treating null as zero creates a misleading product state. Quiz me on the difference between 'unscored' and 'low score'."

*What to listen for:* `0` is a real measured value. `null` means the measurement does not exist. Replacing null with zero creates false information.

*Practice question:* Why is an unscored job neither High Match nor Low Match?

---

## Architecture overview

```
GET /find-jobs
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ app/find-jobs/page.tsx                         [SERVER]     │
│ auth guard → SELECT jobs scoped by user_id                  │
│ wraps FindJobsClient in <Suspense fallback={null}>          │
└──────────────────────────────┬──────────────────────────────┘
                               │ initialJobs
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ components/find-jobs/FindJobsClient.tsx        [CLIENT]     │
│ useSearchParams() → q, match, sort, page                   │
│ useState() → jobs, agent inputs, loading, draft q          │
│ useMemo() → filter → sort → safePage → pageItems           │
│ router.replace() → write refined URL state                 │
└───────────────┬────────────────┬────────────────────────────┘
                │                │
                ▼                ▼
┌─────────────────────────┐  ┌───────────────────────────────┐
│ JobFilters              │  │ JobsTable                      │
│ presentational controls │  │ page slice + empty states      │
└─────────────────────────┘  └───────────────────────────────┘
                │
                ▼
┌─────────────────────────┐
│ JobsPagination          │
│ page labels + buttons   │
└─────────────────────────┘
```

**Key invariants:**

1. URL params (`q`, `match`, `sort`, `page`) are the source of truth for view state.
2. Agent inputs (`jobTitle`, `location`) stay local because refreshing a URL must not re-run the actor.
3. Unscored jobs stay visible in All Matches only; they are never coerced to `0%`.

---

## Part 1 — The page boundary: server data plus a Suspense island

Open [`app/find-jobs/page.tsx`](../../../app/find-jobs/page.tsx) lines 1–39:

```tsx
import { Suspense } from "react";
import { redirect } from "next/navigation";

import { Navbar } from "@/components/layout/Navbar";
import { FindJobsClient } from "@/components/find-jobs/FindJobsClient";
import { createInsforgeServer } from "@/lib/insforge-server";
import type { Job } from "@/types/index";

// Per-user, frequently-mutated list — never serve a cached render.
export const dynamic = "force-dynamic";

export default async function FindJobsPage() {
  const insforge = await createInsforgeServer();
  const { data: authData, error: authError } =
    await insforge.auth.getCurrentUser();

  if (authError || !authData.user) {
    redirect("/login");
  }

  const { data: jobs } = await insforge.database
    .from("jobs")
    .select("*")
    .eq("user_id", authData.user.id)
    .order("found_at", { ascending: false });

  return (
    <>
      <Navbar />
      <main className="min-h-[calc(100vh-4rem)] bg-background">
        <div className="max-w-[1440px] mx-auto px-6 py-8">
          <Suspense fallback={null}>
            <FindJobsClient initialJobs={(jobs as Job[]) ?? []} />
          </Suspense>
        </div>
      </main>
    </>
  );
}
```

The Server Component owns authentication and the initial database read because both require server cookies and user scoping. Feature 11 does not move filtering into the database; it still fetches the user's saved job history once, then lets the client refine that in memory. This matches the grilling decision: current scale is expected to be tens or hundreds of rows, not thousands.

The `<Suspense fallback={null}>` wrapper exists because `FindJobsClient` calls `useSearchParams()`. Next's installed docs say `useSearchParams` is a Client Component hook and that components using it should be wrapped in Suspense for prerendering support. `fallback={null}` is deliberate: the server already fetched the jobs and renders the page shell, so a skeleton would add visual noise without revealing new data.

**Checkpoint:** Why is `fallback={null}` acceptable here, but risky if the server page did not fetch `initialJobs` first?

<details>
<summary>Reveal answer</summary>

Here the meaningful data dependency is already satisfied before the client island hydrates. The user gets the page structure and the initial jobs list from the server-rendered route. `FindJobsClient` only needs client URL access to refine that list. If the server did not fetch jobs first, `fallback={null}` would hide the entire data area while the client waited. That would look like a blank page, not a deliberate loading state.

</details>

**Checkpoint:** Why does the query include `.eq("user_id", authData.user.id)` even though auth already succeeded?

<details>
<summary>Reveal answer</summary>

Authentication proves who the user is. It does not automatically scope arbitrary database reads. The project standard is that every query against user-owned data must include the user's id, even when RLS also exists. Without this filter, a bug in policy configuration or a future server-side service role path could leak other users' jobs into the list.

</details>

**Try it yourself:** Run `rg -n "useSearchParams|Suspense fallback" app/find-jobs components/find-jobs` and confirm the hook lives under the boundary.

---

## Part 2 — URL params are view state; agent inputs are not

Open [`components/find-jobs/FindJobsClient.tsx`](../../../components/find-jobs/FindJobsClient.tsx) lines 43–62:

```tsx
export function FindJobsClient({ initialJobs }: Props) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // View state — derived from URL on every render (single source of truth)
  const match = parseMatch(searchParams.get("match"));
  const sort = parseSort(searchParams.get("sort"));
  const page = parsePage(searchParams.get("page"));
  const q = parseQ(searchParams.get("q"));

  // Agent inputs — not URL state; refreshing must not re-trigger the actor
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [jobTitle, setJobTitle] = useState("");
  const [location, setLocation] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [searchStatus, setSearchStatus] = useState<SearchStatus | null>(null);

  // Display state — local draft for the text input only
  const [filterTextDraft, setFilterTextDraft] = useState(q);
```

The core split is between *view state* and *action input state*. `match`, `sort`, `page`, and `q` describe how to look at saved job history. They should survive refresh, copy-paste, and back navigation, so they are read from the URL on every render. `jobTitle` and `location` are inputs to the discovery action. Putting them in the URL would imply that loading `/find-jobs?jobTitle=React` should run an actor, which would be expensive and surprising.

`jobs` is local state even though it starts from server data. That matters after a search completes: the API route returns newly saved jobs immediately, and the client merges them without waiting for a server refresh. This is a deliberate evolution from Tutorial 15. `router.refresh()` re-renders Server Components, but Next's docs say it merges the payload without losing unaffected client state like `useState`. Since `jobs` is already in `useState`, a refresh would not replace it unless an extra sync effect copied props into state.

**Checkpoint:** Why does `useSearchParams()` cause the component to see a new query value when the browser Back button changes the URL, but not because unrelated React state changes?

<details>
<summary>Reveal answer</summary>

`useSearchParams()` is subscribed to the router's current URL state. When Back changes the browser history entry, Next's router observes a new URL and causes components using navigation hooks to render with the new `ReadonlyURLSearchParams`. A local React state update can also re-render the component, but it does not mutate the URL, so `searchParams.get("q")` returns the same value. The underlying mechanism is the router state changing, not React state changing by itself.

</details>

**Checkpoint:** The filter, sort, and page are in the URL, but `jobTitle` and `location` are in `useState`. What is the principle that determined which goes where?

<details>
<summary>Reveal answer</summary>

The principle is whether the value describes the current view or triggers work. View state answers "what am I looking at right now?" and belongs in the URL because it should survive navigation. Action input state answers "what will happen if I press this button?" and stays local because loading or sharing the URL should not execute an actor run.

</details>

**Checkpoint:** If two tabs are open to the same Find Jobs page and one tab runs a search, what happens to the other tab's URL state?

<details>
<summary>Reveal answer</summary>

Nothing. URL state is per browser tab history entry. Running a search in one tab may write new jobs to the database, but it does not mutate the other tab's current URL. If the other tab refreshes, it will fetch the updated saved job history while preserving whatever query string that tab already had.

</details>

**Try it yourself:** Open `components/find-jobs/FindJobsClient.tsx` and mark each state variable as one of: URL view state, local action input, local display state, or local data cache.

---

## Part 3 — Debounced text input: draft first, URL later

Open [`components/find-jobs/FindJobsClient.tsx`](../../../components/find-jobs/FindJobsClient.tsx) lines 64–82:

```tsx
  // Sync draft when URL q changes externally (back/forward navigation).
  // Calling setState in an effect is intentional here: we are syncing an
  // external system (the URL) to local display state. The debounce effect's
  // guard (filterTextDraft === q) prevents a URL replace loop.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFilterTextDraft(q);
  }, [q]);

  // Debounce draft → URL; guard prevents replace loop after back-nav sync
  useEffect(() => {
    if (filterTextDraft === q) return;
    const timeout = window.setTimeout(() => {
      replaceViewState({ q: filterTextDraft, page: 1 });
    }, 300);
    return () => window.clearTimeout(timeout);
    // replaceViewState is stable (defined below in render scope) — intentionally omitted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterTextDraft]);
```

The text input is the one exception to "read URL params directly." If the input wrote to the URL on every keystroke, typing `react` would cause five router updates. The visible input would be tied to navigation work. Feature 11 avoids that by separating display state (`filterTextDraft`) from view state (`q`). The draft changes immediately; the URL changes after 300ms of no typing.

The first effect handles external URL changes, especially browser back/forward. When the URL says `q=react`, the displayed input must show `react`. ESLint flags set-state-in-effect because many effects are unnecessary state mirrors. This one is intentional because the external system is the browser URL, not a React prop that could be derived during render.

The guard in the second effect prevents a replace loop. If back navigation changes `q`, the first effect updates the draft. Without `if (filterTextDraft === q) return`, the second effect would write the same value back to the URL, causing another render and another sync.

**Checkpoint:** Describe the exact sequence of events when a user types `react` into the text filter. Which state updates happen immediately, and which are delayed?

<details>
<summary>Reveal answer</summary>

Each keystroke calls `setFilterTextDraft`, so the input displays `r`, `re`, `rea`, `reac`, and `react` immediately. Each draft change schedules a 300ms timeout and clears the previous timeout. Only after typing pauses does the last timeout call `replaceViewState({ q: "react", page: 1 })`. The table filter uses URL `q`, so the actual filtered list updates when the URL changes, not on every keystroke.

</details>

**Checkpoint:** The sync `useEffect` calls `setFilterTextDraft(q)`. Why was this flagged by ESLint, and why is it correct here despite the warning?

<details>
<summary>Reveal answer</summary>

It was flagged because setting state in an effect often means derived state is being copied unnecessarily. Here the effect is synchronizing an external system, the browser URL, into local display state. The input needs a local draft for responsiveness, but that draft must also reflect back/forward changes. The guard in the debounce effect prevents the usual synchronization loop.

</details>

**Checkpoint:** If the debounce delay were `0ms` instead of `300ms`, the guard would still prevent loops on back navigation. What UX problem would `0ms` cause?

<details>
<summary>Reveal answer</summary>

It would still update the URL on every keystroke. The input would remain logically correct, but each keypress would schedule navigation work, mutate browser history state, and re-render the client tree. The user would feel input jank, and the URL would flicker through every intermediate query.

</details>

**Try it yourself:** Temporarily change `300` to `1000`, type in the filter, and watch how the input changes immediately while the URL waits. Restore `300` afterward.

---

## Part 4 — Replace, don't push, when refining the same view

Open [`components/find-jobs/FindJobsClient.tsx`](../../../components/find-jobs/FindJobsClient.tsx) lines 84–99 and 214–233:

```tsx
  function replaceViewState(updates: {
    q?: string;
    match?: MatchFilter;
    sort?: Sort;
    page?: number;
  }) {
    const params = new URLSearchParams(searchParams.toString());
    if ("q" in updates) {
      if (updates.q) params.set("q", updates.q);
      else params.delete("q");
    }
    if ("match" in updates) params.set("match", updates.match!);
    if ("sort" in updates) params.set("sort", updates.sort!);
    if ("page" in updates) params.set("page", String(updates.page));
    router.replace(`${pathname}?${params.toString()}`);
  }
```

```tsx
      <div className="bg-surface border border-border rounded-2xl shadow-sm">
        <JobFilters
          filterText={filterTextDraft}
          matchFilter={match}
          sort={sort}
          onFilterTextChange={setFilterTextDraft}
          onMatchFilterChange={(next) =>
            replaceViewState({ match: next, page: 1 })
          }
          onSortChange={(next) => replaceViewState({ sort: next, page: 1 })}
        />
        <JobsTable jobs={pageItems} hasNoHistory={jobs.length === 0} />
        <JobsPagination
          page={safePage}
          totalPages={totalPages}
          totalCount={totalCount}
          startIdx={startIdx}
          pageNumbers={pageNumbers}
          pageSize={PAGE_SIZE}
          onPageChange={(p) => replaceViewState({ page: p })}
        />
```

`replaceViewState()` is the single write path for URL view state. It preserves existing params, applies the requested update, and uses `router.replace()`. This is the history-stack decision: filters, sorts, and page changes refine the same screen. They should overwrite the current history entry, not add a trail of intermediate entries.

The difference becomes visible after Feature 12 row navigation. Row click navigation should use `push` because `/find-jobs/[id]` is a different page. Filter changes use `replace` because `/find-jobs?match=high` is the same page with a refined projection.

**Checkpoint:** A user applies five filter combinations on Find Jobs, then clicks a job row, reads it, and presses Back. How many times must they press Back to leave Find Jobs entirely with `replace` versus `push` for filter changes?

<details>
<summary>Reveal answer</summary>

With `replace`, one Back press returns from job detail to the last filtered Find Jobs URL, and one more Back press leaves Find Jobs. With `push`, every filter change added an entry, so after returning from job detail the user must press Back through each intermediate filter state before leaving the page.

</details>

**Checkpoint:** A "clear all filters" button calls `replaceViewState({ q: "", match: "all", sort: "score", page: 1 })`. Should it use `replace` or `push`?

<details>
<summary>Reveal answer</summary>

It should use `replace`. Clearing filters is still a refinement of the current Find Jobs view. It is not navigation to a new conceptual page. Using `push` would make the Back button restore the previous filtered state instead of leaving the page.

</details>

**Checkpoint:** Feature 12 uses `router.push()` for row navigation. Feature 11 uses `router.replace()` for filter changes. What is the distinguishing question?

<details>
<summary>Reveal answer</summary>

Ask: "Is the user going to a different place, or changing how this same place is displayed?" A different place gets `push`. A refined display of the same place gets `replace`.

</details>

**Try it yourself:** Change one filter handler to `router.push` locally, make several filter changes in the browser, then use Back. Restore the code after observing the history behavior.

---

## Part 5 — Merging search results without stale closures

Open [`components/find-jobs/FindJobsClient.tsx`](../../../components/find-jobs/FindJobsClient.tsx) lines 101–137:

```tsx
  async function handleSearch() {
    setIsLoading(true);
    try {
      const res = await fetch("/api/agent/find", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobTitle, location }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        console.error("[FindJobsClient] search failed:", data?.error);
        return;
      }

      // Merge by id — functional form avoids stale closure if searches overlap
      setJobs((currentJobs) => {
        const merged = new Map(currentJobs.map((job) => [job.id, job]));
        for (const job of data.jobs as Job[]) {
          merged.set(job.id, job);
        }
        return [...merged.values()];
      });

      setSearchStatus({
        jobsFound: data.jobsFound,
        strongMatches: data.strongMatches,
      });

      // Reset to page 1 — preserve q, match, sort
      replaceViewState({ page: 1 });
    } catch (error) {
      console.error("[FindJobsClient] search error:", error);
    } finally {
      setIsLoading(false);
    }
  }
```

Before this feature, the tempting implementation was `setJobs(data.jobs)`. That made the visible list equal to only the latest search run. Existing saved job history disappeared from the table until refresh. Feature 11 treats search results as additions to saved history, not as a replacement for history.

The functional setter protects the merge from stale closures. If two search requests overlap, both handlers may have closed over the same old `jobs` value. The non-functional form would merge against that stale snapshot and whichever request finishes last would overwrite the other. The functional form receives `currentJobs` at application time, so each search merges into the actual latest list.

Only `page` resets after the merge. `q`, `match`, and `sort` represent deliberate view preferences. Resetting them would erase the user's refinements just because new data arrived.

**Checkpoint:** Write out the exact failure scenario where the closure form produces incorrect results. What job data is lost, and under what timing conditions?

<details>
<summary>Reveal answer</summary>

Search A and search B both start while `jobs` contains `[old1]`. Search A returns `[a1]` and sets jobs to `[old1, a1]`. Search B returns later, but its closure also captured `[old1]`, so it merges `[old1, b1]` and sets that as the state. `a1` is lost from the UI even though it was already saved. This happens when async requests overlap or React batches state updates based on old render snapshots.

</details>

**Checkpoint:** After `handleSearch` completes, why reset only `page`? What would break if `match` were also reset?

<details>
<summary>Reveal answer</summary>

The result list changed size, so staying on page 5 may no longer be the best display; page 1 gives the user the top of the newly merged result set. But `match` is the user's chosen refinement. If the user is viewing High Match jobs and runs another search, resetting `match` to All would show jobs they explicitly filtered out.

</details>

**Try it yourself:** Search for `setJobs(` in `FindJobsClient.tsx` and confirm the only result update that depends on previous jobs uses the functional form.

---

## Part 6 — Filter and sort semantics: null is a third category

Open [`components/find-jobs/FindJobsClient.tsx`](../../../components/find-jobs/FindJobsClient.tsx) lines 139–176:

```tsx
  const filtered = useMemo(() => {
    let result = [...jobs];

    if (match === "high") {
      result = result.filter(
        (j) => j.match_score != null && j.match_score >= MATCH_THRESHOLD,
      );
    } else if (match === "low") {
      result = result.filter(
        (j) => j.match_score != null && j.match_score < MATCH_THRESHOLD,
      );
    }

    if (q.trim()) {
      const lower = q.toLowerCase();
      result = result.filter(
        (j) =>
          j.company?.toLowerCase().includes(lower) ||
          j.title?.toLowerCase().includes(lower),
      );
    }

    if (sort === "score") {
      result.sort((a, b) => (b.match_score ?? -1) - (a.match_score ?? -1));
    } else if (sort === "newest") {
      result.sort(
        (a, b) =>
          new Date(b.found_at).getTime() - new Date(a.found_at).getTime(),
      );
    } else {
      result.sort(
        (a, b) =>
          new Date(a.found_at).getTime() - new Date(b.found_at).getTime(),
      );
    }

    return result;
  }, [jobs, match, q, sort]);
```

The key line is `j.match_score != null`. This is intentionally loose: it rejects both `null` and `undefined`. The database type is nullable, but JavaScript data can become `undefined` when objects come from partial fixtures, JSON transformations, or future API paths that omit a field. The product meaning stays the same: no score exists.

The rejected pattern is `job.match_score ?? 0`. That converts "not scored" into "scored as zero." Users lose the ability to distinguish an incomplete AI result from a genuinely poor match. Feature 11 keeps unscored jobs in All Matches, excludes them from High and Low, and displays a dash in the score cell.

The sort still uses `(match_score ?? -1)` for Match Score ordering. That is not a product label; it is only an ordering trick so unscored jobs fall to the bottom when sorting by score.

**Checkpoint:** `job.match_score ?? 0` puts unscored jobs in Low Match. `job.match_score != null` excludes them from High and Low. What specifically does a user lose with the `?? 0` approach?

<details>
<summary>Reveal answer</summary>

They lose the distinction between "the system has not scored this job" and "the system scored this job as a bad match." The first is incomplete information; the second is negative information. Treating both as 0% can cause a user to ignore a job that may become a good match once scoring completes or is repaired.

</details>

**Checkpoint:** In what specific scenario in this codebase could `match_score` be `undefined` at runtime even though the TypeScript type says `number | null`?

<details>
<summary>Reveal answer</summary>

It can happen when data enters through a partial JavaScript object rather than a full database row: a test fixture, a mocked API response, or a future route that serializes only selected job fields. TypeScript describes intended shapes at compile time, but it cannot guarantee every runtime object from JSON includes every key.

</details>

**Try it yourself:** Temporarily change the low filter to `(j.match_score ?? 0) < MATCH_THRESHOLD`, add or mock a job with `match_score: null`, and observe that it appears under Low Match. Restore the correct check.

---

## Part 7 — The table renders product semantics, not raw fields

Open [`components/find-jobs/JobsTable.tsx`](../../../components/find-jobs/JobsTable.tsx) lines 27–105:

```tsx
export function JobsTable({ jobs, hasNoHistory }: Props) {
  return (
    <table className="w-full">
      <thead>
        <tr>
          <th className="px-6 py-3 text-left text-xs font-medium text-text-secondary uppercase tracking-wide">
            Company
          </th>
          <th className="px-6 py-3 text-left text-xs font-medium text-text-secondary uppercase tracking-wide">
            Role
          </th>
          <th className="px-6 py-3 text-left text-xs font-medium text-text-secondary uppercase tracking-wide">
            Match Score
          </th>
          <th className="px-6 py-3 text-left text-xs font-medium text-text-secondary uppercase tracking-wide">
            Salary Est.
          </th>
          <th className="px-6 py-3 text-left text-xs font-medium text-text-secondary uppercase tracking-wide">
            Provider
          </th>
          <th className="px-6 py-3 text-left text-xs font-medium text-text-secondary uppercase tracking-wide">
            Date Found
          </th>
        </tr>
      </thead>
      <tbody>
        {jobs.length === 0 ? (
          <tr>
            <td
              colSpan={6}
              className="px-6 py-12 text-center text-sm text-text-muted"
            >
              {hasNoHistory
                ? "Run a search above to find your first jobs."
                : "No jobs match your filters."}
            </td>
          </tr>
        ) : (
          jobs.map((job) => (
            <tr
              key={job.id}
              className="border-t border-border hover:bg-surface-secondary transition-colors cursor-pointer"
            >
              <td className="px-6 py-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-surface-tertiary border border-border rounded-md flex items-center justify-center shrink-0">
                    <Building2 size={16} className="text-text-muted" />
                  </div>
                  <span className="text-sm font-semibold text-text-primary">
                    {job.company ?? "—"}
                  </span>
                </div>
              </td>
              <td className="px-6 py-4 text-sm text-text-primary">
                {job.title ?? "—"}
              </td>
              <td className="px-6 py-4">
                {job.match_score != null ? (
                  <MatchScoreBar score={job.match_score} />
                ) : (
                  <span className="text-sm text-text-muted">—</span>
                )}
              </td>
              <td className="px-6 py-4 text-sm text-text-primary">
                {job.salary ?? "—"}
              </td>
              <td className="px-6 py-4 text-sm text-text-primary">
                {job.source_provider ?? "—"}
              </td>
              <td className="px-6 py-4 text-sm text-text-muted">
                {formatRelativeDate(job.found_at)}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
```

Two empty states prevent misleading copy. If the user has no saved jobs at all, the fix is to run a search. If saved jobs exist but filters exclude them, the fix is to adjust filters. `hasNoHistory` lets the presentational table choose the right message without owning filter logic.

The Provider column replaces Source because `source` answers how a job entered the system (`search` or `url`), while `source_provider` answers where it came from (`jobsdb_hk` or `adzuna`). In the current system all rows are search-sourced, so SOURCE was uninformative. Provider carries the distinction introduced in Feature 10b.

**Checkpoint:** Why are there two empty states instead of one generic "No results" message?

<details>
<summary>Reveal answer</summary>

The recovery action is different. With no saved history, there is nothing to filter; the user needs to run a search. With filters excluding all saved jobs, the user needs to clear or change filters. A single message would either hide the first-search prompt or imply saved jobs exist when they do not.

</details>

**Checkpoint:** Why is Provider more useful than Source on this table?

<details>
<summary>Reveal answer</summary>

`source` currently has almost no variation: jobs enter through search. `source_provider` distinguishes JobsDB from Adzuna, which is the real user-visible provenance after Feature 10b. It also keeps the two concepts orthogonal instead of overloading one column.

</details>

**Try it yourself:** Search `source_provider` across the codebase and compare where it is written in Feature 10b versus where it is rendered here.

---

## Part 8 — Windowed pagination and one owner for page size

Open [`components/find-jobs/FindJobsClient.tsx`](../../../components/find-jobs/FindJobsClient.tsx) lines 178–200:

```tsx
  const totalCount = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(startIdx, startIdx + PAGE_SIZE);

  const pageNumbers = useMemo((): (number | "...")[] => {
    if (totalPages <= 5) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const neighbours = new Set(
      [1, totalPages, safePage, safePage - 1, safePage + 1].filter(
        (p) => p >= 1 && p <= totalPages,
      ),
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

Open [`components/find-jobs/JobsPagination.tsx`](../../../components/find-jobs/JobsPagination.tsx) lines 3–20:

```tsx
type Props = {
  page: number;
  totalPages: number;
  totalCount: number;
  startIdx: number;
  pageNumbers: (number | "...")[];
  pageSize: number;
  onPageChange: (page: number) => void;
};

export function JobsPagination({
  page,
  totalPages,
  totalCount,
  startIdx,
  pageNumbers,
  pageSize,
  onPageChange,
}: Props) {
```

`PAGE_SIZE` lives in `FindJobsClient` because that is where slicing happens. `JobsPagination` receives `pageSize` only so the label can say "Showing X to Y." This avoids a drift bug where the list slices 20 items but the label thinks pages contain 6.

`safePage = Math.min(page, totalPages)` prevents an empty table when filters shrink the result set. If the URL says `page=5` but High Match has only 2 pages, the component renders page 2. It does not rewrite the URL, because the invalid page is a temporary consequence of filtering, not an error that needs a redirect.

The page-number algorithm always shows first, last, and current page with one neighbor on each side. A naive `[1, 2, 3, "...", last]` list hides the current page when the user is on page 6.

**Checkpoint:** The windowed page algorithm uses a `Set` of `{1, totalPages, safePage, safePage - 1, safePage + 1}`. If the user is on page 1 of 10, which pages end up in the set, and what does the rendered list look like?

<details>
<summary>Reveal answer</summary>

The raw values are `{1, 10, 1, 0, 2}`. Filtering removes `0`, and the Set removes duplicate `1`, leaving `{1, 2, 10}`. Sorted and gap-filled, it renders `[1, 2, "...", 10]`.

</details>

**Checkpoint:** A user is on page 5 of All Matches, then switches to High Match, which has only 2 pages. What is `safePage`, and what does the user see?

<details>
<summary>Reveal answer</summary>

`safePage = Math.min(5, 2)`, so `safePage` is `2`. The user sees the second page of High Match results rather than an empty table. The URL can still say `page=5`, but the rendered view clamps to the last valid page.

</details>

**Try it yourself:** In a scratch note, compute the page list for page 5 of 12. You should get `[1, "...", 4, 5, 6, "...", 12]`.

---

## Full data flow: typing a filter, running a search, and preserving the view

1. The server route fetches saved jobs for the authenticated user in [`app/find-jobs/page.tsx`](../../../app/find-jobs/page.tsx) lines 12–25.
2. The server wraps [`FindJobsClient`](../../../components/find-jobs/FindJobsClient.tsx) in Suspense at lines 32–34 because the client component uses `useSearchParams()`.
3. `FindJobsClient` reads `q`, `match`, `sort`, and `page` from the URL at lines 48–52.
4. The user types into `JobFilters`; the presentational input calls `onFilterTextChange` in [`JobFilters.tsx`](../../../components/find-jobs/JobFilters.tsx) lines 38–43.
5. `FindJobsClient` receives that as `setFilterTextDraft` at lines 215–219, so the input updates immediately.
6. After 300ms, the debounce effect calls `replaceViewState({ q: filterTextDraft, page: 1 })` at lines 73–82.
7. `replaceViewState()` writes the new query string via `router.replace()` at lines 84–99.
8. `useSearchParams()` re-renders the client with the new URL. The `useMemo` filter reads URL `q`, not the draft, at lines 139–176.
9. If the user runs a discovery search, `handleSearch()` posts `jobTitle` and `location` to `/api/agent/find` at lines 101–108.
10. Returned jobs merge into local history with functional `setJobs(currentJobs => ...)` at lines 116–123.
11. The search reset writes only `{ page: 1 }` at line 131, preserving the user's `q`, `match`, and `sort`.
12. The final table receives `pageItems`, and pagination receives `safePage`, `pageNumbers`, and `PAGE_SIZE` at lines 225–233.

---

## Extend it (challenges)

**Challenge 1 — Trace** (15–20 min): Follow the value `match=high` from the URL into the rendered table. Write down each function or prop it passes through.

<details>
<summary>Hint</summary>

Start at `useSearchParams()`, then `parseMatch`, then the `useMemo` filter, then `JobFilters` and `JobsTable` props.

</details>

**Challenge 2 — Extend** (20–30 min): Add a "Provider" filter with `all`, `jobsdb_hk`, and `adzuna`, keeping it in the URL like `provider=jobsdb_hk`.

<details>
<summary>Hint</summary>

Follow the `match` pattern: add a type in `JobFilters`, a parse helper in `FindJobsClient`, a select control, a `replaceViewState` key, and a filter branch in `useMemo`.

</details>

**Challenge 3 — Break and fix / Design** (30–45 min): Temporarily change `router.replace()` to `router.push()` in `replaceViewState`, perform several refinements, and document the exact Back-button behavior. Then restore `replace` and write a one-paragraph rule for future features.

<details>
<summary>Hint</summary>

Use a route sequence like `/dashboard → /find-jobs → filter high → sort newest → page 2`. The rule should distinguish refinements from navigation.

</details>

---

For deeper exploration, `docs/plan/11-filter-sort-pagination/ai-discussion-topics.md` has 15 prompts covering URL state, debounce effects, history stack behavior, merge semantics, null handling, and pagination. Feed them to an LLM *after* forming your own answer first — the gap between what you thought and what you learn is where understanding lands.
