# Review — Feature 09: Find Jobs Page Full UI

## Scope

Feature 09 replaced the placeholder at `/find-jobs` with a full two-card layout using
mock data. The review compared the actual implementation against an alternative design
shown in a screenshot (a parallel AI session that proposed a 5-component decomposition).

**Files in scope:**
- `lib/utils.ts`
- `components/find-jobs/SearchControls.tsx`
- `components/find-jobs/JobsTable.tsx`
- `app/find-jobs/page.tsx`

---

## Layer 1 — Plan alignment

**PASS (with note)**

The implementation matched the plan exactly. The plan specified `JobsTable` as a single
component owning filter/sort/pagination state via `useMemo`, and that is what was built.
No `FindJobsClient`, `JobFilters`, or `JobsPagination` components were in the plan —
their absence is a plan gap, not an implementation gap.

**Missing from both plan and implementation (vs. screenshot design):**
- `getMatchBarColor` and `formatRelativeDate` in `lib/utils.ts` — both are locked inside
  `JobsTable.tsx` as private module-level functions
- `formatSalary` utility — screen shows it in utils; actual uses raw strings in mock data
- Source badge column in the jobs table

---

## Layer 2 — System integrity

**ISSUES FOUND**

### Issue 1 — Pure utilities locked inside a component file [Important]

`getMatchBarColor(score)` and `formatRelativeDate(dateStr)` are stateless pure functions
with no React dependency. They live as module-level helpers inside `JobsTable.tsx`. Per
project architecture, `lib/` owns shared utilities — component files should not own
reusable pure functions.

**Status:** Deferred for immediate fix (Option A) before Feature 10.

### Issue 2 — `JobsTable.tsx` owns four distinct concerns [Important]

The component is responsible for:
1. State management (`filterText`, `matchFilter`, `sort`, `page`)
2. Derived data pipeline (`useMemo` filter → sort → paginate)
3. Filter bar UI (text input + two selects)
4. Table rows rendering
5. Pagination UI

The screenshot design correctly separates these:
- `FindJobsClient.tsx` — state + derived data, no JSX
- `JobFilters.tsx` — filter bar UI only (props in, JSX out)
- `JobsTable.tsx` — table rows only (receives already-filtered `jobs: Job[]`)
- `JobsPagination.tsx` — pagination UI only

**Status:** Deferred for immediate fix (Option A) before Feature 10.

### Issue 3 — `inputCls` and `selectCls` duplicated across components [Minor]

`inputCls` is defined identically in both `SearchControls.tsx` and `JobsTable.tsx`.

**Status:** Not fixed — noted for extraction to `lib/styles.ts` in a future cleanup pass.

---

## Layer 3 — Production readiness

**PASS (with minor note)**

Empty states, pagination edge cases (`safePage` clamp), and auth guards are all handled
correctly. No console errors in the verified build.

Source badge column (mentioned in screenshot) was not in the design image and is absent
from the implementation. Not treated as a bug.

---

## Summary

2 important issues found. Both are architectural (component decomposition and utility
placement), not functional bugs. The implementation works correctly today but will require
restructuring in Feature 11 when filtering moves to DB queries.

**Decision:** Remediate before Feature 10 (Option A). The 5-component structure from the
screenshot will be implemented as a refactor pass before wiring the Adzuna API.

---

## Root cause finding

All issues trace to a single upstream gap: the Feature 09 plan was written top-down from
the design image without first resolving the structural question of component ownership.
The plan specified what state to use and what CSS classes to apply — but never asked
"who should own this state, and what are each component's exact responsibilities?"

**Resolution:** Run `/architect` before writing the plan for any feature involving more
than one connected client component. Document this as a process improvement.
