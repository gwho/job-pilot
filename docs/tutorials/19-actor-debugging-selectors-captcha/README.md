# Tutorial 19 — Actor Debugging: Fingerprinting, Silent 404s, Selector Migration, and URL Canonicalization

**After completing this tutorial you will understand:** why Playwright's bundled Chromium triggers CAPTCHA even in visible-window mode and why `channel: 'chrome'` bypasses it; how a scraper can return `status: SUCCEEDED` with zero results and why that is harder to catch than an outright failure; how to inspect a live site's rendered DOM without opening a browser, using `page.evaluate()` as a diagnostic tool; why a tracking-param URL breaks hash-set deduplication and how `new URL()` canonicalizes it correctly; and how TypeScript's excess property check surfaces SDK naming inconsistencies that runtime tests would silently ignore.

---

> [!NOTE]
> **Prerequisites:**
> Tutorial 18 (`../18-jobsdb-hk-discovery-architect-deep-dive/README.md`) — covers the architecture decisions behind the actor, the session security model, and the two Apify surfaces (CLI vs. runtime SDK). You need the session/KV store mental model for Parts 1–2.
> Tutorial 17 (`../17-adzuna-job-discovery/README.md`) — establishes the route lifecycle (`agent_runs`, `MATCH_THRESHOLD`, batch scoring) that the actor feeds into; Part 6's deduplication Set lives in that route.
>
> Open [`scripts/capture-jobsdb-session.mjs`](../../../scripts/capture-jobsdb-session.mjs), [`apify/jobsdb-hk-actor/src/main.ts`](../../../apify/jobsdb-hk-actor/src/main.ts), and [`lib/apify.ts`](../../../lib/apify.ts) alongside this tutorial.

---

## CS & language concepts in this tutorial

| Concept | Where it appears | Category |
|---------|-----------------|----------|
| Browser fingerprinting | `channel: 'chrome'`, `navigator.webdriver`, plugin lists | OS fundamentals |
| Binary search / layer isolation | REST API curl bypasses Next.js to test actor in isolation | Algorithms |
| Canonicalization | `canonicalJobUrl()` strips query + fragment to a stable identifier | System design |
| Excess property check | TypeScript rejects `{ timeoutSecs }` because `ActorCallOptions` only accepts `{ timeout }` | Type theory |
| Silent failure (zero-result success) | `waitForSelector().catch(() => {})` returns 0 on a 404 page with status SUCCEEDED | System design |

---

## How to use an LLM before this tutorial

Budget 25–35 minutes on these five concepts before reading code.

### Concept 1 — Browser fingerprinting: beyond the user agent

> "A website wants to determine whether a browser is being controlled by a script or used by a human. The user agent string is trivially spoofable, so sites check dozens of other signals. Explain what browser fingerprinting is, name at least four JavaScript properties or APIs that differ between a real browser and a headless/automated one, and explain why 'not headless' is not the same as 'not detectable'. Quiz me on which signals a Chromium binary built from source would fail compared to an installed Google Chrome."

*What to listen for:* Fingerprinting is multi-signal identity verification — no single property is decisive, but enough weak signals together create a confident classification. The key insight is that `navigator.webdriver`, `navigator.plugins.length`, WebGL renderer strings, and font enumeration all differ between real Chrome and Playwright's bundled Chromium. "Non-headless" means you can *see* the window; it does not change these DOM properties. Real Chrome installs register plugins, have a real GPU pipeline, and expose the system font library — none of which Playwright's Chromium has.

*Practice question:* A capture script runs Playwright's Chromium in non-headless mode (a visible window appears). The user can see the page and interact with it. Why does Cloudflare Turnstile still classify this as automated?

---

### Concept 2 — Layer isolation: binary search through a system stack

> "When a distributed system fails, how do you efficiently narrow down which layer is responsible? Explain the binary-search approach to debugging a layered system: UI → API route → external service → external API. Give an example where calling the external API directly (bypassing all intermediary layers) is the correct first diagnostic step. Quiz me on what each result tells you."

*What to listen for:* Layer isolation is a form of binary search on a causal chain. If calling the external API directly succeeds, the problem is in the middleware. If it fails, the problem is in the external system. Each test cuts the search space in half. The key insight: don't start at the top (the UI) and trace down step by step — start at the bottom (the most isolated unit) and work up. In this context: call the Apify actor via REST API before touching Next.js server logs.

*Practice question:* The route returns a 500. You call the actor directly via `curl` and get `status: SUCCEEDED, items: 0`. What have you proved, and what have you ruled out?

---

### Concept 3 — URL canonicalization: stable identifiers from dirty strings

> "Many web systems attach tracking parameters to URLs: `?ref=email&utm_campaign=june` or hash fragments like `#sol=abc123`. Explain what canonicalization means in the context of URL identity. Why is `https://example.com/job/123` and `https://example.com/job/123?ref=email` the same resource but different strings? What data structure is broken by treating them as different, and how does the URL class in JavaScript help you extract just the stable part? Quiz me."

*What to listen for:* Canonicalization means reducing a variant form to a single canonical representative. Two URLs that load the same resource but have different query strings or fragments are semantically identical but not string-equal. A `Set<string>` uses exact string equality (`===`), so it will treat them as different — causing deduplication to fail silently. The `URL` class parses a URL into structured parts (`origin`, `pathname`, `search`, `hash`), making it trivial to reconstruct just the stable identity.

