# Technical Explanation — Actor Diagnostics Improvements

## Why "blocked-http" needed to be a separate outcome type

In build 0.1.8, `failedRequestHandler` set `page1Outcome = "suspicious-empty"` when an HTTP failure occurred. This was imprecise: `"suspicious-empty"` means "the page loaded but we saw zero cards and no recognised empty-state element." An HTTP 403 failure means the page never loaded at all — two very different things.

Having a single outcome for both made logs misleading (`outcome: suspicious-empty` in the `Actor.fail()` message, even when Crawlee reported a 403) and made it impossible to distinguish the two failure modes from a log search alone.

`"blocked-http"` is now the authoritative signal for: **Crawlee exhausted all retries at the HTTP layer; the page was never delivered to the browser.** `"suspicious-empty"` is reserved for: **the page arrived, rendered, showed no job cards, and showed no known empty-state marker.** Both routes to failure are distinct engineering problems with different mitigations.

## Why the race-based wait replaced the fixed timeout

The original `extractCardLinks` flow:
1. `waitForSelector('[data-testid="job-card"]', { timeout: 15000 })` — wait up to 15s for a job card
2. Scroll + 800ms fixed wait
3. `page.$$('[data-testid="job-card"]')` — count cards
4. If 0 cards: `locator('[data-automation="searchZeroResults"]').isVisible()` — check empty state with **no await/timeout** (just the immediate DOM snapshot)

The problem with step 4: `isVisible()` with no preceding wait checks the DOM synchronously at the moment of the call. If the empty-state element hadn't yet rendered at that exact moment (e.g., the React component was still hydrating), it would return `false`, and the function would classify the page as `"suspicious-empty"` even if JobsDB intended to show the "no results" UI.

The race-based approach starts a four-way race:
- Job card appears → cards found, proceed normally
- Empty-state element appears → legit empty
- URL becomes a login page → session redirect
- 15 second timeout → either something is wrong or the connection is very slow

Whichever signal fires first wins. After the race resolves (or times out), the DOM is in a more stable state. The `isVisible()` call on the empty-state element now runs after the element has had up to 15s to render, making false negatives from hydration race conditions far less likely.

## Why diagnostics are collected only on zero-card results

Diagnostics collection (url, title, emptyState marker, login marker, captcha marker) runs only when `initialCardCount === 0`. This is intentional:

1. **On the happy path** (cards found), the diagnostic cost is avoided entirely. Every job search with real results skips all five `locator.isVisible()` calls.
2. **On the failure path**, the diagnostics run before `classifySearchPage`, so the classification decision has structured evidence in the log rather than relying on post-hoc reconstruction.
3. **On suspicious-empty only**, the screenshot is taken. Screenshots are expensive (full browser render to PNG buffer) and only have diagnostic value when the page loaded but looked wrong. HTTP-blocked pages (never loaded) can't be screenshotted from the browser.

The per-run screenshot key `diagnostics/${runId}/suspicious-empty.png` means each run's screenshot doesn't overwrite the previous one. Before this change, every suspicious-empty run wrote to the same key, so you could only see the most recent failure.

## Why session presence is logged at cookie count only

The session file loaded from `JOBSDB_SESSION` in the Apify KV store contains a Playwright `storageState` object — which includes cookie names, values, domains, local storage entries, and session storage. Any of these are sensitive credentials that should never appear in actor logs.

The log line:
```
[jobsdb-actor] Session loaded: 12 cookies (store: default).
```

answers the diagnostic question "was a session found, and does it look populated?" without leaking anything. `12 cookies` suggests a real authenticated session; `0 cookies` suggests the session file exists but is empty (misconfigured) — a distinct failure mode from the session file not existing at all (which produces the existing warning log).

## How TypeScript's narrowing made the blocked-http check fail

TypeScript 5.x CFA (control flow analysis) infers that within the `if (shouldFailRun(...))` block, `page1Outcome` can only hold values for which `shouldFailRun` returns `true`. Since `shouldFailRun` contains an explicit `return` when `page1Outcome` satisfies the union, TypeScript may narrow the type of the outer variable to the complement set. In this specific case, it narrowed `page1Outcome` to `"ok"` (the initializer literal), making `page1Outcome === "blocked-http"` a type error.

The fix `(page1Outcome as SearchOutcome) === "blocked-http"` breaks the narrowing by casting to the full declared type before the comparison. This is the correct approach when you know the type is right but TypeScript's narrowing is incorrect — prefer `as T` over `as unknown as T` because the latter abandons all safety.

## Why apify push is mandatory and what it updates

`apify push` does three things:
1. Packages the local source into a Docker image
2. Pushes the image to Apify's ECR registry
3. Updates the actor's build pointer in Apify's backend so the next `apify actors call` invocation uses the new code

The Next.js app calls the actor via `APIFY_JOBSDB_ACTOR_ID`. That ID points to the actor's latest build. Until `apify push` runs, the actor running in Apify's cloud is still the old version — local changes under `apify/jobsdb-hk-actor/` have zero effect on live runs.

Build 0.1.8 → 0.1.9 is the version increment for this change set.
