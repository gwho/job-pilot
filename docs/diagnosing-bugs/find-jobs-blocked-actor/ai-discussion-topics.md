# AI Discussion Topics — Blocked Actor Error Fix

## Group 1: The "silent success" failure pattern

1. **Why does a SUCCEEDED Apify run with 0 dataset items look identical to a successful run with 0 genuine results? What would you change about the Apify actor contract to make these distinguishable at the SDK level?**

2. **The actor's `failedRequestHandler` was called but only logged. Why does Crawlee call this handler instead of throwing? What is the design tradeoff that makes a failed request handler useful?**

3. **`Actor.fail(message)` vs `process.exit(1)` vs `throw new Error()` — what happens to the Apify run status in each case? Why does only `Actor.fail()` produce the right outcome here?**

4. **The `lib/apify.ts` guard checks `run.status !== "SUCCEEDED"`. This was already correct before the fix. Why did the fix need to happen in the actor rather than in `lib/apify.ts`?**

## Group 2: The monotonic invariant

5. **What is a monotonic invariant, and why does the "actor returns pages 1..N cumulatively" design create one in the route's pagination loop?**

6. **The old loop was: `allActorJobs = await discoverJobsDbJobs(...)` on every iteration. Why does assignment (replace) violate the invariant, but accumulation (union) preserve it?**

7. **The fix uses `if (pageResult.length < bestActorJobs.length)` as the shrink signal. Could a legitimate actor run ever return fewer items on page N+1 than page N? What would cause that, and would the fix incorrectly classify it as a suspicious shrink?**

8. **"Suspicious shrink" and "thrown error" both set `searchIncomplete = true`. Why is it correct to treat them the same way at the route level, even though they have different causes?**

## Group 3: Classification and evidence quality

9. **`classifySearchPage` returns four variants instead of a boolean `isBlocked`. What does a caller lose if the function returns only `isBlocked: boolean`?**

10. **The text fallback (`/no results|0 jobs found/i`) is treated as NOT sufficient evidence for a legit-empty result. Why not? What kind of anti-bot page might match this regex?**

11. **`shouldFailRun` returns false when `jobsPushed > 0`, even if `page1Outcome === "suspicious-empty"`. Why is this the right behavior? What would go wrong if the check ignored `jobsPushed`?**

12. **The known empty-state selector is `[data-automation="searchZeroResults"]`. What happens to the classification if JobsDB changes this selector without notice? How would you detect this breakage?**

## Group 4: Test design for this bug family

13. **The diagnosing-bugs skill says "Phase 1 is the skill." Why is building a tight feedback loop so important here? What would have happened if we had jumped straight to reading `failedRequestHandler` and guessing the fix?**

14. **The `actor-search-outcome.test.ts` tests pure functions with no mocks. Why is this seam better for testing the classification logic than testing it inside `main.ts`?**

15. **The trace-2 repro test needs the mock to return 10 dups on call 1, 20 dups on call 2, then `[]` on call 3. Why is it important that calls 1–2 return dup jobs (not new jobs) for this specific test?**

16. **The partial-block-new test needs the loop to reach call 2. To ensure that, call 1 must return fewer than `TARGET_NEW` fresh jobs. What would happen to the test if call 1 returned 10+ new jobs?**

## Group 5: Policy decisions and tradeoffs

17. **The user chose "show partial results with a warning" over "fail the whole search" when later pages are blocked. What are the costs of each policy? When would the opposite policy be better?**

18. **"Suspicious empty" is the default when no positive evidence of a real empty-results page exists. Is this too aggressive for a legitimately obscure query? How would you estimate the false-positive rate?**

19. **The route now has three success paths: legit-empty ("try different keywords"), all-dups ("all already saved"), and new-jobs-found. Previously there were two. What does adding the legit-empty path prevent that wasn't prevented before?**

20. **The fix is applied at three layers: actor (fail cleanly), route (monotonic guard + soft failure), and UI (catch block). If you could only fix one layer, which would have the highest impact? Which would be the safest to ship alone?**