*Practice question:* `new Set(["https://example.com/job/1?ref=a", "https://example.com/job/1?ref=b"]).size` equals what? What should it equal for correct deduplication?

---

### Concept 4 — TypeScript's excess property check

> "TypeScript has two modes of object type checking: structural compatibility (where an object with *more* fields than required is accepted) and excess property checking (where an object literal with *unexpected* fields is rejected). Explain why these two modes exist and when each applies. Give an example where `{ timeout: 270, unknownOption: true }` is accepted in one mode and rejected in the other. Quiz me."

*What to listen for:* Structural compatibility is TypeScript's core type system — any object that has at least the required fields is compatible, even if it has extras. Excess property checking is an additional lint-like check that only applies to *object literals* assigned directly to a typed variable or parameter. Its purpose: catch typos and wrong field names at call sites, since an extra field in a literal is almost always a mistake. The same object via an intermediate variable bypasses excess property checking. This is why `{ timeoutSecs: 270 }` is rejected when `ActorCallOptions` expects `{ timeout: number }` — the *literal* triggers the check.

*Practice question:* Why would `const opts = { timeout: 270, timeoutSecs: 270 }; actor.call(input, opts)` NOT produce a TypeScript error, while `actor.call(input, { timeout: 270, timeoutSecs: 270 })` would?

---

### Concept 5 — `data-*` attributes: who owns them and how stable are they?

> "In HTML, `data-*` attributes are custom attributes teams add to elements. Frontend teams use `data-testid` for their automated tests and `data-automation` for E2E tests or scraping. Explain who adds these attributes, why they tend to be more stable than class names, and what happens to scraper selectors when a frontend team migrates from one attribute convention to another. Quiz me on which part of a component's DOM a team is likely to migrate first."

*What to listen for:* `data-testid` and `data-automation` are added by developers — not by CSS systems or design tokens. They exist solely to provide stable hooks for non-visual consumers (test suites, accessibility tools, scrapers). They are more stable than CSS class names (which get renamed during design system migrations) because test suites depend on them and break immediately if changed. The migration hazard: teams often migrate attribute conventions incrementally — container elements first (they affect layout and accessibility tree structure), inner interactive elements later. A scraper targeting the container breaks first; one targeting inner links survives longer.

*Practice question:* A frontend team migrates from `data-automation="jobListing"` on card containers to `data-testid="job-card"`, but keeps `data-automation="job-list-view-job-link"` on the link inside each card. Why might the team have migrated containers first?

---

## Architecture overview

This tutorial covers three distinct failure points in the flow from "user clicks Find Jobs" to "jobs appear in the table." Each bug intercepted the flow at a different layer.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Browser (user)                                                     │
│  /find-jobs → click "Find Jobs" → POST /api/agent/find             │
└─────────────────────────────┬───────────────────────────────────────┘
                              │ HTTP
┌─────────────────────────────▼───────────────────────────────────────┐
│  Next.js route  app/api/agent/find/route.ts                        │
│  → calls runJobsDbActor()  ← lib/apify.ts (apify-client SDK)       │
│  ← receives []  → returns 500 "Job search failed"  BUG C: TS error │
└─────────────────────────────┬───────────────────────────────────────┘
                              │ apify-client .call() → REST API
┌─────────────────────────────▼───────────────────────────────────────┐
│  Apify Platform                                                     │
│  Actor run: jobsdb-hk-actor  status: SUCCEEDED  items: 0  ← BUG B │
│  (actor ran, crawled 1 page, found nothing, exited cleanly)        │
└─────────────────────────────┬───────────────────────────────────────┘
                              │ Playwright + Crawlee
┌─────────────────────────────▼───────────────────────────────────────┐
│  JobsDB HK site                                                     │
│  GET /hk/search-jobs/query/location → 404  ← BUG B (URL wrong)    │
│  selector [data-automation="jobListing"] → 0 hits ← BUG B (sel.)  │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  Developer machine (session capture)                               │
│  scripts/capture-jobsdb-session.mjs → Playwright Chromium         │
│  → JobsDB CAPTCHA triggered  ← BUG A (wrong browser binary)       │
└─────────────────────────────────────────────────────────────────────┘
```

**Three key invariants governing this system:**

1. Session capture must use real Chrome (`channel: 'chrome'`), not Playwright's bundled Chromium — the actor on Apify (which uses Chromium) never visits login pages, so only the capture script faces CAPTCHA.
2. `SUCCEEDED` status from Apify means the actor exited without throwing — not that it found anything. An actor that scrapes a 404 page will SUCCEED with 0 items.
3. `source_url` stored in the DB must be the canonical URL (no query params, no fragments) so that `Set<string>` membership tests are stable across search runs.

---

## Part 1 — Why visible ≠ undetectable: browser fingerprinting and `channel: 'chrome'`

Open [`scripts/capture-jobsdb-session.mjs`](../../../scripts/capture-jobsdb-session.mjs) lines 76–106:

```javascript
let browser;
try {
  browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled', // hide webdriver flag
    ],
  });
} catch {
  // Fall back to Playwright's Chromium if Chrome isn't installed
  console.warn('⚠️  Google Chrome not found — falling back to Playwright Chromium.');
  console.warn('   If you see a CAPTCHA, try installing Chrome from https://chrome.google.com\n');
  browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });
}

