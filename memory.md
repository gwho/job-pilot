# Memory — Feature 15 Complete + Full Documentation Suite

Last updated: 2026-07-04

## What was built

### Feature 15 implementation (fully complete)

- `components/dashboard/StatsBar.tsx` — `StatCardConfig` type simplified: `trend` field removed entirely, `subtitle` promoted to required `string`. `TrendingUp` import removed. `StatCard` trend rendering branch removed — always renders `<p className="text-xs text-text-muted">{subtitle}</p>`.
- `app/dashboard/page.tsx` — `mockStats` constant removed. Four InsForge SDK queries in `Promise.all` added after the existing profile query: total job count, scored job match_scores (for JS-side average), companies-researched count, jobs-this-week count. `sevenDaysAgo` rolling cutoff computed once. Error logging with `[dashboard/stats]` prefix. Safe defaults (`count ?? 0`, `data ?? []`). Real `stats: StatCardConfig[]` built and passed to `<StatsBar stats={stats} />`.
- `context/ui-registry.md` — StatsBar + StatCard entry updated: trend badge rows removed, `subtitle` noted as required, pattern notes updated for Feature 15.
- `context/progress-tracker.md` — Feature 15 marked complete, next is Feature 16.

### Documentation suite for Feature 15

- `docs/architect/15-stats-bar-real-data/decisions.md` — 3 decisions (trend removal, null denominator + "—" empty state, 4 SDK queries in Promise.all)
- `docs/architect/15-stats-bar-real-data/discussion.md` — 8 deep concept explanations (trust boundary, null exclusion, "—" vs "0%", Promise.all, count HEAD pattern, rolling window, JS-side average, query strategy)
- `docs/architect/15-stats-bar-real-data/ai-discussion-topics.md` — 25 questions across 5 groups
- `docs/plan/15-stats-bar-real-data/plan.md` — 3 files documented, 10 invariants captured
- `docs/plan/15-stats-bar-real-data/explanation.md` — 6 sections (what was built, trust boundary + type change, data flow end-to-end, JS-side average, "—" vs "0%", TypeScript edit-order error)
- `docs/plan/15-stats-bar-real-data/ai-discussion-topics.md` — 17 questions across 5 groups
- `docs/tutorials/28-stats-bar-real-data/README.md` — Tutorial 28: 6 parts, all questions woven as checkpoints, 3 challenges

## Decisions made

- **Trend badges removed entirely** — `trend` field removed from `StatCardConfig`; TypeScript enforces it cannot be re-added accidentally. Misleading fake comparative signals next to real values violate trust. Real trend comparison belongs to a future feature.
- **All 4 cards use plain subtitle** — agreed subtitles: "All time" / "Scored jobs only" / "Completed research" / "Last 7 days".
- **Avg. Match Rate excludes null `match_score` rows** — `.not("match_score", "is", null)` filter is load-bearing. Average computed in JS from returned scores.
- **Avg. Match Rate shows `"—"` when no scored rows exist** — not `"0%"`. Absence of measurement ≠ zero measurement.
- **4 parallel SDK queries via Promise.all** — no raw SQL, no RPC function. Consistent with codebase pattern. 3 count queries use `{ count: 'exact', head: true }`; 1 fetches `match_score` for JS average.
- **`sevenDaysAgo` is a rolling 7 × 24h window from request time** — not a calendar week. Avoids timezone/locale complexity.
- **Stat errors: log with `[dashboard/stats]` prefix, never throw** — safe defaults on failure. Partial DB failure degrades gracefully.

## Problems solved

- **TypeScript error during edit** — deleting `mockStats` before adding replacement queries left file temporarily invalid. IDE reported stale diagnostics pointing at mock activity lines (wrong location). Fix: complete the edit in the same session without pausing on intermediate broken state.
- **`StatCardConfig` type enforcement** — removing `trend` as a required-absent field (vs. optional-absent) means TypeScript catches any future attempt to pass trend data without a real data source.

## Current state

- **Feature 15 fully complete** — 4 stat cards show real InsForge DB values; all documentation, architect session, and Tutorial 28 written
- **Build clean** — TypeScript passes; no stale `trend` references
- **28 tutorials** written
- Feature 16 is next in `context/build-plan.md`

## Next session starts with

Run `/remember restore`, check `context/build-plan.md` for Feature 16 scope (Recent Activity — Real Data), then `/architect Feature 16` before any code. Feature 16 queries `agent_runs` and `jobs` tables to replace the `mockActivity` array in `page.tsx`.

## Open questions

- **`catch` path still silent** — `handleSearch` `catch` block only calls `console.error`. Needs `setSearchStatus({ message: "Network error...", isError: true })`. Deferred.
- **GitHub Issue #19** — `job_found` PostHog event fires only for `match_score >= 70`. Fix in `app/api/agent/find/route.ts`. Must be resolved before Feature 17.
- **DB-level race condition** — concurrent `/api/agent/find` requests from same user could insert duplicate jobs. Needs `UNIQUE (user_id, source_url)`. Deferred.
- **JobsDB session expiry** — re-capture needed ~mid-July 2026. Run `node scripts/capture-jobsdb-session.mjs`.
- **`not-found.tsx`** — custom 404 page absent. Minor; deferred.
