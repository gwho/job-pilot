# Feature 17 — Analytics Charts Real Data

## Context

The dashboard has three chart components (`CompanyResearchChart`, `JobsFoundChart`, `MatchScoreChart`) currently fed by three mock constant arrays in `app/dashboard/page.tsx`. Feature 17 replaces those mock arrays with real DB-backed data assembled in the Server Component, matching the pattern established in Features 15 (stats bar) and 16 (activity feed).

The original build plan said "query PostHog" for chart data. After investigation, `posthog-node` is capture-only — it cannot query event history. Using PostHog's REST API would require a new `POSTHOG_PROJECT_ID` env var and accuracy would depend on Issue #19. Decision: source all chart data from the DB.

A pre-step fixes Issue #19 (`job_found` only fires for strong matches) as a separate change before Feature 17 begins.

---

## Step 0 — Issue #19 Fix (own commit, before Feature 17)

**File:** `app/api/agent/find/route.ts`

**Change:** Remove the `MATCH_THRESHOLD` guard from the `captureServerEvent` loop (lines 260–278). Fire `job_found` for every inserted job. Count `strongMatches` separately via a running counter in the same loop.

Before (simplified):
```typescript
const strongMatches = insertedJobs.filter(j => (j.match_score ?? 0) >= MATCH_THRESHOLD).length;
for (const job of insertedJobs) {
  if ((job.match_score ?? 0) >= MATCH_THRESHOLD) {
    await captureServerEvent({ ... event: "job_found" ... });
  }
}
```

After:
```typescript
let strongMatches = 0;
for (const job of insertedJobs) {
  if ((job.match_score ?? 0) >= MATCH_THRESHOLD) strongMatches++;
  await captureServerEvent({
    distinctId: userId,
    event: "job_found",
    properties: { userId, source: "search", sourceProvider: "jobsdb_hk", matchScore: job.match_score, company: job.company },
  });
}
```

`strongMatches` is still used in the success message — it is not removed.

---

## Feature 17 — Chart Real Data

### Decisions made

| Decision | Choice |
|---|---|
| Data source | DB aggregation (not PostHog REST API) |
| Date window | Rolling last 7 calendar days ending today |
| Day labels | Short weekday name of each bucket's actual date — 7 consecutive days always = 7 distinct weekday names |
| Aggregation helpers location | Module-level functions in `app/dashboard/page.tsx` — dashboard-specific, not shared |
| Empty state | Always render chart with zero-filled buckets — no separate empty state |
| Chart component changes | None — presentation-only components stay unchanged |
| Score distribution coverage | Scores below 50 are excluded — matches existing chart range labels ("50-60%"…"90-100%") |

### Data reuse map

| Chart | Source | New query? |
|---|---|---|
| Jobs Found Over Time | `recentJobsResult` — `found_at` for jobs in last 7 days | Yes |
| Company Research Activity | `chartResearchJobsResult` — `company_research` for all non-null rows, filter by `researchedAt` in JS | Yes |
| Match Score Distribution | `scoredJobsResult` — already fetches all `match_score` values | No |

**Do not reuse `researchJobsResult` for the research chart.** That query is limited to 20 rows ordered by `found_at` — it misses recently researched older jobs. Feature 16 established that `found_at` ≠ `researchedAt`.

---

### File: `app/dashboard/page.tsx`

#### 1. Remove mock constants

Delete `mockCompanyResearchData`, `mockJobsFoundData`, `mockMatchScoreData` (lines 14–40).

#### 2. Add two new queries to `Promise.all`

Add as the 7th and 8th entries:

```typescript
// 7th — for Jobs Found Over Time chart
insforge.database
  .from("jobs")
  .select("found_at")
  .eq("user_id", authData.user.id)
  .gte("found_at", sevenDaysAgo)
  .order("found_at", { ascending: false }),

// 8th — for Company Research Activity chart (no limit — must not miss recently researched older jobs)
insforge.database
  .from("jobs")
  .select("company_research")
  .eq("user_id", authData.user.id)
  .not("company_research", "is", null),
```

`sevenDaysAgo` is already computed above the `Promise.all`. Destructure as `recentJobsResult` and `chartResearchJobsResult`. Add error logging for both: `console.error("[dashboard/charts] recent jobs", ...)` and `console.error("[dashboard/charts] research chart", ...)`.

#### 3. Add a type predicate for safe JSONB extraction

Avoids type assertions (`as`) per `code-standards.md`. Define at module level:

```typescript
type ResearchWithTimestamp = { researchedAt: string };

function hasResearchedAt(v: unknown): v is ResearchWithTimestamp {
  return (
    v !== null &&
    typeof v === 'object' &&
    'researchedAt' in v &&
    typeof (v as Record<string, unknown>).researchedAt === 'string'
  );
}
```