const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  // Use a real Chrome user agent so JobsDB doesn't flag the session
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
});

const page = await context.newPage();

// Mask the webdriver property that CAPTCHA checks look for
await page.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
});
```

The original script used `chromium.launch()` with no `channel` option. That launches Playwright's own bundled Chromium binary — a stripped-down version of Chromium built specifically for automation. When this browser navigated to JobsDB's login page, Cloudflare Turnstile's JavaScript fingerprinting ran and produced a risk score high enough to show the "Verify you are human" challenge. The user couldn't complete the challenge (or it kept regenerating) because the browser continued to fail the passive checks even after the visible checkbox.

The fix is `channel: 'chrome'`. This option tells Playwright's launcher to find the system-installed Google Chrome binary at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` and launch it through CDP, the same Chrome DevTools Protocol Playwright uses for its own Chromium. The browser under CDP control is real Chrome — the same binary the user runs for normal browsing. It has a complete plugin registry, real GPU renderer strings from the system's GPU, and access to the macOS system font library. None of these signals exist in Playwright's bundled Chromium, because it is built without them.

`--disable-blink-features=AutomationControlled` removes a Blink-level marker that CDPcontrolled browsers set on the Chrome DOM. `addInitScript()` additionally hides `navigator.webdriver` at the JavaScript level — this runs before any page script executes, so Cloudflare's check sees `undefined` rather than `true`. Note that `addInitScript` must be called on the page *before* navigation; a `page.evaluate()` call after navigation would run after the page's own JavaScript and miss the window where CAPTCHA checks happen.

The `try/catch` is a graceful degradation: if Chrome isn't installed, fall back to Playwright's Chromium with a visible warning. The user can still complete the login if no CAPTCHA appears, but the warning tells them what to install if one does.

> **OS fundamentals — Browser fingerprinting:** Fingerprinting is multi-signal identity verification. CAPTCHA systems don't check a single flag; they aggregate dozens of passive signals (`navigator.plugins.length`, `WebGLRenderingContext.getParameter(RENDERER)`, available system fonts, canvas rendering output) and compute a risk score. Each signal alone is weak and spoofable, but together they reliably distinguish real Chrome from an automation binary. The reason `channel: 'chrome'` works is not that it hides *one* signal — it passes *all* of them, because it is the real binary.

**Checkpoint:** The user can see the Chromium browser window and interact with it. They can click the CAPTCHA checkbox. Why doesn't this make the CAPTCHA solvable in Playwright's Chromium?

<details>
<summary>Reveal answer</summary>

Cloudflare Turnstile's "Verify you are human" challenge has two stages. The first stage is the passive fingerprint check — JavaScript APIs evaluated silently when the page loads. This check assigns a risk score before the checkbox is even clicked. If the score is too high, the checkbox click either fails immediately or triggers an additional image challenge that itself evaluates the same fingerprint signals. Since Playwright's Chromium fails the passive check (zero plugins, generic WebGL renderer, reduced font set, `navigator.webdriver = true`), clicking the visible checkbox doesn't improve the score. The challenge keeps regenerating because the *underlying reason* for the high risk score — the browser binary — hasn't changed.

</details>

**Try it yourself:** Temporarily change `channel: 'chrome'` to an invalid value like `channel: 'msedge'` and run the script. Observe the error message. Then restore it. This confirms Playwright is resolving the channel to a specific binary path — it's not a hint or a preference, it's a binary lookup.

---

## Part 2 — The silent 404: when SUCCEEDED hides a broken URL

Open [`apify/jobsdb-hk-actor/src/main.ts`](../../../apify/jobsdb-hk-actor/src/main.ts) lines 55–92:

```typescript
const SEARCH_URL = (query: string, location: string) => {
  const params = new URLSearchParams({ q: query });
  if (location) params.set("l", location);
  return `https://hk.jobsdb.com/jobs?${params.toString()}`;
};

// Strip tracking query params and hash fragment from job URLs so the same
// listing discovered through different search result positions deduplicates
// correctly in the Next.js route's Set<source_url> check.
function canonicalJobUrl(href: string): string {
  try {
    const u = new URL(href);
    return `${u.origin}${u.pathname}`;
  } catch {
    return href;
  }
}

