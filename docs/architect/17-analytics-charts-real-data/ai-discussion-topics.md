# AI Discussion Topics — Feature 17: Analytics Charts Real Data

## Group 1 — PostHog SDK Boundaries

1. `posthog-node` is described as "capture-only." What does that mean architecturally? What is the HTTP verb and endpoint it calls under the hood, and why can't the same SDK be used to read event history?

2. Why does PostHog have two different authentication identifiers — the project API key (`phc_xxx`) and the numeric project ID? What does each one authorize, and why can't you use the project API key to query event history directly?

3. If you wanted to use PostHog as the chart data source in a future version of this project, what would you need to add? Walk through the minimum viable integration: what env vars, what new functions, and where they would live.

4. PostHog's `posthog-node` requires `flushAt: 1` and `await posthog.shutdown()` on every server-side usage. Why? What happens to events if you forget `shutdown()` in a Next.js Server Component or Route Handler?

5. The architecture doc says PostHog is correct for "cross-user behavioral analysis" but the DB is correct for "per-user personal dashboards." Where exactly is that line? Give two examples of analytics questions where PostHog would be the right source and two where the DB would be better.

---

## Group 2 — Issue #19 and Event Design

6. The original code had "One job_found event per strong match" as a comment. Who gets harmed if `job_found` only fires for strong matches? Think about a future PostHog funnel analysis, a product manager checking "how many jobs do users save per search," and a chart that tries to show total jobs found over time.

7. `captureServerEvent` is awaited sequentially inside a loop in `route.ts`. For a 10-job search, this fires 10 separate PostHog events, each creating a new PostHog client, sending one event, and calling `shutdown()`. What are the performance implications? How would you batch this into a single PostHog client instance?

8. The PostHog event `job_found` fires from a server Route Handler. Could it also fire from the client side (browser)? What are the trade-offs of server-side vs. client-side event firing for this specific event?

9. `code-standards.md` says there are exactly six PostHog events in this project and "do not add more without updating this list first." Why is that rule important? What breaks down if different features independently add new event names without a centralized registry?

---

## Group 3 — Rolling Windows and Time Bucketing

10. Explain the difference between a "rolling 7-day window" and a "current calendar week." Draw out what each looks like on a Tuesday and again on a Saturday, showing which days would have real data vs. future zeros.

11. `buildJobsFoundByDay` uses `d.toDateString()` to match a job's `found_at` against a bucket. What does `toDateString()` return, and what timezone does it use? If the server runs in UTC and the user is in UTC+8, could a job found at 11 PM UTC appear in the "wrong day" bucket from the user's perspective?

12. The research chart cutoff uses `oldestDay.setHours(0, 0, 0, 0)` to anchor to midnight of the oldest bucket. Why does this matter? Walk through the specific scenario where `Date.now() - 168h` would exclude a valid event from the oldest displayed day.

13. `buildJobsFoundByDay` loops through buckets using `.find()` for each job. For 100 jobs and 7 buckets, that's up to 700 comparisons. Is this a performance concern? At what scale would you refactor to a `Map<string, Bucket>` keyed by `dateStr`?

---

## Group 4 — Separate Queries and the `found_at` vs `researchedAt` Invariant

14. Feature 16 established that `found_at` ≠ `researchedAt`. Why is this invariant so consequential for the research chart, but not for the activity feed? What does each feature actually need from the timestamp, and how do those needs differ?

15. The `chartResearchJobsResult` query has no `.limit()`. The `researchJobsResult` query is `.limit(20)`. What is the worst-case row count for `chartResearchJobsResult` for a power user? At what point would an unbounded query become a performance problem, and what would you do about it?

16. Why does `chartResearchJobsResult` only select `company_research` and not `id`, `company`, or `found_at`? What does this save, and when does column selection matter most?

17. If InsForge added a `groupBy()` method to its query builder tomorrow, how would you rewrite the jobs-found-by-day query to eliminate JS aggregation entirely? Write the hypothetical query. What would the result shape look like?

---

## Group 5 — Type Predicates and JSONB Safety

18. What is a TypeScript type predicate (`v is SomeType`)? How does it differ from a type assertion (`v as SomeType`) in terms of runtime behavior and compile-time guarantees?

19. `hasResearchedAt` contains one `as Record<string, unknown>` internally. The user said this is still technically an assertion. Why is this considered acceptable when `code-standards.md` discourages assertions? What makes a "structural cast after a null/object check" different from a blind assertion?

20. If the `company_research` JSONB schema changed in a future DB migration and `researchedAt` was renamed to `researched_at`, what would happen in the current code? Would TypeScript catch it? Would the app crash? Would it silently produce wrong data?

21. The pre-existing activity feed code in `page.tsx` still uses `as { researchedAt?: string }`. This was not changed in Feature 17. Why not? What principle governs when to change pre-existing code vs. leaving it alone?

---

## Group 6 — Server Components and Data Assembly

22. The aggregation functions use `new Date()` to generate bucket boundaries. `page.tsx` is a Server Component. What are the implications of using `new Date()` on the server? Is the result deterministic across requests, and does timezone matter here?

23. Why are `buildJobsFoundByDay`, `buildResearchByDay`, and `buildMatchScoreDistribution` defined at module level rather than inside the `DashboardPage` function? What happens in React if a function component internally defines other functions on every render?

24. The dashboard `Promise.all` now has 8 parallel queries. If query #7 (`recentJobsResult`) fails, what happens? Does the entire `Promise.all` reject? How does the degradation contract ensure the page still renders?

25. The chart components are `"use client"` and the Server Component passes computed arrays as props. Could you instead pass the raw DB rows to the chart components and aggregate inside them? Why would that violate the architecture, and what specific invariant in `architecture.md` does it break?