#### 4. Add three module-level aggregation functions

**`buildJobsFoundByDay`** — groups `found_at` timestamps into a 7-bucket rolling window:

```typescript
function buildJobsFoundByDay(
  jobs: { found_at: string }[],
): { day: string; count: number }[] {
  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  type Bucket = { dateStr: string; day: string; count: number };
  const buckets: Bucket[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    buckets.push({ dateStr: d.toDateString(), day: DAY[d.getDay()], count: 0 });
  }
  for (const job of jobs) {
    const ds = new Date(job.found_at).toDateString();
    const b = buckets.find(b => b.dateStr === ds);
    if (b) b.count++;
  }
  return buckets.map(({ day, count }) => ({ day, count }));
}
```

**`buildResearchByDay`** — extracts `researchedAt` using the type predicate, uses oldest-bucket start-of-day as cutoff (not `Date.now() - 7 * 24h`, which can exclude early events from the oldest displayed day):

```typescript
function buildResearchByDay(
  jobs: { company_research: unknown }[],
): { day: string; count: number }[] {
  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  // Cutoff = start of the oldest bucket (6 days ago at 00:00:00)
  const oldestDay = new Date();
  oldestDay.setDate(oldestDay.getDate() - 6);
  oldestDay.setHours(0, 0, 0, 0);
  const cutoff = oldestDay.getTime();

  type Bucket = { dateStr: string; day: string; count: number };
  const buckets: Bucket[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    buckets.push({ dateStr: d.toDateString(), day: DAY[d.getDay()], count: 0 });
  }
  for (const job of jobs) {
    if (!hasResearchedAt(job.company_research)) continue;
    const ts = new Date(job.company_research.researchedAt).getTime();
    if (isNaN(ts) || ts < cutoff) continue;
    const ds = new Date(ts).toDateString();
    const b = buckets.find(bk => bk.dateStr === ds);
    if (b) b.count++;
  }
  return buckets.map(({ day, count }) => ({ day, count }));
}
```

**`buildMatchScoreDistribution`** — buckets `match_score` into five non-overlapping ranges. Scores below 50 are excluded (matches existing chart labels):

```typescript
const SCORE_RANGES = [
  { range: '50-60%', min: 50, max: 59 },
  { range: '60-70%', min: 60, max: 69 },
  { range: '70-80%', min: 70, max: 79 },
  { range: '80-90%', min: 80, max: 89 },
  { range: '90-100%', min: 90, max: 100 },
] as const;

function buildMatchScoreDistribution(
  jobs: { match_score: number | null }[],
): { range: string; count: number }[] {
  const counts = new Map<string, number>(SCORE_RANGES.map(r => [r.range, 0]));
  for (const job of jobs) {
    if (job.match_score == null) continue;
    for (const { range, min, max } of SCORE_RANGES) {
      if (job.match_score >= min && job.match_score <= max) {
        counts.set(range, (counts.get(range) ?? 0) + 1);
        break;
      }
    }
  }
  return SCORE_RANGES.map(({ range }) => ({ range, count: counts.get(range) ?? 0 }));
}
```

#### 5. Compute chart data and pass to components

After the `Promise.all` error-logging block:

```typescript
const companyResearchData = buildResearchByDay(chartResearchJobsResult.data ?? []);
const jobsFoundData = buildJobsFoundByDay(recentJobsResult.data ?? []);
const matchScoreData = buildMatchScoreDistribution(scoredJobsResult.data ?? []);
```

Replace mock props in JSX:
```tsx
<CompanyResearchChart data={companyResearchData} />
<JobsFoundChart data={jobsFoundData} />
<MatchScoreChart data={matchScoreData} />
```

---

### Files NOT changed

- `components/dashboard/CompanyResearchChart.tsx`
- `components/dashboard/JobsFoundChart.tsx`
- `components/dashboard/MatchScoreChart.tsx`
- `lib/posthog-server.ts`
- `lib/utils.ts`

---

### Documentation to create (per AGENTS.md)

- `docs/architect/17-analytics-charts-real-data/decisions.md`
- `docs/plan/17-analytics-charts-real-data/plan.md`
- `docs/plan/17-analytics-charts-real-data/explanation.md`
- `docs/plan/17-analytics-charts-real-data/ai-discussion-topics.md`
- Update `context/progress-tracker.md` — mark Feature 17 complete
- Update `context/ui-registry.md` — note real data sources for three chart components

---

### Verification

1. Run `npm run dev`
2. Log in and open `/dashboard`
3. Run a job search — Jobs Found Over Time should show today's bar increment
4. Research a company — Company Research Activity should show today's bar increment
5. Confirm Match Score Distribution shows real score buckets from the DB
6. Confirm all four stat cards still render correctly (no regression in existing queries)
7. Run `npm run build` — TypeScript must pass clean