async function extractSearchResults(page: Page, maxItems: number): Promise<string[]> {
  // Detect session expiry — if we land on a login page, warn and return empty.
  const url = page.url();
  if (url.includes("/login") || url.includes("/sign-in")) {
    console.warn("[jobsdb-actor] Redirected to login — session may be expired. Re-capture storageState.");
    return [];
  }

  await page.waitForSelector('[data-testid="job-card"]', { timeout: 15000 }).catch(() => {});

  const links = await page.evaluate((max: number) => {
    const cards = Array.from(document.querySelectorAll('[data-testid="job-card"]')).slice(0, max);
    return cards.map((card) => {
      const a = card.querySelector('a[data-automation="job-list-view-job-link"]') as HTMLAnchorElement | null;
      return a?.href ?? "";
    }).filter(Boolean);
  }, maxItems);

  return links.map(canonicalJobUrl);
}
```

The original `SEARCH_URL` function constructed:
```
https://hk.jobsdb.com/hk/search-jobs/software%20engineer/Hong%20Kong
```

This was based on JobsDB's pre-acquisition URL format — before Seek bought the platform. The URL now returns a 404 page. The actor navigated to it, Crawlee counted the request as `finished` (HTTP 200 is not required for Crawlee to count a page as processed — the page loaded), `waitForSelector('[data-testid="job-card"]')` timed out silently after 15 seconds (the `.catch(() => {})` swallows the timeout), and `querySelectorAll` returned 0 cards on a 404 error page. The actor then pushed 0 items to the dataset and exited with `exitCode: 0`, `status: SUCCEEDED`.

This is the silent failure mode: **a scraper that returns zero results is indistinguishable from a scraper that finds zero matching content**, unless you explicitly check for it. The actor says "I successfully scraped 0 jobs" when the true fact is "I successfully scraped a 404 error page that happened to have no job cards."

The fix uses `URLSearchParams` for construction:
```typescript
const params = new URLSearchParams({ q: query });
if (location) params.set("l", location);
return `https://hk.jobsdb.com/jobs?${params.toString()}`;
```

`URLSearchParams` handles special characters in query and location correctly (spaces become `+`, colons and slashes are percent-encoded), and the `/jobs?q=` format is the current SEEK-era JobsDB URL.

> **System design — Silent failure (zero-result success):** A remote operation that returns "success with empty results" is the hardest class of bug to catch because it does not trigger error handlers, logging, or alerts. It is only visible when a human notices that the expected output is absent. Defensive patterns against it: (1) assert that a "no results" response is plausible given the input (a valid query should always find *something* on a large site), (2) check `page.title()` for 404/error patterns before attempting selector extraction, (3) emit a warning log when the dataset is empty so monitoring can catch it.

**Checkpoint:** The old code used `waitForSelector('[data-testid="job-card"]', { timeout: 15000 }).catch(() => {})`. What does `.catch(() => {})` do, and why is it both necessary and dangerous here?

<details>
<summary>Reveal answer</summary>

`waitForSelector` throws a `TimeoutError` if the selector doesn't appear within the timeout. `.catch(() => {})` converts that throw into a silent no-op — execution continues. This is necessary because the search results page sometimes renders slowly and the selector appears *after* a brief delay; without the catch, a slow page would throw and abort the crawl prematurely.

It's dangerous because the same catch fires when the selector genuinely doesn't exist — on a 404 page, on a results page with no matches, or after a DOM redesign that changed the selector. In all these cases, execution continues to `querySelectorAll`, which returns 0 elements, and the actor produces an empty result set with status SUCCEEDED. A better pattern: wait for the selector with catch, then check `page.url()` for 404 or error-page indicators *before* running the evaluate. The session-expiry check (checking for `/login` in the URL) is exactly this pattern applied to one known failure case — but it doesn't cover 404s.

</details>

**Try it yourself:** Change `SEARCH_URL` back to the old format temporarily and trigger a test run via REST API. Observe `status: SUCCEEDED` with 0 items in the dataset. Then restore the correct URL and verify 5+ items appear.

---

## Part 3 — Layer isolation: bypassing the UI to test the actor directly

This Part does not change any code — it documents the diagnostic approach used to find the bugs in Parts 2 and 4–5.

When the route returned `"Job search failed. Please try again."`, there were four possible failure layers:

```
UI (browser) → Next.js route → apify-client call → Apify actor → JobsDB site
```

Starting from the UI and tracing down step by step would have required reading Next.js server logs, then reading the apify-client call path, then finding an actor run to inspect. The faster approach is **layer isolation**: call the most isolated unit first.

The actor's REST API accepts an input JSON and returns a run synchronously (with `waitForFinish=120`):

```bash
curl -s -X POST \
  "https://api.apify.com/v2/acts/XzcBowQgpzN8TVhse/runs?token=$APIFY_TOKEN&waitForFinish=120" \
  -H "Content-Type: application/json" \
  -d '{"query":"software engineer","location":"Hong Kong","maxItems":2}'
