# Explanation — Debug Session 01: Why Each Bug Existed and How It Was Found

---

## 1. Why Playwright's Chromium triggers CAPTCHA but real Chrome doesn't

This is one of the most misunderstood aspects of browser automation. The question sounds like "is the browser headless?" — but headless mode is not the variable that matters here. Playwright's Chromium can run in non-headless (visible window) mode and still trigger CAPTCHA, which is exactly what happened.

The real variable is browser fingerprint completeness. CAPTCHA systems like Cloudflare Turnstile evaluate a browser's identity through dozens of passive signals. The most reliable ones:

**`navigator.webdriver`** — All browsers controlled via the WebDriver protocol set `navigator.webdriver = true`. This is the strongest single signal. Cloudflare checks this immediately. The `--disable-blink-features=AutomationControlled` flag removes this marker from Chrome's DOM, and `addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }))` hides it at the JavaScript level.

**Plugin and MIME type lists** — A real Chrome installation has dozens of installed plugins and MIME handlers (PDF viewer, Flash legacy, native browser components). Playwright's bundled Chromium has an empty plugin list. The CAPTCHA system sees a browser with zero plugins and correctly infers automation.

**GPU and renderer strings** — `canvas.getContext('webgl').getParameter(RENDERER)` returns a string like `"ANGLE (Apple, APPLE M2, OpenGL 4.1)"` in a real browser. In Playwright's Chromium, it returns generic or empty values depending on the system.

**Font enumeration** — Real Chrome on macOS has access to the full system font library. Playwright's Chromium may have a reduced set. Font fingerprinting measures how many fonts a browser can render.

Real Chrome passes all these checks because it is a real Chrome: same binary used for normal browsing, same font access, same GPU pipeline, same plugin registration. When Playwright launches it via `channel: 'chrome'`, it uses the Chrome binary at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` and controls it through CDP — the same protocol it uses for Chromium — but the browser itself is indistinguishable from one a human opened.

The practical rule: for any site that uses Cloudflare, Turnstile, or reCAPTCHA v3 (score-based), use `channel: 'chrome'` for session capture. For Playwright actors running on Apify (where Chrome isn't installed), you're stuck with Chromium — but for a one-time session capture running on the developer's own machine, using real Chrome is always available and always better.

---

## 2. Why the wrong search URL was never caught before deployment

The original `SEARCH_URL` function was written based on inspection of the old JobsDB URL format (pre-Seek acquisition). JobsDB was acquired by Seek in 2014 and has gone through multiple redesigns since. The current URL format is SEEK-style:

```
Old: https://hk.jobsdb.com/hk/search-jobs/{query}/{location}
New: https://hk.jobsdb.com/jobs?q={query}&l={location}
```

The URL was never tested because no test run was triggered until after the full session capture and KV store setup was complete. The actor's first actual test run (triggered via REST API during this debug session) returned `SUCCEEDED` with 0 items — which is how the broken URL was discovered.

The key diagnostic signal was `requestsFinished: 1, requestsFailed: 0, jobs: 0`. The crawler processed one URL (the SEARCH page) without error, but found no job cards. This ruled out authentication failure (which would redirect to login), network failure (which would be a failed request), and selector errors (which would still count as processed). The only remaining explanation was that the page content didn't match the selectors — either the URL was wrong (loading the wrong page) or the selectors were wrong (loading the right page but not finding anything).

The local diagnostic confirmed it within seconds: `page.title()` returned `"404 Page Not Found | Jobsdb"`.

**The lesson about dead-URL detection:** The actor's `extractSearchResults` used `waitForSelector(...).catch(() => {})` — a silent timeout that returns if the selector never appears. On a 404 page, the selector legitimately doesn't exist, the wait times out silently, and the evaluate returns 0 results. The actor then exits with 0 jobs and `status: SUCCEEDED`. A proper guard would be to check the response status code or page title before attempting selector evaluation.

---

## 3. Why the CSS selector changed and how to diagnose it without seeing the page

JobsDB's frontend has undergone at least one major redesign since the original selectors were written. The old design used `data-automation` attributes throughout — both on card containers (`[data-automation="jobListing"]`) and on links inside them (`[data-automation="job-list-view-job-link"]`). The new design migrated card containers to `data-testid` attributes while keeping inner elements on `data-automation`.

This is a common pattern in frontend migrations: teams switch from one attribute convention to another incrementally. Container elements (which affect layout and accessibility tooling) tend to be migrated first; individual interactive elements within cards (links, buttons) are updated more slowly.

**How to check selectors when you can't see the page:**

The diagnostic approach used in this session is the right one: write a throwaway local Playwright script that loads the page with your captured session and runs `page.evaluate()` to count elements matching every candidate selector. This is faster and more reliable than trying to infer selectors from page source (which doesn't show dynamically rendered content) or from screenshots.

The key `evaluate` pattern:
```javascript
const count = await page.evaluate(() => {
  const sels = ['[data-automation="jobListing"]', '[data-testid="job-card"]', 'article', /* ... */];
  const results = {};
  for (const sel of sels) {
    results[sel] = document.querySelectorAll(sel).length;
  }
  return results;
});
```

This runs inside the page's JavaScript context and has access to the full rendered DOM, including elements injected by React. Running it after `page.waitForTimeout(2000)` or `waitUntil: 'networkidle'` ensures hydration is complete.

The other useful pattern for discovering what attributes actually exist on a page:
```javascript
const testids = Array.from(document.querySelectorAll('[data-testid]'))
  .map(el => el.getAttribute('data-testid'));
