# Explanation — Feature 15: Stats Bar Real Data

## 1. What this feature actually does and where it fits

Feature 14 built the dashboard UI with four stat cards hardcoded to values like "284 jobs" and "82%". Feature 15 replaces exactly those four values with live numbers from the database. Nothing else changes — the layout, the components, the charts, and the activity feed all remain as they were after Feature 14.

The scope is deliberately narrow: wire stat values, nothing else. This is a pattern that runs through the entire build plan. UI is built first with mocks so it can be verified visually before any complexity is introduced. Then individual pieces are wired to real data one at a time. Feature 15 is the first "wire to real data" step for the dashboard.

The two files changed in application logic are `components/dashboard/StatsBar.tsx` and `app/dashboard/page.tsx`. The registry update in `context/ui-registry.md` is a documentation side-effect, not a logic change.

---

## 2. Why the trend badges were removed instead of kept or neutralized

When Feature 14 built the dashboard, cards 1 and 2 (Total Jobs Found and Avg. Match Rate) were given green trend badges showing "+12% vs last week" and "+3% vs last week". These were mock values chosen to make the UI look realistic during the visual-verification phase. Feature 15 was always going to need to address them — you cannot wire stat values to real data and leave fake comparative percentages sitting next to them.

Three options were evaluated during the architect session. The first (Option A) was to remove the badges and replace them with plain subtitles. The second (Option B) was to keep the badge visual but replace the fake percentage with neutral text like "Live data". The third (Option C) was to implement real week-over-week comparison.

Option C was out of scope. Real trend comparison requires a second set of queries (current period vs. prior period), boundary logic (what counts as "last week"?), and a design decision about what to show for negative or zero trends. None of that belongs in a feature scoped to wiring stat values.

Option B was rejected because a badge is a comparative signal affordance. The design of the badge — its shape, its green color, its `TrendingUp` icon — all communicate "this number changed in this direction." Replacing the percentage with "Live data" uses that affordance without delivering comparison. It is dishonest in a subtler way than a fake percentage: it implies something about change without saying what changed. A careful user would stare at it and wonder what it means. An inattentive user might assume it confirms an upward trend.

Option A was chosen because it is honest. The trust principle at play is: at the point where data transitions from mock to real, every nearby element that remains fake becomes suspect. Removing the badges and using plain subtitles makes all four cards consistent — each shows a real number with a plain label explaining its scope. The subtitles agreed on were: "All time", "Scored jobs only", "Completed research", "Last 7 days".

The type change this produced was significant. `StatCardConfig` had been:

```ts
type StatCardConfig = {
  label: string;
  value: string;
  trend?: { value: string; label: string };
  subtitle?: string;
};
```

After Feature 15 it became:

```ts
type StatCardConfig = {
  label: string;
  value: string;
  subtitle: string;
};
```

The `trend` optional field was removed entirely and `subtitle` was promoted from optional to required. This means any future code that tries to pass `trend` to `StatCard` will fail at compile time — a desirable property. Trend data should not be re-introduced without a real data source.

---

## 3. The data flow: from DB to rendered stat card

Here is the full path a stat value takes from the database to the screen.

**Step 1 — Auth check.** `page.tsx` calls `createInsforgeServer()` and `getCurrentUser()`. If no authenticated user, `redirect("/login")` fires. The user ID is in `authData.user.id` for all subsequent queries.

**Step 2 — Profile query.** The existing query for `is_complete` runs before the stats queries (it was there in Feature 14). This is sequential with the auth check — it depends on the user ID being available.

**Step 3 — sevenDaysAgo.** A single `Date` computation runs before the parallel queries:
```ts
const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
```
This produces an ISO 8601 timestamp exactly 7 × 24 hours before the request. It is computed once and referenced in the fourth query. Computing it inside the `Promise.all` array would also be correct in a server component (there is no re-render that would cause a stale value), but naming it outside makes the intent clear.

**Step 4 — Promise.all.** Four queries fire concurrently. The concurrency is the point: each query is independent of the others, so there is no reason to wait for one before starting the next. The total latency is determined by the slowest query, not the sum of all four.

Query 1 — total jobs:
```ts
insforge.database.from("jobs")
  .select("*", { count: "exact", head: true })
  .eq("user_id", authData.user.id)
```
`{ count: "exact", head: true }` sends a HEAD request with a `Prefer: count=exact` header. PostgREST responds with the count in a header, no body. The result's `data` property is `null`; only `count` is meaningful.

Query 2 — scored jobs for average:
```ts
insforge.database.from("jobs")
  .select("match_score")
  .eq("user_id", authData.user.id)
  .not("match_score", "is", null)
```
This is the only query that returns actual row data. It selects only the `match_score` column (not `*`) and filters to rows where the score is non-null. The average will be computed from these rows in Step 6.

Query 3 — companies researched:
```ts
insforge.database.from("jobs")
  .select("*", { count: "exact", head: true })
  .eq("user_id", authData.user.id)
  .not("company_research", "is", null)
```
Same count pattern as Query 1, but filtered to rows where the `company_research` JSONB column is not null. A job with a research dossier counts as one researched company regardless of how many times it was researched.

Query 4 — jobs this week:
```ts
insforge.database.from("jobs")
  .select("*", { count: "exact", head: true })
  .eq("user_id", authData.user.id)
  .gte("found_at", sevenDaysAgo)
```
Same count pattern, filtered to rows where `found_at` is greater than or equal to the precomputed cutoff timestamp.

