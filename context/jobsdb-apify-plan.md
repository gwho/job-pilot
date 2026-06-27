# JobsDB HK Apify Integration Plan

## Purpose

JobPilot currently discovers jobs through Adzuna, but Adzuna does not provide good coverage for Hong Kong job searches. This plan defines a JobsDB Hong Kong-only v1 job discovery pipeline using a custom Apify actor.

The goal is better Hong Kong job source coverage. The existing Nemotron matching and scoring behavior should remain unchanged.

## Scope

Build a v1 replacement for the active Find Jobs discovery path:

```text
/find-jobs form
  -> POST /api/agent/find
  -> run custom JobsDB HK Apify actor
  -> read actor dataset
  -> normalize jobs
  -> dedupe existing jobs
  -> score with existing Nemotron matcher
  -> save new jobs to InsForge
  -> return jobs to Find Jobs page
```

Adzuna can be bypassed or removed from the active job discovery path for v1. The code should still be shaped so additional job source adapters can be added later.

## Agreed Language

- **JobsDB HK**: authenticated JobsDB Hong Kong search and detail pages scraped through Apify.
- **More suitable jobs**: better Hong Kong job source coverage, not changes to match scoring.
- **Apify actor**: custom scraper owned in this repo and called by JobPilot.
- **Find Jobs page**: existing `/find-jobs` UI and flow.
- **Manual authenticated session**: the developer logs in to JobsDB separately; the actor uses saved session cookies or Playwright storage state. JobPilot never stores JobsDB or Google credentials.

## Decisions

### Source Scope

v1 uses JobsDB HK only.

Adzuna should not be the active provider for the first JobsDB version. Future work can add a source router or source selector if multiple providers are needed.

### Search Inputs

Keep the current Find Jobs inputs.

- Current job title input becomes the free-text JobsDB search query.
- Current location input remains, with Hong Kong as the expected/default use case.
- Do not add company, seniority, or role-specific filters in v1.

The UI copy can change from "Job title" to "Job title or keywords" while preserving the same component shape.

### Actor Ownership

Create a custom Apify actor inside this repo, likely:

```text
apify/jobsdb-hk-actor/
```

The Next.js app calls the deployed actor through Apify APIs. Scraping logic should not live inside the Next.js app.

### Scrape Depth

The actor should scrape both:

- JobsDB search result pages
- Individual job detail pages

Detail pages are required because the existing match scoring depends on meaningful job description text, responsibilities, requirements, and skills.

### Result Cap

Limit v1 to 10 jobs per search.

This keeps actor runtime, Apify cost, route-handler wait time, and scraping fragility under control.

### UX Model

Use the current synchronous Find Jobs flow for v1:

```text
User clicks Find Jobs
  -> route handler starts Apify actor
  -> route handler waits for completion
  -> app reads dataset items
  -> app scores and saves jobs
  -> app returns updated jobs to UI
```

If 10-job searches routinely exceed deployment timeouts, v2 should move to a background run and polling model.

### Data Model

Keep the existing `jobs.source` meaning as the ingestion mode.

Add a new nullable column:

```sql
source_provider text
```

For JobsDB HK rows:

```ts
source: "search";
source_provider: "jobsdb_hk";
source_url: string; // original JobsDB listing URL
external_apply_url: string | null; // JobsDB apply URL, or source URL fallback
```

This avoids overloading `source`, which currently represents how a job entered the app rather than which provider produced it.

### Deduplication

Use conservative URL-based deduplication.

Before insert:

- Dedupe actor results by canonical `sourceUrl`.
- Check existing jobs for the current `user_id`, `source_provider`, and `source_url`.
- Skip existing rows.

Do not use fuzzy dedupe by title, company, or location in v1.

### Success Message

Use:

```text
Found X jobs and saved Y new jobs.
```

This separates discovered jobs from newly persisted jobs after deduplication.

### Auth Boundary

Do not store or automate user credentials.

Do not store any of the following in JobPilot, `.env.local`, InsForge DB, Apify actor input, or source code:

- Google username/password
- JobsDB username/password
- MFA backup codes
- OAuth secrets for the user's personal Google account

The actor should use an authenticated browser session stored on the Apify side, such as an Apify Secret or Key-Value Store value containing cookies or Playwright `storageState`.

### Scraping Boundary

The actor should only access authenticated pages that the user can view normally after login.

Do not implement bypasses for paywalls, private content, bot protections, or access controls.

If a field is missing, the actor should return `null` or an empty string and continue. If one detail page fails, the actor should keep the search-result-level data for that job and continue.

## Actor Contract

### Input

```ts
type JobsDbActorInput = {
  query: string;
  location: string;
  maxItems: number;
};
```

### Output

```ts
type JobsDbActorOutput = {
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
```

## Proposed File Boundaries

```text
apify/jobsdb-hk-actor/
  Apify actor runtime, Playwright/Crawlee scraper, session loading, dataset output

lib/apify.ts
  Apify API client wrapper: start actor, wait for completion, read dataset items

agent/jobsdb.ts
  JobsDB source adapter: call Apify wrapper, validate actor output, normalize records

app/api/agent/find/route.ts
  Request validation, auth, profile loading, run creation, adapter call, scoring, DB writes
```

## Implementation Steps

1. Add `source_provider text` to the `jobs` table.
2. Update shared `Job` types to include `source_provider`.
3. Update `/find-jobs` UI label from "Job title" to "Job title or keywords".
4. Create `apify/jobsdb-hk-actor/`.
5. Implement a Playwright/Crawlee actor with the agreed input and output contract.
6. Configure the actor to load JobsDB auth session state from Apify Secret or Key-Value Store.
7. Add `lib/apify.ts` to run the actor synchronously and read dataset items.
8. Add `agent/jobsdb.ts` to normalize actor results into the existing job shape.
9. Update `app/api/agent/find/route.ts` to call the JobsDB adapter instead of Adzuna.
10. Dedupe by `user_id + source_provider + source_url` before insert.
11. Reuse the existing Nemotron batch scoring.
12. Save new rows with `source = "search"` and `source_provider = "jobsdb_hk"`.
13. Return the success message `Found X jobs and saved Y new jobs.`
14. Update project documentation after implementation.

## Open Practical Tasks

- Inspect JobsDB HK's real logged-in DOM structure before finalizing selectors.
- Decide the exact session-state format for Apify: cookies array or Playwright `storageState`.
- Decide where the deployed actor ID is stored, likely `APIFY_JOBSDB_ACTOR_ID`.
- Confirm route-handler timeout behavior once a 10-job scrape is tested.

## Non-Goals For V1

- Multiple job providers in the UI.
- Source selector.
- Background run polling.
- Scheduled searches.
- Automated Google login.
- Credential storage.
- Fuzzy duplicate detection.
- Changes to Nemotron scoring logic.
