# Diagnose Post-Fix JobsDB Actor Failure — Improved Diagnostics

## Context

The blocked-actor fix (build 0.1.8) is working correctly. Run `DpcHTkVSjq649kayI` confirms:
- HTTP 403 on all 3 Crawlee retries of the page-1 SEARCH URL
- `failedRequestHandler` correctly set `page1Outcome = "suspicious-empty"` (imprecise — see §1)
- `Actor.fail()` called → route returned 500 → UI showed error banner

**Root cause (confirmed): JobsDB is returning HTTP 403 before the page loads (bot-blocking).**

The `requestHandler` / `extractCardLinks` never ran. However:
- Session presence should still be inspected: a missing/expired session may affect how JobsDB classifies the request even at the 403 level.
- The current code has a latent misclassification risk for the 200+no-cards path (no wait for empty-state before classifying).
- Log and screenshot artifacts from suspicious empty runs are not kept per-run (each overwrites the last).

Goal: add precise failure naming, targeted diagnostics, hydration-race wait, session logging, and per-run screenshot storage. **Do not weaken the route.**

---

## Changes

### 1. `apify/jobsdb-hk-actor/src/search-outcome.ts` — precise outcome type

Add `"blocked-http"` as a distinct outcome for HTTP-level failures (403, 429, etc.). Reserve `"suspicious-empty"` strictly for the 200+no-cards+no-empty-marker case.

```ts
export type SearchOutcome =
  | "ok"
  | "login-redirect"
  | "legit-empty"
  | "suspicious-empty"   // page loaded (200), zero cards, no recognised empty-state marker
  | "blocked-http";      // HTTP-level failure (403/429/etc.) — page never loaded
```

Update `shouldFailRun` to fail on both:
```ts
export function shouldFailRun({ page1Outcome, jobsPushed }) {
  if (jobsPushed > 0) return false;
  return (
    page1Outcome === "suspicious-empty" ||
    page1Outcome === "login-redirect" ||
    page1Outcome === "blocked-http"
  );
}
```

Add new tests in `__tests__/find-jobs/actor-search-outcome.test.ts`:
- `shouldFailRun({ page1Outcome: "blocked-http", jobsPushed: 0 })` → true
- `shouldFailRun({ page1Outcome: "blocked-http", jobsPushed: 5 })` → false

### 2. `apify/jobsdb-hk-actor/src/main.ts`

**A. Session presence logging in `loadStorageState`**

After loading the session, log cookie count and store ID without leaking values:
```ts
const cookies = (storageState as { cookies?: unknown[] }).cookies ?? [];
console.log(
  `[jobsdb-actor] Session loaded: ${cookies.length} cookies (store: ${storeId ?? "default"}).`
);
```
No cookie names, values, or domains are logged. The existing `console.warn` for missing session is unchanged.

**B. `failedRequestHandler` — precise outcome + structured log**

Set `page1Outcome = "blocked-http"` (not `"suspicious-empty"`) when the HTTP request itself fails. Extract the status code from the error message for the log:

```ts
failedRequestHandler({ request, error }) {
  const statusMatch = error.message?.match(/\b(\d{3})\b/);
  const httpStatus = statusMatch?.[1] ?? "unknown";
  console.warn(
    `[jobsdb-actor][diag] Request failed: url=${request.url} | label=${request.label} | page=${(request.userData as { page?: number }).page ?? 1} | httpStatus=${httpStatus} | error=${error.message}`,
  );
  if (request.label === "SEARCH" && (request.userData as { page?: number }).page === 1) {
    page1Outcome = "blocked-http";
    page1HttpStatus = httpStatus; // new module-level variable, used in Actor.fail() message
  }
},
```

**C. `extractCardLinks` — race-based wait + targeted diagnostics**

Replace the current sequential wait (15s for cards → scroll → 800ms → query → check empty-state with no wait) with a race-based approach:

```ts
// Race: exit as soon as any meaningful DOM signal appears, or on timeout.
await Promise.race([
  page.waitForSelector('[data-testid="job-card"]', { timeout: 15000 }),
  page.waitForSelector('[data-automation="searchZeroResults"]', { timeout: 15000 }),
  page.waitForURL('**/login**', { timeout: 15000 }),
  page.waitForURL('**/sign-in**', { timeout: 15000 }),
]).catch(() => {});
```

After the race, if cards are present, scroll for lazy-loading and re-query. If cards are still absent, collect diagnostics before classifying:

