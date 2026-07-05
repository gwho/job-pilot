# Architect Decisions — Feature 16: Recent Activity Real Data

## Decision 1 — Timestamp source for research events

**What it is:** The field used to represent "when did this research happen" in the activity feed.

**The choice:** Extract `researchedAt` from the `company_research` JSONB column in JavaScript, after fetching with the InsForge SDK. Never use `found_at`.

**How it works:** `agent/research.ts` line 283 writes `researchedAt: new Date().toISOString()` into the dossier object every time synthesis completes. When we query `jobs` for research events, we fetch `id, company, company_research` and extract the timestamp in `page.tsx`:

```ts
const researchedAt = (row.company_research as { researchedAt?: string } | null)
  ?.researchedAt;
```

**Why not `found_at`?**  
`found_at` records when the job was scraped and saved — not when the user researched the company. A user could find a job on Monday and research it on Thursday. Using `found_at` would display "4 days ago" for an event that happened today. That is factually wrong and erodes trust in the feed.

**Why not add a `company_researched_at` column?**  
Cleanest long-term option, but requires DDL (`ALTER TABLE jobs ADD COLUMN company_researched_at timestamptz`). The timestamp already exists inside the JSONB — adding a column duplicates data that is already there. For Feature 16, JSONB extraction in JS is accurate and avoids any schema change.

**Why not use raw SQL to sort by the JSONB subfield?**  
`(company_research->>'researchedAt')::timestamptz` would let the DB sort by research time. But that violates the project invariant of InsForge SDK queries only (no raw SQL without explicit justification). It also couples the query to the JSONB schema in a way that is harder to audit.

**The tradeoff accepted:** The DB pre-sorts candidates by `found_at` (not `researchedAt`) to select the 20 candidates. In theory, we could miss a research event on a job found outside the top 20 by `found_at`. In practice, users research recently found jobs, so the selection pool is accurate. This is an acceptable edge case for a "recent" activity feed.

---

## Decision 2 — agent_runs status filter

**What it is:** Which `agent_runs` rows appear in the Recent Activity feed.

**The choice:** `status = "completed"` only. Exclude `"running"` and `"failed"`.

**How it works:**

```ts
insforge.database
  .from("agent_runs")
  .select("id, job_title_searched, jobs_found, completed_at")
  .eq("user_id", authData.user.id)
  .eq("status", "completed")
  .order("completed_at", { ascending: false })
  .limit(20)
```

**Why exclude `"running"`?**  
Running rows have no `jobs_found` and no `completed_at`. The label would read "Found null jobs for Frontend Engineer" — factually wrong and visually broken.

**Why exclude `"failed"`?**  
Failed runs did not produce useful results. Surfacing "Found 0 jobs for Frontend Engineer" next to a successful "Found 12 jobs for React Developer" blurs failure reporting with user progress. The activity feed is a progress summary, not a status log. Failed runs belong in a separate diagnostic surface if ever needed.

**What `completed` guarantees:** Both `jobs_found` (integer) and `completed_at` (timestamptz) are set. The label and timestamp are always valid.

---

## Decision 3 — Total item count and merge strategy

**What it is:** How many items the feed shows, and how candidates from two sources are combined.

**The choice:** Fetch 20 candidates from each source, merge into one array, JS-sort by timestamp descending, trim to 10 total. No per-source quota.

**How it works:**

```ts
type ActivityCandidate = ActivityItem & { sortTs: number };

const activityItems: ActivityItem[] = [...searchCandidates, ...researchCandidates]
  .sort((a, b) => b.sortTs - a.sortTs)
  .slice(0, 10)
  .map(({ id, type, label, timeAgo }) => ({ id, type, label, timeAgo }));
```

**Why 10 and not 5?**  
The mock showed 5 items. With two independent sources, 5 items often means only 2-3 from each type — thin. 10 gives a richer view of genuine recent activity. The card uses `items-start` in the grid, so its height is independent of the chart beside it.

**Why no per-source quota (e.g. 5 searches + 5 research)?**  
Recency should decide. If the user ran 8 searches today and researched 0 companies, the feed should show 8 searches — that is their actual recent activity. Enforcing balance would distort the chronological truth of the feed.

