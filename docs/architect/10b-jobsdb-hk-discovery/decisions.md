# Architectural Decisions — Feature 10b: JobsDB HK Job Discovery

---

## Decision 1 — Actor sourcing: Search Store first, build custom if needed

**What it is:**
Before writing a custom Apify actor, run `apify actors search "jobsdb"` and `apify actors search "hong kong jobs"` to check if a viable Store actor already exists. Only build the custom `apify/jobsdb-hk-actor/` if nothing in the Store:
- (a) returns full detail-page descriptions (not just search snippets), AND
- (b) accepts an authenticated session/cookie input

**Why this over "build custom immediately":**
Building and maintaining a custom Crawlee actor is a meaningful ongoing commitment — DOM selectors break on site updates, session formats change, Playwright versions need bumping. A Store actor is someone else's maintenance burden. The search is a 10-minute step that could save days of work.

**What the alternative costs:**
If you skip the Store search and build custom, you own the actor forever. If you adopt a Store actor that doesn't accept session input, you're locked to public-only pages, which may degrade result quality if JobsDB hides salary or full descriptions behind login.

**The reconciliation with the auth decision:**
A Store actor *only qualifies* if it also satisfies the auth requirement (decision 2). These two decisions are linked — "Store-first" doesn't mean "Store always"; it means "check, then verify it supports session input before committing."

---

## Decision 2 — Authentication model: Authenticated Playwright `storageState` on Apify side

**What it is:**
The custom actor (or qualifying Store actor) loads a JobsDB session from the **Apify side only** — stored as an Apify Secret env var or Key-Value Store record containing a Playwright `storageState` JSON blob. JobPilot, `.env.local`, and InsForge never touch Google/JobsDB credentials.

Developer flow:
1. Log in to JobsDB manually in a browser
2. Export the session as Playwright `storageState` (cookies + localStorage)
3. Upload the JSON to Apify once (as a KV store record or Secret)
4. The actor reads it via `Actor.getValue('JOBSDB_SESSION')` and applies it to the Playwright browser context
5. When the session expires: repeat steps 1–4 manually

**Why not public-only pages:**
JobsDB HK does expose some content publicly, but full job descriptions, salary details, and application links may be restricted or degraded for logged-out visitors. Full descriptions are essential for Nemotron scoring quality — Adzuna's existing weakness is that it only provides description *snippets*, which Nemotron scores from. JobsDB was specifically chosen to fix this. Scraping without auth risks getting the same snippet-quality data.

**What the alternative costs:**
Public-only means no credentials to manage, no session-expiry toil, simpler actor — but risks degraded description quality which undermines the whole reason for building the integration.

**Security boundary enforced:**
- JobPilot source code: no credentials
- `.env.local`: no credentials  
- InsForge DB: no credentials
- Apify actor input at call-time: no credentials (session lives in KV store, not passed per-run)

---

## Decision 3 — `source_provider`: Typed union + backfill of existing rows

**What it is:**
```typescript
// types/index.ts
export type JobProvider = 'adzuna' | 'jobsdb_hk'
```
Added to `Job.source_provider: JobProvider | null`.

Migration:
```sql
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source_provider text;
UPDATE jobs SET source_provider = 'adzuna' WHERE source_provider IS NULL;
```

**Why not nullable freeform text (spec default):**
Nullable freeform means every downstream query must guard against `NULL` meaning "Adzuna" or "unknown". Feature 11 (filter by provider), Feature 15 (stats), and PostHog analytics all want to count by provider. A typed union with no NULLs in existing rows makes every query unambiguous from day one.

**Why not collapse `source` and `source_provider` into one field:**
`source` tracks *how* a job entered the app (`'search'` vs `'url'`). `source_provider` tracks *which external provider* produced it. These are orthogonal: a future "Add by URL" flow for a JobsDB posting would be `source: 'url'`, `source_provider: 'jobsdb_hk'`. Collapsing them would require a new field anyway when that flow ships.

