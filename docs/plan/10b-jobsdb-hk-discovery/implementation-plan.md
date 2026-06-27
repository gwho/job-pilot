# Implementation Plan — Feature 10b: JobsDB HK Job Discovery (via Apify)

## Context

Adzuna (Feature 10) gives poor Hong Kong coverage. Feature 10b makes a custom/Store Apify actor
scraping **JobsDB Hong Kong** the active discovery source for `/find-jobs`. Adzuna code is kept but
bypassed. The existing Nemotron batch scoring is reused unchanged — JobsDB detail pages give full
descriptions, which improve scoring quality over Adzuna's snippets.

Authoritative spec: `context/jobsdb-apify-plan.md`. This plan refines it after an `/architect`
session and resolves four architectural decisions (below). Build-plan/progress-tracker already
reference Feature 10b.

## Decisions made (architect session)

- **Actor sourcing — Store-first, custom fallback.** At build time run `apify actors search "jobsdb"`
  / `"hong kong jobs"`. Adopt a Store actor **only if** it (a) returns full detail-page descriptions
  and (b) accepts an authenticated session/cookie input. Otherwise build the custom
  `apify/jobsdb-hk-actor/`. Realistically this leans custom, since most Store actors won't accept an
  arbitrary JobsDB session.
- **Authenticated session (kept).** The actor loads a JobsDB session (Playwright `storageState`)
  from the **Apify side** (Apify Secret env var or Key-Value Store record). JobPilot/`.env.local`/
  InsForge never store Google/JobsDB credentials. Developer captures the session manually and uploads
  it to Apify once.
- **`source_provider` typed + backfilled.** `JobProvider = 'adzuna' | 'jobsdb_hk'`. Migration adds
  the column then backfills existing rows to `'adzuna'` so it's never ambiguous.
- **Synchronous route + `maxDuration`.** `/api/agent/find` blocks on the actor run via the
  `apify-client` SDK and sets `export const maxDuration` high enough for a 10-job scrape (cold start +
  detail pages). No polling UI in v1.

## Language agreed

- **JobsDB HK** — JobsDB Hong Kong search + detail pages, scraped through Apify within an authenticated session.
- **Actor** — the deployed Apify scraper (Store or custom `apify/jobsdb-hk-actor/`), called by JobPilot via `apify-client`.
- **Session** — Playwright `storageState` captured manually by the developer, stored on Apify, never in JobPilot.
- **`source`** — *how* a job entered the app (`'search' | 'url'`), unchanged. JobsDB rows are `'search'`.
- **`source_provider`** — *which* provider produced the row (`'adzuna' | 'jobsdb_hk'`), new column.

## Runtime vs. tooling boundary

- **Runtime (Next.js):** `lib/apify.ts` uses the **`apify-client`** npm SDK (`ApifyClient.actor(id).call(input)`
  blocks until finish, then `dataset(run.defaultDatasetId).listItems()`). Not the CLI.
- **Development/testing:** the **`apify` CLI + `/apify-ultimate-scraper` skill** is used to search the
  Store, fetch actor input schemas (`apify actors info --input`), test runs, and `apify push` the custom
  actor. Requires `APIFY_TOKEN` (`apify login` or env).
- **Actor-building knowledge gap:** `apify-ultimate-scraper` only covers *consuming* Store actors. The
  custom build (step 6) needs *actor-development* knowledge. Before step 6, pull in:
  - `https://github.com/apify/apify-cli` — `apify create`, `apify run`, `apify push`, local actor structure,
    `actor.json`/`input_schema.json`, secrets & KV-store usage.
  - `https://github.com/apify/awesome-skills` — check for an actor-building / Crawlee-authoring skill to
    install via `npx skills add` (same mechanism used for `apify-ultimate-scraper`); install it if present.

---

## Build steps

### 1. Database migration (InsForge MCP `run-raw-sql`)
```sql
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source_provider text;
UPDATE jobs SET source_provider = 'adzuna' WHERE source_provider IS NULL;
```
Also update the durable reference `scripts/schema.sql`.

### 2. Types — `types/index.ts`
- Add `export type JobProvider = 'adzuna' | 'jobsdb_hk'`.
- Add `source_provider: JobProvider | null` to `Job` (flows into `JobInsert` automatically via `Omit`).

### 3. Scorer generalization — `agent/job-matcher.ts`
- Export `export type ScoringInput = { title: string; company: string; location: string; description: string }`.
- Change `scoreJobs(jobs: AdzunaJob[], ...)` → `scoreJobs(jobs: ScoringInput[], ...)`. `buildJobsList`
  already only reads `title/company/location/description` — pure type refinement, no logic change.
  Drop the `AdzunaJob` import here.

### 4. Apify client wrapper — `lib/apify.ts` (new)
- `runJobsDbActor(input: JobsDbActorInput): Promise<JobsDbActorOutput[]>` using `apify-client`:
  `client.actor(process.env.APIFY_JOBSDB_ACTOR_ID!).call(input, { timeoutSecs })`, then
  `client.dataset(run.defaultDatasetId!).listItems()`. Throw on non-`SUCCEEDED` status so the route
  can mark the run failed (mirrors the Adzuna throw/catch pattern in the route).
- Input/Output types from the spec's Actor Contract.

### 5. JobsDB source adapter — `agent/jobsdb.ts` (new)
- `discoverJobsDbJobs(query, location, maxItems=10)`: call `runJobsDbActor`, validate/normalize each
  dataset item (missing field → `null`/`''`, never throw), return a typed `JobsDbJob[]`.
