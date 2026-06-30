# AI Discussion Topics — Find Jobs Error Feedback

18 questions across 4 topic groups.

---

## Group 1 — State design

1. `SearchStatus = { message: string; isError?: boolean }` uses optional `isError`. The alternative is a discriminated union: `{ type: "success"; message: string } | { type: "error"; message: string }`. When does a discriminated union become worth the extra verbosity over an optional flag?

2. `setSearchStatus` is called on three paths: success, API error, and (unfixed) network error. Each sets the same state slot. What is the invariant that makes this safe? What would break that invariant?

3. The `searchStatus` state is never explicitly cleared between searches. If the user searches twice — first fails (error banner), then succeeds — does the error banner disappear? Trace the code path.

4. In `FindJobsClient`, `jobs` and `searchStatus` are updated in the same `handleSearch` function. If `setJobs(data.jobs)` succeeded but `setSearchStatus(...)` never ran (e.g., an exception between them), what would the user see? Is this a realistic risk?

5. `isError` is `boolean | undefined`. The banner checks `searchStatus.isError ? "error classes" : "success classes"`. Is `undefined` a valid "success" signal, or should it be a distinct third state (e.g., `null` meaning "no result yet")?

---

## Group 2 — Component/API contract

6. The fix does `message: (data?.error as string) ?? "Search failed. Please try again."`. The `as string` cast silences TypeScript. What would you need to change to make this type-safe without a cast? Where would the type definition live?

7. The route sends user-facing copy in `data.error` (e.g., `"Job search failed. Please try again."`). The client renders it verbatim. What are the arguments for keeping copy in the route vs. generating it in the client from a typed error code?

8. The `catch` block handles network errors (fetch throws). It still logs to console without calling `setSearchStatus`. What does the user experience during a network failure on a 5-minute search? Write the step-by-step.

9. On a 401 (Unauthorized), the route returns `{ success: false, error: "Unauthorized" }`. The banner would show "Unauthorized" to the user. Is that acceptable copy for a production UI? What should the client do differently for auth errors vs. transient errors?

---

## Group 3 — Styling and tokens

10. `bg-error/10` uses Tailwind's opacity modifier on a CSS custom property (`--color-error`). `bg-success-lightest` uses a named token (`--color-success-lightest: #ecfdf5`). Why do both exist in the same codebase, and when would you prefer one pattern over the other?

11. If `--color-error` changes in `globals.css` (e.g., from `#ef4444` to `#dc2626`), which usages update automatically and which don't? Would `bg-red-100` in a different component be affected?

12. The design rule says "never use raw Tailwind colour classes." If a new engineer added `bg-red-100` to a component for a quick fix, how would you detect it in a code review? Is there a way to lint or test for it automatically?

13. The `AlertCircle` icon is 14px to match the `Sparkles` icon. If the banner text is ever changed to a larger font size, the icon size becomes wrong. What's the most defensive way to couple icon size to text size in a React component?

---

## Group 4 — Test strategy

14. The test for the error path used `waitFor` with a 1-second default timeout. The test went RED because `waitFor` timed out — the element never appeared. Is `waitFor timeout` a reliable RED signal, or can flakiness creep in? What would a more deterministic assertion look like?

15. The consecutive-search test (`keyword B replaces keyword A`) was GREEN before the fix. What does that prove, and what does it NOT prove? Can you construct a scenario where this test is GREEN but the user still sees wrong behaviour?

16. The test `"clears the loading state after an API error"` was also GREEN before the fix, documenting existing correct behaviour. Is it worth keeping a test that was always GREEN? What does it protect against in future development?

17. After the fix, the seam test file has 10 tests. The `mockFetch` helper only covers `ok: true`. The `catch`-path tests would need `global.fetch = vi.fn().mockRejectedValueOnce(new Error("Network error"))`. Write that test skeleton. What would it assert?

18. The fix didn't add a test for the `catch` path (network error), explicitly calling it a "follow-up." What's the argument for leaving it unfixed in this session? What's the risk of deferring it?
