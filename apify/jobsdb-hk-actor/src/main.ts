import { Actor } from "apify";
import { PlaywrightCrawler, Dataset } from "crawlee";
import type { Page } from "playwright";

import { canonicalJobUrl, jobsDbSearchUrl } from "./urls.js";
import { classifySearchPage, shouldFailRun, type SearchOutcome } from "./search-outcome.js";

// ─── Types ───────────────────────────────────────────────────────────────────

type Input = {
  query: string;
  location?: string;
  maxItems?: number;
  maxPages?: number;
};

type JobResult = {
  title: string;
  company: string;
  location: string;
  salary: string | null;
  jobType: string | null;
  description: string;
  sourceUrl: string;
  externalApplyUrl: string | null;
  postedAt: string | null;
};

// ─── Session loading ──────────────────────────────────────────────────────────

async function loadStorageState(): Promise<object | null> {
  const storeId = process.env.APIFY_SESSION_STORE_ID;
  const store = storeId
    ? await Actor.openKeyValueStore(storeId)
    : await Actor.openKeyValueStore();
  const raw = await store.getValue("JOBSDB_SESSION");
  if (!raw) {
    console.warn(
      "[jobsdb-actor] JOBSDB_SESSION not found in KV store — proceeding without auth. Results may be degraded.",
    );
    return null;
  }
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const cookies = (parsed as { cookies?: unknown[] }).cookies ?? [];
    console.log(
      `[jobsdb-actor] Session loaded: ${cookies.length} cookies (store: ${storeId ?? "default"}).`,
    );
    return parsed;
  } catch {
    console.warn("[jobsdb-actor] JOBSDB_SESSION is not valid JSON — proceeding without auth.");
    return null;
  }
}

// ─── Search page extraction ───────────────────────────────────────────────────

type ExtractResult = { links: string[]; outcome: SearchOutcome };

async function extractCardLinks(page: Page): Promise<ExtractResult> {
  const url = page.url();

  // Login redirect check — authoritative block signal.
  if (url.includes("/login") || url.includes("/sign-in")) {
    console.warn("[jobsdb-actor] Redirected to login — session may be expired. Re-capture storageState.");
    return { links: [], outcome: "login-redirect" };
  }

  // Race: resolve as soon as any meaningful DOM signal appears (or on timeout).
  await Promise.race([
    page.waitForSelector('[data-testid="job-card"]', { timeout: 15000 }),
    page.waitForSelector('[data-automation="searchZeroResults"]', { timeout: 15000 }),
    page.waitForURL("**/login**", { timeout: 15000 }),
    page.waitForURL("**/sign-in**", { timeout: 15000 }),
  ]).catch(() => {});

  const initialCardCount = (await page.$$('[data-testid="job-card"]')).length;

  if (initialCardCount > 0) {
    // Scroll to trigger lazy-loaded cards, then re-query.
    await page.evaluate(() => {
      const container =
        (document.querySelector('[data-automation="sortedJobsList"]') as HTMLElement | null) ??
        (document.querySelector('[data-testid="job-list"]') as HTMLElement | null) ??
        document.documentElement;
      container.scrollTo(0, container.scrollHeight);
    });
    await page.waitForTimeout(800);

    const rawLinks = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-testid="job-card"]'));
      return cards
        .map((card) => {
          const a = card.querySelector('a[data-automation="job-list-view-job-link"]') as HTMLAnchorElement | null;
          return a?.href ?? "";
        })
        .filter(Boolean);
    });

    return { links: rawLinks, outcome: "ok" };
  }

  // Zero cards — collect diagnostics before classifying.
  const diagUrl = page.url();
  const diagTitle = await page.title().catch(() => "");
  const diagEmptyState = await page
    .locator('[data-automation="searchZeroResults"]')
    .isVisible()
    .catch(() => false);
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

  if (outcome === "suspicious-empty") {
    const store = await Actor.openKeyValueStore();
    const runId = Actor.getEnv().actorRunId ?? "unknown";
    const buf = await page.screenshot({ fullPage: false }).catch(() => null);
    if (buf) {
      await store.setValue(`diagnostics/${runId}/suspicious-empty.png`, buf, {
        contentType: "image/png",
      });
      console.log(`[jobsdb-actor] Screenshot saved to diagnostics/${runId}/suspicious-empty.png`);
    }
  }

  return { links: [], outcome };
}

// ─── Detail page extraction ───────────────────────────────────────────────────