**Step 5 — Error logging.** After `Promise.all` resolves, each of the four results is checked for an error field. Errors are logged with a `[dashboard/stats]` prefix but do not throw or redirect. The page continues to render with safe defaults.

**Step 6 — Value computation.** The three counts use `result.count ?? 0`. The scored jobs data uses:
```ts
const scoredRows = scoredJobsResult.data ?? [];
const avgMatchRate =
  scoredRows.length > 0
    ? `${Math.round(
        scoredRows.reduce((sum, r) => sum + (r.match_score ?? 0), 0) /
          scoredRows.length
      )}%`
    : "—";
```
The `?? 0` inside the reduce is technically unreachable (the query filtered out nulls) but necessary because TypeScript types `match_score` as `number | null` reflecting the DB column — it cannot infer that the filter removed all nulls. The guard for `scoredRows.length > 0` ensures that a user with no scored jobs sees `"—"` rather than a division-by-zero or `"NaN%"`.

**Step 7 — Stats array construction.** The four computed values are assembled into `StatCardConfig[]`:
```ts
const stats: StatCardConfig[] = [
  { label: "Total Jobs Found",     value: String(totalJobs),           subtitle: "All time" },
  { label: "Avg. Match Rate",      value: avgMatchRate,                subtitle: "Scored jobs only" },
  { label: "Companies Researched", value: String(companiesResearched), subtitle: "Completed research" },
  { label: "Jobs This Week",       value: String(jobsThisWeek),        subtitle: "Last 7 days" },
];
```
`value` is always a string. Integer counts are wrapped in `String()`. The Avg. Match Rate value is already formatted as a string (`"82%"` or `"—"`).

**Step 8 — Render.** `<StatsBar stats={stats} />` receives the array. `StatsBar` maps over it, passing each entry to `StatCard`. `StatCard` renders label, value, and subtitle. No data fetching happens inside any component.

---

## 4. Why the average is computed in JavaScript, not SQL

The natural SQL for Avg. Match Rate is `SELECT AVG(match_score) FROM jobs WHERE user_id = $1 AND match_score IS NOT NULL`. SQL's `AVG()` excludes NULLs by default, so the filter is technically redundant — but writing it explicitly makes the intent clear.

The InsForge SDK wraps PostgREST. PostgREST supports aggregate functions via computed columns (e.g., `.select("match_score.avg()")`), but this feature is not uniformly available across all PostgREST implementations and its availability in InsForge was not verified. Rather than depend on an undocumented PostgREST extension, the implementation fetches non-null `match_score` values and averages them in JS. The result is semantically identical.

This also keeps all four queries in the same pattern (SDK method chain, returns `{ data, error }`) and avoids introducing raw SQL into application-layer code. The rule in this project is: raw SQL via the MCP tool is for infrastructure (schema setup, index creation); application queries go through the SDK.

At current scale (tens to low hundreds of jobs per user), fetching all match_scores is not a performance concern. If a future user had tens of thousands of scored jobs, fetching all scores would become wasteful. The correct solution at that scale would be a stored RPC function that computes the average server-side and returns a single number. That optimization belongs to a future feature, not Feature 15.

---

## 5. The "—" vs "0%" distinction and why it matters

When `scoredRows.length === 0`, the Avg. Match Rate displays `"—"` rather than `"0%"`. This is not a cosmetic preference — it encodes a semantic distinction.

`"0%"` means: a measurement was taken, and the result was zero. In the context of match rate, `0%` would imply that the user's jobs were scored and scored terribly. It is a real data point.

`"—"` means: no measurement exists. The user either has no jobs yet, or all their jobs were saved without being scored. There is nothing to average. `"—"` is the standard display for "not applicable" or "no data" in data tables and dashboards.

For a new user loading the dashboard for the first time, `"0%"` would look like a system error or a score that needs to be improved. `"—"` looks like an expected empty state. The subtitle `"Scored jobs only"` reinforces this: it tells the user that the stat only counts once scoring has happened.

The implementation keeps the value nullable through computation and only formats it at the last step:
```ts
const avgMatchRate = scoredRows.length > 0 ? `${Math.round(...)}%` : "—";
```
This is the right place to make the format decision — in `page.tsx` where the data is owned, not inside `StatCard` which only renders what it receives.

---

## 6. A TypeScript error that revealed the right edit order

When `mockStats` was removed from `page.tsx` but before the real stats queries were added, the IDE reported two TypeScript errors at the lines where `mockActivity` was defined. This was confusing — the errors appeared in the wrong place.

The explanation: the IDE was reporting stale diagnostics from the state *before* the delete edit. The actual error at that point was that `mockStats` (now deleted) was referenced in the JSX on line 91. The "errors at line 16 and 21" were phantom — they disappeared once the real queries were added and `stats` was wired into the JSX.

The lesson is about edit ordering: when you delete a constant and its replacement hasn't been added yet, the file is temporarily invalid. The IDE will report errors, but those errors are from the intermediate broken state, not from the final state. The fix is to add the replacement in the same editing session without pausing for diagnostics on the intermediate state.

In this case the fix was immediate — the real queries and the new `stats` array were added in the next edit, which restored the file to a valid state.
