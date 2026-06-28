# Feature 11 — Discussion Topics

15 questions across 5 topic areas.

---

## URL State

1. Why does `useSearchParams()` cause a re-render when the URL changes via the browser back button — but not when React state changes? What is the underlying mechanism?

2. The filter, sort, and page are in the URL, but `jobTitle` and `location` are in `useState`. What is the principle that determined which goes where?

3. If two tabs are open to the same Find Jobs page and one tab runs a search, what happens to the other tab's URL state?

---

## Debounce and Effect Pattern

4. Describe the exact sequence of events when a user types "react" into the text filter. Which state updates happen immediately, and which are delayed?

5. The sync `useEffect` calls `setFilterTextDraft(q)` — directly setting state inside an effect. Why was this flagged by ESLint, and why is it correct here despite the warning?

6. If the debounce delay were 0ms instead of 300ms, the guard `filterTextDraft === q` would still prevent loops on back-navigation. But what UX problem would 0ms cause that 300ms avoids?

---

## `router.replace()` vs `router.push()`

7. A user applies five filter combinations on Find Jobs, then clicks a job row, reads it, and presses back. How many times must they press back to leave Find Jobs entirely — with `replace` vs `push` for filter changes?

8. A "clear all filters" button calls `replaceViewState({ q: "", match: "all", sort: "score", page: 1 })`. Should it use `replace` or `push`? Why?

9. Feature 12 uses `router.push()` for row navigation. Feature 11 uses `router.replace()` for all filter changes. What is the distinguishing question to ask when deciding which to use?

---

## Functional setState and Merge

10. The functional `setJobs(current => ...)` form was chosen over `setJobs(merged)`. Write out the exact failure scenario where the closure form produces incorrect results. What job data is lost, and under what timing conditions?

11. After `handleSearch` completes, `replaceViewState({ page: 1 })` is called while preserving `q`, `match`, and `sort`. Why reset only `page`? What would break if `match` were also reset?

---

## Null Semantics

12. `job.match_score ?? 0` puts unscored jobs in Low Match. `job.match_score != null` excludes them from High and Low. What specifically does a user lose with the `?? 0` approach?

13. `!= null` catches both `null` and `undefined`. In what specific scenario in this codebase could `match_score` be `undefined` at runtime even though the TypeScript type says `number | null`?

---

## Pagination

14. The windowed page algorithm uses a `Set` of `{1, totalPages, safePage, safePage-1, safePage+1}`. If the user is on page 1, which pages end up in the set, and what does the rendered list look like?

15. `safePage = Math.min(page, totalPages)` clamps the page when filters reduce the total. A user is on page 5 of "All Matches," then switches to "High Match" which has only 2 pages. What is `safePage`, and what does the user see?
