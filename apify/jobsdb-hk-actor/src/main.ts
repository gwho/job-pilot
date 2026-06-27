import { Actor } from "apify";
import { PlaywrightCrawler, Dataset } from "crawlee";
import type { Page } from "playwright";

// ─── Types ───────────────────────────────────────────────────────────────────

type Input = {
  query: string;
  location?: string;
  maxItems?: number;
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

// The developer captures a logged-in JobsDB session as Playwright storageState
// and stores it in the shared KV store (APIFY_SESSION_STORE_ID). This store
// persists across all actor runs — unlike the default per-run KV store.
// JobPilot never touches these credentials.
async function loadStorageState(): Promise<object | null> {
  const storeId = process.env.APIFY_SESSION_STORE_ID;
  const store = storeId
    ? await Actor.openKeyValueStore(storeId)
    : await Actor.openKeyValueStore(); // fallback to per-run default
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

// ─── Selectors ───────────────────────────────────────────────────────────────
// These target the JobsDB HK DOM as of the actor's initial release.
// Inspect https://hk.jobsdb.com after login to verify before deploying.

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

      // The "Apply" button typically links to the employer's site.
      const applyBtn = document.querySelector(
        '[data-automation="job-detail-apply-button"] a',
      ) as HTMLAnchorElement | null;
      const externalApplyUrl = applyBtn?.href ?? url;

      return { title, company, location, salary, jobType, description, sourceUrl: url, externalApplyUrl, postedAt };
    }, sourceUrl);
  } catch (err) {
    console.warn(`[jobsdb-actor] Failed to extract detail for ${sourceUrl}:`, err);
    // Return search-result-level placeholder so we don't lose the listing.
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
const { query, location = "", maxItems = 10 } = input;

if (!query) {
  throw new Error("[jobsdb-actor] Input 'query' is required.");
}

const storageState = await loadStorageState();

const searchUrl = SEARCH_URL(query, location);
const detailUrls: string[] = [];
const results: JobResult[] = [];

const crawler = new PlaywrightCrawler({
  // Apply the authenticated session to the browser context.
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
  maxRequestsPerCrawl: maxItems + 1, // 1 search page + up to maxItems detail pages
  async requestHandler({ request, page, enqueueLinks }) {
    if (request.label === "SEARCH") {
      const links = await extractSearchResults(page, maxItems);
      detailUrls.push(...links);
      await enqueueLinks({ urls: links, label: "DETAIL" });
    } else if (request.label === "DETAIL") {
      const result = await extractJobDetail(page, request.url);
      if (result) {
        results.push(result);
        await Dataset.pushData(result);
      }
    }
  },
  failedRequestHandler({ request, error }) {
    console.warn(`[jobsdb-actor] Request failed: ${request.url}`, error);
  },
});

await crawler.run([{ url: searchUrl, label: "SEARCH" }]);

console.log(`[jobsdb-actor] Done. Pushed ${results.length} jobs to dataset.`);

await Actor.exit();
