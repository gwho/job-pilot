# Reasoning — Find Jobs Silent Error Path

Why the bug existed, why it was hard to see, and the correct mental model going forward.

---

## 1. Why "silent failure" is the hardest bug to notice

A loud failure announces itself: a red screen, a thrown exception, an HTTP 500 body in the network tab. A silent failure does nothing — which is indistinguishable from "the feature worked but nothing changed."

In this case the failure was:

```typescript
if (!res.ok || !data.success) {
  console.error("[FindJobsClient] search failed:", data?.error);
  return;  // ← execution stops here
}
```

From the user's perspective:
1. They click "Find Jobs"
2. The button shows "Finding jobs…" for 30–60 seconds (the actor runs)
3. The button re-enables (the `finally` block runs)
4. The table is unchanged, no banner appears

Step 4 is identical to what you see if the search SUCCEEDS and finds no new jobs — because the missing banner was the only thing that distinguished them. The user reasonably concluded "the search showed old results."

The console.error was invisible unless DevTools was open. Most users never open DevTools.

---

## 2. Why the existing tests didn't catch it

All 7 original seam tests used this mock:

```typescript
function mockFetch(body: object) {
  global.fetch = vi.fn().mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(body),
  });
}
```

`ok: true` is hardcoded. The test suite verified the happy path thoroughly — correct banner text, correct table update, correct consecutive-search behaviour — but never simulated a failure response.

This is a common test-writing bias: you test the thing you're building (success), not the thing you're protecting against (failure). The success path is where you spend all your implementation time; the error path gets a `console.error` and a `return` as an afterthought.

The consequence: the error path had been in production since the feature shipped with zero coverage. It would have stayed that way indefinitely because it only surfaces when the Apify actor fails — which is not reproducible in a local dev environment without triggering real CAPTCHA or session expiry.

---

## 3. Why the consecutive-search test being GREEN was important

Before the tests ran, there were four live hypotheses:
1. The error path silently returns
2. `setJobs` doesn't work correctly across multiple searches
3. URL filter state (`match`, `q`, `sort`) masks new results
4. Something in `mergeJobsById` keeps old rows

The consecutive-search test (search A then search B, assert only B visible) going GREEN immediately eliminated H2, H3, and H4 with one command. The only remaining hypothesis was H1.

This is the value of the "generate ranked hypotheses, then test" pattern: each GREEN test eliminates a branch of the hypothesis tree. By the time you have one RED test, you know exactly which hypothesis it confirms.

---

## 4. Why the fix is `setSearchStatus`, not "show a toast" or "re-throw"

Three options existed for the error path:

**Option A — `setSearchStatus` with `isError: true`** (chosen):
```typescript
setSearchStatus({
  message: (data?.error as string) ?? "Search failed. Please try again.",
  isError: true,
});
```

Uses the existing state slot. The banner is already rendered when `searchStatus` is non-null. Adding `isError` flips it from green to red. No new state, no new component, no new rendering path.

**Option B — separate `errorMessage` state**:
```typescript
const [errorMessage, setErrorMessage] = useState<string | null>(null);
```

Creates a second banner element. Now both success and error banners need to be managed and cleared independently. More surface area, more edge cases (what if both are set?), more DOM to assert against in tests.

**Option C — throw and let a React Error Boundary catch**:
```typescript
throw new Error(data?.error);
```

Error boundaries are for unexpected errors that crash rendering, not for expected API failures. A 500 from a known endpoint that can timeout is expected. Using an Error Boundary here would show a full-page error state for something the user should be able to retry.

Option A is right because: the banner is the established feedback mechanism for this component. The `isError` flag is the minimal change that makes the existing mechanism serve both purposes.

---

## 5. Why `bg-error/10 text-error` is the correct styling

The design system has `--color-error: #ef4444` defined in `app/globals.css`. This maps to the `error` token. The `/10` modifier applies 10% opacity to the background colour — a Tailwind v4 idiom for "light tint of this token."

The banner's success variant uses `bg-success-lightest text-success-foreground`. There is no `--color-error-lightest` token equivalent, so the opacity modifier is the idiomatic substitute. It keeps the styling within the token system (no raw hex, no Tailwind palette colours like `bg-red-100`).

The `AlertCircle` icon from lucide-react replaces `Sparkles` on the error path. Both are 14px to match the existing banner proportions.

---

## 6. What the "loading state re-enables" test confirmed

The second new test:
```typescript
it("clears the loading state after an API error so the button is re-enabled", ...)
```

This was GREEN on current code because `handleSearch` uses `finally`:
```typescript
} finally {
  setIsLoading(false);
}
```

`finally` runs regardless of whether the `if (!res.ok)` block returns early. So the button was never stuck in loading state even before the fix — this was already correct behaviour.

Adding the test documents this as intentional and guards against a future refactor that might move `setIsLoading(false)` into the `try` block instead of `finally`.

---

## 7. The diagnostic discipline that made this fast

The session followed the skill's Phase 1 discipline strictly: no hypotheses were formed before a red-capable command existed. The sequence was:

1. Read the code to build a mental model (not to form a hypothesis)
2. Notice: zero error-path tests exist
3. Write two tests targeting the two most plausible failure modes
4. Run them — one is RED, one is GREEN
5. RED test identifies the exact bug

Total time from "read code" to "RED test in hand": the test was written and run before any hypothesis was written down. This is the correct order. The hypothesis comes from the test result, not the code reading.

If the code had been read to form a hypothesis first, the most obvious hypothesis might have been H2 ("the component state doesn't update across searches") — which the test proved wrong. Anchoring on that hypothesis first would have sent the investigation in the wrong direction.