- Provide `toScoringInput(job)` and the record-mapping used by the route.

### 6. Custom actor (only if no Store actor qualifies) — `apify/jobsdb-hk-actor/`
- **Prep:** install/reference actor-dev knowledge first — `apify/apify-cli` (scaffold via `apify create`,
  `actor.json`, secrets, KV store) and check `apify/awesome-skills` for a Crawlee/actor-building skill to
  `npx skills add`. Scaffold the actor with `apify create` rather than hand-rolling the structure.
- Crawlee `PlaywrightCrawler`; `main.ts`, `input_schema.json`, `Dockerfile`, `package.json`.
- Load JobsDB `storageState` from Apify KV store / `Actor.getValue` (secret), apply to the browser context.
- Scrape search result pages → enqueue detail pages (cap `maxItems=10`) → emit the Output contract.
- Scraping boundary: only pages a logged-in user can normally view; no paywall/bot-protection bypass.
  One failed detail page keeps the search-level data and continues.
- Deploy with `apify push`; record the deployed id in `APIFY_JOBSDB_ACTOR_ID`.

### 7. Route swap + dedupe — `app/api/agent/find/route.ts`
- `export const maxDuration = 300;` (tune to host) at module top.
- Replace `detectCountry` + `searchJobs` with `discoverJobsDbJobs(jobTitle, location, 10)`; same
  run-creation, `job_search_started` event, and failure-marks-run-failed structure.
- Score via `scoreJobs(jobs.map(toScoringInput), profile)`.
- **Dedupe before insert:** query existing `jobs` for `user_id` + `source_provider='jobsdb_hk'`, build a
  `Set<source_url>`, also dedupe the batch by canonical `sourceUrl`; insert only new rows.
- Records: `source: 'search'`, `source_provider: 'jobsdb_hk'`, `source_url`, `external_apply_url`,
  `about_role: description`, score fields. `job_found` per strong match (`>= MATCH_THRESHOLD`).
- Return `successMessage: \`Found ${found} jobs and saved ${newCount} new jobs.\`` plus the inserted rows
  (so `FindJobsClient.handleSearch` `setJobs(res.jobs)` keeps working).

### 8. UI copy — `components/find-jobs/SearchControls.tsx`
- Label `"Job Title"` → `"Job title or keywords"`; keep component shape/props.

### 9. Env + docs
- Add `APIFY_TOKEN`, `APIFY_JOBSDB_ACTOR_ID` to `.env.local` and the env list in `CLAUDE.md`.
- Add an **Apify** section to `context/library-docs.md` (apify-client runtime pattern, CLI/skill for
  tooling, auth-session boundary, JobsDB record mapping).
- Per AGENTS.md: `docs/plan/10b-jobsdb-discovery/{plan,explanation,ai-discussion-topics}.md`; update
  `context/ui-registry.md` (SearchControls label) and `context/progress-tracker.md` (mark 10b done).

---

## Critical files

| File | Change |
|------|--------|
| `types/index.ts` | `JobProvider` union; `source_provider` on `Job` |
| `agent/job-matcher.ts` | `ScoringInput` type; `scoreJobs` signature |
| `lib/apify.ts` *(new)* | `apify-client` actor-run + dataset wrapper |
| `agent/jobsdb.ts` *(new)* | normalize actor output, `toScoringInput` |
| `apify/jobsdb-hk-actor/` *(new, conditional)* | custom Crawlee actor + session loading |
| `app/api/agent/find/route.ts` | adapter swap, `maxDuration`, URL dedupe, new success msg |
| `components/find-jobs/SearchControls.tsx` | label copy |
| `scripts/schema.sql`, `CLAUDE.md`, `context/library-docs.md` | reference updates |

## Reuse (don't rebuild)
- `scoreJobs` batch scorer + index-drift guard — `agent/job-matcher.ts`.
- `MATCH_THRESHOLD` — `lib/utils.ts`.
- `captureServerEvent` — `lib/posthog-server.ts` (events unchanged: `job_search_started`, `job_found`).
- `createInsforgeServer` + `agent_runs` lifecycle pattern — existing route.

## New dependency
- `apify-client` (`npm install apify-client`) — runtime SDK for `lib/apify.ts`.

---

## Verification

1. **Tooling auth:** `apify login` (or `export APIFY_TOKEN=…`); `apify actors search "jobsdb" --json`
   via the `/apify-ultimate-scraper` skill to confirm Store options before building custom.
2. **Actor:** test the chosen/custom actor with input `{ query:"software engineer", location:"Hong Kong", maxItems:10 }`;
   confirm dataset items match the Output contract incl. non-empty `description` from detail pages.
3. **DB:** after migration, `get-table-schema` shows `source_provider`; existing rows = `'adzuna'`.
4. **End-to-end:** `npm run dev`, sign in, `/find-jobs` → search a HK title. Expect jobs to render with
   match bars, `source_provider='jobsdb_hk'` rows in `jobs`, and message `Found X jobs and saved Y new jobs.`
5. **Dedupe:** re-run the same search → `Y` (new) drops toward 0 while `X` (found) stays.
6. **Failure paths:** force an actor error → run marked `failed`, friendly 500, no partial rows.
7. `npm run lint` clean; no TS errors (verify the `scoreJobs` signature change has no stragglers).
