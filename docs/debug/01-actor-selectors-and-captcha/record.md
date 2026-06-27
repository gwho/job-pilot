# Record — Debug Session 01: Actor Selectors, CAPTCHA, and Deployment Failures

## Session scope

After the Apify actor (build 0.1.3) was deployed and the JobsDB session was captured, the end-to-end flow was broken in two distinct ways:

1. The session capture script failed with a "Verify you are human" CAPTCHA using Playwright's Chromium
2. The `/find-jobs` route returned "Job search failed. Please try again." even though the actor's build was SUCCEEDED

This session diagnosed and fixed both issues, resulting in build 0.1.4 with a working end-to-end scrape.

---

## Issue 1: CAPTCHA on session capture

**Symptom:** The capture script opened a Chromium browser for the user to log in, but a "Verify you are human" CAPTCHA appeared and the login could not be completed.

**Root cause:** Playwright ships its own bundled Chromium. Unlike a real browser installation, this Chromium lacks the full set of browser signals that fingerprinting systems check. Cloudflare Turnstile and similar CAPTCHA systems use JavaScript APIs — `navigator.webdriver`, `navigator.plugins`, canvas fingerprinting, font enumeration, and WebGL renderer strings — to distinguish real user browsers from automated ones. Playwright's bundled Chromium fails enough of these checks that the CAPTCHA is triggered immediately, before any user interaction.

**Fix: switch to real Chrome via `channel: 'chrome'`**

In `scripts/capture-jobsdb-session.mjs`:
```javascript
// Before:
const browser = await chromium.launch({
  headless: false,
  args: ['--no-sandbox'],
});

// After:
const browser = await chromium.launch({
  channel: 'chrome',      // uses /Applications/Google Chrome.app
  headless: false,
  args: [
    '--no-sandbox',
    '--disable-blink-features=AutomationControlled',
  ],
});

// Also added to every new page:
await page.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
});
```

`channel: 'chrome'` tells Playwright to launch the user's installed Google Chrome binary rather than its bundled Chromium. Real Chrome has the complete set of fingerprint signals that real user browsers have — installed plugins, correct GPU renderer strings, real OS font tables — and passes CAPTCHA challenges that Playwright's Chromium fails. The `--disable-blink-features=AutomationControlled` flag hides the CDP automation marker; the `addInitScript` hides `navigator.webdriver`.

**Fallback added:** If Chrome is not installed, the script catches the launch error and falls back to Playwright's bundled Chromium with a warning.

**Result:** 104 cookies captured and uploaded to Apify KV store `8yzXh5w1IZdLjvZv9`.

---

## Issue 2: Route returning "Job search failed"

**Symptom:** Clicking "Find Jobs" in the app returned the error toast "Job search failed. Please try again."

**Diagnosis approach:**
1. Checked `.env.local` — all three Apify keys (`APIFY_TOKEN`, `APIFY_JOBSDB_ACTOR_ID`, `APIFY_SESSION_STORE_ID`) were present
2. Triggered a test actor run directly via REST API to isolate Next.js vs. actor:
   ```
   POST /v2/acts/XzcBowQgpzN8TVhse/runs?waitForFinish=120
   → status: SUCCEEDED, exitCode: 0
   ```
3. Checked the actor's dataset — **0 items returned**
4. Fetched the actor's run log — confirmed 1 request processed (the SEARCH page), no failures, but `[jobsdb-actor] Done. Pushed 0 jobs to dataset.`

The actor was succeeding but returning nothing. The problem was in the scraping logic, not the infrastructure.

---

## Issue 2a: Wrong search URL (404)

**Root cause:** The `SEARCH_URL` function in `apify/jobsdb-hk-actor/src/main.ts` constructed:
```
https://hk.jobsdb.com/hk/search-jobs/software%20engineer/Hong%20Kong
```
This URL returns a 404 page. The correct JobsDB HK URL format changed when Seek acquired the platform — search now lives at `/jobs?q=`.

**Confirmed via local Playwright diagnostic:**
```javascript
await page.goto('https://hk.jobsdb.com/hk/search-jobs/software%20engineer/Hong%20Kong');
// Title: "404 Page Not Found | Jobsdb"
```

