# AI Discussion Topics — Feature 15: Stats Bar Real Data

Use these questions with an AI to go deeper on the concepts from this architect session. Each group covers one concept. Start with the question that interests you most — they are independent.

---

## Group 1 — Trust boundaries and UI integrity

1. What is a "trust boundary" in a UI, and why does mixing real and fake data on the same screen create a problem even if the fake data is clearly labeled?

2. We had three options for the trend badges: remove them, neutralize them with "Live data" text, or implement real trends. Why was "Live data" considered worse than removing the badge entirely?

3. If we had kept the trend badges with neutral text, what specific user behavior might result from the confusion? Can you give a realistic example?

4. At what point does it make sense to invest in real trend data? What questions would you need to answer before scoping that feature?

5. The subtitle "Scored jobs only" on the Avg. Match Rate card is a form of transparency — it tells the user what the number means. Can you think of other cases in the app where a subtitle or label should explain the data source or scope rather than just describe the value?

---

## Group 2 — Null values and what they mean

6. Why does SQL's `AVG()` function exclude `NULL` values by default? What assumption does that default encode about what `NULL` means?

7. In this codebase, `match_score` is `number | null`. When would a job have a null score? Why is that condition not the same as a score of zero?

8. We chose to show `"—"` for Avg. Match Rate when there are no scored jobs. What are other cases in this app (or any app) where a UI element should show a dash rather than zero? What is the test for which to use?

9. The `?? 0` fallback inside the `reduce` call (`r.match_score ?? 0`) is technically unreachable because we filtered out null scores at the query level. Why was it kept? What does this teach about the relationship between TypeScript types and runtime behavior?

10. If we had used a SQL `AVG()` function via a stored procedure instead of computing the average in JS, would the null-exclusion behavior change? How would you verify that?

---

## Group 3 — Concurrency with Promise.all

11. What does `Promise.all` actually do that `await` in sequence does not? Can you explain the difference in terms of network requests and timing?

12. `Promise.all` rejects if any promise throws. The InsForge SDK returns `{ data, error }` instead of throwing. Why does that design choice matter for how we used `Promise.all` here?

13. If one of the four stat queries fails, what does the user see? How does the error handling after `Promise.all` ensure partial failures produce a degraded-but-functional dashboard rather than a broken page?

14. The four queries were all independent — none depended on the result of another. What would you have to change if one query did depend on another? Would `Promise.all` still be appropriate?

15. Could you use `Promise.allSettled` instead of `Promise.all` here? What would be the difference in behavior, and would it actually change anything given that the SDK never throws?

---

## Group 4 — Data fetching patterns in Next.js Server Components

16. Why does all data fetching for Feature 15 live in `page.tsx` and not inside `StatsBar`? What rule does this follow, and what would break if `StatsBar` fetched its own data?

17. What is the difference between a Server Component and a Client Component in terms of what they can access? Why can `page.tsx` call `createInsforgeServer()` but `StatsBar` cannot?

18. The page does not have `export const dynamic = 'force-dynamic'`. How does Next.js know to treat it as a dynamic page rather than statically rendering it at build time?

19. `sevenDaysAgo` is computed with `Date.now()`. On a statically-rendered page, what would that timestamp be? Why would that produce incorrect "Jobs This Week" data?

20. The pattern in this page is: fetch data in the Server Component, pass it as props to presentational components. What are the tradeoffs of this pattern compared to having each section fetch its own data?

---

## Group 5 — Query design and SDK usage

21. `{ count: 'exact', head: true }` is passed to two of the four queries. What does `head: true` mean at the HTTP level? Why does it avoid returning the actual row data?

22. `.not("match_score", "is", null)` is a PostgREST filter that translates to `WHERE match_score IS NOT NULL`. Why write it this way instead of `.neq("match_score", null)`? Are they equivalent?

23. We chose four SDK queries over one raw SQL aggregation. What would the raw SQL have looked like? What does the `FILTER (WHERE ...)` clause in SQL do, and why is it useful for aggregations?

24. If the app grows to a user with 100,000 saved jobs, which of the four queries would become a performance problem first? What would you do about it?

25. The `scoredJobsResult` query fetches all `match_score` values into memory to compute the average in JS. At what scale would this approach become a problem, and what would you switch to?
