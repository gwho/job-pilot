# Architect Decisions — Feature 17: Analytics Charts Real Data

## Decision 1 — Source chart data from the DB, not PostHog

**What was decided:** All three dashboard charts (`JobsFoundChart`, `CompanyResearchChart`, `MatchScoreChart`) are fed with data aggregated from InsForge DB queries in `page.tsx`, not from PostHog's API.

**Why not PostHog:**
The build plan said "query PostHog for `job_found` events." But `posthog-node` is a capture-only SDK — it has no query methods. To read event history from PostHog at render time requires direct HTTP calls to their REST API, which needs:
1. A `POSTHOG_PROJECT_ID` env var (the numeric project ID, different from `NEXT_PUBLIC_POSTHOG_KEY`)
2. Accuracy that depends on Issue #19 being fixed — because `job_found` previously only fired for `match_score >= 70`

**Why DB instead:**
The DB already holds everything needed:
- `jobs.found_at` → Jobs Found Over Time
- `jobs.company_research.researchedAt` → Company Research Activity
- `jobs.match_score` → Match Score Distribution

No new env vars. Consistent with Feature 15/16 pattern. Accurate regardless of PostHog event history quality. The pattern: `page.tsx` assembles data, passes props to presentation-only chart components — unchanged.

**What changes architecturally:** "PostHog analytics data" becomes the original build-plan label, not the implementation source. PostHog event tracking still happens; it is just not the render-time data source for charts.

---

## Decision 2 — Fix Issue #19 as its own step before Feature 17

**What was decided:** The bug where `job_found` fires only for `match_score >= 70` is fixed in a separate commit before Feature 17 code is written.

**The bug:** In `app/api/agent/find/route.ts`, `captureServerEvent` for `job_found` was inside the `MATCH_THRESHOLD` guard. Only strong matches fired the event. This made PostHog's `job_found` count consistently lower than the actual jobs saved in the DB.

**Why fix before Feature 17:** Feature 17 uses DB-backed charts, so this bug does not block chart correctness. But the project should not knowingly emit misleading analytics. The fix is small (one loop refactor), independent, and low risk. Keeping it in its own commit keeps the git history clean and readable.

**The fix pattern:**
```typescript
// Before — fires only for strong matches
const strongMatches = insertedJobs.filter(j => (j.match_score ?? 0) >= MATCH_THRESHOLD).length;
for (const job of insertedJobs) {
  if ((job.match_score ?? 0) >= MATCH_THRESHOLD) {
    await captureServerEvent({ event: "job_found", ... });
  }
}

// After — fires for every saved job
let strongMatches = 0;
for (const job of insertedJobs) {
  if ((job.match_score ?? 0) >= MATCH_THRESHOLD) strongMatches++;
  await captureServerEvent({ event: "job_found", ... });
}
```

`strongMatches` is still computed for the success message — it is not removed.

---

## Decision 3 — Rolling 7-day window ending today, not current Mon–Sun week

**What was decided:** Both time-series charts show the last 7 calendar days ending today. Bucket labels are the short weekday name (Mon, Tue, etc.) of each actual date in the window.

**Why not "current calendar week":**
A "current week" window starting Monday has a structural problem: if today is Wednesday, Friday through Sunday would show as future days with zero counts. That's confusing — the chart would display empty bars for days that haven't happened. A rolling window always ends today and always shows 7 days of real history.

**Why 7 days, not the build plan's "last 30 days" for jobs found:**
The chart components were sized and designed around 7 data points (the mock arrays had 7 entries). 30 days of daily data would require date labels ("Jun 15", "Jun 16"...) that crowd together at the chart's width. Keeping both time-series charts at 7 days also makes them consistent with each other.

**Weekday label uniqueness:** 7 consecutive calendar days always includes exactly one of each weekday. There are never duplicate labels (e.g. two "Mon" entries) in a rolling 7-day window.

---

## Decision 4 — Oldest-bucket start-of-day as the research chart cutoff

**What was decided:** The `buildResearchByDay` function uses the start of day (midnight) 6 calendar days ago as its cutoff, not `Date.now() - 7 * 24 * 60 * 60 * 1000`.

**The problem with a rolling hour cutoff:** `Date.now() - 168h` is a 168-hour window. If the oldest bucket in the chart represents Sunday, but a research event happened at 6 AM on Sunday and the cutoff lands at 8 AM Sunday (because the page was rendered at 8 PM Saturday + 168h), that event falls outside the window even though Sunday is one of the 7 displayed days. The user sees Sunday's bar show zero even though something happened that day.