**Fix:**
```typescript
// Before:
const SEARCH_URL = (query: string, location: string) => {
  const base = "https://hk.jobsdb.com/hk/search-jobs";
  const q = encodeURIComponent(query);
  const l = location ? `/${encodeURIComponent(location)}` : "";
  return `${base}/${q}${l}`;
};

// After:
const SEARCH_URL = (query: string, location: string) => {
  const params = new URLSearchParams({ q: query });
  if (location) params.set("l", location);
  return `https://hk.jobsdb.com/jobs?${params.toString()}`;
};
```

---

## Issue 2b: Wrong CSS selector for job cards

**Root cause:** The `extractSearchResults` function waited for and queried `[data-automation="jobListing"]`. This selector returned 0 elements on the current JobsDB DOM. Even if the URL had been correct, no job cards would have been found.

**Confirmed via local Playwright diagnostic:**
```javascript
await page.goto('https://hk.jobsdb.com/jobs?q=software+engineer');
// Title: "Jobs in Hong Kong - Jun 2026 | Jobsdb"
// [data-automation="jobListing"]: 0 results
// [data-testid="job-card"]: 30 results
```

The current DOM uses `data-testid` attributes instead of `data-automation` for the card container element. The inner link — `a[data-automation="job-list-view-job-link"]` — kept the `data-automation` pattern and was still correct.

**Fix:**
```typescript
// Before:
await page.waitForSelector('[data-automation="jobListing"]', { timeout: 15000 }).catch(() => {});
const links = await page.evaluate((max: number) => {
  const cards = Array.from(document.querySelectorAll('[data-automation="jobListing"]')).slice(0, max);
  return cards.map((card) => {
    const a = card.querySelector('a[data-automation="job-list-view-job-link"]') as HTMLAnchorElement | null;
    return a?.href ?? "";
  }).filter(Boolean);
}, maxItems);

// After:
await page.waitForSelector('[data-testid="job-card"]', { timeout: 15000 }).catch(() => {});
const links = await page.evaluate((max: number) => {
  const cards = Array.from(document.querySelectorAll('[data-testid="job-card"]')).slice(0, max);
  return cards.map((card) => {
    const a = card.querySelector('a[data-automation="job-list-view-job-link"]') as HTMLAnchorElement | null;
    return a?.href ?? "";
  }).filter(Boolean);
}, maxItems);
```

**Detail page selectors confirmed still correct:**
- `[data-automation="job-detail-title"]` — title ✓
- `[data-automation="advertiser-name"]` — company ✓
- `[data-automation="job-detail-location"]` — location ✓
- `[data-automation="jobAdDetails"]` — description ✓

---

## Issue 2c: Tracking params in job URLs

**Observed:** Job card links include tracking parameters and hash fragments:
```
https://hk.jobsdb.com/job/88338570?type=standard&ref=search-standalone#sol=f5b8a786...
```

**Problem:** The same listing discovered in different search result positions gets different `ref=` values and different `#sol=` hashes. If these are stored as `source_url` in the DB, the deduplication `Set<source_url>` would treat them as different jobs.

**Fix:** Added `canonicalJobUrl()` to strip everything after the path:
```typescript
function canonicalJobUrl(href: string): string {
  try {
    const u = new URL(href);
    return `${u.origin}${u.pathname}`;
  } catch {
    return href;
  }
}
// Applied: return links.map(canonicalJobUrl);
// Result:  https://hk.jobsdb.com/job/88338570
```

---

## Issue 3: TypeScript build error in lib/apify.ts

**Error:**
```
Type error: Object literal may only specify known properties, and 'timeoutSecs' does not exist in type 'ActorCallOptions'.
```

**Root cause:** The installed version of `apify-client` uses `timeout` (not `timeoutSecs`) as the field name in `ActorCallOptions`. The original code used `timeoutSecs` which is the field name on the *response* type `ActorRun`, not the input options.

**Fix:**
```typescript
// Before:
.call(input, { timeoutSecs: 270 });

// After:
.call(input, { timeout: 270 });
```

---

## Diagnostic scripts used

Three one-off `.mjs` scripts were written to inspect the live JobsDB DOM without running a full actor build cycle:

1. **`check-selectors.mjs`** — loaded multiple candidate search URLs, checked title for 404, tested 9 selector patterns
2. **`check-selectors2.mjs`** — tried 5 SEEK-style URL formats, found `/jobs?q=` works, confirmed `[data-testid="job-card"]` returns 30 results
3. **`check-detail.mjs`** — loaded a real job detail page, tested all `[data-automation]` and `[data-testid]` selectors, printed all attribute values present on the page

These were written to the scratchpad directory and are not committed to the repo.

---

## Final state after session

| Item | Before | After |
|------|--------|-------|
| Session capture browser | Playwright Chromium → CAPTCHA | Real Chrome via `channel: 'chrome'` |
| Cookies captured | 68 (partial, from earlier workaround) | 104 |
| Actor build | 0.1.3 | 0.1.4 |
| Search URL | `/hk/search-jobs/{q}/{l}` (404) | `/jobs?q={q}&l={l}` |
| Card selector | `[data-automation="jobListing"]` (0 hits) | `[data-testid="job-card"]` (30 hits) |
| Job URL in dataset | With tracking params | Canonical (`/job/{id}` only) |
| TS build error | `timeoutSecs` unknown property | Fixed to `timeout` |
| Test run result | 0 jobs in dataset | 5 jobs in dataset |
| `npm run build` | Failing | Clean |
