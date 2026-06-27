# Deep Discussion — Feature 10b: JobsDB HK Job Discovery

---

## Why Adzuna isn't enough for Hong Kong

Adzuna is a job aggregator — it pulls listings from employer sites and other boards, standardises them, and exposes them via a search API. For most English-speaking markets (US, UK, AU) its coverage is reasonable. For Hong Kong specifically, the dominant job boards are JobsDB (SEEK-owned), LinkedIn, and Recruit.com. Adzuna's HK index is thin — fewer listings, less frequent updates, and the descriptions it returns are always *snippets* (a few hundred characters), not the full job text.

This matters because Nemotron's matching quality is directly proportional to description quality. A snippet says "Frontend engineer needed, React experience preferred." A full description says "You will own the design system, migrate legacy Redux code to Zustand, and lead two junior engineers on a B2B SaaS product used by 500 enterprise clients in APAC." The second produces a meaningful matchReason and useful matchedSkills/missingSkills arrays. The first produces noise.

JobsDB publishes full descriptions, structured requirements, benefits, salary ranges, and even application-deadline dates. This is the information that makes the scoring pipeline valuable.

---

## The two Apify surfaces: consumer vs. builder

The installed `/apify-ultimate-scraper` skill and the Apify Store are a *consumer surface* — they let you call existing actors that other developers have already built and published. The workflow is: search → inspect schema → run → read dataset. It's fast, low-risk, and someone else owns maintenance.

Building a custom actor is the *builder surface* — you author Crawlee code, define an `input_schema.json`, test locally with `apify run`, push with `apify push`, and own the actor's lifecycle. The tooling is the `apify` CLI (scaffold with `apify create`), not the `/apify-ultimate-scraper` skill.

Understanding which surface you're on prevents confusion:

| Question | Consumer surface | Builder surface |
|----------|-----------------|-----------------|
| CLI command | `apify actors call` | `apify create`, `apify run`, `apify push` |
| Runtime SDK | `apify-client` SDK | Not applicable |
| You own maintenance | No | Yes |
| Time to first run | Minutes | Hours to days |

For Feature 10b: check the consumer surface first (Store search), then fall back to the builder surface (custom actor) only if needed.

---

## Why Store-first is genuinely a decision, not a shortcut

The spec defaulted to "build custom" because at the time of writing the author didn't know what was in the Store. The Store has 4,000+ actors. The gap between "no suitable actor exists" and "a suitable actor exists but nobody searched" is significant effort.

A Store actor qualifies for Feature 10b only if it satisfies two independent constraints:
1. Returns full detail-page descriptions (not search-level snippets)
2. Accepts a session/cookie input for authenticated access

Both constraints need to be verified. `apify actors info "ACTOR_ID" --input --json` returns the full input schema — check it for a `cookies`, `sessionStorage`, or `storageState` field. If the actor hardcodes its own login flow or only supports anonymous browsing, it fails constraint 2 regardless of description quality.

