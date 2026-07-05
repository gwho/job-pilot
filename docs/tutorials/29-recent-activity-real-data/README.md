# Tutorial 29 — Recent Activity Real Data: JSONB Extraction, flatMap Filtering, and Two-Source Feed Merging

**After completing this tutorial you will understand:** why `found_at` is the wrong timestamp for research events even though it lives on the same row, and how to correctly extract `researchedAt` from a JSONB column in JavaScript; why `.flatMap()` with `return []` / `return [item]` solves a TypeScript narrowing problem that `.filter().map()` cannot; how an intermediate type (`ActivityCandidate`) carries a temporary sort key through a transformation pipeline without leaking into the component's props; why merging two data sources into a single chronological feed requires no per-source quota; and why `company_research IS NOT NULL` is a sufficient filter for research events given how the research agent is written.

---

> [!NOTE]
> **Prerequisites:** Tutorial 28 (`../28-stats-bar-real-data/README.md`) — covers `Promise.all` for concurrent DB queries, the `[dashboard/stats]` error-logging pattern, and the rule that all data fetching lives in `page.tsx`. This tutorial extends the same `Promise.all` block with two new queries and follows the same degradation contract. Tutorial 27 (`../27-dashboard-page/README.md`) — covers the dashboard's Server/Client boundary and how mock data seams were designed to be swapped in later features. Open [`app/dashboard/page.tsx`](../../../app/dashboard/page.tsx) and [`components/dashboard/RecentActivity.tsx`](../../../components/dashboard/RecentActivity.tsx) alongside this tutorial.

---

## CS & language concepts in this tutorial

| Concept | Where it appears | Category |
|---------|-----------------|----------|
| `flatMap` as transform-and-filter | `researchCandidates` JSONB extraction | Functional programming |
| Type intersection for temporary fields | `type ActivityCandidate = ActivityItem & { sortTs: number }` | Type theory |
| JSONB column extraction in application code | `row.company_research as { researchedAt?: string }` | System design |
| Stable identifiers vs. positional keys | `key={item.id}` replacing `key={index}` | Design patterns |
| Source-local failure degradation | `agentRunsResult.data ?? []` and `researchJobsResult.data ?? []` | System design |
| DB pre-sort as candidate selection, JS re-sort as truth | `found_at` for DB order, `researchedAt` for final order | Algorithms |

---

## How to use an LLM before this tutorial

Budget 25–30 minutes across these five concepts.

### Concept 1 — JSONB and extracting nested data in application code

> "Explain what JSONB is in PostgreSQL. How is it different from a regular `TEXT` column that stores a JSON string? What are the tradeoffs of storing a timestamp like `researchedAt` inside a JSONB column versus as a dedicated `timestamptz` column on the same table? Now: I store `{ researchedAt: '2026-07-05T09:00:00Z', summary: '...' }` as JSONB in a column called `company_research`. I query the row and get the full JSONB object back in JavaScript. How do I safely extract `researchedAt` from the returned value using optional chaining? What TypeScript type annotation would I give the column value? Quiz me: if `company_research` is `null` for a row that was never researched, what does `(row.company_research as { researchedAt?: string } | null)?.researchedAt` evaluate to?"

*What to listen for:* JSONB is a binary-encoded JSON value stored in the database — it is queryable and indexable. Extracting a subfield in JavaScript (after fetching the row) costs no extra DB round-trip but means the database cannot sort or filter by that subfield without raw SQL. Optional chaining (`?.researchedAt`) safely returns `undefined` when the outer value is `null`. The TypeScript annotation `as { researchedAt?: string } | null` teaches the compiler the shape of the opaque JSONB type, which the SDK types as `unknown` or `Json`.

*Practice question:* A row has `company_research = {}` (an empty object). What does the optional chaining expression return? What about `company_research = { researchedAt: '' }` (empty string)?

---

### Concept 2 — `flatMap` as a one-pass transform-and-filter

> "Explain JavaScript's `Array.flatMap()`. How does it differ from calling `.map()` followed by `.flat()`? Show me how to use `.flatMap()` to simultaneously filter and transform an array — specifically, to produce zero output items for some inputs and one output item for others. Compare `.flatMap((x) => x > 10 ? [x * 2] : [])` with `.filter(x => x > 10).map(x => x * 2)` — are they always equivalent? Now explain the TypeScript narrowing problem: after `.filter(row => row.company_research?.researchedAt)`, TypeScript still considers `researchedAt` as potentially `undefined` inside the following `.map()` callback. Why? How does `.flatMap()` with an `if (!researchedAt) return []` guard avoid this problem? Quiz me: I want to filter an array to rows where `foo` is a non-null string, then map each row to `row.foo.toUpperCase()`. Write both approaches and identify where TypeScript will complain with the `.filter().map()` approach."

*What to listen for:* `.flatMap(fn)` applies `fn` to each element and concatenates the results. When `fn` returns `[]`, that element disappears from the output. When `fn` returns `[item]`, it contributes one element. The key advantage over `.filter().map()` is that within the `.flatMap()` callback, after a guard like `if (!researchedAt) return []`, TypeScript knows `researchedAt` is defined — the narrowing holds for the rest of the callback. With `.filter()`, TypeScript does not carry that narrowing into the subsequent `.map()` callback.

*Practice question:* Does `.flatMap((x) => condition ? [transform(x)] : [])` always produce identical output to `.filter(x => condition).map(x => transform(x))`? Are there performance differences?

---

### Concept 3 — Intermediate types for transformation pipelines

