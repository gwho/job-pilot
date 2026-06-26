# Plan — Feature 10-adzuna-job-discovery: Adzuna Job Discovery

## What was built

**New files**
- `lib/adzuna.ts` — `AdzunaJob` type, `detectCountry(location)` (keyword → `gb`/`au`/`ca`/`sg`/`us`), and `searchJobs(jobTitle, location, country)`. Always sends `category=it-jobs`; omits `where` when location is empty; throws on a non-ok response.
- `agent/job-matcher.ts` — `JobScore` type and `scoreJobs(jobs, profile)`. One batch Nemotron call scoring all jobs at once; returns one `JobScore` per input job, index-aligned, with a fallback for missing/malformed entries.
- `app/api/agent/find/route.ts` — POST handler orchestrating the search: auth → parse body → profile fetch → create `agent_runs` row → `job_search_started` event → Adzuna search → batch scoring → batch insert into `jobs` → `job_found` events for strong matches → complete the run → return `{ jobs, jobsFound, strongMatches, successMessage }`.

**Modified files**
- `components/find-jobs/FindJobsClient.tsx` — now the container. Owns `jobs`, `jobTitle`, `location`, `isLoading`, `searchStatus` state plus the existing filter/sort/pagination pipeline. Prop renamed `jobs` → `initialJobs`. `handleSearch()` POSTs to `/api/agent/find` and calls `setJobs(res.jobs)`. Renders `SearchControls` as a child.
- `components/find-jobs/SearchControls.tsx` — now a presentational leaf. All internal state removed; takes `jobTitle`, `location`, `isLoading`, `searchStatus`, and three handlers as props. Button shows "Finding jobs..." + spinner and disables while loading.
- `app/find-jobs/page.tsx` — added `export const dynamic = "force-dynamic"`. Removed `MOCK_JOBS`. Queries `jobs` scoped to `user_id`, ordered by `found_at` desc. Renders only `<FindJobsClient initialJobs={...} />` (no longer renders `SearchControls` directly).
- `components/profile/ProfileForm.tsx` — removed the Connected Accounts card and the unused `linkedinConnected` state; `handleSave` now passes `linkedin_connected: profile?.linkedin_connected ?? false` through unchanged. LinkedIn URL field untouched.

**Verified, no change**
- `types/index.ts` — `JobSource` was already `'search' | 'url'`; no fix was required.

## Schema changes

None. Feature 10 writes to the existing `jobs` and `agent_runs` tables created in Feature 04.

## Key invariants

- **Adzuna calls always include `category=it-jobs`.** Set in `searchJobs`; never call the Adzuna endpoint without it.
- **`where` is omitted entirely when location is empty** — never pass an empty `where` value.
- **Country codes are limited to real Adzuna endpoints**: `gb`, `au`, `ca`, `sg`, `us`. Do not add a code (e.g. `hk`) Adzuna doesn't serve — the request 404s.
- **`source` is always `'search'`** for jobs created by this route.
- **Scoring is best-effort and must never fail the search.** `scoreJobs` catches all errors and returns neutral scores; the route still inserts jobs and completes the run.
- **`scoreJobs` output is index-aligned to its input.** The batch-ordering guard maps scores back by index; a length/shape mismatch degrades to `matchScore: 0`, never throws.
- **Strong match = `match_score >= MATCH_THRESHOLD`** imported from `lib/utils.ts`. Never hardcode 70.
- **All `jobs`/`agent_runs` reads and writes are scoped to `user_id`.** The page query and the run updates all filter by the authenticated user.
- **`FindJobsClient` is the single owner of `jobs` state.** `SearchControls` holds no state — it is presentational. Do not reintroduce state into it.
- **`page.tsx` stays `force-dynamic`.** Removing it risks serving a cached/empty jobs list on navigation.
- **PostHog server events still fire exactly the four approved events.** This feature uses `job_search_started` and `job_found` only.
- **Removing the Connected Accounts card must not reset `linkedin_connected`.** `handleSave` passes the existing DB value through; the column and the LinkedIn URL field remain.