```ts
const cardCount = (await page.$$('[data-testid="job-card"]')).length;

if (cardCount > 0) {
  // scroll + 800ms wait for lazy-loaded cards (unchanged)
  ...
  // re-query links
  ...
  return { links: rawLinks, outcome: "ok" };
}

// Zero cards — collect diagnostics before classifying
const diagUrl = page.url();
const diagTitle = await page.title().catch(() => "");
const diagEmptyState = await page.locator('[data-automation="searchZeroResults"]').isVisible().catch(() => false);
const diagLoginMarker = diagUrl.includes("/login") || diagUrl.includes("/sign-in");
const diagBlockMarker = await page
  .locator('[data-testid="captcha"], [id*="captcha"], [class*="captcha"], [id*="challenge"]')
  .isVisible()
  .catch(() => false);

console.log(
  `[jobsdb-actor][diag] zero-cards: url=${diagUrl} | title="${diagTitle}" | emptyState=${diagEmptyState} | login=${diagLoginMarker} | block=${diagBlockMarker}`,
);

const outcome = classifySearchPage({
  url: diagUrl,
  cardCount: 0,
  hasKnownEmptySelector: diagEmptyState,
  hasEmptyTextFallback: false,
});

// Screenshot on suspicious-empty (page loaded; screenshot is available)
if (outcome === "suspicious-empty") {
  const store = await Actor.openKeyValueStore();
  const runId = Actor.getEnv().actorRunId ?? "unknown";
  const buf = await page.screenshot({ fullPage: false }).catch(() => null);
  if (buf) {
    await store.setValue(
      `diagnostics/${runId}/suspicious-empty.png`,
      buf,
      { contentType: "image/png" },
    );
    console.log(`[jobsdb-actor] Screenshot saved to diagnostics/${runId}/suspicious-empty.png`);
  }
}

return { links: [], outcome };
```

**D. Precise `Actor.fail()` message**

Use `page1HttpStatus` (set in `failedRequestHandler`) to distinguish blocked-http from page-level suspicious-empty:

```ts
let failMessage: string;
if (page1Outcome === "blocked-http") {
  failMessage = `Search request blocked at HTTP level (status ${page1HttpStatus}) — page never loaded, no jobs discovered.`;
} else {
  failMessage = `Search page loaded but returned no recognisable content (outcome: ${page1Outcome}) — no jobs discovered. Check diagnostics KV store for screenshot.`;
}
await Actor.fail(failMessage);
```

### 3. Route and UI — no changes

The route's 500 / error banner contract is unchanged. The 71 existing tests in `__tests__/find-jobs/` must stay green.

---

## Release checklist (in order)

1. Update `search-outcome.ts` (new type + `shouldFailRun` update).
2. Update `main.ts` (session logging, failedRequestHandler, extractCardLinks race + diagnostics, Actor.fail message).
3. Run `npm run test:run -- __tests__/find-jobs/` — 71 tests green; new outcome tests pass.
4. Run `npx tsc --noEmit` and `npm run lint`.
5. **`cd apify/jobsdb-hk-actor && apify push`** — **MANDATORY before testing**. Local changes under `apify/jobsdb-hk-actor/` are completely inert for the running Next.js app until a new build is deployed. The app calls the actor ID in `APIFY_JOBSDB_ACTOR_ID`; the KV store build pointer must update.
6. Trigger a live search to exercise the new logging path.
7. Update `context/progress-tracker.md`.
8. Create `docs/plan/find-jobs-actor-diagnostics/` with plan.md, explanation.md, ai-discussion-topics.md.

---

## Verification

- **403 path**: logs show `httpStatus=403`, `page1Outcome=blocked-http`, and `Actor.fail` message says "blocked at HTTP level (status 403)."
- **200+no-cards path**: logs show all 5 diagnostic fields; screenshot saved to `diagnostics/<runId>/suspicious-empty.png` in KV store.
- **200+legit-empty path**: race fires on `[data-automation="searchZeroResults"]` → `legit-empty` → `Actor.exit()` → route returns "Found 0 jobs. Try different keywords."
- **Session presence**: every run now logs whether a session was found and its cookie count.
- `npm run test:run -- __tests__/find-jobs/` → 71+ tests pass (new `blocked-http` outcome tests added).

---

## Not in scope

- Proxy support (keep failing when bot-blocked)
- Weakening the route's 500 path
- Automated session recapture (manual: export storageState from browser, upload to Apify KV store key `JOBSDB_SESSION`)