```

Result: `status: SUCCEEDED, exitCode: 0`. This immediately proved:
- The actor is reachable (APIFY_TOKEN valid)
- The actor binary runs (no build failure)
- The actor completes without throwing (no uncaught exception)
- The failure is in what the actor *produces*, not in whether it *runs*

The next step was fetching the actor's run logs via:
```bash
curl "https://api.apify.com/v2/actor-runs/{runId}/log?token=$APIFY_TOKEN"
```

The log showed `requestsFinished: 1, requestsFailed: 0` and `Done. Pushed 0 jobs to dataset.` — the actor processed one page (the SEARCH URL) without failure, but found nothing. This narrowed the problem to the scraping logic on that one page: either the URL loaded the wrong content, or the selectors didn't match.

> **Algorithms — Binary search / layer isolation:** Debugging a layered system by calling layers in isolation is a direct application of binary search. Instead of eliminating one step at a time (sequential O(n) search), each isolation test cuts the problem space in half. After the REST API call succeeded with 0 items, the problem was proven to be in the actor's scraping logic — not in the Next.js route, not in the `apify-client` SDK, not in Apify's infrastructure. One test eliminated three layers simultaneously.

**Checkpoint:** The REST API call returned `status: SUCCEEDED, items: 0`. What has this proved about the TypeScript type error in `lib/apify.ts` (Part 7)? Could the type error have been causing the 500?

<details>
<summary>Reveal answer</summary>

The type error in `lib/apify.ts` was a TypeScript *build-time* error — it prevented `npm run build` from succeeding. But in development (`npm run dev`), Turbopack does not run the full TypeScript type checker. The route runs successfully in dev mode with the wrong field name (`timeoutSecs`), which TypeScript accepts at runtime (JavaScript ignores unknown object keys — they're simply unused). The `timeout` option being effectively ignored means the actor run has no explicit timeout, which is fine for a short scrape.

So: the REST API call succeeds because the actor itself has no type errors — TypeScript type errors in `lib/apify.ts` only affect the Next.js app code, not the Apify actor. The 500 error was caused by the actor returning 0 items and the route treating an empty result set as a failure, not by the type error.

</details>

---

## Part 4 — DOM inspection without a browser: the throwaway diagnostic script

This Part covers the selector discovery technique — the `page.evaluate()` pattern used to find the correct selectors without deploying a new actor build.

Rather than guess selectors and redeploy the actor (a 3–5 minute Docker build cycle per attempt), a local throwaway Playwright script loaded the live JobsDB search page with the captured session and ran `page.evaluate()` to count elements:

```javascript
const count = await page.evaluate(() => {
  const sels = [
    '[data-automation="jobListing"]',
    '[data-testid="job-card"]',
    'article[data-card-type]',
    '[class*="JobCard"]',
    'article',
  ];
  const results = {};
  for (const sel of sels) {
    results[sel] = document.querySelectorAll(sel).length;
  }
  return results;
});
```

Result:
```
{ "[data-testid=\"job-card\"]": 30, "article[data-card-type]": 30, "article": 30 }
```

The original `[data-automation="jobListing"]` returned 0. `[data-testid="job-card"]` returned 30. This is the exact result needed — no visual inspection of the page required.

The `page.evaluate()` callback runs inside the page's JavaScript engine, with full access to the rendered DOM. It is not limited to what's in the initial HTML — it sees all elements added by React hydration after the page load. Running it after `waitUntil: 'networkidle'` and an additional 2 second wait ensures hydration is complete.

A second pattern dumps every `data-*` attribute value on the page — the complete vocabulary of what you can target:

```javascript
const testids = Array.from(document.querySelectorAll('[data-testid]'))
  .map(el => el.getAttribute('data-testid'));
const automations = Array.from(document.querySelectorAll('[data-automation]'))
  .map(el => el.getAttribute('data-automation'));
```

This produced the full list of attribute values on both the search page and the detail page, which confirmed that `[data-automation="job-detail-title"]`, `[data-automation="advertiser-name"]`, and `[data-automation="jobAdDetails"]` were all still present on the detail page unchanged.

The important implication: **detail page selectors survived the redesign; search page selectors did not**. This is covered in Part 5.

**Checkpoint:** Why is `page.evaluate()` returning element counts more reliable than reading the page's HTML source with a curl request?

<details>
<summary>Reveal answer</summary>

JobsDB renders its job listings with React (a JavaScript framework). When the server sends the initial HTML response, it contains a mostly empty shell — the actual job card elements are injected into the DOM by React after the JavaScript bundle loads and hydrates. A `curl` request fetches only the initial HTML response, which contains no job card elements at all. `page.evaluate()` runs inside a real browser that has executed the JavaScript, rendered the React components, and populated the DOM. The element counts reflect what a user actually sees — not what the server sends in the raw HTML.

This is the fundamental problem with scraping JavaScript-rendered sites: the DOM that matters is the post-JS DOM, not the initial HTML. Playwright solves this by running a real browser engine.

</details>

**Try it yourself:** Write a one-file `.mjs` script that opens JobsDB (`https://hk.jobsdb.com/jobs?q=engineer`) using the captured session and prints `page.title()`. Run it with `node yourscript.mjs`. You should see the search results title. This confirms the session is working before modifying any actor code.

---

## Part 5 — Attribute migration: why `[data-testid]` replaced `[data-automation]` on cards

Open [`apify/jobsdb-hk-actor/src/main.ts`](../../../apify/jobsdb-hk-actor/src/main.ts) lines 73–92:

```typescript
async function extractSearchResults(page: Page, maxItems: number): Promise<string[]> {
  // Detect session expiry — if we land on a login page, warn and return empty.
  const url = page.url();
  if (url.includes("/login") || url.includes("/sign-in")) {
    console.warn("[jobsdb-actor] Redirected to login — session may be expired. Re-capture storageState.");
    return [];
  }

  await page.waitForSelector('[data-testid="job-card"]', { timeout: 15000 }).catch(() => {});

  const links = await page.evaluate((max: number) => {
    const cards = Array.from(document.querySelectorAll('[data-testid="job-card"]')).slice(0, max);
    return cards.map((card) => {
      const a = card.querySelector('a[data-automation="job-list-view-job-link"]') as HTMLAnchorElement | null;
      return a?.href ?? "";
    }).filter(Boolean);
  }, maxItems);

  return links.map(canonicalJobUrl);
}
```

