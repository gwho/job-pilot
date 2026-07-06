# Explanation — Feature 17: Analytics Charts Real Data

## 1. Why the build plan said "PostHog" but the implementation uses the DB

The original build plan specified "query PostHog for `job_found` events" for the Jobs Found Over Time chart and "query PostHog for `company_researched` events" for the Company Research Activity chart. This framing implied that `posthog-node`, the server-side PostHog SDK already installed in the project, could fetch event history. It cannot.

`posthog-node` is a **capture-only** SDK. Its entire public surface is oriented around sending events to PostHog's ingestion endpoint: `posthog.capture()`, `posthog.identify()`, `posthog.shutdown()`. There are no methods for reading events back. The SDK is purpose-built for the direction of "app → PostHog," not "PostHog → app."

To read analytics data from PostHog at render time, you would need to call PostHog's REST API directly — specifically an endpoint like `GET https://us.posthog.com/api/projects/{projectId}/events/?event=job_found`. This requires a numeric project ID (found in the PostHog dashboard URL, e.g. `https://app.posthog.com/project/12345`) — a completely different identifier from the `NEXT_PUBLIC_POSTHOG_KEY` (`phc_xxx` string) used for event ingestion. The project ID is not in the current env var list, so using PostHog as the read source would mean adding a new env var, writing a raw `fetch()` wrapper, and parsing the REST response — all for data that is already in the DB.

The DB is in fact the correct source. These charts answer per-user questions: "How many jobs did I save this week? How many companies have I researched?" All the data for those questions lives in the `jobs` table, scoped to the current user. The `found_at` column timestamps job saves. The `company_research.researchedAt` JSONB field timestamps research runs. The `match_score` column holds the distribution data. No PostHog query is needed.

The architectural principle at work: PostHog is the right tool for cross-user, aggregate behavioral analysis ("what percentage of users run more than 3 searches?"). The DB is the right tool for per-user personal dashboards ("how many jobs did this user save?"). Feature 17 is the latter.

---

## 2. Issue #19: how the bug worked and why the fix landed before Feature 17

Before this feature, `app/api/agent/find/route.ts` fired `captureServerEvent` for `job_found` inside a `MATCH_THRESHOLD` guard:

```typescript
for (const job of insertedJobs) {
  if ((job.match_score ?? 0) >= MATCH_THRESHOLD) {
    await captureServerEvent({ event: "job_found", ... });
  }
}
```

This meant PostHog received one `job_found` event only for jobs scoring 70 or above. A search that found 20 jobs with 4 strong matches would produce 4 `job_found` events in PostHog, even though 20 rows were inserted into the DB.

The `code-standards.md` definition for `job_found` is clear: "Each job discovered and saved." The implementation had drifted from the specification. PostHog's historical `job_found` counts are permanently lower than actual, but the issue was fixed going forward.

The fix was to combine the `strongMatches` count and the event loop into a single pass:

```typescript
let strongMatches = 0;
for (const job of insertedJobs) {
  if ((job.match_score ?? 0) >= MATCH_THRESHOLD) strongMatches++;
  await captureServerEvent({ event: "job_found", ... });
}
```

`strongMatches` is still used in the `successMessage` returned to the client ("Found X jobs and saved Y new jobs"). It was not removed — only its calculation method changed from `.filter().length` to a running counter. The fix was kept as its own independent change before the Feature 17 chart wiring, both because it's logically independent and to keep the git history readable.

---

## 3. The full end-to-end data flow for each chart

**Jobs Found Over Time:**
At page render time, `DashboardPage` (a Server Component) runs a new 7th query in the `Promise.all`: all `jobs` rows for the current user with `found_at >= sevenDaysAgo`, selecting only the `found_at` column. `sevenDaysAgo` is the existing `getIsoTimestampDaysAgo(7)` value already computed above the `Promise.all` for the stats bar. The DB returns an array of `{ found_at: string }` objects. `buildJobsFoundByDay` iterates them, groups by calendar date using `toDateString()`, and returns 7 `{ day: string; count: number }` objects ordered oldest-to-newest. That array is passed as `data` to `<JobsFoundChart>`, which renders an `AreaChart`.