> "In a data transformation pipeline, I sometimes need a temporary field that is useful during computation but should not exist in the final output. For example: I sort a list of items by a numeric timestamp, but the final type I pass to a component should only have a formatted string `timeAgo`, not the raw number. What are my options? Could I just delete the field at runtime? Could I use TypeScript to prevent it from escaping? Show me how a type intersection (`type Candidate = FinalType & { sortTs: number }`) lets me extend a type for internal use, then strip the extra field before passing downstream. Quiz me: after `.sort((a, b) => b.sortTs - a.sortTs).slice(0, 10)`, I want to produce `FinalType[]` without `sortTs`. Write the `.map()` call that strips `sortTs` using explicit destructuring."

*What to listen for:* A type intersection (`A & B`) adds all fields of `B` to `A`. Declaring this type inside a function body (not at module level) scopes it so it can't be imported elsewhere — it is implementation detail. The stripping `.map(({ id, type, label, timeAgo }) => ({ id, type, label, timeAgo }))` is explicit destructuring: by naming only the four fields that belong to the final type, TypeScript infers the return type as the exact shape of `FinalType`. No underscore discard needed.

*Practice question:* Could I avoid stripping `sortTs` by just passing `ActivityCandidate[]` to `<RecentActivity>` instead of `ActivityItem[]`? What breaks if I do?

---

### Concept 4 — React list keys: index vs. stable IDs

> "Explain what React's `key` prop is for in list rendering. Why does `key={index}` cause problems when list items can be reordered, inserted, or deleted? Give a concrete example: a list of 3 items keyed by index. I delete the first item. Which DOM node does React reuse, and which does it destroy? Now explain: for a server-rendered list that never re-renders on the client, does `key={index}` cause any actual bug? If it causes no runtime bug, why might you still prefer stable, source-qualified IDs like `search-<uuid>` over index? Quiz me: if two separate database tables (agent_runs and jobs) both use UUID primary keys, could a UUID from one table collide with a UUID from the other? Why or why not? And why would you add a source prefix anyway?"

*What to listen for:* React uses keys to match component instances between renders. With `key={index}`, if item 0 is removed, what was item 1 becomes item 0 — React reuses the DOM node for the old item 0, potentially carrying stale state. For static server-rendered lists (no client-side re-rendering), this never manifests as a visible bug. The source prefix (`search-`, `research-`) is not about collision prevention — UUID collision is astronomically unlikely — but about readability in DevTools and forward-compatibility: if the component ever gains client-side interactivity, the stable keys are already correct.

*Practice question:* A React key shows up as `research-3a7f2c-...` in DevTools. Without looking at the code, what does that tell you about where the item came from?

---

### Concept 5 — Partial failure degradation in composite data views

> "A dashboard page fetches data from multiple independent sources and displays them in separate sections. One data source fails. What should the page do? Explain the two strategies: fail the whole page (throw, show error boundary) vs. degrade the failed section (show empty/default state, keep the rest working). What are the user-experience tradeoffs of each? When would you prefer the 'fail the whole page' approach? Now: if I use `Promise.all` and one SDK query returns `{ data: null, error: <message> }` instead of throwing, how do I detect that in my code? What fallback value do I use so the failed section shows an empty state rather than crashing? Quiz me: in a dashboard with 4 stats and 1 activity feed, the activity feed query fails. Should the stats still display? Write the pseudocode for how you would handle this."

*What to listen for:* For a composite view like a dashboard, section-level degradation is almost always better than a full-page crash. Stats and activity are independent — a broken activity query says nothing about the stats data. The InsForge SDK returns `{ data, error }` rather than throwing, which means `Promise.all` always resolves (it only rejects if a promise throws). Each section checks its own `result.error`, logs it, and falls back to an empty/zero value. This keeps the rest of the dashboard functional.

*Practice question:* If the InsForge SDK threw on every DB error instead of returning `{ data: null, error }`, what would `Promise.all` do when the activity query failed? What would the user see?

---

## Architecture overview

```
  GET /dashboard
        │
        ▼
┌───────────────────────────────────────────────────────────────┐
│  app/dashboard/page.tsx                          SERVER ONLY  │
│                                                               │
│  1. createInsforgeServer() + getCurrentUser()                 │
│     └─ no user → redirect("/login")                          │
│                                                               │
│  2. Profile query (maybeSingle) → isComplete bool            │
│                                                               │
│  3. sevenDaysAgo = getIsoTimestampDaysAgo(7)                  │
│                                                               │
│  4. Promise.all([q1, q2, q3, q4, q5, q6])  ← six concurrent │
│     │   q1–q4: stats queries (Feature 15, unchanged)         │
│     │   q5: agent_runs WHERE status='completed', limit 20    │
│     └─  q6: jobs WHERE company_research IS NOT NULL, limit 20│
│                                                               │
│  5. Log errors with [dashboard/activity] prefix               │
│                                                               │
│  6. Normalize q5 → searchCandidates: ActivityCandidate[]     │
│     Normalize q6 → researchCandidates: ActivityCandidate[]   │
│     (ActivityCandidate = ActivityItem & { sortTs: number })   │
│                                                               │
│  7. Merge → sort by sortTs desc → slice(0,10) → strip sortTs │
│     activityItems: ActivityItem[]                             │
│                                                               │
│  8. <RecentActivity items={activityItems} />                  │
└────────────────────────┬──────────────────────────────────────┘
                         │  props only — no DB in components
                         ▼
         ┌───────────────────────────────────┐
         │  RecentActivity.tsx  (Server)     │
         │  items.length === 0 → empty state │
         │  items.length > 0  → ActivityRow  │
         │  for each item: key={item.id}     │
         └───────────────────────────────────┘
```

**Key invariants:**
1. Every activity query is scoped to `authData.user.id` — the redirect guard above guarantees this is non-null at the query site.
2. Research events use `company_research.researchedAt` as the display and sort timestamp. `found_at` is used only for DB candidate pre-selection.
3. `company_research IS NOT NULL` is the correct filter for research events — no empty objects or partial dossiers can be saved given how `agent/research.ts` is written.

---

## Part 1 — What Feature 16 replaces and adds