The outer card container changed from `[data-automation="jobListing"]` to `[data-testid="job-card"]`. The inner link (`a[data-automation="job-list-view-job-link"]`) stayed on `data-automation` and was still correct.

This split — containers migrated, inner elements not — reflects how frontend teams approach attribute conventions during a redesign. `data-testid` is the modern convention for elements that test suites target. `data-automation` is older and typically added by an E2E testing team or a separate automation layer. When a frontend team modernizes a component, they often:
1. Replace the container's attribute (they control the component's root element)
2. Leave inner elements alone (links and buttons may be owned by different components, or migration is incremental)

For a scraper targeting this DOM, this means: **container selectors are more likely to break during redesigns than inner element selectors**. The container is what the frontend team "owns" visually; the link inside it is a functional element with its own lifecycle.

The detail page selectors (`[data-automation="job-detail-title"]`, etc.) survived the redesign entirely because detail pages were not redesigned in the same round — they use a different component tree and a different team's migration timeline.

> **System design — Selector stability:** `data-testid` attributes are more stable than CSS class names (which change during design system migrations) but less stable than element-level `aria-label` or semantic HTML structure. The implicit contract: a frontend team changes `data-testid` values only when their own test suite changes, not when visual redesigns happen. Targeting `data-testid` for scraping is a reasonable bet for medium-term stability (1–2 year horizon). If a selector must be maximally stable, prefer the element's functional role (`a[href*="/job/"]`) over its test attribute.

**Checkpoint:** The search result card link uses `a[data-automation="job-list-view-job-link"]` and the detail page uses `[data-automation="job-detail-title"]`. Both survived the redesign. The card container did not. What does this tell you about which team migrated the search results page vs. who didn't yet migrate the detail page?

<details>
<summary>Reveal answer</summary>

The fact that card containers changed to `data-testid` while inner links and detail page elements stayed on `data-automation` suggests the redesign was incremental. The search results page component tree was partially modernized — the outer component wrapper adopted the `data-testid` convention (the "new" style), while the inner `JobLink` or `JobCard` child components were not yet migrated (they kept `data-automation`). The detail page was either owned by a different team or not yet scheduled for migration. This is consistent with how large frontend codebases evolve: teams migrate the components they own, in sprints, not all at once. The lesson for selector maintenance: when selectors break, they tend to break at the component boundary of whatever was recently redesigned — typically the outermost container of the component, not its inner leaves.

</details>

---

## Part 6 — URL canonicalization and hash-set deduplication

Open [`apify/jobsdb-hk-actor/src/main.ts`](../../../apify/jobsdb-hk-actor/src/main.ts) lines 64–71:

```typescript
function canonicalJobUrl(href: string): string {
  try {
    const u = new URL(href);
    return `${u.origin}${u.pathname}`;
  } catch {
    return href;
  }
}
```

And its application at line 91:
```typescript
return links.map(canonicalJobUrl);
```

JobsDB attaches tracking parameters to every link in search results:

```
https://hk.jobsdb.com/job/88338570?type=standard&ref=search-standalone#sol=f5b8a7861cac654e...
```

The `#sol=...` fragment is a unique hash generated per search session. The `?ref=...` parameter changes depending on how the user reached the listing (featured, recommended, organic). The same job ID 88338570 found in two different searches will have different `sol` values and potentially different `ref` values — making the full URLs string-unequal even though they point to the same resource.

The deduplication in `app/api/agent/find/route.ts` (from Tutorial 17/18) uses a `Set<string>`:
```typescript
const existingSet = new Set(existing.map(r => r.source_url));
const batchSet = new Set<string>();
const newJobs = jobs.filter(j => {
  const url = j.sourceUrl;
  if (existingSet.has(url) || batchSet.has(url)) return false;
  batchSet.add(url);
  return true;
});
```

`Set.has()` uses `===` comparison — exact string equality. Two strings that represent the same page but have different tracking params are *not equal* under `===`. The job would be inserted twice.

`canonicalJobUrl` uses `new URL(href)` to parse the full URL into structured parts, then reconstructs only origin + pathname:
```
new URL("https://hk.jobsdb.com/job/88338570?ref=search-standalone#sol=f5b8a786")
→ { origin: "https://hk.jobsdb.com", pathname: "/job/88338570", search: "?ref=...", hash: "#sol=..." }
→ canonical: "https://hk.jobsdb.com/job/88338570"
```

The `try/catch` wrapping `new URL()` handles the edge case where a returned `href` is malformed (not a valid URL). In that case, the original href is returned unchanged — the job is still processed, it just won't deduplicate perfectly against that specific malformed URL.

> **System design — Canonicalization:** Canonicalization is the process of reducing semantically equivalent representations to a single canonical form. It is required whenever an identity comparison is made between values that may have been through different generation paths. Hash-set membership (`Set.has()`) is an identity comparison. It works correctly only when all values in the set were produced through the same canonical form. The pattern is ubiquitous: URL canonicalization in crawlers, case normalization in usernames, whitespace normalization in search, and integer normalization in currency (cents, not dollars).

