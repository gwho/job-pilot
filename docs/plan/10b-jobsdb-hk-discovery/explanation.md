# Explanation — Feature 10b-jobsdb-hk-discovery: JobsDB HK Job Discovery

---

## 1. Why this feature exists and the end-to-end data flow

Adzuna was chosen for Feature 10 because it offers a clean REST API with no authentication needed, good global coverage, and a structured response. The problem is Adzuna's Hong Kong coverage is thin — fewer listings, less frequent updates, and critically, descriptions are always search snippets (a few hundred characters). Nemotron's matching quality is proportional to description depth: a snippet gives vague matchReason and imprecise skills arrays; a full description gives actionable analysis. JobsDB Hong Kong is the dominant local job board (owned by SEEK), publishes full descriptions, salary ranges, and structured requirements, and is accessible by authenticated Playwright session.

The end-to-end flow for a single search:

1. User fills "Job title or keywords" + "Location" in `SearchControls` and clicks Find Jobs
2. `FindJobsClient.handleSearch()` POSTs `{ jobTitle, location }` to `/api/agent/find`
3. The route authenticates, creates an `agent_runs` row (`status: 'running'`), fires `job_search_started`
4. `discoverJobsDbJobs(jobTitle, location, 10)` in `agent/jobsdb.ts` calls `runJobsDbActor()` in `lib/apify.ts`
5. `runJobsDbActor` uses `apify-client` to call `client.actor(APIFY_JOBSDB_ACTOR_ID).call(input, { timeoutSecs: 270 })` — this blocks until the remote actor run finishes on Apify's cloud
6. The actor (running on Apify's servers): loads `JOBSDB_SESSION` from Apify KV store, opens `https://hk.jobsdb.com/hk/search-jobs/{query}`, extracts up to 10 detail page URLs, navigates each, pushes full `JobResult` to dataset
7. `runJobsDbActor` reads the dataset via `client.dataset(run.defaultDatasetId!).listItems()` and returns the items
8. `agent/jobsdb.ts` normalizes the items (missing fields → `null`/`""`)
9. Route deduplicates against existing DB rows for this user + `source_provider='jobsdb_hk'`, and within the batch
10. `scoreJobs(newJobs.map(toScoringInput), profile)` sends all new jobs in one Nemotron call, returns `JobScore[]`
11. Route builds `JobInsert[]` records with `source_provider: 'jobsdb_hk'` and bulk-inserts via InsForge
12. `agent_runs` row updated to `status: 'completed'`, `jobs_found: newCount`
13. Response returns `{ jobs: insertedJobs, jobsFound: totalFound, newJobs: newCount, strongMatches, successMessage }`
14. `FindJobsClient.handleSearch` receives the response and calls `setJobs(res.jobs)` — no reload needed

---

## 2. The two Apify surfaces and why they cannot be mixed

There are two distinct Apify surfaces in use and they must never be confused:

**Consumer surface (development/tooling):** The installed `/apify-ultimate-scraper` skill and the `apify` CLI. These are designed for interactive terminal use — they write auth tokens to `~/.apify/auth.json`, output progress to stderr, and assume a human is watching. Running the CLI as a subprocess inside a Next.js route handler would require spawning a child process, parsing its stdout while suppressing stderr, managing process lifecycle inside a serverless function, and re-authenticating on every invocation. None of that is appropriate in a production API route.

**Runtime surface (production):** The `apify-client` npm SDK in `lib/apify.ts`. This is a pure HTTP wrapper around the same Apify REST API — no filesystem writes, no global config, initialized with a single env var, returns typed Promises. `client.actor(id).call(input, options)` starts the run and polls until completion, then `client.dataset(id).listItems()` reads the results. The SDK belongs in `lib/` alongside other third-party clients like `lib/insforge-server.ts` and `lib/adzuna.ts`.

The `apify` CLI is used at development time only: `apify login` to authenticate, `apify create` to scaffold the actor, `apify run` to test locally, `apify push` to deploy. Once deployed, only the SDK is used.

---

## 3. Why `ScoringInput` replaces `AdzunaJob` in the scorer — and the type error it produced

Before Feature 10b, `agent/job-matcher.ts` imported `AdzunaJob` from `lib/adzuna.ts` and typed its `jobs` parameter as `AdzunaJob[]`. This worked only because the scorer happened to call `buildJobsList` which happened to only read `title`, `company.display_name`, `location.display_name`, and `description` — the rest of `AdzunaJob` (id, salary_min, salary_max, redirect_url, created, etc.) was ignored. The Adzuna type was on the argument purely by accident of the first implementation.

The moment a second source (JobsDB) needed to go through the same scorer, the problem became visible: JobsDB output uses flat `company: string`, not nested `company: { display_name: string }`. If we had kept `AdzunaJob[]` as the type, `agent/jobsdb.ts` would have had to manufacture fake `AdzunaJob` objects with artificial `.display_name` nesting — a backwards leak of the Adzuna type into an unrelated adapter.

The fix was to export `ScoringInput = { title: string; company: string; location: string; description: string }` from `job-matcher.ts` and change `scoreJobs` to accept `ScoringInput[]`. The `buildJobsList` internal function was updated to use `job.company` and `job.location` (flat) instead of `.display_name` (nested). This produced two immediate TypeScript errors at the call site inside `buildJobsList` (it still referenced `AdzunaJob` after the type was removed) — caught by the IDE diagnostics hook at lines 68 and 86. Both were fixed by the same edit that changed the function signature.

The Adzuna-specific adapter `lib/adzuna.ts` is unchanged — `AdzunaJob` still exists there. Any future code that calls `searchJobs` and then needs to score would call `.map(j => ({ title: j.title, company: j.company.display_name, ... }))` before passing to `scoreJobs`. The scorer is now source-agnostic.

---

## 4. The `source` vs `source_provider` column split

The `jobs` table already had `source: 'search' | 'url'`. This tracks *how a job entered the app*, not *which external system produced it*. Before Feature 10b, these were effectively the same thing (only Adzuna existed as a search provider), so `source = 'search'` implicitly meant Adzuna. With two providers, the implicit assumption breaks.

`source_provider` was added as a separate `text` column to track which provider produced a row. The two axes are orthogonal: a job added by pasting a URL from JobsDB would be `source: 'url', source_provider: 'jobsdb_hk'`. A future LinkedIn scraper would be `source: 'search', source_provider: 'linkedin_hk'`. Collapsing them into a single field like `source: 'jobsdb_search'` would lose the ability to filter "all user-added URLs regardless of provider."

The column was added nullable (`text`, no `NOT NULL`) to allow a clean migration without requiring a default on existing rows. But rather than leaving existing rows as `NULL` (which would silently break `GROUP BY source_provider` queries — SQL aggregates ignore NULLs), the migration immediately backfilled all existing rows to `'adzuna'`. The TypeScript type `JobProvider = 'adzuna' | 'jobsdb_hk'` enforces the known values at compile time, though the DB column is freeform text — a future enum constraint could add DB-level enforcement.

---

## 5. Authenticated session design: why Apify KV store, not `.env.local`

The problem with storing a Playwright `storageState` JSON in `.env.local` has two dimensions. First, the blob is functionally equivalent to a password — it contains session cookies that authenticate the user on JobsDB. Storing it in `.env.local` means it lives on the developer's filesystem and would be included in any accidental `git add -A` of dotfiles. Second, the blob is several kilobytes, making it unwieldy as an environment variable.

The design stores the session on the Apify side as a KV store record under the key `JOBSDB_SESSION`. The actor reads it at runtime via `Actor.getValue('JOBSDB_SESSION')` before any navigation happens. The value never appears in the Next.js codebase, `.env.local`, InsForge DB, or Apify actor *input* (which is passed per-run and could be logged). Apify's KV store has access control scoped to the actor's project.

Session expiry is a reality: JobsDB sessions last days to weeks. The actor handles it by checking `page.url()` after navigating to the search page — a redirect to `/login` or `/sign-in` means the session is expired. In that case, the actor emits a warning log and returns an empty result rather than throwing or returning scraped login-page content as "jobs." The route receives an empty array, deduplication runs against nothing, no records are inserted, and the run completes with `jobs_found: 0`. The user sees `Found 0 jobs...` which is the correct signal that re-capture is needed.

---

## 6. The two-pass deduplication design

Deduplication runs in two passes before insert:

**Pass 1 (DB):** Query `jobs` for `(user_id, source_provider='jobsdb_hk').source_url`. Build a `Set<string>` of existing URLs. This handles the case where the same listing appears in a repeat search.

**Pass 2 (batch):** Maintain a second `Set<string>` (`seenInBatch`) populated as each incoming job is evaluated. This handles the case where the same listing appears twice in the actor's own output — possible if a listing appears on multiple result pages, or if two keyword variations return the same result.

Both passes use the canonical `sourceUrl` as the deduplication key. URL-based dedup was chosen over title+company fuzzy matching for simplicity and precision: the same listing at `https://hk.jobsdb.com/job/12345` always has the same URL regardless of how the title is formatted.

A notable edge case handled explicitly: if `records.length === 0` after dedup (all discovered jobs already in DB), the route returns early with a success response and an empty `jobs` array rather than attempting an empty `.insert()` call. The `agent_runs` row is still marked `completed` with `jobs_found: 0`, and the client receives `successMessage: 'Found X jobs — all already saved.'` where X is `jobsDbJobs.length` (the actual count from the actor), so the user knows the search ran successfully.

---

## 7. The `maxDuration` constraint and deployment reality

`export const maxDuration = 300` at the top of the route file tells Next.js (and Vercel's edge network) the maximum seconds this route handler is allowed to run. The 10-job scrape timeline is:
- Actor cold start on Apify: ~5–15s
- Loading `JOBSDB_SESSION` from KV: ~1s
- Search result page navigation and extraction: ~5–10s
- 10 detail page navigations: ~5–10s each = 50–100s
- `apify-client` blocking + dataset read overhead: ~2–5s
- **Realistic total: 60–130s**

At 270 seconds (`timeoutSecs: 270` in `lib/apify.ts`), the actor call itself will time out before the Next.js route's 300s limit — this ordering is intentional so the route can receive a failure from the SDK and return a 500 rather than the route being killed mid-execution with no chance to mark the run failed.

On Vercel Hobby, the maximum `maxDuration` is 60 seconds — which is likely to time out on a cold actor start + 10 detail pages. The comment in the route records this. Before deploying to Hobby, either: (a) upgrade to Vercel Pro, (b) reduce `maxItems` to 3–5 jobs, or (c) implement the v2 background-run + polling model. The `maxDuration` value was deliberately not put in an env var because it's a static export read at build time by the framework — it cannot be dynamic.

---

## 8. Actor structure and the `JOBSDB_SESSION` loading mechanism

The custom actor in `apify/jobsdb-hk-actor/` follows the official Apify actor directory structure: `.actor/actor.json` (spec), `.actor/input_schema.json` (typed inputs), `src/main.ts` (entrypoint), `Dockerfile` (uses the official `apify/actor-node-playwright-chrome:20` base image which includes Node 20, Playwright, and Chromium).

The session loading in `src/main.ts` uses `Actor.getValue('JOBSDB_SESSION')` which reads from the actor's default KV store. The return type from `Actor.getValue` is `object | null` — if the stored value is a JSON string (how most KV entries are stored), it must be `JSON.parse`d before use. If it's already a parsed object (Apify stores it as JSON internally), it's used as-is. The `try/catch` around `JSON.parse` ensures a malformed session doesn't crash the actor — it warns and proceeds without auth.

The session is applied to Playwright via `page.context().addCookies(storageState.cookies)` in a `preNavigationHooks` array. This runs before every page navigation, so every request in the crawler — both search pages and detail pages — is authenticated. An alternative would be to create the browser context with `{ storageState }` directly, but `PlaywrightCrawler` manages its own browser pool and context creation, so the hooks approach is the correct integration point.

DOM selectors use `[data-automation="*"]` attributes rather than CSS classes. `data-automation` attributes are typically added for test automation and are more stable than class names (which change with CSS refactors). They were chosen speculatively based on SEEK's documented automation attribute convention — they must be verified against the live JobsDB HK DOM before the first deploy.
