# Feature 11 — AI Discussion Topics

27 questions across 6 topic groups. Each question asks WHY or HOW, probes edges, and targets durable understanding rather than Feature 11 specifics.

---

## Group 1 — URL State vs Client State

1. Why does the `router.replace()` vs `router.push()` distinction matter so much for filter UIs? What breaks if you use `push` for every filter change?

2. The text search input uses two separate pieces of state: local `useState` for the visible value and a debounced URL param for the actual filter. Why can't both be the same state?

3. In this feature, "view state" means `q`, `match`, `sort`, and `page`, while "display state" means the text input draft. Why is this distinction useful when reading or changing the code?

4. Why should the text input draft and debounce live in the container component rather than inside a presentational `JobFilters` component? When would the opposite choice be better?

5. Why does `useSearchParams()` in Next.js App Router require a `<Suspense>` boundary? What problem is the framework preventing?

6. When is client `useState` the right choice for filter/sort/page, and when is URL state the right choice? What is the decision factor?

7. The recommendation for client state was initially reasonable and then reversed. What additional context changed the answer? What does this reveal about the order in which decisions should be made?

8. Why do agent inputs (`jobTitle`, `location`) stay in `useState` even though view state moves to the URL? What would go wrong if they were also encoded in the URL?

---

## Group 2 — History Stack and Navigation

9. What is the browser's history stack, and how do `router.push()` and `router.replace()` interact with it differently?

10. A user on page 3 of "High Match" results clicks a job, reads it, and presses back. Walk through exactly what happens with: (a) client `useState`, (b) URL params with `router.push()`, (c) URL params with `router.replace()`. Which is correct and why?

11. Why is "refinement of the current view" the right frame for deciding between `replace` and `push`? What makes a filter change a refinement vs a navigation?

12. If we later add a "clear all filters" button that resets `q`, `match`, `sort`, and `page` to defaults, should it use `router.replace()` or `router.push()`? Why?

---

## Group 3 — Pagination Design

13. The original `pageNumbers` logic showed `[1, 2, 3, "...", totalPages]` regardless of the current page. Why is this broken? At what page number does the failure become visible?

14. What is "windowed" pagination? Describe the algorithm: which pages are always shown, which are conditional, and where do ellipses appear?

15. The `safePage = Math.min(page, totalPages)` clamp was described as a UX concern, not a URL hygiene concern. What is the difference, and why does the distinction matter for how we think about it?

16. Why does `page` reset to 1 when a filter or sort changes, but not when a search run completes? What is different about a search completing?

17. Should the URL be updated to reflect the clamped page number (so `?page=3` becomes `?page=1` when only 1 page exists)? What are the arguments for and against?

---

## Group 4 — Null Values and Semantic Types

18. Why is `?? 0` idiomatic JavaScript but semantically wrong for `match_score`? What is the difference between a zero score and a null score in this domain?

19. The CONTEXT.md definition of "Unscored job" says it should only appear in All Matches. What is the reasoning behind this rule? When would it be wrong to apply it?

20. The score cell renders "—" for null rather than "0%" or "Pending". Why "—"? What does each option communicate to the user?

21. If we later add a "Not yet scored" filter tab, how would it interact with the High/Low filter tabs? What invariant must always hold across all tabs?

22. The `source` and `source_provider` columns are described as orthogonal. What does that mean precisely? Give an example of a job where they would carry different information simultaneously.

---

## Group 5 — State Merge and Data Ownership

23. Before Feature 11, `handleSearch()` called `setJobs(data.jobs)`, replacing the full list. What is the user-visible consequence of this? Why is it data loss even though no DB records are deleted?

24. The merge uses `id` as the deduplication key. What could go wrong if we deduplicated on `source_url` instead? When would two jobs have the same URL but different IDs?

25. After a merge, `page` resets to 1 but `match` and `sort` are preserved. Why not also reset `match` and `sort` to defaults? Under what circumstances would preserving them feel wrong to a user?

26. If the user has "High Match" active and runs a search that returns only low-scoring jobs, the merged list under "High Match" shows no new results. Is this a bug or correct behavior? What should the UI communicate?

---

## Group 6 — Empty States and Communication

27. The two empty states ("no history" vs "filters excluded everything") require different messages and different calls to action. What general principle about empty states does this illustrate? How do you identify when an empty state is actually two distinct states?