Open [`app/dashboard/page.tsx`](../../../app/dashboard/page.tsx), lines 60–106:

```ts
const [
  totalJobsResult,
  scoredJobsResult,
  companiesResult,
  thisWeekResult,
  agentRunsResult,
  researchJobsResult,
] = await Promise.all([
  insforge.database
    .from("jobs")
    .select("*", { count: "exact", head: true })
    .eq("user_id", authData.user.id),

  insforge.database
    .from("jobs")
    .select("match_score")
    .eq("user_id", authData.user.id)
    .not("match_score", "is", null),

  insforge.database
    .from("jobs")
    .select("*", { count: "exact", head: true })
    .eq("user_id", authData.user.id)
    .not("company_research", "is", null),

  insforge.database
    .from("jobs")
    .select("*", { count: "exact", head: true })
    .eq("user_id", authData.user.id)
    .gte("found_at", sevenDaysAgo),

  insforge.database
    .from("agent_runs")
    .select("id, job_title_searched, jobs_found, completed_at")
    .eq("user_id", authData.user.id)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(20),

  insforge.database
    .from("jobs")
    .select("id, company, company_research")
    .eq("user_id", authData.user.id)
    .not("company_research", "is", null)
    .order("found_at", { ascending: false })
    .limit(20),
]);
```

Before Feature 16, `page.tsx` had a hard-coded `mockActivity` array of five items with fixed labels and "2 hours ago" timestamps. It was passed directly to `<RecentActivity items={mockActivity} />`. Feature 16 removes that constant entirely and replaces it with two real database queries — query 5 (`agentRunsResult`) and query 6 (`researchJobsResult`) — added to the same `Promise.all` block established in Tutorial 28.

Adding two queries to an existing `Promise.all` costs nothing in latency. The existing four queries are already the bottleneck; queries 5 and 6 fire at the same time and their results are ready by the time the slowest of the six resolves. As covered in Tutorial 28, `Promise.all` fires all operations simultaneously — the total wait is the time of the slowest individual query, not the sum of all six.

The two new queries are different in shape. Query 5 (`agent_runs`) selects specific columns from a dedicated audit table that records each job search the agent ran. Query 6 (`jobs`) re-queries the `jobs` table — which already appears in queries 1–4 — but this time selects only the `id`, `company`, and `company_research` columns of researched jobs. No schema changes were needed; both tables already existed.

**Checkpoint:** Feature 16 adds two queries to an existing four-query `Promise.all`. The existing queries each take ~30ms. The two new queries also take ~30ms each. What is the new total page wait time, and why?

<details>
<summary>Reveal answer</summary>

The total wait time is still approximately 30ms — the time of the slowest single query. Adding more independent queries to `Promise.all` does not increase the total wait time as long as those queries can run concurrently. All six fire at the same moment. The outer `await` resolves when the last one finishes. If the two new queries are slightly slower than the original four (say, 35ms), the new total is ~35ms, not 120ms + 60ms.

</details>

---

## Part 2 — The timestamp problem: why `found_at` is wrong for research events

The most consequential decision in Feature 16 is invisible in the final code: the choice of which timestamp to use for research events.

The `jobs` table has a column `found_at` that records when the job was scraped and saved. It also has a `company_research` JSONB column containing the dossier. A developer in a hurry might reach for `found_at` as the research event timestamp — it is available at the top level, sortable by the database, and already in scope from the other queries.

But `found_at` and "when research ran" are different moments in time with no guaranteed relationship. A user might save a job on Monday, browse their saved jobs on Wednesday, and research that company on Thursday. Using `found_at` as the research timestamp would show "4 days ago" in the activity feed for something that happened today. The Recent Activity feed would silently lie.

The correct timestamp is `researchedAt`. Open [`agent/research.ts`](../../../agent/research.ts) and search for `researchedAt` — line 283 writes it into the dossier on every successful synthesis:

```ts
researchedAt: new Date().toISOString(),
```

This field is the moment the dossier was synthesized — the actual research event time. To use it, the query selects `company_research` (the full JSONB column) along with `id` and `company`:

```ts
insforge.database
  .from("jobs")
  .select("id, company, company_research")
  .eq("user_id", authData.user.id)
  .not("company_research", "is", null)
  .order("found_at", { ascending: false })
  .limit(20)
```

`found_at` is still used here — but only as a sort key for candidate selection. The query asks the database: "give me the 20 most recently found researched jobs." Then, in JavaScript, `researchedAt` is extracted from each row's JSONB and used for the actual display and ordering logic.

This two-level sort is necessary because the InsForge SDK cannot sort by a JSONB subfield. Sorting by `(company_research->>'researchedAt')::timestamptz` requires raw SQL. The tradeoff is a bounded approximation: if a user has more than 20 researched jobs and the most recently researched one was attached to a very old job (outside the top 20 by `found_at`), it will not appear in the feed. Fetching 20 candidates — more than the 10 the feed displays — widens the selection pool and makes this edge case extremely unlikely in normal usage.

> **System design — DB pre-sort as candidate selection, JS re-sort as truth:** This two-phase pattern is common when the sort key lives in a format the database cannot efficiently use (JSONB subfields, computed values, fields in joined tables). Phase 1 uses an approximate DB-level sort to narrow the pool. Phase 2 re-sorts in application code using the correct value. The key design requirement is that the pool in Phase 1 must be larger than the final output — here, 20 candidates for 10 displayed items.

**Checkpoint:** A user finds a job on July 1st and researches it on July 5th. The feed uses `found_at`. What does the activity entry show for "Researched Stripe"? What should it show?

<details>
<summary>Reveal answer</summary>

With `found_at` as the timestamp: if today is July 5th, the entry shows "4 days ago" — the age of the job discovery, not the research event. The correct display is "Just now" or "X hours ago" — the age of the research event (July 5th). Using `found_at` produces a factually wrong feed. The user performed research today; the feed claims it happened four days ago. This erodes trust in the dashboard because the "Recent Activity" data no longer represents when the user actually acted.

