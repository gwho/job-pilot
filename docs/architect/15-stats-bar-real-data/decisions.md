# Architectural Decisions — Feature 15: Stats Bar Real Data

Three decisions were made during this session. Each is documented below with the reasoning, alternatives considered, and what the alternative would have cost.

---

## Decision 1 — Trend badges: remove entirely, replace with plain subtitles

**What was decided:**
The green trend badges on cards 1 (Total Jobs Found) and 2 (Avg. Match Rate) were removed. All four stat cards now render a plain text subtitle beneath the number. No `trend` field exists on `StatCardConfig` any more.

**The four agreed subtitles:**
| Card | Subtitle |
|---|---|
| Total Jobs Found | "All time" |
| Avg. Match Rate | "Scored jobs only" |
| Companies Researched | "Completed research" |
| Jobs This Week | "Last 7 days" |

**Why this choice:**
Feature 15 is described as a "trust boundary." When mock stat values become real, every nearby element that is still fake becomes suspicious. The badges were showing `+12% vs last week` and `+3% vs last week` — both invented. Leaving them next to real numbers creates an implicit lie: the user sees a real "284 jobs" and an invented "+12%" next to it and cannot tell which to trust.

The neutralization option (Option B — badge reading "Live data") was considered and rejected. A badge that says "Live data" is visually decorative but semantically odd — it uses the design affordance of a comparative signal without conveying comparison. It would look like a bug to a careful user.

Real trend comparison (Option C) would have required a second set of queries comparing current-week stats to prior-week stats. That is a meaningful scope increase for Feature 15, and it belongs to a future dashboard enhancement where historical comparison is the explicit goal.

**What the alternative would have cost:**
- **Option B (neutral badge):** Visual inconsistency — the badge exists for comparison semantics, not decoration. Using it as a "live" label repurposes a design affordance in a confusing way.
- **Option C (real trends):** Scope creep. Eight queries instead of four, plus the complexity of week-boundary logic, timezone handling, and edge cases for users with very few jobs.

**Type change:**
`StatCardConfig` before:
```ts
type StatCardConfig = {
  label: string;
  value: string;
  trend?: { value: string; label: string };
  subtitle?: string;
};
```
`StatCardConfig` after:
```ts
type StatCardConfig = {
  label: string;
  value: string;
  subtitle: string; // required on every card
};
```
The `TrendingUp` import and the `trend ? ... : ...` rendering branch were both removed from `StatCard`. The component is now simpler: label → number → subtitle, always.

---

## Decision 2 — Avg. Match Rate: exclude null scores, show "—" for no-data

**What was decided:**
`match_score` rows that are `null` are excluded from the Avg. Match Rate calculation. When no scored rows exist, the card shows `"—"` instead of `"0%"`. The value is computed nullable in JS and only formatted at the display step.

**How it works:**

Query — filters nulls at the DB level:
```ts
insforge.database
  .from("jobs")
  .select("match_score")
  .eq("user_id", authData.user.id)
  .not("match_score", "is", null)
```

Computation — nullable until format:
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

**Why exclude nulls from the denominator:**
Some jobs are saved without a match score — this happens when the scoring step fails or a job is imported without being run through Nemotron. Including those as zero would drag down the average in a misleading way. A user who found 10 jobs, 5 of which scored 80% and 5 of which were unscored, would see 40% if nulls counted as zero. The `"Scored jobs only"` subtitle signals this explicitly.

**Why "—" instead of "0%":**
`0%` is a measurement result — it means something was measured and came back at zero. `"—"` means nothing was measured yet. These are semantically different states. A brand-new user who has no scored jobs should see `"—"` with subtitle `"Scored jobs only"`, which reads naturally as "nothing scored yet." Showing `0%` would look like a broken or wrongly-configured system.

**Why keep it nullable until the format step:**
The rule is: compute the value in its natural domain (either a number or nothing), then format for display at the last moment. This keeps the logic readable:
```ts
const avgMatchRate = scoredRows.length > 0 ? `${Math.round(...)}%` : "—";
```
Anyone reading the code can see immediately: "if there are scored rows, format as percentage; otherwise, show dash." The condition and the fallback are co-located.

**What the alternative would have cost:**
- **Including nulls (counting as 0):** Misleading average. Penalises users for having unscored jobs — a condition they did not cause and may not know about.
- **Showing "0%" for no-data:** Implies a measurement that did not occur. Would look like a bug on a fresh account.

---

## Decision 3 — Query strategy: four separate SDK queries in Promise.all

**What was decided:**
Four separate InsForge SDK queries run concurrently via `Promise.all`. Three use `{ count: 'exact', head: true }` to get row counts without fetching data. One fetches `match_score` values for JS-side average computation.

```ts
const [totalJobsResult, scoredJobsResult, companiesResult, thisWeekResult] =
  await Promise.all([
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
  ]);
```

**Why four separate queries:**
This pattern matches exactly how every other data-fetching step in this codebase works: SDK calls that return `{ data, error }`, each independently handled. The alternative was a single raw SQL aggregation query via an InsForge RPC function — but that would require creating a new database function (infrastructure step), a new query pattern, and a separate error handling path. For four lightweight aggregate queries, the performance benefit of one round-trip is negligible.

**Why Promise.all:**
Running them sequentially would add latency proportional to the number of queries (each waits for the previous). `Promise.all` fires all four concurrently — the total latency is the slowest single query, not the sum of all four. On a server component rendered at request time, this matters for page load speed.

**Error handling after Promise.all:**
Each result is checked independently:
```ts
if (totalJobsResult.error)
  console.error("[dashboard/stats] total jobs", totalJobsResult.error);
```
Errors are logged with a `[dashboard/stats]` prefix (findable in server logs) but do not throw. Safe defaults are used: `count ?? 0` for counts, `data ?? []` for the scored jobs array. This means a partial DB failure results in a zeroed-out stat card, not a broken page.

**The "Jobs This Week" cutoff:**
`sevenDaysAgo` is computed once before `Promise.all`:
```ts
const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
```
This is a rolling 7×24h window from the moment the page is rendered — not a calendar week (Mon–Sun). Calendar weeks would require knowing the user's timezone and day-of-week start convention. Rolling window is simpler and still meaningful.

**What the alternative would have cost:**
- **Single raw SQL / RPC function:** New database object to maintain, new query pattern, more setup before implementation can begin. For Feature 15 scale this is not justified.
- **Sequential queries:** Unnecessary latency. Each query would wait for the previous one to complete even though they are independent.
- **Calendar week for "Jobs This Week":** Timezone edge cases, locale-dependent start day, more complex query. Rolling window is simpler and equally informative.