**The correct approach:**
```typescript
const oldestDay = new Date();
oldestDay.setDate(oldestDay.getDate() - 6);
oldestDay.setHours(0, 0, 0, 0);            // midnight = start of that calendar day
const cutoff = oldestDay.getTime();
```

The cutoff is anchored to the same calendar day as the oldest bucket, not to a floating 168-hour window. Any event on that day is included.

---

## Decision 5 — Separate chart-specific query for Company Research Activity

**What was decided:** The Company Research Activity chart uses a new `chartResearchJobsResult` query — not the `researchJobsResult` query already used by the Recent Activity feed.

**Why not reuse `researchJobsResult`:** That query fetches 20 rows ordered by `found_at` descending. Feature 16 established that `found_at` (when the job was scraped) and `researchedAt` (when the user ran research) can differ by days or weeks. A user might find a job in January and research it in July. If 20 more recently-found jobs all happened to have research done first, this July research event would be outside the 20-row limit and silently missing from the chart.

**The chart query:**
```typescript
insforge.database
  .from("jobs")
  .select("company_research")
  .eq("user_id", authData.user.id)
  .not("company_research", "is", null)
```

No limit. No order. Fetches `company_research` JSONB for every researched job the user has. Filtering to the last 7 days happens in JS by reading `researchedAt` from the JSONB. This guarantees no recent research event is missed regardless of when the job was originally found.

---

## Decision 6 — Aggregation helpers as module-level functions in `page.tsx`

**What was decided:** Three aggregation functions (`buildJobsFoundByDay`, `buildResearchByDay`, `buildMatchScoreDistribution`) are defined at module scope in `app/dashboard/page.tsx`, not in `lib/utils.ts`.

**Why not `lib/utils.ts`:** `formatRelativeDate` and `getIsoTimestampDaysAgo` live in utils because they are used across multiple pages. These chart aggregation functions are dashboard-specific transforms called only from `page.tsx`. Adding them to `lib/utils.ts` would pollute a shared module with logic that has exactly one consumer. If they become reused later, move them then.

**Why module-level, not inside the component:** The component function runs on every request. Functions defined inside the component are re-created on every render (a minor perf concern) and cannot be easily tested in isolation. Module-level functions are defined once, stable across requests, and clearly separated from the render logic.

---

## Decision 7 — Always render charts with zero-filled data; no separate empty state

**What was decided:** Charts always receive 7 pre-filled buckets (or 5 for match score), even if all counts are zero. No `isEmpty` prop, no conditional swap to a text message.

**Why no empty state:** The chart components were built as presentation-only components that accept a data array. Adding an empty state would mean either modifying the components (adding an `isEmpty` prop or internal conditional) or conditionally rendering different JSX in `page.tsx` depending on whether data is all-zero. Either path changes the component contract established in Feature 14. A flat chart with zero bars communicates "no activity yet" adequately and keeps the layout stable on first visit.

---

## Decision 8 — Type predicate instead of type assertion for JSONB extraction

**What was decided:** A module-level type predicate `hasResearchedAt` is used to safely extract `researchedAt` from JSONB instead of a direct type assertion.

**Why this matters:** `code-standards.md` discourages type assertions (`as SomeType`). The `company_research` column is `unknown` at the TypeScript level (JSONB can be anything). An assertion `as { researchedAt?: string }` would skip runtime verification — if the JSONB shape changes, it silently corrupts data.

**The type predicate pattern:**
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

The one `as Record<string, unknown>` inside the guard is a safe structural cast after the null/object check — not a blind assertion. The calling code is fully clean:
```typescript
if (!hasResearchedAt(job.company_research)) continue;
const ts = new Date(job.company_research.researchedAt).getTime(); // fully typed
```

---

## Decision 9 — Match Score Distribution excludes scores below 50

**What was decided:** The five fixed buckets ("50-60%", "60-70%", "70-80%", "80-90%", "90-100%") match the mock data ranges. Jobs with `match_score < 50` are silently excluded — they fall through all range checks.

**Why this is intentional:** The chart design was established in Feature 14 with these five ranges. Changing them to include a "<50%" bucket would change the chart's visual language and require updating the `MatchScoreChart` component. For Feature 17's scope (replacing mock data, not redesigning the chart), the right choice is to match the existing shape exactly.

**What this means for users:** A user with many low-scoring jobs will see their distribution only in the 50–100 range. This is acceptable — jobs below 50 are weak matches and the chart's purpose is to show the distribution of meaningful matches.
