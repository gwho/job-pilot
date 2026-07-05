# Explanation — Feature 16: Recent Activity Real Data

## 1. What the feature does end to end

Feature 16 replaces the `mockActivity` constant in `app/dashboard/page.tsx` with real data from the InsForge database. The page is a Next.js Server Component — it runs on the server at request time, fetches data from InsForge, and sends fully rendered HTML to the browser. No client-side fetching, no loading states.

The data flow is:

1. `page.tsx` authenticates the user via `insforge.auth.getCurrentUser()` and redirects to `/login` if no session exists.
2. Six queries run in parallel via `Promise.all`. The first four are the existing stats queries from Feature 15. The two new queries are: `agent_runs` (completed search runs for this user, newest 20 by `completed_at`) and `jobs` with `company_research IS NOT NULL` (researched jobs for this user, newest 20 by `found_at`).
3. After `Promise.all` resolves, both result sets are normalised into an intermediate `ActivityCandidate[]` type (which is `ActivityItem & { sortTs: number }`).
4. The two candidate arrays are spread into one, sorted by `sortTs` descending, sliced to 10, and mapped to the final `ActivityItem[]` (stripping `sortTs`).
5. `activityItems` is passed as the `items` prop to `<RecentActivity>`, which renders the list unchanged — the component's UI logic was already correct from Feature 14.

---

## 2. Why `found_at` cannot be the research timestamp

This was the most consequential architectural decision in the session. The `jobs` table has a column `found_at` that records when the job was scraped and saved. It also has a `company_research` JSONB column containing the dossier. A reasonable first instinct is to use `found_at` to represent "when research happened" — it's available at the top level, sortable by the database, and already indexed.

But `found_at` and "when research ran" are different moments in time with no guaranteed relationship. A user might save a job on Monday and research it on Thursday. Using `found_at` as the research timestamp would show "4 days ago" in the activity feed for something that happened today. The feed would be factually wrong and would undermine user trust.

The correct timestamp is `researchedAt`, which `agent/research.ts` line 283 writes into the dossier JSONB on every successful synthesis: `researchedAt: new Date().toISOString()`. To use it, the query selects `id, company, company_research` and the extraction happens in JavaScript after the query returns:

```ts
const researchedAt = (row.company_research as { researchedAt?: string } | null)
  ?.researchedAt;
```

The tradeoff is that the database cannot sort by this subfield using the InsForge SDK (doing so would require raw SQL with `(company_research->>'researchedAt')::timestamptz`). Instead, `found_at` is used as the DB sort for candidate selection only — to choose which 20 rows to pull from the database — and `researchedAt` is used for the actual ordering in JavaScript. This approximation is correct because users overwhelmingly research recently found jobs. The only edge case is a user who researches a job that falls outside the top 20 by `found_at`, which is unlikely in normal usage and acceptable for a "recent" activity feed.

---

## 3. Why `company_research IS NOT NULL` is sufficient

The architect session flagged a risk: could an empty object `{}` or a failed fallback dossier be saved to `company_research`, causing "Researched [company]" to appear in the feed when research actually failed?

Reading `agent/research.ts` answered this directly. The research agent has two distinct code paths:

**Path 1 — synthesis succeeds.** `synthesizeDossier` completes and returns the full dossier shape including `researchedAt`. The `.update({ company_research: dossier })` executes. The row is correctly marked as researched.

**Path 2 — synthesis fails.** `synthesizeDossier` throws (Nemotron returned empty content, JSON parsing failed, or the OpenAI call threw). The throw propagates up to `researchCompany`, which propagates to the API route. The `.update()` line never executes. `company_research` remains `NULL`.

There is no path that saves `{}` or a partial dossier — the update is only reachable after a complete, successful synthesis. This means `company_research IS NOT NULL` accurately identifies rows where research fully completed. The filter is safe.

---

## 4. The DB-sort / JS-sort split and its gap

Because `researchedAt` lives inside JSONB rather than as a top-level column, the InsForge SDK cannot sort the query by it. The query uses `found_at` for ordering:

```ts
insforge.database
  .from("jobs")
  .select("id, company, company_research")
  .eq("user_id", authData.user.id)
  .not("company_research", "is", null)
  .order("found_at", { ascending: false })
  .limit(20)
```

This creates a specific, bounded gap: if a user has more than 20 researched jobs total, and the most recently researched one is attached to a job that falls outside the top 20 by `found_at`, it won't appear in the candidate pool and won't make it to the feed.

The fix was to fetch 20 candidates per source rather than 10 (the final display size). This widens the selection pool and reduces the probability of the gap being visible. The decision to stop at 20 rather than, say, 50 or 100 reflects a practical judgment: users who have researched more than 20 companies and are actively researching old jobs in a way that inverts the `found_at` ordering are an extreme edge case. If this gap ever becomes a real user problem, the correct fix is to add a `company_researched_at timestamptz` column to `jobs` and sort the DB query by it directly.

---

## 5. The `flatMap` pattern for extracting optional JSONB fields with filtering

Research candidates are built using `.flatMap()` rather than `.filter().map()`:

