# Plan — Feature 09-find-jobs-ui: Find Jobs Page Full UI

## What was built

- **`components/find-jobs/SearchControls.tsx`** — `"use client"` component; two labeled inputs (JOB TITLE, LOCATION) + Find Jobs button + conditional success banner. No props — placeholder for Feature 10.
- **`components/find-jobs/JobsTable.tsx`** — `"use client"` component; accepts `jobs: Job[]` prop; client-side filter/sort/pagination via `useMemo`. Contains module-level sub-components `MatchScoreBar` and helpers `getMatchBarColor`, `formatRelativeDate`.
- **`app/find-jobs/page.tsx`** — replaced placeholder; async Server Component; auth guard (`redirect("/login")` if no session); defines `MOCK_JOBS: Job[]` (6 entries, `found_at` computed relative to `Date.now()`); renders `<Navbar />`, `<SearchControls />`, `<JobsTable jobs={MOCK_JOBS} />`.
- **`lib/utils.ts`** — created; exports `MATCH_THRESHOLD = 70`. This is the canonical location for the threshold per CLAUDE.md.
- **`context/ui-registry.md`** — added `SearchControls` and `JobsTable` entries with class tables and pattern notes.
- **`context/progress-tracker.md`** — Feature 09 marked complete; current phase updated to Feature 10.

## Schema changes

None. Feature 09 is UI-only with mock data. No DB reads or writes.

## Key invariants

- **`MATCH_THRESHOLD` lives in `lib/utils.ts` only.** Import it; never hardcode `70` in component logic. `JobsTable` already imports it — any future filter that branches on this threshold must import from the same source.
- **`MOCK_JOBS` is defined inside the Server Component function, not at module level.** `found_at` is computed with `Date.now()` so timestamps stay relative to the actual request time. Moving it to module level would freeze timestamps at server startup.
- **`MatchScoreBar` and `getMatchBarColor` are module-level, not inside the component function.** React treats a component type defined inside a render function as a new type on every render, causing unnecessary remount. Both must stay outside `JobsTable`.
- **Match score bar fill uses inline `style={{ backgroundColor: getMatchBarColor(score) }}`, not a Tailwind class.** The fill color is dynamic (computed from `score` at runtime). Tailwind's static class system cannot express runtime-computed values. Any future change to score coloring must keep this as inline style.
- **`SearchControls` has no props intentionally.** It is a placeholder shell — its `handleSearch` function sets a hardcoded stub `searchStatus`. In Feature 10, `handleSearch` will call `POST /api/agent/find`. Do not pass data into `SearchControls` from the page; Feature 10's wiring happens inside the component via API call + `router.refresh()`.
- **Every filter/sort/page change must reset `page` to 1.** `handleFilterChange`, `handleSortChange`, and `handleTextChange` all call `setPage(1)`. If any future filter is added without this reset, users can land on a page that doesn't exist for the new filtered dataset.
- **`safePage = Math.min(page, totalPages)` must be used everywhere pagination math is needed.** `page` state can lag behind `totalPages` when filters reduce the dataset. Using raw `page` for slice calculations would produce an empty result instead of the last valid page.
