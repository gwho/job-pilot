# AI Discussion Topics — Feature 17: Analytics Charts Real Data

## Group 1 — PostHog vs DB as Data Source

1. `posthog-node` is described as "capture-only." What does that mean in practice — what HTTP endpoint and verb does it call, and what would need to change for it to also read event history?

2. The build plan said "query PostHog" and this feature ended up using the DB instead. What's the test for whether the DB or an analytics tool is the right source for a given chart? Apply it to: (a) a chart showing jobs-saved-per-day, (b) a chart showing the percentage of users who researched a company after saving a job.

3. If a future engineer wanted to add a PostHog-backed chart — say, a chart comparing this user's search frequency to the platform average — what would they need to add? Walk through every new piece: env vars, auth, SDK methods, where in the codebase the query would live.

---

## Group 2 — Issue #19 and Event Accuracy

4. Before the fix, a search that saved 20 jobs with 4 strong matches would produce 4 `job_found` events in PostHog and 20 rows in the DB. Now it produces 20 events. What is the observable difference from the user's perspective? What breaks in analytics if the old behaviour had continued?

5. The fix changed `captureServerEvent` from being called inside an `if` block to being called unconditionally in the same loop. `strongMatches` is still tracked. Walk through the exact before and after code and explain what each version computes and fires.

6. `captureServerEvent` is awaited sequentially in a loop over all inserted jobs. If a search saves 10 jobs, what is the performance cost of this approach versus batching all 10 events into a single PostHog client? Why was the sequential approach kept?

---

## Group 3 — Rolling Windows and Bucket Logic

7. Explain the difference between "rolling 7-day window ending today" and "current calendar week starting Monday." Draw the bucket labels for each on a Wednesday. Which one shows future days as empty bars, and why is that a problem?

8. `buildJobsFoundByDay` uses `d.toDateString()` to match a job's `found_at` against a bucket. What does `toDateString()` return? What timezone does it use, and could a timezone mismatch cause a job saved at 11 PM to appear in the wrong day's bucket?

9. The cutoff in `buildResearchByDay` is computed as midnight of the oldest bucket (`setHours(0,0,0,0)`), not as `Date.now() - 7 * 24h`. Construct a specific scenario where the `Date.now() - 168h` approach would silently exclude a valid event from the chart, even though the event occurred on the oldest displayed day.

10. `buildResearchByDay` uses `.find()` to locate the matching bucket for each job. For a user with 200 researched jobs and 7 buckets, what is the worst-case number of comparisons? At what scale would you refactor this to a `Map<string, Bucket>` keyed by `dateStr`, and what would that look like?

---

## Group 4 — Separate Queries and the found_at / researchedAt Invariant

11. `chartResearchJobsResult` has no `.limit()` while `researchJobsResult` has `.limit(20)`. Construct a specific scenario — using concrete dates — where reusing the limited query would cause the Company Research chart to silently undercount a research event.

12. The `chartResearchJobsResult` query fetches only the `company_research` column. Why not also select `id` and `company`? When does column selection matter for performance, and at what approximate row count would it start making a measurable difference?

13. `buildResearchByDay` fetches all researched jobs with no date filter, then filters by `researchedAt` in JS. An alternative would be to add a DB-level filter. Why can't InsForge filter on a JSONB subfield? What would you do if the user had 50,000 researched jobs?

---

## Group 5 — Type Predicates and JSONB Safety

14. What is a TypeScript type predicate and how does it differ from a type assertion at runtime? Rewrite the `hasResearchedAt` function using a type assertion (`as`) and describe what runtime safety is lost.

15. `hasResearchedAt` contains `typeof (v as Record<string, unknown>).researchedAt === 'string'`. This uses `as` internally. The user said this is still "technically an assertion" but acceptable. Why is this considered safe when a direct `as { researchedAt?: string }` is not? What specific runtime check makes the difference?

16. If a DB migration renamed `researchedAt` to `researched_at` in the JSONB, what would happen in the current code at runtime? What error would the user see, and where in the call stack would the failure occur?
