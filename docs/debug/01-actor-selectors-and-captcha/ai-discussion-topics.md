# AI Discussion Topics — Debug Session 01: Actor Selectors, CAPTCHA, and Deployment Failures

---

## Group 1: Browser fingerprinting and CAPTCHA bypass

1. Playwright's Chromium in non-headless mode still triggers Cloudflare CAPTCHA. Why does "visible window" not equal "real browser" from a CAPTCHA system's perspective? What specific browser APIs does Cloudflare's TrustToken/Turnstile check that Playwright fails?

2. `--disable-blink-features=AutomationControlled` removes the CDP automation marker. But Cloudflare uses many signals, not just one. If a browser passes `navigator.webdriver === undefined` but has an empty `navigator.plugins` list, does it pass the CAPTCHA? What does this tell you about the multi-factor nature of bot detection?

3. The fix uses `channel: 'chrome'` to launch the user's installed Chrome. What happens if the user's Chrome is signed into Google with the same account being used for JobsDB login — does that session context carry over into Playwright's new browser context? Is this a privacy concern or a benefit?

4. `addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }))` runs before any page script. Why must this be an `addInitScript` rather than a `page.evaluate()` call after navigation? What is the execution order, and why does it matter for detection?

5. The session capture script now runs locally (developer's machine, real Chrome) but the actor runs on Apify (Chromium, no real Chrome). The Apify actor uses the captured session cookies, so it avoids the login CAPTCHA — but could it still trigger CAPTCHA during job scraping? Why or why not?

---

## Group 2: URL format and the "silent 404" failure mode

6. The actor returned `status: SUCCEEDED, exitCode: 0` even though it scraped a 404 page and found zero jobs. What does this reveal about how Crawlee/Playwright defines "success"? At what level should an actor validate that it scraped a real results page, not an error page?

7. The `waitForSelector('[data-testid="job-card"]', { timeout: 15000 }).catch(() => {})` pattern silently swallows a timeout. In what scenarios is this the right pattern vs. the wrong pattern? What would a better approach look like that distinguishes "selector not found because page is still loading" from "selector not found because this is the wrong page"?

8. The old URL was `/hk/search-jobs/{query}/{location}` (path segments). The new URL is `/jobs?q={query}&l={location}` (query string). Why do web apps migrate between these URL formats? What are the SEO, caching, and routing differences between path-segment URLs and query-string URLs?

9. The `URLSearchParams` constructor encodes query parameters correctly. Why is `new URLSearchParams({ q: query })` safer than manually constructing `?q=${encodeURIComponent(query)}`? What edge case does `URLSearchParams` handle that manual encoding might miss?

---

## Group 3: CSS selector stability and DOM inspection

10. The card container changed from `[data-automation="jobListing"]` to `[data-testid="job-card"]`, but the inner link kept `[data-automation="job-list-view-job-link"]`. What does this pattern suggest about which part of a component's DOM a frontend team considers "stable" vs. "implementation detail"? What attribute naming convention would be most stable for a long-lived scraper?

11. The diagnostic script used `document.querySelectorAll('[data-testid]').map(el => el.getAttribute('data-testid'))` to discover all testid values on the page. Why is this approach faster than reading the page's JavaScript source or inspecting the React component tree? What are its limitations?

12. The session ran three separate diagnostic scripts (`check-selectors.mjs`, `check-selectors2.mjs`, `check-detail.mjs`) rather than one comprehensive script. Why is iterating with small scripts faster than trying to write a complete diagnostic upfront? What is the risk of spending too long on a comprehensive diagnostic before making a fix?

13. The detail page selectors (`[data-automation="job-detail-title"]`, `[data-automation="advertiser-name"]`, etc.) survived the redesign unchanged. The search result selectors didn't. Why might a company be more careful about stability of detail page selectors than search result selectors? (Think about what each page type is used for.)

---

## Group 4: URL canonicalization and deduplication correctness

14. The tracking hash `#sol=f5b8a7861cac...` is a fragment identifier. Fragment identifiers are never sent to the server — they are client-side only. So why would two URLs with different `#sol=` values load the same server content? Does stripping the fragment affect what the server returns?

15. The `ref=search-standalone` query parameter IS sent to the server. Would keeping this parameter in the stored `source_url` break anything besides deduplication? Would the detail page display differently with vs. without `?ref=search-standalone`?

16. `canonicalJobUrl` uses `new URL(href)` and returns `${u.origin}${u.pathname}`. Why use `URL` rather than a regex like `/^(https:\/\/[^?#]+)/`? Walk through a case where a regex would fail but `URL` succeeds.

17. The canonical URL form (`https://hk.jobsdb.com/job/88338570`) is also the URL shown to users in the "View job" button. Why is using a canonical URL in the UI preferable to using the original `href` with tracking params? What are the privacy and UX implications?

---

## Group 5: Diagnosing remote actor failures

18. The first diagnostic step was a direct REST API call to the actor, bypassing the Next.js route entirely. Walk through why this isolation step was critical. What would you have been unable to determine if you had only tested through the Next.js UI?

19. The actor run log showed `requestsFinished: 1, requestsFailed: 0`. If `requestsFailed` had been 1 instead, what would that have told you? What if `requestsFinished` had been 0?

20. Apify run logs are available after the run completes. But a running actor can also stream logs in real time via WebSocket. When would real-time log streaming be valuable that post-run log inspection wouldn't cover?

21. The TypeScript error `timeoutSecs does not exist in type 'ActorCallOptions'` was only caught during `npm run build`, not during `npm run dev`. Why do some type errors only appear at build time? What does this tell you about the difference between Turbopack's dev mode type checking and the production build's TypeScript checker?

---

## Group 6: Selector maintenance strategy

22. The selectors in `main.ts` have a comment: "These target the JobsDB HK DOM as of the actor's initial release. Inspect https://hk.jobsdb.com after login to verify before deploying." What would a more proactive maintenance strategy look like — one that detects selector breakage before users report it?

23. If you wanted the actor to detect selector failure at runtime and return a useful error rather than an empty dataset, where in the code would you add that check? What would the error message say, and how would it reach the developer?

24. `data-testid` attributes are typically added by frontend developers to support their own automated testing. What does this tell you about the implicit contract between a site's frontend team and external scrapers who target `data-testid` selectors? Is this a "stable" interface in any meaningful sense?