**Checkpoint:** `new Set(["https://example.com/job/1?ref=a", "https://example.com/job/1?ref=b"]).size` equals 2. After applying `canonicalJobUrl` to both strings, what does `new Set([...].map(canonicalJobUrl)).size` equal, and why?

<details>
<summary>Reveal answer</summary>

After canonicalization, both strings become `"https://example.com/job/1"` — identical strings. `new Set(["https://example.com/job/1", "https://example.com/job/1"]).size` equals 1. `Set` stores unique values; inserting a duplicate of an existing value is a no-op. The Set's size correctly reflects that there is one unique job, not two. This is exactly the correct behavior: the same job found in two different searches (or at different positions in the same search) is stored once in the database.

</details>

**Try it yourself:** Open a Node.js REPL and run:
```javascript
const u = new URL("https://hk.jobsdb.com/job/88338570?type=standard&ref=search-standalone#sol=f5b8a786");
console.log(u.origin + u.pathname);
```
Confirm the output is `https://hk.jobsdb.com/job/88338570`.

---

## Part 7 — TypeScript excess property check: `timeoutSecs` vs `timeout`

Open [`lib/apify.ts`](../../../lib/apify.ts) lines 35–39:

```typescript
const run = await client
  .actor(process.env.APIFY_JOBSDB_ACTOR_ID!)
  .call(input, {
    timeout: 270, // slightly under the route's maxDuration
  });
```

The original line was `timeoutSecs: 270`. The TypeScript build failed with:

```
Type error: Object literal may only specify known properties,
and 'timeoutSecs' does not exist in type 'ActorCallOptions'.
```

The `apify-client` SDK uses two differently-named fields in two different contexts:

- **Input options (`ActorCallOptions`):** `timeout?: number` — the maximum run duration you configure before starting the run
- **Response object (`ActorRun`):** `timeoutSecs: number` — the timeout value that was in effect when the run executed, returned in the run object

Both field names appear in the Apify documentation under "configure actor runs." Using the response field name in the options object is a natural mistake when reading documentation that mixes input and output shapes on the same page.

TypeScript caught this through its **excess property check**: when an object literal is directly assigned to a typed position (`options?: ActorCallOptions`), TypeScript checks that every key in the literal exists in the target type. `timeoutSecs` is not in `ActorCallOptions` — it is in `ActorRun` — so the literal is rejected.

This error only appeared during `npm run build`. The development server (`npm run dev` with Turbopack) does not run the full TypeScript type checker — it transpiles TypeScript but skips type-checking for performance. At runtime, `{ timeoutSecs: 270 }` is valid JavaScript — JavaScript ignores unknown object properties — so the actor call would still execute, but the timeout option would silently be ignored (the field has the wrong name and the SDK never reads it). The build-time type check caught a bug that would have been invisible in runtime testing.

> **Type theory — Excess property check:** TypeScript's structural type system normally accepts objects with *extra* fields — if an object has all the required fields, it's compatible regardless of extras. Excess property checking is a deliberate exception: object *literals* assigned directly to typed positions must not have unknown keys. The asymmetry exists because a literal with unexpected keys is almost certainly a typo or a wrong field name (like this bug), while a pre-existing variable with extra fields is likely a legitimate subtype being passed to a narrower interface. The check specifically targets the error class "I wrote the wrong field name" — which is exactly what happened here.

**Checkpoint:** Why did this TypeScript error not prevent the `/find-jobs` route from working in development (`npm run dev`), even though the build (`npm run build`) failed?

<details>
<summary>Reveal answer</summary>