**What the alternative costs:**
NULL as "Adzuna" is a leaky convention that breaks every `GROUP BY source_provider` query silently (NULLs don't count in SQL aggregates without explicit `COALESCE`).

---

## Decision 4 — Route execution: Synchronous + `maxDuration`

**What it is:**
```typescript
// app/api/agent/find/route.ts
export const maxDuration = 300; // seconds — tune to host's deployment limit
```
`lib/apify.ts` calls `client.actor(id).call(input)` which blocks until the actor run finishes, then reads the dataset. The route returns once all jobs are scored and inserted.

**Why not background start + poll (the spec's "v2"):**
Background polling requires a new polling endpoint, client-side interval logic, a "pending" UI state in `FindJobsClient`, and a way to cancel abandoned polls. For a 10-job scrape the synchronous wait is measurable but not unusable. The UX is already a loading spinner — adding latency to that spinner is simpler than adding a new async state machine.

**What the alternative costs:**
If a 10-job scrape routinely exceeds the deployment timeout (typically 60s on hobby plans, up to 300s+ on paid plans), the synchronous model will fail with a timeout error before the actor completes. At that point the v2 polling model becomes necessary regardless of preference. The plan notes this as the trigger for upgrading.

**Apify actor execution model:**
The actor runs on Apify's cloud, not inside the Next.js route. The route is just waiting for a webhook/completion signal — it does not consume server resources proportional to actor run time beyond keeping the TCP connection open. This is architecturally similar to how Browserbase session time doesn't count against Next.js route CPU.

---

## Decision 5 — `scoreJobs` generalization: `ScoringInput[]` instead of `AdzunaJob[]`

**What it is:**
```typescript
// agent/job-matcher.ts — before
export async function scoreJobs(jobs: AdzunaJob[], profile: Profile | null): Promise<JobScore[]>

// agent/job-matcher.ts — after
export type ScoringInput = { title: string; company: string; location: string; description: string }
export async function scoreJobs(jobs: ScoringInput[], profile: Profile | null): Promise<JobScore[]>
```

**Why it's safe:**
`buildJobsList` inside `job-matcher.ts` only ever reads `title`, `company.display_name`, `location.display_name`, and `description` from `AdzunaJob`. The `.display_name` nesting was the only shape difference — flatten that in the normalization step in `agent/jobsdb.ts`. No logic changes anywhere.

**Why not keep `AdzunaJob` and overload:**
An overloaded signature adds type complexity for zero benefit. A minimal `ScoringInput` type makes the scorer's actual requirements explicit and removes the `lib/adzuna.ts` import from `job-matcher.ts`, which belonged in a UI/transport layer anyway.

**What the alternative costs:**
Keeping `AdzunaJob` means `agent/jobsdb.ts` has to manufacture fake `AdzunaJob` shapes (with `company: { display_name: ... }` nesting) to satisfy the type, which is a leaky abstraction in the wrong direction.

---

## Decision 6 — Runtime vs. tooling: `apify-client` SDK vs. `apify` CLI

**What it is:**
Two separate Apify surfaces are in play for this feature:

| Layer | Tool | When used |
|-------|------|-----------|
| **Runtime** (Next.js `lib/apify.ts`) | `apify-client` npm SDK | Production: start actor run, wait, read dataset |
| **Development** | `apify` CLI + `/apify-ultimate-scraper` skill | Build time: search Store, inspect schemas, push custom actor, test runs |

**Why they're separate:**
The CLI is a developer tool — it writes to `~/.apify/` config, requires `apify login`, and is not available inside Next.js server functions. The `apify-client` SDK is a pure HTTP client suitable for server-side use with an API token from an env var. Using the CLI at runtime would introduce authentication ceremony and global config state inside the app process.

**`apify-client` runtime pattern:**
```typescript
import { ApifyClient } from 'apify-client';

const client = new ApifyClient({ token: process.env.APIFY_TOKEN! });

const run = await client.actor(process.env.APIFY_JOBSDB_ACTOR_ID!).call(input, {
  timeoutSecs: 270, // slightly under maxDuration
});

if (run.status !== 'SUCCEEDED') throw new Error(`Actor run ${run.status}`);

const { items } = await client.dataset(run.defaultDatasetId!).listItems();
return items as JobsDbActorOutput[];
```