**Why 20 candidates per source?**  
Fetching exactly 10 from each and merging could miss events. Example: if the 10 most recent research events are older than the 10 most recent searches, only searches would appear in the final 10 — correct! But if we fetch only 10 from each and the research sort order (by `found_at`) doesn't match `researchedAt` order, we might miss a recently-researched-but-older-found job. Fetching 20 from each gives a wider candidate pool to compensate for the `found_at` / `researchedAt` ordering mismatch without fetching an unreasonable number of rows.

---

## Decision 4 — Stable source-qualified IDs on ActivityItem

**What it is:** How React keys are generated for the activity list rows.

**The choice:** Add `id: string` to `ActivityItem`. Generate IDs as `search-${run.id}` and `research-${job.id}`. Use `key={item.id}` in the component.

**Why not keep `key={index}`?**  
Index keys are technically safe for a static server-rendered list (no client-side reordering). But the list is now built from real database records that have stable UUIDs. Using index keys carries forward a legacy pattern from mock data into a list backed by durable DB records. Source-qualified IDs are more correct and make debugging easier — you can match a rendered row directly to a database row.

**Why source-qualify the ID (`search-` / `research-` prefix)?**  
Both sources are UUID-keyed, but UUIDs from different tables could theoretically collide. More importantly, the prefix makes the type of event immediately visible when debugging — you can read a React key and know which table it came from.

**Why add `id` to `ActivityItem` rather than handle it outside the type?**  
The component renders the list. Giving it stable keys via `item.id` is the component's concern. The type should carry what the component needs. Keeping `id` outside the type (e.g. passing a parallel `keys` array) would be awkward and inconsistent with how every other list component in this project works.

---

## Decision 5 — Query location and rendering pattern

**What it is:** Where the database queries run and how data reaches the component.

**The choice:** Both queries run in `app/dashboard/page.tsx` as a Server Component, added to the existing `Promise.all`. Data is normalized in `page.tsx` and passed as `items: ActivityItem[]` to `<RecentActivity>`. No API route, no Server Action, no `"use client"`.

**Why consistent with Feature 15?**  
Feature 15 established the dashboard pattern: all data queries parallel in `page.tsx`, components receive typed props. `RecentActivity` already accepts `items: ActivityItem[]` — it requires no change to support real data (beyond the type update). Consistency means less cognitive overhead and easier future maintenance.

**Why not a dedicated API route?**  
API routes are for agent operations (long-running, user-triggered, async). Dashboard data loading is synchronous, user-scoped, and renders on page load. An API route would add a client-side fetch, a loading state, and network overhead for no benefit.

---

## Decision 6 — Partial failure degradation

**What it is:** How the dashboard behaves if one of the two activity queries fails.

**The choice:** Source-local degradation. If `agent_runs` fails, use `[]` for search activity and log `[dashboard/activity] agent_runs`. If `jobs` research query fails, use `[]` and log `[dashboard/activity] jobs`. If both fail, `RecentActivity` receives `[]` and shows the empty state.

**Why not throw?**  
The activity feed is secondary content — the stats bar, charts, and profile banner all render correctly even if activity fails. Throwing would crash the entire page render, removing all dashboard value for a non-critical feature failure.

**Why the `[dashboard/activity]` prefix?**  
Matches the `[dashboard/stats]` prefix established in Feature 15. Consistent prefixes make server log filtering trivial — a single grep finds all dashboard data failures.

---

## Decision 7 — Empty state

**What it is:** What renders in the Recent Activity card when `items.length === 0`.

**The choice:** Inside `RecentActivity`, when `items.length === 0`, render:

```tsx
<p className="text-sm text-text-muted py-3">
  No activity yet.{" "}
  <Link href="/find-jobs" className="text-accent hover:underline">
    Run a search
  </Link>{" "}
  to get started.
</p>
```

**Why add this now?**  
With mock data, the component always had 5 items. With real data, new users have zero activity. Without an empty state, the card renders a heading with no content — visually broken and confusing.

**Why "No activity yet." not "No activity yet —"?**  
The codebase uses em dashes in marketing copy (`HowItWorks.tsx`, `Features.tsx`) but not in functional UI feedback messages. ASCII period keeps the tone neutral and consistent with how other functional messages read in the app.

**Why only "Run a search" linked, not the whole sentence?**  
Linking the minimal meaningful phrase is the correct pattern — it tells the user exactly what to click and where it goes, without turning the entire message into a hyperlink.
