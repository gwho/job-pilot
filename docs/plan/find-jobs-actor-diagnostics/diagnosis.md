# Diagnosis — Post-Fix Actor Failure: Imprecise Outcome Classification

## What triggered this investigation

Run `DpcHTkVSjq649kayI` confirmed the blocked-actor fix (build 0.1.8) was working correctly:
- HTTP 403 on all 3 Crawlee retries of the page-1 SEARCH URL
- `Actor.fail()` called → route returned 500 → UI showed error banner

The fix was correct. But the actor logs and `Actor.fail()` message were imprecise:

```
Search page blocked or returned no results (page-1 outcome: suspicious-empty)
```

The message said `suspicious-empty` even though the page never loaded at all (HTTP 403 before any browser content was received). A future engineer reading the Apify console would see a misleading description of what went wrong and check for the wrong things.

## Three latent issues confirmed from the code

### Issue 1: `"suspicious-empty"` used for two distinct failure modes

In `failedRequestHandler`, after all Crawlee retries are exhausted:

```typescript
failedRequestHandler({ request, error }) {
  console.warn(`[jobsdb-actor] Request failed: ${request.url}`, error);
  if (request.label === "SEARCH" && (request.userData as { page?: number }).page === 1) {
    page1Outcome = "suspicious-empty";  // ← wrong: page never loaded
  }
},
```

`"suspicious-empty"` was defined as: page loaded (HTTP 200), zero cards visible, no recognised empty-state marker. An HTTP-level failure (403/429/etc.) is a completely different failure mode — the page never reached the browser at all. Using the same outcome for both made it impossible to distinguish the two from logs or the Apify console.

### Issue 2: Race condition in `extractCardLinks` for the 200+no-cards path

The original wait sequence in `extractCardLinks`:
1. `waitForSelector('[data-testid="job-card"]', { timeout: 15000 })` — waits up to 15s for job cards
2. Scroll + 800ms fixed wait
3. `page.$$('[data-testid="job-card"]')` — count cards
4. If 0 cards: `locator('[data-automation="searchZeroResults"]').isVisible()` — check empty state **with no await/timeout**

Step 4 was the problem. `isVisible()` is a synchronous DOM snapshot — it reads the current state of the page at the moment of the call. If the empty-state element had not yet rendered (React component still hydrating), `isVisible()` returned `false`, and the page was classified as `"suspicious-empty"` even when JobsDB had rendered a genuine "no results" UI that simply hadn't finished loading.

This is a **time-of-check race condition** specific to Single Page Applications: the DOM state at the time of the check may not reflect the final rendered state.

### Issue 3: Log artifacts and screenshots overwritten per run

The actor did not save screenshots of suspicious-empty runs. Future builds intended to add per-run screenshot storage, but no `runId`-scoped key was used, meaning every suspicious-empty run would overwrite the same key in the KV store. Only the most recent failure would be inspectable.

Additionally, session presence was not logged — whether a valid session was loaded from the KV store was not reported anywhere in the actor logs, making it impossible to diagnose session-related 403s from log inspection alone.

## Failure mode classification

This is not a correctness bug (the actor was failing correctly). It is a **diagnostic precision gap**:

- Failure mode A (`blocked-http`): HTTP error before page load. Mitigations: session recapture, IP rotation, timing.
- Failure mode B (`suspicious-empty`): Page loaded, no cards, no empty-state marker. Mitigations: check session auth, update selectors, verify JobsDB UI changes.

Conflating A and B means engineers investigating a blocked run must check both classes of mitigations every time, with no signal about which applies.

## Signs in the code that pointed to each issue

| Issue | Signal |
|---|---|
| Imprecise outcome | `failedRequestHandler` sets `"suspicious-empty"` — the comment was "hard block signal" but the type name said "DOM-level no-cards" |
| Race condition | `isVisible()` called after `waitForSelector` timeout, with no additional wait for the empty-state element itself |
| Artifact overwrite | Screenshot (if it had existed) would use a fixed key with no `runId` component; session presence not logged anywhere |
