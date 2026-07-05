# Architect Discussion — Feature 16: Recent Activity Real Data

## 1. The "recent" in Recent Activity is a claim

The feature is called Recent Activity. "Recent" means the user's last meaningful actions, ordered by when they happened. That sounds obvious — but it contains a hidden risk: the timestamps you use must actually represent when the actions happened, not when related records were created.

This project has two distinct timestamps that could be confused:

- `jobs.found_at` — when the job was scraped and saved to the database
- `company_research.researchedAt` — when the user triggered research on that job

These are different moments in time, sometimes by days. A user might find a job on Monday, leave it unresearched for three days, then research it on Thursday. If you use `found_at` as the research timestamp, Thursday's research appears as "4 days ago" in the activity feed — wrong. The user would see activity that appears older than it is, eroding trust in the dashboard.

The right timestamp for research events is `researchedAt`. The challenge is that it lives inside a JSONB column, not as a top-level column in `jobs`. This created the first real architectural decision of the session.

---

## 2. Three options for the research timestamp

**Option A: Use `found_at` as a proxy**

Simple. No schema change, no JSONB extraction. But factually incorrect — it reports when the job was found, not when research ran. Rejected because it violates the Feature 15 principle: "treat absence of measurement differently from zero." Here it is: treat "when research ran" differently from "when the job was found."

**Option B: Extract `researchedAt` from JSONB in JavaScript**

`agent/research.ts` line 283 writes `researchedAt: new Date().toISOString()` into the dossier on every successful synthesis. This means any row where `company_research IS NOT NULL` has a valid `researchedAt` field. We can extract it after the SDK query:

```ts
const researchedAt = (row.company_research as { researchedAt?: string } | null)
  ?.researchedAt;
```

Accurate. No schema change. Stays SDK-only (no raw SQL). The cost: we can't sort the DB query by `researchedAt` — we use `found_at` as a DB pre-sort for candidate selection, then re-sort in JS by the extracted timestamp. Chosen.

**Option C: Add `company_researched_at timestamptz` column**

Cleanest for the long term — the timestamp is at the table level, sortable by the DB, indexed if needed. Requires DDL: `ALTER TABLE jobs ADD COLUMN company_researched_at timestamptz`. Also requires the research agent to write to this column on every research completion. That is two changes (schema + agent) for data that already exists inside the JSONB. Deferred — if Feature 17 or later requires sorting or filtering by research time at the DB level, adding the column then is the right move.

---

## 3. Why `company_research IS NOT NULL` is the right filter

The architect session caught a potential issue: can `company_research IS NOT NULL` return false positives? Could an empty object `{}` or a failed fallback dossier be saved, causing "Researched Stripe" to appear in the feed when research actually failed?

Code inspection of `agent/research.ts` answered the question:

```
// Synthesis always runs, even with empty content
const dossier = await synthesizeDossier(content, job, profile);

// Save to DB
await insforge.database
  .from("jobs")
  .update({ company_research: dossier })
  ...
```

The only way `company_research` is updated to a non-null value is if `synthesizeDossier` completes without throwing. If Nemotron returns empty content, `synthesizeDossier` throws. If JSON parsing fails, it throws. In both cases, the DB update never runs — `company_research` stays `NULL`.

When `synthesizeDossier` does complete, it always produces the full dossier shape with at least `researchedAt` set and empty string/array fallbacks for all other fields. There is no path to save `{}`.

Conclusion: `company_research IS NOT NULL` means "synthesis ran and saved a dossier." The filter is accurate.

---

## 4. The DB-sort / JS-sort split and when it matters

The research query fetches 20 candidates sorted by `found_at` descending. In JavaScript, we extract `researchedAt` from each candidate's JSONB and re-sort by that value before merging.

This creates a subtle gap: if a user has researched 21+ companies total, and the most recently researched one is the 21st oldest job (outside the 20-candidate pool), it won't appear in the feed.

How likely is this? A user would need to:
1. Have saved 20+ jobs
2. Researcher one of the oldest jobs more recently than all 20 of the newer jobs

This is an edge case. Users typically research jobs they recently found. The 20-candidate pool covers the vast majority of real usage. For a "recent" activity feed, this approximation is correct and the implementation stays SDK-only without raw SQL.

If this ever became a problem in practice, the correct fix would be to add `company_researched_at` as a column (Option C above) and sort the DB query by that column directly.

---

## 5. Why the merge uses no per-source quota

An early design intuition might be: "show 5 searches and 5 research events." This is wrong.

The activity feed is a chronological record of what the user actually did. If the user ran 8 searches today and researched 0 companies, the feed should show 8 searches. If they researched 10 companies and ran no searches, show 10 research events. A per-source quota would distort the truth — it would make the feed look balanced when the user's behavior was not.

