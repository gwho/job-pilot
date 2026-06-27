# AI Discussion Topics — Feature 10b: JobsDB HK Job Discovery

---

## Group 1: Apify platform fundamentals

1. What is the difference between the Apify consumer surface (Store actors, CLI `actors call`) and the builder surface (Crawlee, `apify create`, `apify push`)? When does a project need both, and which should it reach for first?

2. Why is `apify-client` (npm SDK) used at runtime in `lib/apify.ts` instead of spawning the `apify` CLI as a subprocess? What are the specific failure modes of the subprocess approach in a serverless environment?

3. The Apify Store has 4,000+ actors. How would you evaluate whether a community actor is trustworthy enough to depend on in a production system? What signals suggest an actor is maintained vs. abandoned?

4. `client.actor(id).call(input)` is a blocking call — it waits until the actor run finishes. What happens on the Apify side during that wait? Is the Next.js server consuming CPU while the actor runs?

5. Why does the plan use `run.defaultDatasetId` to read results rather than a webhook or callback URL? What would need to change in the architecture to use webhooks instead?

---

## Group 2: Playwright storageState and authenticated scraping

6. What exactly is in a Playwright `storageState` JSON blob? What data does it capture, and why is it functionally equivalent to a password?

7. The plan stores the storageState on Apify's side (KV store or Secret), not in `.env.local`. Why isn't an Apify Secret equivalent to putting the credential in `.env.local` from a security perspective?

8. How would the actor detect that its session has expired (e.g., JobsDB has logged it out between runs)? What should it return in that case — empty results, an error, or a partial result with a warning?

9. What is the process for re-capturing a Playwright storageState when a session expires? Walk through the manual steps a developer would take to export cookies from a live browser session.

10. The spec says "only access authenticated pages that the user can view normally after login." What distinguishes scraping authenticated pages from bypassing access controls? Where is that line, and who defines it?

---

## Group 3: Data model design — `source` vs. `source_provider`

11. `source` tracks *how* a job entered the app; `source_provider` tracks *which external system* produced it. These are orthogonal. What SQL queries become impossible or fragile if you collapse them into a single field like `source: 'jobsdb_search'`?

12. Why does backfilling existing Adzuna rows to `'adzuna'` matter more than it appears to? Give a specific example of a query that would silently return wrong results if existing rows stayed `NULL`.

13. `JobProvider = 'adzuna' | 'jobsdb_hk'` is a TypeScript union, but the DB column is `text`. What enforces the type constraint at the database level? What breaks if a future developer writes `source_provider = 'ADZUNA'` (wrong casing) directly in SQL?

14. The plan uses `(user_id, source_provider, source_url)` as the deduplication key instead of a DB unique constraint. What are the tradeoffs? When would you add the unique constraint instead?

---

## Group 4: Scoring pipeline generalization

15. `ScoringInput = { title, company, location, description }` replaces `AdzunaJob[]` in `scoreJobs`. Why is a narrower type preferable here even though `AdzunaJob` technically works?

16. The Nemotron prompt for scoring only uses four fields per job: title, company, location, description. But a JobsDB full description might be 10× longer than an Adzuna snippet. Does longer input improve scoring quality, or does it introduce noise? What would you test to find out?

17. The batch scoring call sends all 10 jobs in one Nemotron request. What is the `max_tokens` setting for this call (check `context/library-docs.md`)? Is `max_tokens: 300` (documented) or `2000` (actual code) correct for full descriptions? How would you decide?

18. The index-drift guard in `job-matcher.ts` falls back to `matchScore: 0` if the model returns fewer scores than jobs. With JobsDB full descriptions, Nemotron has more context — could this actually *increase* the chance of a malformed response by pushing the response length over the model's output limit?

---

## Group 5: Route handler design

19. `export const maxDuration = 300` sets the route's wall-clock timeout. On Vercel Hobby the max is 60s; on Pro it's 300s. What is the right architecture when you don't know which plan the user will deploy to? Should this be an env var?

20. The route marks `agent_runs` as `'failed'` and returns a 500 when the actor throws. But the actor might fail for three different reasons: session expired, Apify quota hit, or scraping error on a specific page. Should the client receive different error messages for each, or is a generic "Job search failed, please try again" correct?

21. The Adzuna route passes `country` (detected from location) as a URL path segment. The JobsDB route doesn't need country detection — it's always HK. What should happen if a user types "New York" in the location field when JobsDB is the active provider? Should the route reject the search, ignore the location, or surface a warning?

22. The plan returns `Found X jobs and saved Y new jobs.` (X = scraped, Y = newly inserted after dedupe). Feature 10 returned `Found X jobs and saved Y strong matches.` (Y = match score >= 70). These are different success messages. Which is more useful to the user, and why?

---

## Group 6: Crawlee and custom actor architecture (if Store search finds nothing)

23. `apify create` scaffolds an actor from a template. What does the `actor.json` file define, and why does it matter for `apify push` and the Apify Console UI?

24. `input_schema.json` defines the actor's typed input. The agreed contract is `{ query, location, maxItems }`. Why does defining a schema file matter for an actor called programmatically — who reads it, and when?

25. The custom actor uses `PlaywrightCrawler`. Why not `CheerioCrawler` (faster, no real browser) or `HttpCrawler` (fastest, raw HTTP)? What specific property of JobsDB requires a real browser?

26. The actor should scrape search results then detail pages. What Crawlee mechanism handles the two-step crawl (enqueue detail URLs from search results)? How does `maxItems` cap the total across both steps?

27. When one detail page fails, the actor should "keep the search-result-level data and continue." What does the `description` field look like for a job whose detail page failed? Does the scorer still run on that job, and what score does it likely produce?