async function extractJobDetail(page: Page, sourceUrl: string): Promise<JobResult | null> {
  try {
    await page.waitForSelector('[data-automation="jobAdDetails"]', { timeout: 15000 });

    return await page.evaluate((url: string) => {
      const text = (sel: string) =>
        (document.querySelector(sel) as HTMLElement | null)?.innerText?.trim() ?? "";

      const title = text('[data-automation="job-detail-title"]');
      const company = text('[data-automation="advertiser-name"]');
      const location = text('[data-automation="job-detail-location"]');
      const salary = text('[data-automation="job-detail-salary"]') || null;
      const jobType = text('[data-automation="job-detail-work-type"]') || null;
      const postedAt = text('[data-automation="job-detail-date"]') || null;
      const description = text('[data-automation="jobAdDetails"]');

      const applyBtn = document.querySelector(
        '[data-automation="job-detail-apply-button"] a',
      ) as HTMLAnchorElement | null;
      const externalApplyUrl = applyBtn?.href ?? url;

      return { title, company, location, salary, jobType, description, sourceUrl: url, externalApplyUrl, postedAt };
    }, sourceUrl);
  } catch (err) {
    console.warn(`[jobsdb-actor] Failed to extract detail for ${sourceUrl}:`, err);
    return {
      title: "",
      company: "",
      location: "",
      salary: null,
      jobType: null,
      description: "",
      sourceUrl,
      externalApplyUrl: sourceUrl,
      postedAt: null,
    };
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

await Actor.init();

const input = (await Actor.getInput<Input>()) ?? { query: "" };
const { query, location = "", maxItems = 10, maxPages = 1 } = input;

if (!query) {
  throw new Error("[jobsdb-actor] Input 'query' is required.");
}

const storageState = await loadStorageState();

const seenUrls = new Set<string>();
let jobsPushed = 0;
// Outcome of the page-1 SEARCH request — used to decide whether to fail the run.
let page1Outcome: SearchOutcome = "ok";
let page1HttpStatus = "unknown";

const crawler = new PlaywrightCrawler({
  browserPoolOptions: {
    useFingerprints: false,
  },
  preNavigationHooks: [
    async ({ page }) => {
      if (storageState) {
        const cookies = (storageState as { cookies?: unknown[] }).cookies ?? [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await page.context().addCookies(cookies as any[]);
      }
    },
  ],
  maxRequestsPerCrawl: maxPages + maxItems,
  async requestHandler({ request, page, enqueueLinks, addRequests }) {
    if (request.label === "SEARCH") {
      const currentPage = (request.userData as { page?: number }).page ?? 1;
      const { links: rawLinks, outcome } = await extractCardLinks(page);

      if (currentPage === 1) {
        page1Outcome = outcome;
      }

      // Stop enqueueing if the search page yielded no cards.
      if (rawLinks.length === 0) {
        console.log(
          `[jobsdb-actor] Page ${currentPage}: 0 cards found (outcome: ${outcome}). Stopping pagination.`,
        );
        return;
      }

      const newLinks: string[] = [];
      for (const href of rawLinks) {
        if (seenUrls.size >= maxItems) break;
        const canonical = canonicalJobUrl(href);
        if (canonical && !seenUrls.has(canonical)) {
          seenUrls.add(canonical);
          newLinks.push(canonical);
        }
      }

      console.log(
        `[jobsdb-actor] Page ${currentPage}: ${rawLinks.length} cards found, ` +
        `${newLinks.length} new unique links (${seenUrls.size}/${maxItems} total).`,
      );

      await enqueueLinks({ urls: newLinks, label: "DETAIL" });

      if (currentPage < maxPages && seenUrls.size < maxItems) {
        await addRequests([
          {
            url: jobsDbSearchUrl(query, location, currentPage + 1),
            label: "SEARCH",
            userData: { page: currentPage + 1 },
          },
        ]);
      }
    } else if (request.label === "DETAIL") {
      const result = await extractJobDetail(page, request.url);
      if (result) {
        await Dataset.pushData(result);
        jobsPushed++;
      }
    }
  },
  failedRequestHandler({ request, error }) {
    const statusMatch = (error as Error).message?.match(/\b(\d{3})\b/);
    const httpStatus = statusMatch?.[1] ?? "unknown";
    console.warn(
      `[jobsdb-actor][diag] Request failed: url=${request.url} | label=${request.label} | page=${(request.userData as { page?: number }).page ?? 1} | httpStatus=${httpStatus} | error=${(error as Error).message}`,
    );
    if (request.label === "SEARCH" && (request.userData as { page?: number }).page === 1) {
      page1Outcome = "blocked-http";
      page1HttpStatus = httpStatus;
    }
  },
});

await crawler.run([
  { url: jobsDbSearchUrl(query, location, 1), label: "SEARCH", userData: { page: 1 } },
]);

console.log(`[jobsdb-actor] Done. Pushed ${jobsPushed} jobs across up to ${maxPages} page(s).`);

if (shouldFailRun({ page1Outcome, jobsPushed })) {
  let failMessage: string;
  if ((page1Outcome as SearchOutcome) === "blocked-http") {
    failMessage = `Search request blocked at HTTP level (status ${page1HttpStatus}) — page never loaded, no jobs discovered.`;
  } else {
    failMessage = `Search page loaded but returned no recognisable content (outcome: ${page1Outcome}) — no jobs discovered. Check diagnostics KV store for screenshot.`;
  }
  await Actor.fail(failMessage);
} else {
  await Actor.exit();
}