const automations = Array.from(document.querySelectorAll('[data-automation]'))
  .map(el => el.getAttribute('data-automation'));
```

This dumps every `data-testid` and `data-automation` value on the page — the complete vocabulary of what you can target.

---

## 4. Why tracking params in URLs break deduplication

JobsDB generates a unique `#sol=...` hash fragment and `?ref=...` query parameter for each search result position. The same job listing at position 1 and position 15 in the search results page will have different `sol` values. The `ref` parameter tracks which surface the click came from (search standalone, featured listing, recommended, etc.).

The deduplication in the Next.js route builds a `Set<string>` from `source_url` values already in the database:
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

If job ID 88338570 is stored as `https://hk.jobsdb.com/job/88338570?type=standard&ref=search-standalone#sol=f5b8a786...` in the DB, and the next search run returns it as `https://hk.jobsdb.com/job/88338570?type=standard&ref=search-standalone#sol=1b5aa429...`, the Set comparison fails (`has()` is an exact string match). The job gets inserted again as a duplicate.

The canonical URL strips everything after the path:
```typescript
function canonicalJobUrl(href: string): string {
  try {
    const u = new URL(href);
    return `${u.origin}${u.pathname}`; // "https://hk.jobsdb.com/job/88338570"
  } catch {
    return href;
  }
}
```

Using `new URL()` for this rather than string splitting is important: the URL class handles edge cases like double slashes, percent-encoded characters in the path, and malformed query strings without throwing on valid inputs.

The canonical form `https://hk.jobsdb.com/job/88338570` is also the correct URL for the "View job" link in the app UI — it loads the job detail page without any tracking context, which is the clean, stable URL a user would share or bookmark.

---

## 5. Why the TypeScript error identified the wrong field name

The `apify-client` SDK has two contexts where "timeout" appears:

**On input options (`ActorCallOptions`):** `timeout?: number` — the maximum duration in seconds for the actor run itself. This is what you configure before starting a run.

**On the run response (`ActorRun`):** `timeoutSecs: number` — the timeout that was in effect when the run executed. This is a field on the object returned by `.call()` or fetched from the runs API.

The original code used `timeoutSecs: 270` in the options object — the field name from the response type, not the input type. TypeScript's strict object literal checking ("excess property check") caught this: when you write `{ timeoutSecs: 270 }` in a position typed as `ActorCallOptions`, TypeScript reports that `timeoutSecs` doesn't exist on that type. The correct field name is `timeout: 270`.

This is a naming inconsistency inside the SDK itself — the option you set is called `timeout` but the value stored on the run is called `timeoutSecs`. It's the kind of issue that is easy to get wrong when reading API documentation because both names appear in the same context (the "configure your actor run" section of the docs). TypeScript's build-time check caught what a runtime test would only surface as unexpected behavior (the timeout being ignored, not as an error).

---

## 6. Why the actor logs were the right first diagnostic step

When the route returned a 500 error, there were several possible failure points: the Next.js server might not have loaded env vars, the `apify-client` call might have thrown before the actor ran, the actor might have failed during execution, or the actor might have succeeded but returned empty data.

The fastest way to isolate which layer failed was to bypass the Next.js route entirely and call the actor directly via REST API:

```bash
curl -s -X POST \
  "https://api.apify.com/v2/acts/XzcBowQgpzN8TVhse/runs?token=$APIFY_TOKEN&waitForFinish=120" \
  -H "Content-Type: application/json" \
  -d '{"query":"software engineer","location":"Hong Kong","maxItems":2}'
```

This ran the actor synchronously (waited up to 120 seconds) and returned `status: SUCCEEDED, exitCode: 0`. That result eliminated the actor infrastructure as the problem source — the actor itself was running correctly. The issue was in what the actor produced (0 items), not in whether it ran.

Fetching the logs for that run ID then showed `Done. Pushed 0 jobs to dataset` — confirming the crawl completed without throwing but extracted nothing. This narrowed the problem to the scraping logic: URL, selectors, or both.

The alternative diagnostic path — looking at the Next.js server logs — would have shown `console.error("[api/agent/find] jobsdb error:", error)` if the actor threw an exception. But since the actor itself was returning `SUCCEEDED` with an empty dataset, `lib/apify.ts` would not throw (it only throws on non-SUCCEEDED status), and the route would return an empty jobs array. The client-side "Job search failed" toast comes from the route checking `!data.success` — a separate condition that fires when 0 new jobs are saved and the response flags an issue.

---

## 7. The right way to maintain Playwright selectors over time

The selectors in `apify/jobsdb-hk-actor/src/main.ts` are coupled to JobsDB's frontend DOM. They will break again when JobsDB redesigns its UI. This session's fix used `[data-testid="job-card"]` — an attribute that frontend teams typically maintain more carefully than CSS class names because test suites depend on them. But even `data-testid` values change during major redesigns.

The monitoring strategy that would catch breakage before users do:
1. The actor returns 0 items but `SUCCEEDED` — add a check in `agent/jobsdb.ts` or `lib/apify.ts` that logs a warning if the dataset is empty after a scrape of a real query
2. Run a scheduled actor test (via Apify scheduler) once weekly with a known query ("software engineer") and alert if 0 items are returned

The diagnostic script pattern from this session — a throwaway `.mjs` file that loads the live page with the real session and dumps all selector counts — is the fastest way to find the new selectors when the old ones break. It doesn't require understanding the page's React component tree; it just queries the final rendered DOM.