The realistic outcome for JobsDB HK specifically: there may not be a published actor that satisfies both constraints. JobsDB is a regional board and authenticated-session actors are rarer than anonymous ones (publishing an actor that requires the user's personal cookies is a complex onboarding story). If the Store search turns up nothing, build custom — but the 10-minute search is always worth doing.

---

## Playwright `storageState` as a session mechanism

Browser automation authentication comes in two main flavours:

**Username/password at login time:** The actor opens the login page, types credentials, and submits. Credentials are passed as actor input. This is simpler to set up but requires storing credentials somewhere. The spec explicitly prohibits this.

**Pre-captured session:** The developer logs in manually, exports the resulting browser state, and the actor loads that state before navigating to authenticated pages. No credentials in motion — just cookies and local storage that represent an already-authenticated session.

Playwright's `storageState` format captures exactly what a session is:
```json
{
  "cookies": [
    { "name": "__jobsdb_sid", "value": "abc123...", "domain": ".jobsdb.com.hk", "path": "/", "expires": 1751234567, ... }
  ],
  "origins": [
    { "origin": "https://hk.jobsdb.com", "localStorage": [ { "name": "auth_token", "value": "..." } ] }
  ]
}
```

The actor loads this before navigating:
```typescript
import { Actor } from 'apify';
import { chromium } from 'playwright';

const { storageState } = await Actor.getInput();
const browser = await chromium.launch();
const context = await browser.newContext({ storageState });
// Now every page opened in `context` starts authenticated
```

**Why on Apify's side, not in `.env.local`:**
The storageState blob can be several kilobytes and contains session cookies that are functionally equivalent to a password — anyone with them can act as the user on JobsDB. Storing it in `.env.local` would mean it lives in the developer's filesystem and potentially in version control if `.env.local` is accidentally committed. Storing it as an Apify KV-store record keeps it in Apify's secret management system, accessible only to actors within the same project.

**Session expiry reality:**
JobsDB sessions last days to weeks depending on "remember me" settings. When the session expires, the actor starts seeing login redirects instead of job listings. The actor should detect this (check for a redirect to a login URL, or check that the first job listing is present after navigation) and raise a clear error rather than returning empty results silently. The developer then re-captures the session.

---

## How the `source` vs `source_provider` distinction works

The `jobs` table has always had a `source` column with two values: `'search'` (jobs the agent found) and `'url'` (jobs the user adds manually by pasting a URL). This tracks *how a job entered the app*, not *who provided it*.

When Adzuna was the only search provider, `source = 'search'` implicitly meant Adzuna. With a second provider, that implicit assumption breaks.

`source_provider` answers the different question: *which external system produced this listing?* A JobsDB job added via search is `source: 'search', source_provider: 'jobsdb_hk'`. A hypothetical JobsDB job added by pasting its URL would be `source: 'url', source_provider: 'jobsdb_hk'`. Adzuna jobs are `source: 'search', source_provider: 'adzuna'`.

The two axes are:
```
source:          how it got in (search vs user-added URL)
source_provider: who produced the data (adzuna, jobsdb_hk, ...)
```

These are orthogonal and should stay separate. Collapsing them into one field (`source: 'jobsdb_search'`) loses the ability to ask "how many jobs did the user add manually?" across providers.

**The backfill matters:**
SQL `GROUP BY source_provider` silently drops NULL rows from counts. An `AVG` over a column with NULLs ignores those rows. If existing Adzuna rows stay NULL, any stats query for "Adzuna jobs" requires `WHERE source_provider IS NULL OR source_provider = 'adzuna'` — a fragile convention that will be forgotten. Backfilling to `'adzuna'` makes every query clean from the start.

---

## The `ScoringInput` refactor: why it's safe

`agent/job-matcher.ts` builds its prompt from four fields per job:
```typescript
function buildJobsList(jobs: AdzunaJob[]): string {
  return jobs.map((job, i) =>
    `Job ${i + 1}:\nTitle: ${job.title}\nCompany: ${job.company.display_name}\nLocation: ${job.location.display_name}\nDescription: ${job.description}`
  ).join('\n\n');
}
```

Only `title`, `company.display_name`, `location.display_name`, and `description` are read. The rest of `AdzunaJob` (`id`, `salary_min`, `salary_max`, `redirect_url`, `created`, etc.) is ignored by the scorer. The only reason `AdzunaJob` was the type was because no one had defined a narrower interface.

`ScoringInput` makes those four fields explicit and removes the dependency on the Adzuna-specific nested shape (`company: { display_name }` vs a flat `company: string`). The adapter in `agent/jobsdb.ts` normalizes JobsDB output to flat strings before passing to the scorer — this is the right boundary.

**Why this isn't a breaking change in practice:**
The `ScoringInput` type is structurally *simpler* than `AdzunaJob`. Any code that previously constructed an `AdzunaJob` to pass to `scoreJobs` can now construct a simpler `ScoringInput` instead. The route handler's Adzuna-to-record mapping already existed as inline code — it now routes through a normalization step that produces `ScoringInput[]` instead.

---

## Why `apify-client` SDK in runtime, not the CLI

The `apify` CLI is a developer tool. It stores its auth token in `~/.apify/auth.json`, writes build artifacts to `.apify/`, and is designed for interactive terminal use. Running it inside a Next.js route handler would require:
- Spawning a subprocess (`child_process.exec`)
- Managing stdout/stderr parsing
- Dealing with process lifecycle inside a serverless function
- Authenticating the CLI before every invocation

None of that is appropriate in production code. The `apify-client` npm SDK is a pure HTTP wrapper around the Apify REST API — same underlying operations, but designed for programmatic use:

```typescript
// CLI equivalent:
// apify actors call actor-id --input '{"query":"engineer","maxItems":10}'

// SDK equivalent:
const run = await client.actor('actor-id').call({ query: 'engineer', maxItems: 10 });
```

The SDK is importable, tree-shakeable, doesn't touch the filesystem, and can be initialized with just an env var. It belongs in `lib/apify.ts`.

---

## Deduplication: why URL-based, and why pre-insert

**Why not title + company:**
Title deduplication across searches is brittle. "Senior Software Engineer" at "Google" returns thousands of distinct listings. Fuzzy matching on title would produce false positives (different roles at the same company with similar titles) or miss true duplicates (same listing, slightly different title formatting). URL is canonical — the same JobsDB listing always has the same URL.

**Why pre-insert, not upsert:**
If you `INSERT ... ON CONFLICT DO NOTHING` on `source_url`, you need a unique constraint on `(user_id, source_provider, source_url)`. That means a schema migration for the constraint. Pre-insert deduplication is simpler: fetch existing `source_url` values for this user and provider, build a `Set`, filter the incoming batch before insert. The tradeoff is an extra query per search, but at 10 results that's negligible.

**Why dedupe the incoming batch as well:**
The actor could theoretically return the same listing twice (a listing appearing on multiple search result pages, or a search with overlapping keyword matches). Deduping only against DB doesn't catch within-batch duplicates. A `Set<sourceUrl>` built from the actor results catches both.

---

## Synchronous route timeout: the real numbers

`export const maxDuration = 300` sets the maximum wall-clock time the Next.js route handler will run. This depends on your deployment:

| Deployment | Default timeout | Max you can set |
|-----------|----------------|-----------------|
| Vercel Hobby | 10s | 60s |
| Vercel Pro | 60s | 300s |
| Vercel Enterprise | 60s | 900s |
| Self-hosted / Railway | Configurable | Configurable |

A 10-job JobsDB scrape involves:
- Cold start + session load: ~5–15s
- Search results page: ~5–10s
- 10 detail page navigations: ~5–10s each = ~50–100s total
- Total realistic: 60–120s

On Vercel Hobby (60s max), synchronous is likely to fail. On Vercel Pro with `maxDuration = 300`, it fits. This is the trigger condition for v2 (background run + polling): when the deployment environment can't accommodate the synchronous wait, not before.

The actor runs on Apify's cloud regardless — the only question is whether the Next.js route stays open long enough to receive the result.