**Company Research Activity:**
A new 8th query fetches all `jobs` rows for the current user where `company_research IS NOT NULL`, selecting only the `company_research` column. No limit, no ordering. The DB returns an array of `{ company_research: unknown }` objects. `buildResearchByDay` iterates them: for each row, `hasResearchedAt` checks whether `company_research.researchedAt` exists and is a string. If it passes, the timestamp is parsed, compared against the calendar-day cutoff (midnight of the oldest bucket date), and if within range, the corresponding day bucket is incremented. The result is 7 `{ day: string; count: number }` objects passed as `data` to `<CompanyResearchChart>`.

**Match Score Distribution:**
No new query is needed. The existing `scoredJobsResult` already fetches `match_score` for all non-null scored jobs for the user (this was added in Feature 15 for the Avg. Match Rate stat card). `buildMatchScoreDistribution` iterates those rows, checks each `match_score` against the five `SCORE_RANGES`, and increments the matching bucket. Scores below 50 are silently excluded — no bucket captures them. The result is 5 `{ range: string; count: number }` objects passed as `data` to `<MatchScoreChart>`.

---

## 4. Why `researchJobsResult` cannot be reused for the chart — the `found_at` vs `researchedAt` invariant

Feature 16 established a critical invariant: `found_at` (when a job was scraped and added to the DB) and `researchedAt` (when the user clicked "Research Company" and the dossier was generated) are different timestamps that can differ by days, weeks, or months.

`researchJobsResult` was built for the Recent Activity feed. Its query is:
```typescript
.order("found_at", { ascending: false })
.limit(20)
```

It returns the 20 most recently *found* jobs that have research. This is correct for the activity feed — you want a reasonably recent and bounded set of jobs to display.

For the Company Research Activity chart, the question is "how many research runs happened on each of the last 7 days?" A job found 90 days ago but researched yesterday is highly relevant — it should appear in yesterday's bar. But `researchJobsResult` might not include it: if the user has 20 jobs found more recently that also have research, the old-but-recently-researched job falls outside the `.limit(20)` and is silently missing from the chart.

The chart query removes both constraints:
```typescript
.select("company_research")
.not("company_research", "is", null)
// no .order(), no .limit()
```

Every researched job is returned. The 7-day filtering happens in JS by reading `researchedAt` from the JSONB. This is the only query design that correctly represents the Company Research Activity chart regardless of the user's research history.

---

## 5. The rolling 7-day window and why "current calendar week" is wrong

The build plan mentioned "last 7 days" for the Company Research chart and "last 30 days" for Jobs Found. Both time-series charts ended up using a rolling 7-day window. The 30-day suggestion was rejected because the chart components were designed around 7 data points (the mock arrays both had 7 entries with Mon–Sun labels). 30 days of daily data would need date labels like "Jun 15", "Jun 16" — 30 labels crammed into a 240px chart width.

An alternative framing would have been "current calendar week" — Monday through Sunday of the present week. This was rejected for a specific structural reason: it shows future days. If today is Wednesday, a Monday-anchored week window would need to display Thursday, Friday, Saturday, and Sunday as future days with zero bars. A user opening the dashboard on Wednesday would see 4 empty bars on the right side of the chart, which looks like a drop in activity rather than "those days haven't happened yet."

A rolling 7-day window ending today always displays 7 days of real history. The labels are the short weekday name of each actual calendar date — for example, if today is Wednesday, the labels (oldest to newest) are: Thu, Fri, Sat, Sun, Mon, Tue, Wed. These are always 7 distinct weekday names: because 7 consecutive calendar days spans exactly one full week cycle, there are never duplicate labels.

---

## 6. The cutoff precision problem in `buildResearchByDay`

The naive implementation for a 7-day window cutoff would be:
```typescript
const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; // 168 hours ago
```

This is a floating window anchored to the exact moment the page renders. The problem: if the page renders at 3 PM on Sunday, the cutoff is 3 PM last Sunday. The oldest bucket in the chart represents last Sunday (as a full calendar day). A research event that happened at 9 AM last Sunday — which is clearly "on the oldest displayed day" — would be excluded because it occurred before the cutoff (3 PM last Sunday).