</details>

---

## Part 3 — Why `company_research IS NOT NULL` is sufficient

The filter `.not("company_research", "is", null)` is used in two places in `page.tsx`: in query 3 (counting researched companies for the stats bar) and in query 6 (fetching research candidates for the activity feed). A reasonable question is whether this filter can produce false positives — could a row exist where `company_research` is not null, but research actually failed?

If the research agent saved `{}` (an empty object) or a partial dossier on failure, `IS NOT NULL` would match those rows, and the activity feed would show "Researched [company]" for a job that was never actually researched.

To verify this cannot happen, read `agent/research.ts`. The critical path is:

```
synthesizeDossier(content, job, profile)   ← always runs
  └─ throws if Nemotron returns empty content
  └─ throws if JSON parsing fails

if synthesis succeeds:
  insforge.database.from("jobs").update({ company_research: dossier })
  ← this line only runs if synthesizeDossier returned without throwing
```

There are two failure paths:
- **Nemotron returns empty content** — `synthesizeDossier` throws.
- **JSON parsing fails** — `synthesizeDossier` throws.

In both cases, the throw propagates up to `researchCompany`, which propagates to the API route. The `.update()` line never executes. `company_research` remains `NULL`.

When `synthesizeDossier` does complete successfully, it writes a full dossier object that includes `researchedAt` and string/array fallbacks for every other field. There is no code path that saves `{}` or an empty object.

Conclusion: `company_research IS NOT NULL` accurately means "synthesis ran and saved a complete dossier." The filter is not just convenient — it is correct by code invariant.

> **System design — Filter safety through code invariant:** The correctness of `IS NOT NULL` depends not on the database schema but on a specific code path in `agent/research.ts`. This is an implicit invariant: any developer who changes `researchCompany` to catch the Nemotron throw and save a partial dossier instead would silently break this filter. The `plan.md` invariants section documents this dependency explicitly so future developers know the filter is load-bearing.

**Checkpoint:** A future developer changes `agent/research.ts` to catch the `synthesizeDossier` throw and save `company_research: {}` instead of propagating the error. What changes in the activity feed?

<details>
<summary>Reveal answer</summary>

"Researched [company]" entries would appear in the activity feed for jobs where research failed. `company_research IS NOT NULL` would now match rows with `{}`. The `flatMap` callback would try to extract `researchedAt` from `{}` — get `undefined` — and hit the `if (!researchedAt) return []` guard, so those rows would be filtered out. The activity feed would stay correct. However, the stats bar stat "Companies Researched" (query 3) uses the same `IS NOT NULL` filter and would now count failed-research jobs as researched companies. That stat would be wrong. The fix: if partial saves are ever introduced, a separate `research_status` column or a check for `company_research.researchedAt` existence is needed.

</details>

---

## Part 4 — The `agent_runs` query: why `status = "completed"` only

Open [`app/dashboard/page.tsx`](../../../app/dashboard/page.tsx), lines 91–97:

```ts
insforge.database
  .from("agent_runs")
  .select("id, job_title_searched, jobs_found, completed_at")
  .eq("user_id", authData.user.id)
  .eq("status", "completed")
  .order("completed_at", { ascending: false })
  .limit(20),
```

The `agent_runs` table records every search run the agent starts. A row is created when the search begins and updated as it progresses. The `status` field can be `"running"`, `"failed"`, or `"completed"`.

The filter `.eq("status", "completed")` is load-bearing for two reasons:

1. **Data availability.** `completed_at` and `jobs_found` are only populated when a run finishes successfully. For `"running"` rows, `completed_at` is `null` and `jobs_found` may be `null`. Including them would require special-casing every field: `r.completed_at ?? now`, `r.jobs_found ?? 0`. The logic becomes defensive for a case that should never appear in the feed at all.

2. **Semantic correctness.** The activity feed represents what the user accomplished. A `"running"` search has not yet produced a result. A `"failed"` search is an operational event — it is not a user achievement. Neither belongs in "Recent Activity." Only a completed search, which definitively added jobs to the user's saved list, belongs there.

The code also filters defensively after the query resolves — only rows where `completed_at` is truthy are processed:

```ts
const searchCandidates: ActivityCandidate[] = (agentRunsResult.data ?? [])
  .filter((r) => !!r.completed_at)
  .map((r) => ({
    id: `search-${r.id}`,
    type: "search" as const,
    label: `Found ${r.jobs_found ?? 0} jobs for ${r.job_title_searched ?? "your search"}`,
    timeAgo: formatRelativeDate(r.completed_at as string),
    sortTs: new Date(r.completed_at as string).getTime(),
  }));
```

The `.filter((r) => !!r.completed_at)` guard is technically redundant given the `.eq("status", "completed")` filter — all completed rows should have `completed_at` set. But TypeScript types `completed_at` as `string | null` because the column is nullable in the schema. The filter narrows the type from `string | null` to `string`, allowing the subsequent `.map()` to use `r.completed_at as string` without a non-null assertion that would look wrong to a future reader.

**Checkpoint:** Why is `.eq("status", "failed")` not equivalent to `.not("status", "eq", "completed")`? What difference does this make for rows with `status = "running"`?

<details>
<summary>Reveal answer</summary>

`.eq("status", "failed")` matches only failed rows, excluding both running and completed. `.not("status", "eq", "completed")` matches running AND failed — everything that is not completed. Neither is what we want. The correct filter is `.eq("status", "completed")` — include only the rows that represent a successful, finished search run. Using a negative filter like `not eq "completed"` would include running rows, whose `completed_at` is null, requiring extra defensive handling and producing wrong activity labels like "Found 0 jobs for your search" for in-progress searches.

