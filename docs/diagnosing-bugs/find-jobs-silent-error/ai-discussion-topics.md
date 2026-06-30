# AI Discussion Topics — Find Jobs Silent Error Path

20 questions across 5 topic groups.

---

## Group 1 — Silent failure as a bug category

1. The error path called `console.error` and returned. This is a very common pattern. Why is it specifically a problem when the caller is a React component controlling visible UI state, versus when it appears in a background server-side function?

2. The user's symptom was "search shows old results." The actual cause was "search failed silently." These are the same observable outcome. What does this reveal about the difference between debugging from symptoms vs debugging from mechanisms?

3. If there had been a loading overlay that covered the whole page during the search, would the silent failure have been more or less visible to the user? Why?

4. `finally { setIsLoading(false) }` means the button re-enables even on error. Is this the right behaviour? What are the arguments for keeping the button disabled after a failure until the user explicitly dismisses the error?

5. The `console.error` message was correct and descriptive. Is a console log an acceptable substitute for UI feedback? Under what specific conditions is it acceptable, and when is it not?

---

## Group 2 — Test coverage gaps

6. All 7 original seam tests used `ok: true` mocks. Why is this a systematic bias, not a one-off oversight? What mental model of the code does a test author have when they only write success-path tests?

7. The skill says: "for every `fetch` mock set, add at least one `ok: false` variant." Why is the pairing rule stronger than "write error tests when the error path matters"? What does the pairing rule prevent that the judgment-call rule doesn't?

8. The `ok: false` test used `waitFor` with a 1-second timeout. The test timed out — which is what proved the bug. What's the risk of using `waitFor` timeout as your "RED" signal, rather than an immediate assertion?

9. The consecutive-search test was GREEN, eliminating three hypotheses at once. Why is a test that documents CORRECT behaviour still valuable in a bug diagnosis session? When is it a waste of time?

10. The seam test file now has 8 tests. What's the right scope for a "seam test" file — should it test every possible response combination, or stay focused on the contract at the boundary?

---

## Group 3 — State machine design

11. `SearchStatus = { message: string; isError?: boolean }` uses an optional `isError`. What would change if you used a discriminated union instead: `{ type: "success"; message: string } | { type: "error"; message: string }`? When is a discriminated union worth the extra verbosity?

12. Both `searchStatus` and `jobs` are React state in `FindJobsClient`. They're updated in the same `handleSearch` function. Is there a risk that they get out of sync (e.g., success banner showing but old jobs visible, or vice versa)? How would you test for that?

13. The fix uses `setSearchStatus` on the error path without calling `setJobs`. This is correct — on failure, the table shouldn't clear. But what if a future engineer adds `setJobs([])` to the error path "to make it obvious nothing was found"? What test would catch that regression?

14. `isLoading` is cleared in `finally`, `searchStatus` is set in `try` and `catch`-equivalent blocks. If a network error occurs (`fetch` throws, not resolves with `ok: false`), which of these run? Write the code path.

---

## Group 4 — Component/API contract

15. The route sends `data.error` as a string like `"Job search failed. Please try again."`. The client uses it as the banner message. Who should own user-facing error copy — the route or the client? What are the arguments for each side?

16. The client has `(data?.error as string) ?? "Search failed. Please try again."`. The `?? fallback` covers the case where `data.error` is absent. Can you construct a scenario where `data.error` is absent even though `data.success === false`? What would cause that?

17. The banner shows the route's `error` string verbatim. If the route is ever called from a mobile app or a different client, that client also gets this copy. Is this a good or bad property of the current design?

18. `data` is typed as `any` (via `res.json()`). TypeScript doesn't verify that `data.error` is a string or that `data.success` exists. What would you add to make this type-safe, and where would you put the type definition?

---

## Group 5 — Debugging discipline

19. The skill rule is: "if you catch yourself reading code to build a theory before a red-capable command exists, stop." In this session, code was read before the test was written. Was this a violation? What is the distinction between "reading to understand the shape of the seam" and "reading to form a hypothesis"?

20. The consecutive-search test went GREEN, which eliminated three hypotheses. If it had gone RED instead, what would that have implied about the codebase, and how would the investigation have changed?