```ts
const researchCandidates: ActivityCandidate[] = (researchJobsResult.data ?? [])
  .flatMap((row) => {
    const researchedAt = (row.company_research as { researchedAt?: string } | null)
      ?.researchedAt;
    if (!researchedAt) return [];
    const ts = new Date(researchedAt).getTime();
    if (isNaN(ts)) return [];
    return [{ id: `research-${row.id}`, type: "research" as const, ... }];
  });
```

The `.flatMap()` pattern treats each input row as producing either zero or one output item. Returning `[]` from the callback drops the row; returning `[item]` keeps it. This is idiomatic TypeScript for "transform and filter in one pass."

The alternative — `.filter(...).map(...)` — has a TypeScript problem: after `.filter(row => row.company_research?.researchedAt)`, TypeScript still considers `researchedAt` as potentially undefined inside the subsequent `.map()` callback, requiring a non-null assertion (`!`) or a type predicate function. The `flatMap` approach avoids this entirely: the `if (!researchedAt) return []` guard narrows the type cleanly within the same callback, and the `return [item]` branch only executes when `researchedAt` is confirmed to be a non-empty string.

The `isNaN(ts)` guard is a defensive check for malformed timestamp strings. In theory `researchedAt` is always a valid ISO string because it's written by `new Date().toISOString()`. In practice, a defensive check costs nothing and prevents a `NaN` from silently corrupting the sort order.

---

## 6. The `ActivityCandidate` intermediate type and why `sortTs` is stripped

The normalization needs a sort key (`sortTs: number`) that is not part of the final `ActivityItem` type. Rather than modifying `ActivityItem` to carry this internal field, a local type intersection is used:

```ts
type ActivityCandidate = ActivityItem & { sortTs: number };
```

This type is declared inside `DashboardPage` (the function body), not at the module level. It is never exported. After sorting and slicing, `sortTs` is removed by explicit destructuring in the final `.map()`:

```ts
.map(({ id, type, label, timeAgo }) => ({ id, type, label, timeAgo }));
```

Naming only the four fields that belong to `ActivityItem` (rather than using `{ sortTs: _sortTs, ...rest }`) keeps TypeScript happy without relying on underscore-prefixed discard conventions, which can trigger lint warnings depending on configuration.

The reason `sortTs` must be stripped is architectural: `RecentActivity` is a presentational component that should receive exactly the data it needs to render, nothing more. A `sortTs` field in its props would be noise — unused by the component, leaking implementation details of the sort algorithm into the component's API. Stripping it at the boundary keeps the component contract clean.

---

## 7. Source-qualified IDs and why they matter

Before Feature 16, activity items were identified by `key={index}` in the React list. This was safe for a static server-rendered list that never changes on the client. With real DB data, items have stable UUIDs.

The ID format chosen is `search-${run.id}` and `research-${job.id}`. Both `agent_runs.id` and `jobs.id` are UUID v4, which makes actual collisions between the two tables impossible in practice. The prefix serves a different purpose: readability and debuggability. When a React key appears in DevTools as `research-3a7f2c-...`, you immediately know it came from the `jobs` table via the research query. When it reads `search-9b1e4a-...`, you know it is from `agent_runs`. This kind of self-documenting data makes debugging faster and is consistent with how other systems (e.g., Stripe's `cus_`, `ch_` prefixes) encode entity type in an identifier.

The `id` field was added to `ActivityItem` to carry this value into the component. The type change is intentional: `id: string` is the first field, making it visually prominent in the type definition and ensuring it cannot be omitted when constructing an item.

---

## 8. Why `RecentActivity` needs no `"use client"`

The empty state added in this feature uses `<Link href="/find-jobs">`, which might suggest a need for `"use client"` — `Link` is associated with client-side navigation. But `Link` from `next/link` is fully compatible with Server Components. It renders as an `<a>` tag on the server and progressively enhances to client-side navigation in the browser. No client JavaScript is required for it to exist in the HTML.

`RecentActivity` has no `useState`, no `useEffect`, no browser APIs, and no event handlers (the `Link` click is handled by the browser's native anchor behavior, not by React state). There is no reason to add `"use client"`. Keeping it as a Server Component means its module bundle is never sent to the browser, which is a small performance benefit.

This distinction matters for future development: if someone added a "Dismiss" button to activity items, they would need `"use client"` at that point. The absence of the directive right now is not an oversight — it is a deliberate signal that the component is purely declarative.

---

## 9. Why the empty state lives inside `RecentActivity`, not in `page.tsx`

A developer might ask: why not handle the empty case in `page.tsx` by conditionally rendering `<RecentActivity>` only when `activityItems.length > 0`, and rendering the empty state separately?

The answer is encapsulation. `RecentActivity` is responsible for rendering a recent activity card. That responsibility includes all states of that card: populated, empty, and (if ever added) loading or error. If the empty state lived in `page.tsx`, it would leak presentation logic out of the component that owns it. Every place that renders `<RecentActivity>` would need to duplicate the empty-state check and copy.

More concretely: `page.tsx` is not supposed to know what the activity card looks like when empty. It passes `items` and trusts the component to handle all cases. This is the same mental model as `StatsBar` receiving `stats` — the page doesn't render fallback stat cards; `StatsBar` handles its own internal states.

The empty state text, styling, and link target are all implementation details of the card's presentation layer. They belong in `RecentActivity`.
