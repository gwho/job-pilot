# AI Discussion Topics — Feature 09-find-jobs-ui: Find Jobs Page Full UI

## Group 1: Component architecture and data flow

1. `SearchControls` and `JobsTable` are siblings on the page — neither wraps the other. Explain how, in Feature 10, clicking "Find Jobs" in `SearchControls` will cause the jobs list in `JobsTable` to refresh, given that the two components share no state and no parent client component.

2. `MOCK_JOBS` is typed as `Job[]` even though many of its fields are hardcoded as `null`. Why does this matter for Feature 11? What would break if the mock data were typed as `Partial<Job>[]` instead?

3. Walk me through exactly what the browser and server each do when a logged-out user navigates to `/find-jobs` — starting from the HTTP request, through `proxy.ts`, through Next.js routing, to the final response the browser receives.

4. Why is `MOCK_JOBS` defined inside `FindJobsPage()` rather than at module scope? What would the date display look like after 48 hours if it were at module scope?

## Group 2: Match score bar — the inline style decision

5. The `MatchScoreBar` fill uses `style={{ backgroundColor: getMatchBarColor(score) }}` rather than a Tailwind class. Walk me through what would happen if we tried to use a computed Tailwind class string like `` `bg-${colorName}` `` instead — at build time, at runtime, and in production.

6. `getMatchBarColor` returns strings like `"var(--color-success)"` rather than raw hex values like `"#10b981"`. What is the practical difference between these two approaches when a designer decides to change the success color token?

7. The design image shows green for 90+, blue for 80–89, and orange for 70–79. `ui-tokens.md` says 70–89 should both be green. Explain the decision made here, why it was made, and what a developer should do if in a future session they are told to "match ui-tokens.md exactly."

## Group 3: State management and filtering

8. Every filter change in `JobsTable` calls `setPage(1)` in the same handler that updates the filter. Why is this explicit reset necessary rather than relying on `safePage` alone to clamp the page? Under what conditions would skipping the explicit reset still produce correct UI — and under what conditions would it fail?

9. The `filtered` array is computed inside a `useMemo` that depends on `[jobs, matchFilter, filterText, sort]`. What happens if `jobs` changes reference identity on every render (e.g., the parent creates a new array literal each time it renders)? Is that a risk with the current page structure? Why or why not?

10. "Low Match" shows jobs where `match_score < MATCH_THRESHOLD` (70). In the current mock data, every job has a score of 72 or above, so "Low Match" shows zero results. Describe exactly what the user sees when they select "Low Match" — trace through `filtered`, `pageItems`, the table render branch, and the pagination row.

## Group 4: Pagination math

11. A user is on page 3 of a 5-page dataset, then types a filter that reduces the dataset to 8 items. Walk through `safePage`, `startIdx`, and `pageItems` for that first render after the filter applies, assuming `page` state is still `3` and `PAGE_SIZE` is `6`.

12. The `pageNumbers` `useMemo` returns `[1, 2, 3, "...", totalPages]` for any dataset larger than 5 pages. What happens to this array if the user is currently on page 4 of a 10-page dataset? Is page 4 highlighted as active? Is there any way the current implementation loses track of which page button should appear active?

## Group 5: Wiring to real data (Feature 10 and 11)

13. In Feature 11, filtering will move from client-side `useMemo` to server-side DB queries. What will need to change in `JobsTable`? Think specifically about: where `filterText`, `matchFilter`, and `sort` state currently live, how they currently drive the displayed data, and what they would need to drive instead.

14. Feature 10 will wire the "Find Jobs" button in `SearchControls` to `POST /api/agent/find`. After the API responds, the UI needs to show the newly discovered jobs. `SearchControls` has no reference to `JobsTable` and no shared state with the page. What is the one-line Next.js call inside `SearchControls` that triggers the page to re-fetch its server data and re-render `JobsTable` with the new jobs from the DB?