Turbopack (Next.js's development bundler) transpiles TypeScript to JavaScript but does not run `tsc` (the TypeScript type checker). Type annotations are stripped, not verified. The compiled JavaScript runtime sees `{ timeoutSecs: 270 }` and passes it to the `apify-client` SDK's `.call()` method. The SDK reads its own known fields (`timeout`, `memory`, `build`, etc.) from the options object and ignores unknown ones — in JavaScript, accessing a non-existent property returns `undefined`, not an error. So the actor call works, but without an explicit timeout (the SDK uses the actor's default). The build step runs `tsc --noEmit` as a full type-checking pass, which catches the wrong field name. This is a common pattern in TypeScript development: the dev server is fast (no type checking) and the production build is safe (full type checking). The implication: you need to run `npm run build` (or `tsc`) periodically during development to catch type errors that the dev server misses.

</details>

---

## Full data flow: from "Find Jobs" click to jobs in the table — and where each bug intercepted it

The following trace covers the successful flow (post-fix). Marked steps show where each bug intercepted execution before the fix.

```
1.  User clicks "Find Jobs" in /find-jobs
    → FindJobsClient.tsx: handleSearch() → POST /api/agent/find
                                           with { jobTitle, location }

2.  Route: app/api/agent/find/route.ts
    → creates agent_run record (status: 'running')
    → calls discoverJobsDbJobs(jobTitle, location, 10)  from agent/jobsdb.ts
    → which calls runJobsDbActor(input)  from lib/apify.ts

       [BUG C was here: { timeoutSecs: 270 } caused build failure; dev worked by accident]

3.  lib/apify.ts: runJobsDbActor()
    → ApifyClient.actor(APIFY_JOBSDB_ACTOR_ID).call(input, { timeout: 270 })
    → blocks synchronously until actor completes (up to 270s)
    → reads dataset items

4.  Apify Platform: starts actor container (build 0.1.4)
    → actor: Actor.init() → loadStorageState() from KV store 8yzXh5w1IZdLjvZv9
    → builds searchUrl: https://hk.jobsdb.com/jobs?q={query}

       [BUG B was here: URL was /hk/search-jobs/{query}/{location} → 404]

5.  Actor: PlaywrightCrawler.run([{ url: searchUrl, label: "SEARCH" }])
    → preNavigationHook: injects 104 session cookies into browser context
    → page.goto(searchUrl) → JobsDB search results load (authenticated)
    → extractSearchResults():
       - checks page.url() for /login (session expiry guard)
       - waitForSelector('[data-testid="job-card"]')

       [BUG B was also here: selector was [data-automation="jobListing"] → 0 hits]

6.  Actor: for each job card (up to maxItems=10):
    → a[data-automation="job-list-view-job-link"].href → raw URL with tracking params
    → canonicalJobUrl() strips to https://hk.jobsdb.com/job/{id}
    → enqueueLinks({ urls: canonicalLinks, label: "DETAIL" })

7.  Actor: for each detail URL:
    → page.goto(detailUrl)
    → waitForSelector('[data-automation="jobAdDetails"]')
    → extractJobDetail():
       - title, company, location, salary, jobType, postedAt, description
       - externalApplyUrl from apply button
    → Dataset.pushData(result)

8.  lib/apify.ts: client.dataset(run.defaultDatasetId).listItems()
    → returns up to 10 JobsDbActorOutput items

9.  agent/jobsdb.ts: discoverJobsDbJobs()
    → normalizes each item (null-guards missing fields)
    → returns typed JobsDbJob[]

10. Route: scoreJobs(jobs.map(toScoringInput), profile) → scored []

11. Route: deduplication
    → queries existing source_url values for this user + source_provider='jobsdb_hk'
    → builds existingSet = new Set(existing.map(r => r.source_url))
    → filters jobs by canonical URL membership → newJobs[]

12. Route: batch insert newJobs into jobs table
    → source: 'search', source_provider: 'jobsdb_hk'
    → updates agent_run status: 'completed'

13. Route: returns { success: true, jobs: insertedRows, successMessage: "Found X, saved Y new jobs" }

14. FindJobsClient.tsx: setJobs(res.jobs) → table re-renders with new rows
```

---

## Extend it (challenges)

**Challenge 1 — Trace (15–20 min):**
Open [`apify/jobsdb-hk-actor/src/main.ts`](../../../apify/jobsdb-hk-actor/src/main.ts) and trace what happens when `loadStorageState()` returns `null` (no session found in KV store). Follow the `storageState` variable through the crawler setup: does `preNavigationHooks` still run? What happens when the crawler navigates to JobsDB without cookies? Where would execution diverge from the authenticated path?

<details>
<summary>Hint</summary>

Look at the `if (storageState)` guard in `preNavigationHooks`. When null, `addCookies` is skipped entirely. The crawler loads JobsDB without authentication — the search page may still load (JobsDB shows public results) but may show fewer jobs or redirect premium content to login. The `extractSearchResults` check for `/login` in the URL is the guard that catches a full redirect to the login page; it would fire if JobsDB requires login for the search page.

</details>

**Challenge 2 — Extend (20–30 min):**
Add a guard to `extractSearchResults` that detects a 404 page and returns `[]` with a warning, rather than silently timing out on `waitForSelector`. Use `page.title()` to check for the 404 condition. Modify the function to check the title *before* calling `waitForSelector`.

<details>
<summary>Hint</summary>

After `page.goto()` resolves (which happens inside the crawler's `requestHandler`, not in `extractSearchResults` directly), `page.title()` is available. Add a check: `const title = await page.title(); if (title.includes('404') || title.includes('Page Not Found')) { console.warn(...); return []; }`. Place this check before the `waitForSelector` call.

</details>

**Challenge 3 — Break and fix / Design (30–45 min):**
The session capture script detects login completion by polling `page.url()` every 2 seconds and checking `onJobsDb && !onAuthPage`. Design a failure scenario where this detection fires too early (like the original Google OAuth false-positive from Tutorial 18's deploy record) and write the exact condition that would trigger it. Then propose a stricter detection rule that eliminates the false-positive without being so strict it misses real logins.

<details>
<summary>Hint</summary>

Consider a scenario where JobsDB adds a new post-login confirmation page at a URL that doesn't include `/account/` or the known auth provider domains. The current check would fire immediately when the user reaches that new URL. A stricter rule: require that the page has loaded a JobsDB-specific element (like the job search bar or user profile avatar) before considering login complete — `page.waitForSelector('[data-testid="search-bar"]')` is a positive confirmation, not just an absence-of-login-page check.

</details>

---

For deeper exploration, [`docs/debug/01-actor-selectors-and-captcha/ai-discussion-topics.md`](../../debug/01-actor-selectors-and-captcha/ai-discussion-topics.md) has 24 prompts covering browser fingerprinting and CAPTCHA bypass, Apify KV store architecture, DOM inspection for scraper debugging, URL canonicalization correctness, and actor versioning and platform sync. Feed them to an LLM *after* forming your own answer first — the gap between what you thought and what you learn is where understanding lands.
