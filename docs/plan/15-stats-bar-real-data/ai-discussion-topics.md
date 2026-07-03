# AI Discussion Topics — Feature 15: Stats Bar Real Data

---

## Group 1 — Mock-to-real transitions

1. Feature 15 is described as a "trust boundary." What does that mean, and why does it affect what we do with the trend badges even though they are technically separate from the stat values?

2. The build plan says "full page UI built with mock data first — verified visually before any logic is written." What are the benefits of this pattern? What risks does it introduce that Feature 15 had to address?

3. After Feature 15, the dashboard still has mock data in three places: `mockActivity`, `mockCompanyResearchData`, and `mockJobsFoundData`. Why is that acceptable given the trust boundary argument? What is different about those vs the stat values?

---

## Group 2 — The trend badge decision

4. Walk me through why Option B (neutral badge saying "Live data") is worse than Option A (remove the badge entirely), even though Option B is less destructive.

5. What would real trend data for "Total Jobs Found" require? What queries would you need, what edge cases would you need to handle, and what UI decisions would arise that don't exist today?

6. The `trend` field was removed from `StatCardConfig` entirely rather than just not passing it. Why does that matter? What would happen differently if the field had been kept optional?

---

## Group 3 — Null values and the Avg. Match Rate

7. A job can have `match_score: null`. Walk me through when that happens in the current app and why it is not the same as a score of zero.

8. The `?? 0` inside the `reduce` call is technically unreachable. Why does it exist? What would TypeScript say if you removed it, and why?

9. We chose to compute the average in JavaScript rather than using a SQL `AVG()` function. What would the SQL version look like? What was the reason for avoiding it here?

10. "Jobs This Week" uses a rolling 7 × 24h window rather than a calendar week. Under what conditions would those two approaches give different answers? Which approach would show a higher count on a Monday?

---

## Group 4 — Promise.all and concurrent queries

11. What is the difference between running four queries with `await` in sequence vs. `Promise.all`? What does "concurrent" mean at the HTTP level?

12. The InsForge SDK returns `{ data, error }` instead of throwing. Why does that design choice matter specifically when using `Promise.all`?

13. The three count queries use `{ count: 'exact', head: true }`. What does `head: true` do at the HTTP level? Why is `result.data` null when you use it?

14. Stat query errors are logged with `console.error` but do not throw or redirect. What is the user experience when a stat query fails? Is that the right tradeoff? What would be wrong with throwing instead?

---

## Group 5 — Architecture and data ownership

15. All four queries live in `page.tsx`, not in `StatsBar`. What rule does this follow, and what would break if `StatsBar` fetched its own data?

16. `page.tsx` already had an auth check and a profile query before Feature 15 added the stats queries. Walk through the full sequence of async operations on the dashboard page now — what runs in what order, and what runs concurrently?

17. Feature 17 will replace the mock chart arrays in `page.tsx` with real PostHog data. Based on the pattern established in Feature 15, what should that look like? What should NOT change in the chart components themselves?
