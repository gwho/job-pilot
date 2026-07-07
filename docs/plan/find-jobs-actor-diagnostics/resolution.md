# Resolution — Post-Fix Actor Diagnostics Improvements

## Root cause

Three independent gaps in the actor's diagnostic instrumentation, all latent before build 0.1.8 but made visible once the blocked-actor fix was confirmed working:

1. **Same outcome type used for HTTP-level and DOM-level failures.** `"suspicious-empty"` was assigned in `failedRequestHandler` (HTTP failure, page never loaded) and returned from `extractCardLinks` (page loaded, zero cards). Both paths reached `Actor.fail()` but produced an identical, misleading message.

2. **`isVisible()` called without a preceding wait on the empty-state element.** In `extractCardLinks`, after `waitForSelector('[data-testid="job-card"]')` timed out, the code immediately called `locator('[data-automation="searchZeroResults"]').isVisible()` — a synchronous DOM snapshot. If the empty-state element was still hydrating, it returned `false` and the page was misclassified as `"suspicious-empty"`.

3. **No per-run artifact storage.** Screenshots of suspicious-empty pages (if they had existed) would have overwritten each other. Session presence was not logged, making it impossible to determine from logs whether a session was loaded.

---

## What was changed

### `apify/jobsdb-hk-actor/src/search-outcome.ts`

Added `"blocked-http"` to the `SearchOutcome` union as a formally distinct outcome for HTTP-layer failures:

```typescript
export type SearchOutcome =
  | "ok"
  | "login-redirect"
  | "legit-empty"
  | "suspicious-empty"   // page loaded (200), zero cards, no recognised empty-state marker
  | "blocked-http";      // HTTP-level failure (403/429/etc.) — page never loaded
```

Updated `shouldFailRun` to include `"blocked-http"`:

```typescript
export function shouldFailRun({ page1Outcome, jobsPushed }) {
  if (jobsPushed > 0) return false;
  return (
    page1Outcome === "suspicious-empty" ||
    page1Outcome === "login-redirect" ||
    page1Outcome === "blocked-http"
  );
}
```

### `apify/jobsdb-hk-actor/src/main.ts`

**Session presence logging** — `loadStorageState` now logs cookie count and store ID. No cookie names, values, or domains are logged:

```typescript
console.log(
  `[jobsdb-actor] Session loaded: ${cookies.length} cookies (store: ${storeId ?? "default"}).`
);
```

**`failedRequestHandler`** — sets `page1Outcome = "blocked-http"` and extracts the HTTP status from the error message:

```typescript
const statusMatch = (error as Error).message?.match(/\b(\d{3})\b/);
const httpStatus = statusMatch?.[1] ?? "unknown";
// ...
if (request.label === "SEARCH" && ...) {
  page1Outcome = "blocked-http";
  page1HttpStatus = httpStatus;
}
```

**`extractCardLinks`** — race-based wait replaces the sequential card-only wait:

```typescript
await Promise.race([
  page.waitForSelector('[data-testid="job-card"]', { timeout: 15000 }),
  page.waitForSelector('[data-automation="searchZeroResults"]', { timeout: 15000 }),
  page.waitForURL("**/login**", { timeout: 15000 }),
  page.waitForURL("**/sign-in**", { timeout: 15000 }),
]).catch(() => {});
```

After the race, zero-card results collect five diagnostic fields before classification:

```typescript
console.log(
  `[jobsdb-actor][diag] zero-cards: url=${diagUrl} | title="${diagTitle}" | emptyState=${diagEmptyState} | login=${diagLoginMarker} | block=${diagBlockMarker}`,
);
```

On `"suspicious-empty"`, a per-run screenshot is saved using `runId` in the key:

```typescript
await store.setValue(`diagnostics/${runId}/suspicious-empty.png`, buf, {
  contentType: "image/png",
});
```

**`Actor.fail()` message** — now distinguishes the two failure modes precisely:

```typescript
if ((page1Outcome as SearchOutcome) === "blocked-http") {
  failMessage = `Search request blocked at HTTP level (status ${page1HttpStatus}) — page never loaded, no jobs discovered.`;
} else {
  failMessage = `Search page loaded but returned no recognisable content (outcome: ${page1Outcome}) — no jobs discovered. Check diagnostics KV store for screenshot.`;
}
```

### `__tests__/find-jobs/actor-search-outcome.test.ts`

Two new tests added to the `shouldFailRun` describe block:

```typescript
it("page-1 blocked-http + no jobs pushed → true (HTTP failure, no page loaded)", () => {
  expect(shouldFailRun({ page1Outcome: "blocked-http", jobsPushed: 0 })).toBe(true);
});

it("page-1 blocked-http but jobs were somehow pushed → false (safety valve)", () => {
  expect(shouldFailRun({ page1Outcome: "blocked-http", jobsPushed: 5 })).toBe(false);
});
```

---

## TypeScript issue encountered

Inside `if (shouldFailRun(...))`, TypeScript CFA narrowed `page1Outcome` from `SearchOutcome` to the literal `"ok"` (the initializer). The comparison `page1Outcome === "blocked-http"` then failed with:

```
error TS2367: This comparison appears to be unintentional because the types '"ok"' and '"blocked-http"' have no overlap.
```

Fix: `(page1Outcome as SearchOutcome) === "blocked-http"` — casting to the full declared type breaks the narrowing without discarding type safety.

---

## Test and deployment summary

| Step | Result |
|---|---|
| `npm run test:run` | 73 tests pass (71 pre-existing + 2 new `blocked-http` outcome tests) |
| `npx tsc --noEmit` | Clean (pre-existing mock type errors unchanged, not introduced by this session) |
| `npm run lint` | Clean |
| `apify push` | Build `0.1.9` deployed |

---

## What was NOT changed

- Route layer (`app/api/agent/find/route.ts`) — monotonic guard and error policy from build 0.1.8 remain intact
- UI error banner (`components/find-jobs/FindJobsClient.tsx`) — unchanged
- `lib/apify.ts` — unchanged
- `Actor.fail()` call path — only the message content changed; the 500 → error banner contract is identical

---

## What this enables for future debugging

| Signal | Before 0.1.9 | After 0.1.9 |
|---|---|---|
| HTTP 403 vs. DOM failure | Both reported as `"suspicious-empty"` | Distinct: `"blocked-http"` vs. `"suspicious-empty"` |
| `Actor.fail()` message | "Search page blocked or returned no results (outcome: suspicious-empty)" | Precise: "blocked at HTTP level (status 403)" or "page loaded but no recognisable content" |
| Session presence | Not logged | Cookie count + store ID logged on every run |
| Suspicious-empty page state | No screenshot | Screenshot at `diagnostics/<runId>/suspicious-empty.png` per run |
| Zero-card diagnostics | None | url, title, emptyState, login, block logged before classification |