The correct anchor is midnight of the oldest bucket:
```typescript
const oldestDay = new Date();
oldestDay.setDate(oldestDay.getDate() - 6);  // same calendar date as the oldest bucket
oldestDay.setHours(0, 0, 0, 0);              // midnight = start of that day
const cutoff = oldestDay.getTime();
```

By anchoring to midnight, any event that occurred at any time on the oldest displayed day is included. The cutoff aligns with the bucket boundary rather than floating based on render time.

Note: this issue only applies to `buildResearchByDay`. The `buildJobsFoundByDay` function processes rows already filtered by the DB query (`found_at >= sevenDaysAgo`). The DB pre-filters the rows, so the JS loop doesn't need its own cutoff — every row from that query belongs in one of the 7 buckets by definition.

---

## 7. The type predicate for JSONB extraction — why not a type assertion

`code-standards.md` says: "Never use type assertions (`as SomeType`) unless absolutely necessary and commented why." The `company_research` column is typed as `unknown` at the TypeScript level — InsForge returns JSONB as an untyped value. The temptation is:

```typescript
const research = job.company_research as { researchedAt?: string };
```

This compiles, but it bypasses any runtime check. If the JSONB ever lacks `researchedAt` (for example, an old dossier written before that field was added), `research.researchedAt` would be `undefined` with no error. Worse: if a future migration changes the field name, TypeScript won't catch it — the assertion silently passes and the downstream `new Date(undefined)` produces `NaN` silently.

A type predicate is the correct pattern:

```typescript
type ResearchWithTimestamp = { researchedAt: string };

function hasResearchedAt(v: unknown): v is ResearchWithTimestamp {
  return (
    v !== null &&
    typeof v === "object" &&
    "researchedAt" in v &&
    typeof (v as Record<string, unknown>).researchedAt === "string"
  );
}
```

The function signature `v is ResearchWithTimestamp` is a TypeScript type predicate: calling `hasResearchedAt(x)` in an `if` condition narrows `x` to `ResearchWithTimestamp` inside the true branch. The one `as Record<string, unknown>` inside the guard body is a structural cast after the null/object check — it is safe because the `"researchedAt" in v` check has already confirmed `v` is a non-null object with that key. The calling code is fully clean:

```typescript
if (!hasResearchedAt(job.company_research)) continue;
const ts = new Date(job.company_research.researchedAt).getTime(); // typed string, no cast
```

The predicate also serves as reusable documentation of the expected JSONB shape for anyone reading the code.

---

## 8. TypeScript errors encountered during implementation

The implementation produced three TypeScript errors immediately after the first edit, all from the same root cause: two JSX props still referenced the old mock constant names after the mocks were deleted but before the JSX was updated.

```
Cannot find name 'mockCompanyResearchData'. Did you mean 'companyResearchData'?
Cannot find name 'mockJobsFoundData'. Did you mean 'jobsFoundData'?
Cannot find name 'mockMatchScoreData'. Did you mean 'matchScoreData'?
```

The compiler also reported three "declared but never read" hints for `jobsFoundData`, `companyResearchData`, `matchScoreData` — because those variables were computed but the JSX still referenced the deleted mock names. The three errors and three hints were all resolved by updating the two remaining JSX prop references to the real variable names.

The resolution order matters: the mock constants were deleted first (in the same edit that added the aggregation functions and helper), and the JSX references to the old names were updated last. If the JSX had been updated in the same edit as the deletion, no error would have appeared. The two-step approach that produced the errors is not wrong — TypeScript catches intermediate broken states during multi-step edits, which is expected behavior.

---

## 9. The `Promise.all` grows to 8 queries — degradation contract applies to all

The dashboard `page.tsx` `Promise.all` started with 4 queries in Feature 15, grew to 6 in Feature 16, and now has 8. The Feature 15 degradation contract applies to all 8:

- If any query produces an error, that error is logged with a `[dashboard/...]` prefix and the corresponding data defaults to `[]` or `0`.
- `Promise.all` itself will not reject — each query returns `{ data, error }` and errors are checked individually.
- The chart data computed from a failed query will be an all-zero array (built from an empty input `[]`).
- The page always renders.

The two new queries use `[dashboard/charts]` as their log prefix, matching the convention for chart-specific errors. This distinguishes them from `[dashboard/stats]` (the first four queries) and `[dashboard/activity]` (the activity feed queries).
