import { Actor } from "apify";
import { PlaywrightCrawler, Dataset } from "crawlee";
import type { Page } from "playwright";

import { canonicalJobUrl, jobsDbSearchUrl } from "./urls.js";

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
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    console.warn("[jobsdb-actor] JOBSDB_SESSION is not valid JSON — proceeding without auth.");
    return null;
  }
}

// ─── Search page extraction ───────────────────────────────────────────────────

async function extractCardLinks(page: Page): Promise<string[]> {
  // Detect session expiry.
  const url = page.url();
  if (url.includes("/login") || url.includes("/sign-in")) {
    console.warn("[jobsdb-actor] Redirected to login — session may be expired. Re-capture storageState.");
    return [];
  }

  await page.waitForSelector('[data-testid="job-card"]', { timeout: 15000 }).catch(() => {});

  // Scroll the job-card list container to its bottom so lazy-loaded cards
  // are rendered before we query the DOM. JobsDB uses a split-screen layout
  // where the left panel scrolls independently from the right detail panel.
  await page.evaluate(() => {
    const container =
      (document.querySelector('[data-automation="sortedJobsList"]') as HTMLElement | null) ??
      (document.querySelector('[data-testid="job-list"]') as HTMLElement | null) ??
      document.documentElement;
    container.scrollTo(0, container.scrollHeight);
  });
  // Give the browser a moment to render any newly visible cards.
  await page.waitForTimeout(800);

  // Collect ALL card links — no slice here. Dedup happens in the caller
  // using the shared seenUrls set, so we always consider every card on the page.
  const rawLinks = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[data-testid="job-card"]'));
    return cards
      .map((card) => {
        const a = card.querySelector('a[data-automation="job-list-view-job-link"]') as HTMLAnchorElement | null;
        return a?.href ?? "";
      })
      .filter(Boolean);
  });

  return rawLinks;
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

// Shared dedup set: canonical URLs already enqueued for detail scraping.
// Populated only in SEARCH handlers (which run sequentially — each page is
// only enqueued after the previous page's handler has finished).
const seenUrls = new Set<string>();
// Counter incremented in DETAIL handler — reliable across Apify's ESM closure context.
let jobsPushed = 0;

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
  // maxPages search-result pages + maxItems detail pages.
  maxRequestsPerCrawl: maxPages + maxItems,
  async requestHandler({ request, page, enqueueLinks, addRequests }) {
    if (request.label === "SEARCH") {
      const currentPage = (request.userData as { page?: number }).page ?? 1;
      const rawLinks = await extractCardLinks(page);

      // Canonicalize and deduplicate across all pages seen so far.
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

      // Enqueue the next search-result page if there is more budget.
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
    console.warn(`[jobsdb-actor] Request failed: ${request.url}`, error);
  },
});

await crawler.run([
  { url: jobsDbSearchUrl(query, location, 1), label: "SEARCH", userData: { page: 1 } },
]);

console.log(`[jobsdb-actor] Done. Pushed ${jobsPushed} jobs across up to ${maxPages} page(s).`);

await Actor.exit();