</details>

---

## Part 5 — `flatMap` for JSONB extraction: the TypeScript narrowing solution

Open [`app/dashboard/page.tsx`](../../../app/dashboard/page.tsx), lines 153–169:

```ts
const researchCandidates: ActivityCandidate[] = (researchJobsResult.data ?? [])
  .flatMap((row) => {
    const researchedAt = (row.company_research as { researchedAt?: string } | null)
      ?.researchedAt;
    if (!researchedAt) return [];
    const ts = new Date(researchedAt).getTime();
    if (isNaN(ts)) return [];
    return [
      {
        id: `research-${row.id}`,
        type: "research" as const,
        label: `Researched ${row.company ?? "company"}`,
        timeAgo: formatRelativeDate(researchedAt),
        sortTs: ts,
      },
    ];
  });
```

Each row from `researchJobsResult.data` contains a `company_research` field typed as `unknown` or `Json` by the SDK — the SDK has no knowledge of the JSONB column's internal structure. The cast `(row.company_research as { researchedAt?: string } | null)` tells TypeScript the shape to expect. The `?.researchedAt` optional chain then safely extracts the timestamp string, or returns `undefined` if the outer value is `null` or the field does not exist.

The first guard `if (!researchedAt) return []` handles two cases: `company_research` is `null` (already excluded by the query filter, but defensible) or `researchedAt` is an empty string or missing from the JSONB. The second guard `if (isNaN(ts)) return []` handles a malformed timestamp string — `new Date("garbage").getTime()` returns `NaN`, which would silently corrupt the sort order if allowed through.

The `.flatMap()` pattern is the right tool here because it is a one-pass transform-and-filter. Returning `[]` drops the row; returning `[item]` keeps it. Compare this to `.filter().map()`:

```ts
// .filter().map() — has a TypeScript narrowing problem
(researchJobsResult.data ?? [])
  .filter((row) => {
    const r = (row.company_research as { researchedAt?: string } | null)?.researchedAt;
    return !!r;
  })
  .map((row) => {
    const researchedAt = (row.company_research as { researchedAt?: string } | null)
      ?.researchedAt; // TypeScript still considers this string | undefined
    // Must use non-null assertion: researchedAt! — or extract again
    ...
  })
```

After the `.filter()`, TypeScript does not carry the narrowing into the `.map()` callback — it still considers `researchedAt` as `string | undefined`. You would need to extract the value again inside `.map()`, or use a type predicate function, or use a non-null assertion (`!`). `.flatMap()` avoids this entirely: within the same callback, after `if (!researchedAt) return []`, TypeScript knows `researchedAt` is a non-empty string for the rest of the callback.

> **Functional programming — `flatMap` as transform-and-filter:** `flatMap(fn)` applies `fn` to each element and concatenates the resulting arrays. When `fn` returns `[]`, the input is dropped. When `fn` returns `[x]`, the input becomes one output element. This is sometimes called "filterMap" in other languages (Rust calls it `filter_map`, Scala calls it `collect`). It is the idiomatic solution to the "produce zero or one output item per input item" pattern — cleaner than a separate filter pass because the filtering condition and the transformation logic share the same scope.

**Checkpoint:** The `isNaN(ts)` guard is described as "defensive." Given that `researchedAt` is always written by `new Date().toISOString()`, can `isNaN(ts)` ever be `true` in production? What is the cost of including it?

<details>
<summary>Reveal answer</summary>

Under normal operation, `isNaN(ts)` cannot be `true` — `new Date().toISOString()` always produces a valid ISO 8601 string, and `new Date(validISOString).getTime()` always returns a finite number. However, if `company_research` were ever written by a different code path (a database migration, a manual insert, a future agent variant) that uses a different timestamp format or stores `researchedAt` as something other than an ISO string, the guard would silently drop that row rather than crashing or producing `NaN` as a sort key. The cost is one `isNaN()` call per candidate — negligible. The benefit is that the sort order cannot be corrupted by malformed data from any future code path.

</details>

**Try it yourself:** Temporarily change the `.flatMap()` to `.filter().map()`. In the `.filter()` callback, check `(row.company_research as any)?.researchedAt`. In the `.map()` callback, try to access `researchedAt` without a non-null assertion. Observe the TypeScript error. Then restore `.flatMap()`.

---

## Part 6 — `ActivityCandidate`: extending a type for internal sorting, then stripping

Open [`app/dashboard/page.tsx`](../../../app/dashboard/page.tsx), lines 141–174:

```ts
type ActivityCandidate = ActivityItem & { sortTs: number };
```

```ts
const activityItems: ActivityItem[] = [...searchCandidates, ...researchCandidates]
  .sort((a, b) => b.sortTs - a.sortTs)
  .slice(0, 10)
  .map(({ id, type, label, timeAgo }) => ({ id, type, label, timeAgo }));
```

The normalization pipeline needs a numeric sort key (`sortTs`) that is not part of the final `ActivityItem` type. Rather than modifying `ActivityItem` to carry this internal field, a local type intersection is declared: `ActivityCandidate = ActivityItem & { sortTs: number }`.

This type is declared inside the `DashboardPage` function body, not at module level. It is not exported. Its scope is intentionally limited to the function where it is used — no other file can reference it, and no future developer can accidentally import it. This is the correct scope for an implementation detail.

After `.sort()` and `.slice(0, 10)`, `sortTs` must be stripped before `activityItems` is passed to `<RecentActivity>`. The final `.map()` destructures only the four fields that belong to `ActivityItem`, explicitly by name:

```ts
.map(({ id, type, label, timeAgo }) => ({ id, type, label, timeAgo }))
```

This is not redundant — it is architectural. `RecentActivity` declares `items: ActivityItem[]`. If `sortTs` were included, TypeScript would not object (extra properties in object literals do not fail structural type checking in all contexts). But the component would receive a field it has no use for, leaking an implementation detail of the sort algorithm into the component's public API. Stripping `sortTs` keeps the component contract clean.

