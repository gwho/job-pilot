# Plan — Feature 10b-jobsdb-hk-discovery: JobsDB HK Job Discovery

## What was built

**New files:**
- `lib/apify.ts` — `apify-client` runtime wrapper; `runJobsDbActor()` blocks until actor SUCCEEDED, reads dataset items. Exports `JobsDbActorInput` and `JobsDbActorOutput` types.
- `agent/jobsdb.ts` — source adapter; `discoverJobsDbJobs()` calls `runJobsDbActor` and normalizes output (missing fields → `null`/`""`); `toScoringInput()` maps to flat `ScoringInput`.
- `apify/jobsdb-hk-actor/.actor/actor.json` — actor spec (name, title, build tag, input ref, Dockerfile ref)
- `apify/jobsdb-hk-actor/.actor/input_schema.json` — typed input schema for the Apify Console and SDK
- `apify/jobsdb-hk-actor/src/main.ts` — Crawlee `PlaywrightCrawler` actor; loads `JOBSDB_SESSION` from Apify KV store; navigates search page → enqueues + scrapes detail pages; pushes `JobResult` to dataset; detects session-expiry redirect
- `apify/jobsdb-hk-actor/package.json` — actor Node.js deps (`apify`, `crawlee`, `playwright`)
- `apify/jobsdb-hk-actor/tsconfig.json` — ESNext module, strict, no JSX
- `apify/jobsdb-hk-actor/Dockerfile` — extends `apify/actor-node-playwright-chrome:20`
- `docs/architect/10b-jobsdb-hk-discovery/` — architect session docs (decisions, discussion, ai-discussion-topics)

**Modified files:**
- `agent/job-matcher.ts` — removed `AdzunaJob` import; added exported `ScoringInput` type; `scoreJobs` signature changed to `ScoringInput[]`; `buildJobsList` now uses flat `job.company`/`job.location` instead of nested `.display_name`
- `app/api/agent/find/route.ts` — swapped Adzuna for `discoverJobsDbJobs`; added `export const maxDuration = 300`; added two-pass URL deduplication (DB check + within-batch `Set`); sets `source_provider: 'jobsdb_hk'` on every record; new success message `Found X jobs and saved Y new jobs.`; handles zero-new-jobs case without insert
- `types/index.ts` — added `JobProvider = 'adzuna' | 'jobsdb_hk'`; added `source_provider: JobProvider | null` to `Job`
- `components/find-jobs/SearchControls.tsx` — label `"Job Title"` → `"Job title or keywords"`
- `scripts/schema.sql` — added `source_provider TEXT` column to `jobs` table definition
- `context/library-docs.md` — added Apify section (runtime pattern, auth boundary, record mapping, dedup, env vars, rules)
- `CLAUDE.md` — updated stack table (Job data row), agent operations data flow, env vars list
- `context/build-plan.md` — Feature 10b section inserted between 10 and 11
- `context/progress-tracker.md` — 10b marked complete; last completed updated

**Dependency added:**
- `apify-client` — runtime SDK for `lib/apify.ts`

## Schema changes

`jobs` table:
```sql
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source_provider text;
UPDATE jobs SET source_provider = 'adzuna' WHERE source_provider IS NULL;
```
Existing rows backfilled to `'adzuna'`. `scripts/schema.sql` updated to match.

## Key invariants

- **`source_provider` must always be set** for any job inserted by a search provider. Never insert a `source: 'search'` row without `source_provider`. JobsDB rows are always `'jobsdb_hk'`.
- **`APIFY_TOKEN` and `APIFY_JOBSDB_ACTOR_ID` must be in `.env.local`** before `POST /api/agent/find` is called. Missing either causes the `apify-client` call to throw and mark the run failed.
- **`scoreJobs` takes `ScoringInput[]`, not `AdzunaJob[]`.** Any new source adapter must call `toScoringInput()` (or equivalent) before passing to the scorer. Never pass provider-specific types to `agent/job-matcher.ts`.
- **Deduplication key is `(user_id, source_provider, source_url)`.** Two passes: DB check + within-batch `Set`. Do not skip either pass. Do not use fuzzy dedup in v1.
- **`maxDuration = 300` must match the deployment plan.** Vercel Hobby cap is 60s — the current value will time out on Hobby. Adjust to match the actual hosting plan before deploying.
- **`JOBSDB_SESSION` lives in the Apify KV store, never in `.env.local` or InsForge.** The actor reads it via `Actor.getValue('JOBSDB_SESSION')`. JobPilot has no credential access.
- **`lib/apify.ts` uses `apify-client` SDK only.** Never spawn the `apify` CLI as a subprocess in runtime code.
- **The actor is a separate deploy step.** `apify push` from `apify/jobsdb-hk-actor/` deploys the actor. `APIFY_JOBSDB_ACTOR_ID` must be updated in `.env.local` after every push that changes the actor ID.
- **DOM selectors in `main.ts` are fragile.** `[data-automation="jobListing"]`, `[data-automation="jobAdDetails"]` etc. must be verified against the live JobsDB HK DOM before each deploy. Document the verified date in a comment.
