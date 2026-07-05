# AI Discussion Topics — Feature 16: Recent Activity Real Data

## Group 1 — Timestamps and what they actually represent

1. Why is `found_at` the wrong timestamp to use for research events, even though it is the most easily accessible column on the `jobs` table?

2. `researchedAt` is stored inside a JSONB column rather than as a top-level table column. What are the general tradeoffs between storing a timestamp inside JSONB versus as a dedicated column, and when should you prefer one over the other?

3. The `company_research` JSONB is fetched and its subfield extracted in JavaScript rather than sorted at the database level. What would you need to change to sort by `researchedAt` directly in the database query, and what is the cost of making that change?

4. If a user finds a job on Monday and researches it on Thursday, what would each of the three timestamp options (`found_at`, `researchedAt` from JSONB, `company_researched_at` column) display in the activity feed, and which is correct?

5. The session decided to defer adding a `company_researched_at` column. Under what future conditions would that column become necessary rather than optional?

---

## Group 2 — Filtering and candidate pools

6. Why does the session filter `agent_runs` to `status = "completed"` rather than `status != "running"`? What difference does this make for `"failed"` rows?

7. The query fetches 20 candidates per source before JS-sorting, rather than 10 (the final display count). Why is 10 not enough? Under what specific conditions would fetching only 10 produce an incorrect feed?

8. `company_research IS NOT NULL` is used to identify research events. The session verified this is sufficient by reading `agent/research.ts`. What would make this filter insufficient — i.e., what code change in the research agent would break this assumption?

9. The 20-candidate limit creates a scenario where a recently-researched but older-found job might be excluded from the feed. How would you explain this tradeoff to a non-technical stakeholder who noticed their research event was missing?

---

## Group 3 — Merging and sorting two sources

10. The final 10 items come from a merged, sorted list with no per-source quota. What user behavior would result in 10 consecutive search items with zero research items in the feed, and is that correct or a bug?

11. The `ActivityCandidate` intermediate type adds `sortTs: number` to `ActivityItem`. Why is this field stripped before passing `activityItems` to `<RecentActivity>`? What problem would arise if `sortTs` leaked into the component's props?

12. The `.flatMap()` pattern is used to normalize research rows instead of `.filter().map()`. What specific TypeScript problem does `.flatMap()` with `return []` / `return [item]` solve that `.filter().map()` does not?

13. The merge sorts by `sortTs` descending, then slices to 10. What would happen if you sliced first and sorted second? Why does order matter here?

---

## Group 4 — Stable keys and the React rendering contract

14. `key={index}` works correctly for static server-rendered lists that never re-render. Why does this project still prefer `key={item.id}` for the activity feed rows?

15. The source-qualified ID format is `search-${run.id}` and `research-${job.id}`. Both `agent_runs.id` and `jobs.id` are UUIDs. Given that UUID collision across two tables is practically impossible, why is the source prefix still useful?

16. If the `RecentActivity` component gained a "Dismiss" button that removed items client-side, how would `key={item.id}` versus `key={index}` affect React's behavior when an item is dismissed from the middle of the list?

---

## Group 5 — Resilience and error handling

17. Feature 16 degrades gracefully: a query failure produces `[]`, not a page crash. What is the user experience difference between "activity query failed → empty state shown" versus "activity query failed → page crashes"? Which is preferable and why?

18. The error log prefix `[dashboard/activity]` follows `[dashboard/stats]` from Feature 15. Why does consistent prefix formatting matter in production server logs? How would you use these prefixes to diagnose a dashboard data problem?

19. If both activity queries fail simultaneously, `RecentActivity` shows the empty state rather than an error message. Is this the right choice? Under what conditions might you want to distinguish "no data exists" from "query failed" in the UI?

20. The queries are added to the existing `Promise.all` alongside the four stats queries, making six parallel DB calls on every page load. What is the cost of parallel versus sequential queries? At what scale would you consider splitting them?

---

## Group 6 — Component and rendering architecture

21. `RecentActivity` is a Server Component that now imports `Link` from `next/link`. Why does `Link` work in a Server Component when most "interactive" elements require `"use client"`?

22. The empty state is added inside `RecentActivity` rather than handled in `page.tsx` (e.g., conditional render of the component itself). What is the architectural reason to keep empty states inside the component rather than outside?

23. The normalization of raw DB rows into `ActivityItem[]` happens in `page.tsx`, not in `RecentActivity`. What architectural principle does this follow, and what would break if normalization moved into the component?

24. Feature 16 keeps `RecentActivity` as a purely presentational component receiving typed props. How does this compare to the `CompanyResearch` component in `components/job-details/`, which manages its own state and makes its own API call? When is each pattern appropriate?

25. The `type ActivityCandidate = ActivityItem & { sortTs: number }` is declared inside `DashboardPage` (the function body), not at the module level. Is this a good practice or a code smell? When should local types be module-level versus function-level?