> **Type theory — Type intersection for temporary fields:** `type Candidate = FinalType & { extraField: T }` is a standard pattern for adding a temporary computation field to an existing type. It is preferable to modifying `FinalType` (which would pollute the type everywhere it is used) or to casting with `as` (which abandons type safety). The intersection type carries all the required fields of `FinalType` plus the extra field, and TypeScript enforces both. After the computation, the explicit destructuring in `.map()` serves as a type-narrowing step: the return type is inferred as exactly `FinalType`, not `FinalType & { extraField }`.

**Checkpoint:** Why is it important to strip `sortTs` before passing `activityItems` to `<RecentActivity>`, if TypeScript might not catch the extra property?

<details>
<summary>Reveal answer</summary>

TypeScript's structural type system allows object types with extra properties to satisfy narrower interfaces in most contexts (object type compatibility). So passing `ActivityCandidate[]` where `ActivityItem[]` is expected might not produce a TypeScript error. But even if TypeScript allows it, the architectural problem remains: `RecentActivity` now implicitly receives `sortTs` on every item it renders. A future developer modifying the component might see the field, use it for something, and create a hidden coupling between the component's rendering logic and the page's sorting algorithm. Explicit stripping documents the intent: `sortTs` is internal to `DashboardPage` and must never escape.

</details>

---

## Part 7 — Merging two sources: no per-source quota, recency decides

The final merge is straightforward:

```ts
const activityItems: ActivityItem[] = [...searchCandidates, ...researchCandidates]
  .sort((a, b) => b.sortTs - a.sortTs)
  .slice(0, 10)
  .map(({ id, type, label, timeAgo }) => ({ id, type, label, timeAgo }));
```

Two arrays are spread into one, sorted by `sortTs` descending (newest first), trimmed to 10, and stripped of `sortTs`. No per-source quota is enforced.

A natural first instinct is to show 5 search events and 5 research events — balanced representation. This is wrong. The activity feed is a chronological record of what the user actually did. If the user ran 10 searches today and researched 0 companies, the feed should show 10 searches. If they researched 8 companies and ran 0 searches, show 8 research events. A per-source quota would distort the truth — it would make the feed look balanced when the user's behavior was not.

The 20-candidate limit per source (not 10) exists because the DB pre-sort (`found_at`) and the JS re-sort (`researchedAt`) can produce different orderings. Fetching only 10 research candidates would mean some recently-researched jobs might not be in the pool at all. Fetching 20 creates a buffer: even if the JS re-sort inverts the order of several candidates, the final top-10 is drawn from a wide enough pool to be accurate.

Each source also degrades independently. If `agentRunsResult.error` is set, `agentRunsResult.data` is `null`, and `agentRunsResult.data ?? []` produces an empty array — `searchCandidates` is empty. If `researchJobsResult.error` is set similarly, `researchCandidates` is empty. The merge still runs; it just merges fewer items. The `RecentActivity` component handles the resulting empty `activityItems` with its built-in empty state.

**Checkpoint:** A user ran 10 searches today and has never researched a company. What does `activityItems` contain after the merge? What does the feed show?

<details>
<summary>Reveal answer</summary>

`researchCandidates` is empty (no researched companies). `searchCandidates` contains up to 20 completed search runs, sorted by `completed_at` descending. After merging and slicing to 10, `activityItems` contains the 10 most recent completed searches. The feed shows 10 "Found X jobs for [title]" entries — all search events, zero research events. This is correct: it is an accurate reflection of what the user actually did.

</details>

---

## Part 8 — `id: string` on `ActivityItem`, stable keys, and why `RecentActivity` stays server-rendered

### The `ActivityItem` type change

Open [`components/dashboard/RecentActivity.tsx`](../../../components/dashboard/RecentActivity.tsx):

```ts
export type ActivityItem = {
  id: string;
  type: "search" | "research";
  label: string;
  timeAgo: string;
};
```

Before Feature 16, `ActivityItem` did not have an `id` field. The list rendered with `key={index}`. Feature 16 adds `id: string` as the first field.

The IDs are source-qualified: `search-${run.id}` for agent runs and `research-${row.id}` for researched jobs. Both `agent_runs.id` and `jobs.id` are UUID v4 — collision across the two tables is astronomically unlikely. The prefix is not about preventing collision. It is about readability: when a React key appears in DevTools as `research-3a7f2c...`, you immediately know it came from the `jobs` table. When it reads `search-9b1e4a...`, you know it is from `agent_runs`. This is the same convention used by services like Stripe (`cus_`, `ch_`, `pi_`) — the type prefix is embedded in the identifier itself.

The list render changes from `key={index}` to `key={item.id}`:

```tsx
{items.map((item) => (
  <ActivityRow key={item.id} {...item} />
))}
```

For a server-rendered static list that never re-renders on the client, `key={index}` causes no actual React bug — the list is rendered once and never mutated. But the activity feed now has stable database-backed IDs, and using them costs nothing. If this component ever gains client-side interactivity (a "Dismiss" button, real-time updates via WebSocket), the stable keys will already be correct.

### The empty state

```tsx
export function RecentActivity({ items }: Props) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
      <h2 className="text-base font-semibold text-text-primary mb-2">Recent Activity</h2>
      {items.length === 0 ? (
        <p className="text-sm text-text-muted py-3">
          No activity yet.{" "}
          <Link href="/find-jobs" className="text-accent hover:underline">
            Run a search
          </Link>{" "}
          to get started.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {items.map((item) => (
            <ActivityRow key={item.id} {...item} />
          ))}
        </div>
      )}
    </div>
  );
}
```

