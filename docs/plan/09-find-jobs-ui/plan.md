# Plan — Feature 09-find-jobs-ui: Find Jobs Page Full UI

## What was built

- **`lib/utils.ts`** — created; exports `MATCH_THRESHOLD = 70`, `getMatchBarColor(score)`, and `formatRelativeDate(dateStr)`. Canonical location for shared pure utilities per CLAUDE.md.
- **`components/find-jobs/SearchControls.tsx`** — `"use client"` component; two labeled inputs (JOB TITLE, LOCATION) + Find Jobs button + conditional success banner. No props — placeholder for Feature 10.
- **`components/find-jobs/JobFilters.tsx`** — `"use client"` presentational component; filter text input + All/High/Low match dropdown + Match Score/Newest/Oldest sort dropdown. Receives all values and handlers as props; owns no state. Exports `MatchFilter` and `Sort` types.
- **`components/find-jobs/JobsTable.tsx`** — `"use client"` presentational component; accepts `jobs: Job[]` (the already-filtered page slice) and renders table rows only. No state, no filtering logic. Contains module-level `MatchScoreBar` sub-component. Imports `getMatchBarColor` and `formatRelativeDate` from `lib/utils.ts`.
- **`components/find-jobs/JobsPagination.tsx`** — `"use client"` presentational component; renders "Showing X to Y of Z", page number buttons, and Previous/Next. Accepts `page`, `totalPages`, `totalCount`, `startIdx`, `pageNumbers`, and `onPageChange` as props; owns no state.
- **`components/find-jobs/FindJobsClient.tsx`** — `"use client"` container component; accepts `jobs: Job[]` from the Server Component; owns `filterText`, `matchFilter`, `sort`, and `page` state; computes the `filtered` `useMemo` pipeline and pagination math; passes typed props to `JobFilters`, `JobsTable`, and `JobsPagination`.
- **`app/find-jobs/page.tsx`** — replaced placeholder; async Server Component; auth guard (`redirect("/login")` if no session); defines `MOCK_JOBS: Job[]` (6 entries, `found_at` computed relative to `Date.now()`); renders `<Navbar />`, `<SearchControls />`, `<FindJobsClient jobs={MOCK_JOBS} />`.
- **`context/ui-registry.md`** — added `SearchControls`, `FindJobsClient`, `JobFilters`, `JobsTable`, and `JobsPagination` entries.
- **`context/progress-tracker.md`** — Feature 09 marked complete; current phase updated to Feature 10.

## Schema changes

None. Feature 09 is UI-only with mock data. No DB reads or writes.

## Key invariants

- **`MATCH_THRESHOLD`, `getMatchBarColor`, and `formatRelativeDate` live in `lib/utils.ts` only.** All three are pure functions — they take a value and return a value, with no React dependency. Import them from `lib/utils.ts`; never redefine them in component files.
- **`FindJobsClient` owns all state and derived data; `JobFilters`, `JobsTable`, and `JobsPagination` own none.** The three leaf components are purely presentational: props in, JSX out, no `useState`, no `useMemo`. Feature 11 will modify `FindJobsClient` only when filtering moves to DB queries — the leaves stay frozen.
- **`MOCK_JOBS` is defined inside the Server Component function, not at module level.** `found_at` is computed with `Date.now()` so timestamps stay relative to the actual request time. Moving it to module level would freeze timestamps at server startup.
- **`MatchScoreBar` is defined at module scope in `JobsTable.tsx`, not inside the component function.** React uses reference equality to identify component types; defining a component inside a render function creates a new reference on every render, causing unnecessary remount.
- **Match score bar fill uses inline `style={{ backgroundColor: getMatchBarColor(score) }}`, not a Tailwind class.** The fill color is dynamic (computed from `score` at runtime). Tailwind's static scanner cannot generate classes for runtime-computed values.
- **`SearchControls` has no props intentionally.** It is a placeholder shell — Feature 10 wires the real API call inside the component via `router.refresh()`, not via props from the page.
- **Every filter/sort/page change in `FindJobsClient` calls `setPage(1)`.** Changing the dataset without resetting the page can produce a stale page that no longer exists in the filtered result.
- **`safePage = Math.min(page, totalPages)` must be used for all pagination math.** `page` state can lag behind `totalPages` when filters reduce the dataset; `safePage` clamps the display page to the valid range.
