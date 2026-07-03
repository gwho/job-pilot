# Plan — Feature 15: Stats Bar Real Data

## What was built

- **`components/dashboard/StatsBar.tsx`** (modified) — `StatCardConfig` type simplified: `trend?: { value, label }` removed, `subtitle` promoted to required `string`. `TrendingUp` import removed. `StatCard` trend rendering branch removed — always renders `<p className="text-xs text-text-muted">{subtitle}</p>`.

- **`app/dashboard/page.tsx`** (modified) — `mockStats` constant removed. Four InsForge SDK queries added in `Promise.all` after the existing profile query: total job count, scored job match_scores (for JS-side average), companies-researched count, jobs-this-week count. `sevenDaysAgo` rolling cutoff computed once before `Promise.all`. Error logging after results. Safe defaults on failure (`count ?? 0`, `data ?? []`). Real `stats: StatCardConfig[]` array built and passed to `<StatsBar stats={stats} />`.

- **`context/ui-registry.md`** (modified) — StatsBar + StatCard entry updated: trend badge rows removed from the table, `subtitle` noted as required, pattern notes updated to reflect Feature 15 changes.

---

## Schema changes

None. All four stats query existing columns on the `jobs` table: `user_id`, `match_score`, `company_research`, `found_at`.

---

## Key invariants

- **All four stats queries must be scoped to `authData.user.id`.** The `authData.user` reference is guaranteed non-null at the query site because the `redirect("/login")` guard fires before `Promise.all`. Never add a stats query without `.eq("user_id", authData.user.id)`.

- **`insforge.database.from(...)` is the correct namespace.** Server-side InsForge queries always go through `.database.from()`, not `.from()` directly. See `context/library-docs.md`.

- **Counts use `count ?? 0` — never `data`.** The three count queries use `{ count: 'exact', head: true }`, which means `data` is `null` by design. `result.count` is the only useful field; always default with `?? 0`.

- **Avg. Match Rate excludes null `match_score` rows.** The `.not("match_score", "is", null)` filter is load-bearing. Removing it would silently include unscored jobs as zero in the average.

- **Avg. Match Rate shows `"—"` when `scoredRows.length === 0`.** The check `scoredRows.length > 0` must gate the format step. `"0%"` is a real measurement; `"—"` means no data exists.

- **`StatCardConfig.subtitle` is required.** Every card must have a subtitle. The type does not allow omission. The agreed subtitles are: "All time" / "Scored jobs only" / "Completed research" / "Last 7 days".

- **No `trend` field exists on `StatCardConfig`.** It was removed in Feature 15. Do not reintroduce it without a corresponding source of real comparative data.

- **`page.tsx` is the single owner of all stats data.** `StatsBar` and `StatCard` receive data as props only — they never query InsForge.

- **Stat query errors are logged, never thrown.** The `[dashboard/stats]` prefix makes server-log filtering easy. A failed query produces a safe default value — it does not crash the page.

- **`sevenDaysAgo` is a rolling 7 × 24h window from request time**, not a calendar week. It is computed with `new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()`.