The empty state lives inside `RecentActivity`, not in `page.tsx`. If the empty check lived in `page.tsx`, the page would need to know what the activity card looks like when empty — its copy, its styling, its link target. That is presentation logic leaking out of the component that owns it. `page.tsx` passes `items` and trusts the component to handle all states: populated, empty, and any future states (loading, error) that might be added. This is the same principle as `StatsBar` from Tutorial 28 — the page passes stats, the component decides how to render them.

### Why no `"use client"` is needed

`RecentActivity` imports `Link` from `"next/link"`. A developer seeing `Link` might assume `"use client"` is required — `Link` is associated with client-side navigation. But `Link` from `next/link` is a Server Component-compatible export. It renders as an `<a>` tag on the server and progressively enhances to client-side navigation in the browser without requiring client JavaScript to render.

`RecentActivity` has no `useState`, no `useEffect`, no browser APIs, and no event handlers. There is no reason to add `"use client"`. Keeping it as a Server Component means its module bundle is never sent to the browser — a small performance benefit. The absence of `"use client"` is deliberate: it is a signal that the component is purely declarative. If someone adds a "Dismiss" button to activity items in the future, they would add `"use client"` at that point.

> **Design patterns — Single-owner data flow:** As established in Tutorial 27 and continued in Tutorial 28, all data fetching lives in `page.tsx`. Components receive typed props and render. `RecentActivity` is purely presentational — it does not know its data came from two merged database sources. Adding `"use client"` would not change this, but it would enable patterns (useState, useEffect) that could shift data fetching into the component. Keeping the component as a Server Component enforces the boundary through constraint rather than convention alone.

**Checkpoint:** A new user has no job searches and no researched companies. `activityItems` is an empty array. What does `RecentActivity` render, and why is the empty state check inside the component rather than in `page.tsx`?

<details>
<summary>Reveal answer</summary>

`RecentActivity` renders the card container with the heading "Recent Activity" and the paragraph "No activity yet. Run a search to get started." with the `/find-jobs` link. The empty state check is inside the component because `RecentActivity` is responsible for all rendering states of the activity card — not just the populated state. If the empty check were in `page.tsx`, the page would need to import and render different JSX for the card depending on whether items is empty. Any future change to the empty state copy, styling, or behavior would require editing `page.tsx` instead of `RecentActivity`. The component owns its own states.

</details>

---

## Full data flow: a user's first research event appearing in the feed

Here is a complete trace for a user who has run two job searches and researched one company, loading the dashboard.

1. **Browser:** Sends `GET /dashboard`. Next.js routes to `app/dashboard/page.tsx`.

2. **Auth + Profile:** `createInsforgeServer()`, `getCurrentUser()`, profile query — same as every authenticated page. `authData.user.id` confirmed non-null.

3. **`sevenDaysAgo`** — `getIsoTimestampDaysAgo(7)` produces e.g. `"2026-06-28T09:00:00.000Z"`.

4. **`Promise.all` fires six HTTP requests simultaneously:**
   - q5 (`agent_runs`): `GET /agent_runs?user_id=eq.<uuid>&status=eq.completed&order=completed_at.desc&limit=20` → returns 2 rows: `[{ id: "run-1", job_title_searched: "Frontend Developer", jobs_found: 12, completed_at: "2026-07-04T14:00:00Z" }, { id: "run-2", job_title_searched: "React Engineer", jobs_found: 8, completed_at: "2026-07-03T11:00:00Z" }]`
   - q6 (`jobs` with research): `GET /jobs?user_id=eq.<uuid>&company_research=not.is.null&order=found_at.desc&limit=20&select=id,company,company_research` → returns 1 row: `{ id: "job-abc", company: "Stripe", company_research: { researchedAt: "2026-07-05T09:30:00Z", summary: "..." } }`

5. **Error checks** — all results have `error: null`. No logging occurs.

6. **`searchCandidates` normalization:**
   - Row 1: `completed_at` is truthy → `id: "search-run-1"`, `type: "search"`, `label: "Found 12 jobs for Frontend Developer"`, `timeAgo: formatRelativeDate("2026-07-04T14:00:00Z")` → `"Yesterday"`, `sortTs: 1751896800000`
   - Row 2: `id: "search-run-2"`, `timeAgo: "2 days ago"`, `sortTs: 1751810400000`

7. **`researchCandidates` normalization via `flatMap`:**
   - Row 1 (job-abc): cast `company_research` → extract `researchedAt: "2026-07-05T09:30:00Z"` → truthy, `ts = new Date("2026-07-05T09:30:00Z").getTime()` → valid number, not NaN
   - Returns `[{ id: "research-job-abc", type: "research", label: "Researched Stripe", timeAgo: "Just now", sortTs: 1751711400000 }]`

8. **Merge and sort:**
   - `[...searchCandidates, ...researchCandidates]` → 3 items
   - Sort by `sortTs` descending: research-job-abc (1751711400000 — most recent), search-run-1 (1751896800000 — yesterday), search-run-2 (1751810400000 — two days ago)
   
   Wait — research happened today at 9:30am, which has the highest timestamp. So the sorted order is: research-job-abc first, then search-run-1, then search-run-2. *(Note: higher timestamp = more recent = sorts first with `b.sortTs - a.sortTs`.)*
   
   - `.slice(0, 10)` → all 3 items
   - `.map(({ id, type, label, timeAgo }) => ...)` → strips `sortTs`

9. **`activityItems`:** `[{ id: "research-job-abc", type: "research", label: "Researched Stripe", timeAgo: "Just now" }, { id: "search-run-1", ... }, { id: "search-run-2", ... }]`

10. **`<RecentActivity items={activityItems} />`** — `items.length === 3`, not 0 → renders the `divide-y` list. Three `<ActivityRow>` elements render with `key={item.id}`, each with the appropriate dot color (info for research, success for search) and label text.

11. **HTML streamed to browser.** The activity card shows the research event at the top ("Researched Stripe — Just now"), followed by the two search events.

