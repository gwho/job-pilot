# Plan — Feature 17: Analytics Charts Real Data

## What was built

- **`app/api/agent/find/route.ts`** — Issue #19 fix: `captureServerEvent` for `job_found` moved outside the `MATCH_THRESHOLD` guard; fires for every inserted job, not just strong matches. `strongMatches` counter computed via `let` + increment in the same loop.
- **`app/dashboard/page.tsx`** — Three mock constants removed (`mockCompanyResearchData`, `mockJobsFoundData`, `mockMatchScoreData`). Type predicate `hasResearchedAt` and constant `SCORE_RANGES` added at module level. Three aggregation functions added at module level: `buildJobsFoundByDay`, `buildResearchByDay`, `buildMatchScoreDistribution`. Two new queries added to the existing `Promise.all` (7th: `recentJobsResult`; 8th: `chartResearchJobsResult`). Error logging added for both new queries. Chart data computed after the error-logging block. Real arrays passed to `<CompanyResearchChart>`, `<JobsFoundChart>`, `<MatchScoreChart>` in JSX.

## Schema changes

None.

## Key invariants

- **`chartResearchJobsResult` must never be replaced with `researchJobsResult`.** The activity feed query is `.limit(20)` ordered by `found_at`. The chart query has no limit and fetches all researched jobs. A job found months ago but researched today is visible only in the chart query.

- **The `buildResearchByDay` cutoff is computed from the oldest bucket's start-of-day (`setHours(0,0,0,0)`), not from `Date.now() - 7 * 24h`.** A rolling-hours cutoff excludes early-morning events on the oldest displayed day. The calendar-day anchor never does.

- **Both time-series charts use a rolling 7-day window ending today** — not "current Mon–Sun calendar week." Never anchor to Monday. Always generate buckets as `new Date(); d.setDate(d.getDate() - i)` for `i` from 6 to 0.

- **`buildResearchByDay` uses `hasResearchedAt` (the type predicate) to extract `researchedAt` from JSONB** — not a type assertion. The predicate verifies both `typeof === 'object'` and `typeof .researchedAt === 'string'` at runtime.

- **`SCORE_RANGES` defines non-overlapping half-open-style integer buckets: `[50,59]`, `[60,69]`, `[70,79]`, `[80,89]`, `[90,100]`.** Scores below 50 are excluded. The ranges must match the `MatchScoreChart` XAxis `dataKey="range"` labels exactly.

- **`buildJobsFoundByDay`, `buildResearchByDay`, `buildMatchScoreDistribution` must remain module-level functions in `page.tsx`**, not moved inside `DashboardPage` or into `lib/utils.ts`. Module-level keeps them stable across renders; `utils.ts` is for shared, multi-page utilities only.

- **Chart components receive fully computed arrays as props and do no data transformation themselves.** All aggregation is in `page.tsx` before the JSX return. The `components/dashboard/` chart files must not be given raw DB rows.

- **The `job_found` PostHog event must fire for every inserted job** — not gated on `match_score >= MATCH_THRESHOLD`. `strongMatches` is still counted (for the success message) but must never re-gate the event.
