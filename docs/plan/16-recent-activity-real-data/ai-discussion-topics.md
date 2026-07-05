# AI Discussion Topics — Feature 16: Recent Activity Real Data

## Group 1 — Timestamps and data accuracy

1. `found_at` and `researchedAt` both exist for any researched job. Walk me through exactly what each timestamp records, and explain why using `found_at` as the research event timestamp would produce wrong data in the feed.

2. `researchedAt` is stored inside the `company_research` JSONB column rather than as a top-level column. What are the practical consequences of this storage choice when it comes to querying, sorting, and displaying research events?

3. The implementation extracts `researchedAt` in JavaScript rather than casting it in a SQL expression. What would the raw SQL alternative look like, and why was it ruled out for this feature?

4. The query fetches 20 candidates sorted by `found_at`, then re-sorts in JavaScript by `researchedAt`. Describe exactly the scenario in which this produces an incorrect feed — which user behaviour would trigger it, and how likely is it?

5. If `researchedAt` were added as a top-level column `company_researched_at` on the `jobs` table, what would change in the query, and what would stay the same in the normalization code?

---

## Group 2 — Filter correctness and the JSONB safety proof

6. The filter `company_research IS NOT NULL` is used to identify research events. Walk me through the two failure paths in `agent/research.ts` and explain why neither of them can result in a non-null but invalid `company_research` row.

7. If a future developer changed `agent/research.ts` to catch the Nemotron throw and save a partial dossier instead of propagating the error, what would break in Feature 16, and how would you detect it?

8. `company_research IS NOT NULL` could theoretically match a row where the JSONB is an empty object `{}`. Explain why this cannot happen given the current code, and describe the one code change that would make it possible.

9. The `agent_runs` query filters to `status = "completed"`. What values does `jobs_found` and `completed_at` have for `"running"` and `"failed"` rows, and what visual bug would appear if those rows were included?

---

## Group 3 — Normalization and the intermediate type

10. `ActivityCandidate` is declared inside the `DashboardPage` function body, not at the module level. What does this mean for where the type is usable, and why is this the right scope for it?

11. After sorting and slicing, `sortTs` is stripped via `.map(({ id, type, label, timeAgo }) => ({ id, type, label, timeAgo }))`. What would happen if `sortTs` were not stripped and `ActivityItem` did not declare an `id` field — would TypeScript catch the error?

12. The research normalization uses `.flatMap()` with `return []` and `return [item]`. Rewrite the same logic using `.filter().map()` and describe the TypeScript problem you encounter that `.flatMap()` avoids.

13. The `type: "research" as const` cast is required inside the `.flatMap()` callback. Why does TypeScript need `as const` here even though the string `"research"` is only ever assigned to a field typed as `"search" | "research"`?

---

## Group 4 — Component architecture and rendering

14. `RecentActivity` remains a Server Component even though it now imports `Link` from `next/link`. Explain why `Link` does not require `"use client"`, and describe the specific feature that would require adding `"use client"` to this component in the future.

15. The empty state is handled inside `RecentActivity` rather than in `page.tsx`. If the empty state were handled in `page.tsx` instead, what would that code look like, and what would be wrong with the resulting architecture?

16. `key={item.id}` replaces `key={index}` in the activity list render. For a server-rendered list that never mutates on the client, `key={index}` causes no actual bug. Why does this project still prefer stable source-qualified IDs?

17. The `Promise.all` now runs six queries in parallel. What would happen to page load time if the six queries ran sequentially instead? Under what conditions would six parallel queries perform worse than sequential ones?
