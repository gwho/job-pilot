# AI Discussion Topics — Find Jobs Pipeline Bugs

25 questions across 6 topic groups. Each asks WHY or HOW, not just WHAT.

---

## Group 1 — Dedup chains and fragile contracts

1. The old `extractSearchResults` produced deduplicated output in practice, but no test checked for uniqueness. What is the difference between code that *happens to work* and code whose *contract is explicit*? How do you make the distinction visible in a codebase?

2. The `canonicalJobUrl` function was applied OUTSIDE `extractSearchResults`, yet it was the safety net for the entire dedup chain. What design principle was being violated, and what does "each function owns its own invariants" mean in practice?

3. If `canonicalJobUrl` were moved to inside `page.evaluate` (stripping QS in the browser context), would dedup still work? What would change, and what would stay the same?

4. Crawlee's `uniqueKey` defaults to the full URL including query string, with params sorted. Why do you think Crawlee chose to sort params? What problem does that solve, and what problem does it still leave unsolved?

5. The new code shares `seenUrls` across multiple SEARCH handlers via a module-level closure. What are the conditions that make this safe? If you added concurrency (e.g., maxConcurrency: 2 for SEARCH requests), what would break?

---

## Group 2 — The `slice` position bug

6. `slice(0, max)` inside `page.evaluate` cut the card list BEFORE dedup. What class of bug is this — off-by-one, wrong-order, or something else? Name the general pattern and give another example of it outside this codebase.

7. The coverage gap (getting 9 jobs instead of 10 when one card was a featured duplicate) would be hard to notice during manual testing. Why? What kind of test or assertion would catch it automatically?

8. After the fix, the dedup loop is:
   ```typescript
   for (const href of rawLinks) {
     if (seenUrls.size >= maxItems) break;
     const canonical = canonicalJobUrl(href);
     if (!seenUrls.has(canonical)) { seenUrls.add(canonical); newLinks.push(canonical); }
   }
   ```
   What guarantees does this give that the old `slice(0, max)` did not? What does it NOT guarantee?

---

## Group 3 — Pagination architecture

9. The "enqueue next page from SEARCH handler" pattern is demand-driven. What is the alternative (enqueue all pages upfront), and what specific problem does demand-driven solve that upfront doesn't?

10. `maxRequestsPerCrawl: maxPages + maxItems` limits unique requests, not retry attempts. Why does Crawlee separate these two counts? What would happen if retries counted against the limit?

11. The SEARCH handler enqueues page 2 only if `seenUrls.size < maxItems`. What edge case does this handle? Describe a search query where pages 1–3 all yield zero new unique jobs — what does the actor do?

12. Why does the actor use `addRequests` (crawler context method) instead of `enqueueLinks` to enqueue the next search page? Could `enqueueLinks` be used here instead? What would need to change?

13. `SEARCH_URL(query, location, page)` adds `?page=N` for `page > 1`. If JobsDB's actual pagination URL uses a different parameter name or path structure, how would you discover this, and where in the actor would you fix it?

---

## Group 4 — API→UI message contracts

14. The API returned `successMessage` on both response paths. The client ignored it and re-derived the message from `strongMatches`. What architectural rule does this violate? Name the principle.

15. Path A (all already saved) omitted `strongMatches` from the JSON response. TypeScript didn't catch this on the client because `data` was `any` (untyped fetch response). What would you add to the codebase so that TypeScript catches missing fields from an API response?

16. React renders `{undefined}` as nothing — not the string "undefined". Is this a feature or a footgun? When is it useful, and when does it hide bugs the way it did here?

17. The fix was `searchStatus = { message: string }` — one field, pre-composed by the API. Under what circumstances would you want the client to have `{ jobsFound, newJobs, strongMatches }` instead? What UI requirement would justify the more verbose type?

18. The API's `successMessage` is English prose with numbers embedded: `"Found 10 jobs and saved 5 new jobs."`. If the app needed to support multiple languages, this approach wouldn't work. What would you change in the API response, and what would change in the client?

---

## Group 5 — Testing at seams

19. The seam tests used Vitest + RTL with `vi.mock('next/navigation', ...)` and a mocked `fetch`. What is a "seam" in the context of testing? Why is the UI/API boundary a particularly valuable seam to test?

20. The test for "banner must not say 'strong matches'" used `screen.queryByText(/strong matches/i)`. Why `queryBy` rather than `getBy`? What is the RTL convention and why does it matter for assertions about absent content?

21. The test for "banner must not contain 'undefined'" PASSED on buggy code — React doesn't render `{undefined}` as text. What does this reveal about writing red-capable tests? How would you write a test that correctly goes RED for a missing count in a banner?

22. Three of the five seam tests were GREEN on current code (documenting correct behaviour). Is it useful to have GREEN tests in a bug-fix test session? What purpose do they serve?

23. The diagnosing-bugs skill says: "if you catch yourself reading code to build a theory before a red-capable command exists, stop." In this session, code was read before the test was written. Was this a violation of the skill? When is code reading before loop-building justified?

---

## Group 6 — Product decisions embedded in code

24. `mergeJobsById(currentJobs, [])` returns the current list unchanged. This is a correct implementation of "show all-time history." But users perceived it as a bug because the broken banner gave no context. What does this reveal about the relationship between UI copy and user mental models?

25. The "table shows history, banner shows what just happened" split is a design decision — but it lives nowhere in the codebase as a comment, a type, or a doc string. Where would you put it so a future developer doesn't "fix" `mergeJobsById` to clear old jobs on each search?