Recency decides. The 10 most recent events, regardless of type, sorted by timestamp. This is the correct mental model for "recent activity."

---

## 6. The `ActivityCandidate` intermediate type pattern

The normalization in `page.tsx` uses a local intermediate type that is never exported:

```ts
type ActivityCandidate = ActivityItem & { sortTs: number };
```

This type is used internally for sorting and then stripped before the final `ActivityItem[]` is built:

```ts
const activityItems: ActivityItem[] = [...searchCandidates, ...researchCandidates]
  .sort((a, b) => b.sortTs - a.sortTs)
  .slice(0, 10)
  .map(({ id, type, label, timeAgo }) => ({ id, type, label, timeAgo }));
```

The explicit `.map()` destructuring strips `sortTs` cleanly. TypeScript is satisfied. No extra fields leak into the component's props. The component receives exactly the shape it declared.

This pattern — extend a type internally for a computation, strip before passing downstream — is common in data transformation pipelines. The key discipline: never let the intermediate type escape its origin file.

---

## 7. Source-qualified IDs and the two-table collision risk

Both `agent_runs` and `jobs` use UUIDs as primary keys. UUID v4 collision probability across two tables is astronomically low in practice. But the prefix (`search-` / `research-`) is not about collision prevention — it is about clarity.

When you read a React key in DevTools that says `research-3a7f2c...`, you know immediately that this row came from the `jobs` table via the research query. When you read `search-9b1e4a...`, you know it came from `agent_runs`. This makes debugging faster. It also documents the data model in the rendered output.

Compare this to keys like `3a7f2c...` — you cannot tell which table the row came from without cross-referencing the code.

---

## 8. Index keys vs stable keys for server-rendered static lists

`key={index}` is often described as "bad practice." The actual rule is more specific: index keys cause problems when items can be reordered, added, or removed on the client side. React uses keys to decide which component instances to reuse or discard during re-renders. If the key for "item 2" is `2` whether the item is "Researched Stripe" or "Found 8 jobs for React Developer," React cannot distinguish them.

For a server-rendered list that never changes on the client — no React state, no mutations — index keys cause no actual bugs. The list is rendered once on the server and never re-renders. This is why `key={index}` worked fine with the mock array.

That said, the Activity feed is now backed by real database records. Those records have stable UUIDs. Using them as keys is correct, free, and forwards-compatible. If the component ever gains client-side interactivity (filter, dismiss, real-time updates), the stable keys are already in place.

---

## 9. The `flatMap` pattern for optional extraction with filtering

The research candidate normalization uses `.flatMap()` instead of `.filter().map()`:

```ts
const researchCandidates = (researchJobsResult.data ?? [])
  .flatMap((row) => {
    const researchedAt = ...?.researchedAt;
    if (!researchedAt) return [];
    const ts = new Date(researchedAt).getTime();
    if (isNaN(ts)) return [];
    return [{ id: ..., type: ..., label: ..., timeAgo: ..., sortTs: ts }];
  });
```

`flatMap` with `return []` (empty array) and `return [item]` (single-item array) is idiomatic TypeScript for "transform and filter in one pass." It avoids:

1. A `.filter()` pass that narrows the type (TypeScript still needs the guard after filter)
2. A separate `.filter(Boolean)` after `.map()` that requires a non-null assertion or type predicate

The pattern reads as: "for each row, produce zero or one candidate." It is clear, typesafe, and single-pass.

---

## 10. Partial failure and the dashboard's resilience contract

The Feature 15 principle was: a failing stats query produces a `0` default and logs the error. The dashboard never crashes because one query fails.

Feature 16 extends that contract to the activity feed: a failing activity query produces `[]` and logs with `[dashboard/activity]`. If both queries fail, `RecentActivity` receives `[]` and shows the empty state — not an error page.

This is the correct mental model for dashboard data: the page is a composite view. Any single data source failing should degrade that panel to a neutral state, not take down the entire view. The user can still see their stats, profile banner, and charts even if the activity feed fails.

The `[dashboard/activity]` prefix follows `[dashboard/stats]` exactly. Consistent prefixes across all dashboard data failures mean a single server-log grep (`grep "\[dashboard/"`) surfaces all dashboard data issues in one query.

---

## 11. Why `"use client"` was not added to `RecentActivity`

`RecentActivity` is a Server Component that receives typed props from `page.tsx`. It renders JSX with no state, no event handlers, and no browser APIs. The `Link` component from `next/link` works in Server Components.

Making it a Client Component would mean:
- The component re-renders whenever the parent re-renders (minor)
- Its module bundle is sent to the browser (unnecessary if all data comes from the server)
- It could no longer directly receive `Promise`-based props in certain patterns

The empty state's `<Link>` is the only potentially "interactive" element — but `Link` is a server-renderable navigation component, not a client-only hook. No `"use client"` needed.