---

## Extend it (challenges)

### Challenge 1 — Trace (15–20 min)

A user has 25 researched companies in their database. All 25 jobs were found on the same day (found_at is nearly identical for all of them), but they were researched at different times over several weeks. The most recently researched company was also the most recently found job.

Trace through exactly what `researchCandidates` will contain after the query and normalization. Does the 20-candidate limit create any risk of missing the most recent research event in this scenario? Now change the scenario: the most recently researched company is the oldest job (found_at is the smallest). What happens?

<details>
<summary>Hint</summary>

The DB query orders by `found_at` descending and limits to 20. If the most recently researched company is attached to one of the top 20 jobs by `found_at`, it will be in the candidate pool. If it is attached to job 21 or later by `found_at`, it will not. Consider: in the first scenario (most recently researched = most recently found), does it appear in the pool? In the second scenario (most recently researched = oldest found), does it appear?

</details>

---

### Challenge 2 — Extend (20–30 min)

The activity feed currently shows two types: `"search"` and `"research"`. Suppose the product team asks for a third type: `"applied"` — showing when a user marked a job as "Applied" via the job details page.

1. What table would you query? What column indicates "applied" status?
2. What timestamp field would you use for `sortTs`?
3. Write the query (using the InsForge SDK pattern from the existing code) and the normalization code that produces `ActivityCandidate[]` for applied events.
4. What changes to the `ActivityItem` type and `RecentActivity`?
5. What color tokens would you use for the applied activity dot (check `context/ui-tokens.md`)?

Write out your plan. No implementation required — reasoning only.

<details>
<summary>Hint</summary>

Look at the `jobs` table schema. Is there a column for application status or application date? If the column is nullable, how do you filter to "applied" jobs only? The `ActivityItem` type currently has `type: "search" | "research"` — adding `"applied"` requires a union extension. The dot color tokens are `bg-success-light / bg-success-alt` for search and `bg-info-light / bg-info` for research. Check `context/ui-tokens.md` for other available pairs.

</details>

---

### Challenge 3 — Break and fix (30–45 min)

In `page.tsx`, change the `researchCandidates` normalization to use `.filter().map()` instead of `.flatMap()`:

```ts
const researchCandidates = (researchJobsResult.data ?? [])
  .filter((row) => {
    const r = (row.company_research as { researchedAt?: string } | null)?.researchedAt;
    return !!r && !isNaN(new Date(r).getTime());
  })
  .map((row) => {
    // Try to produce an ActivityCandidate here
  });
```

1. Complete the `.map()` callback. What TypeScript error do you encounter when trying to access `researchedAt` inside `.map()`?
2. What are your options to fix it without using `.flatMap()`?
3. Which of those options requires the most typing? Which is most readable?
4. Restore the `.flatMap()` version. What does this exercise tell you about when to reach for `.flatMap()` vs. `.filter().map()`?

<details>
<summary>Hint</summary>

Inside the `.map()` callback after `.filter()`, TypeScript does not carry forward the narrowing you established in the `.filter()` predicate. `researchedAt` is still `string | undefined` even though you just filtered out rows where it was undefined. Your options: re-extract it (call the cast + optional chain again), use a type predicate in the filter, or use a non-null assertion (`!`). Consider the readability cost of each.

</details>

---

For deeper exploration, [`docs/plan/16-recent-activity-real-data/ai-discussion-topics.md`](../../plan/16-recent-activity-real-data/ai-discussion-topics.md) has 17 prompts covering timestamps and data accuracy, filter correctness and the JSONB safety proof, normalization and the intermediate type, and component architecture and rendering. Feed them to an LLM *after* forming your own answer first — the gap between what you thought and what you learn is where understanding lands.

---

## Good next /teach topics

These concepts appeared in this tutorial and each has enough depth to become a standalone `/teach` lesson:

**1. `flatMap` as filterMap** — The pattern `array.flatMap(x => condition ? [transform(x)] : [])` is a general solution to "produce zero or one output per input." A `/teach` lesson could cover: the formal definition of `flatMap`, its relationship to `bind`/`chain` in functional programming, the TypeScript narrowing advantage over `.filter().map()`, and equivalent constructs in other languages (Rust `filter_map`, Scala `collect`, Haskell `mapMaybe`).

**2. JSONB: when to keep a field in JSON vs. promote it to a column** — This tutorial saw `researchedAt` stored in JSONB and the complications that causes for sorting. A `/teach` lesson could cover: the general tradeoffs of JSONB vs. dedicated columns (queryability, indexability, schema flexibility, normalization), how to migrate a JSONB subfield to a column with a zero-downtime migration, and when JSONB is the right choice (sparse optional data, highly variable structure).

**3. Intermediate types for transformation pipelines** — The `ActivityCandidate = ActivityItem & { sortTs: number }` pattern. A `/teach` lesson could cover: TypeScript type intersection (`&`), function-scoped vs. module-scoped types, the "extend for computation, strip before passing" pattern, and how this compares to alternative approaches (using `Omit` or `Pick`, casting, or modifying the downstream type).

**4. Stable React keys: the actual rule** — `key={index}` is not always wrong, and `key={id}` is not always necessary. A `/teach` lesson could cover: exactly what React uses keys for (diffing, instance reuse), the specific scenario where index keys cause bugs (reorder/insert/delete with stateful components), why stable IDs are still preferred for forward-compatibility and debuggability even when index keys cause no current bug.

**5. Source-local failure degradation in composite data views** — The pattern of `data ?? []` and `[dashboard/activity]` error logging. A `/teach` lesson could cover: the design principle that composite views should degrade section-by-section rather than fail as a unit, the InsForge SDK's `{ data, error }` return convention and why it enables this pattern, and how this contrasts with throwing-on-error APIs where `Promise.all` rejection would abort all results.
