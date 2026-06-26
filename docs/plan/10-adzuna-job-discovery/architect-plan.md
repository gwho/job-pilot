# Feature 10 — Adzuna Job Discovery + Profile Page Cleanup

## Context
Feature 09 built the Find Jobs UI with mock data and a stubbed `handleSearch` in `SearchControls`. Feature 10 makes it real end-to-end: user submits job title + location → `POST /api/agent/find` hits Adzuna → a single batch Nemotron call scores every job against the user's profile → jobs are saved to the DB → the API returns the saved jobs + a success message → `FindJobsClient` sets its own `jobs` state so results render instantly with no page reload.

Separately, a non-functional "Connected Accounts" card is removed from the top of the Profile page (the LinkedIn URL field under Personal Info stays).

---

## Language agreed on
- **Batch scoring**: ONE Nemotron call scoring all Adzuna jobs together, returning a scores array in input order. Model stays `nvidia/nemotron-3-ultra-550b-a55b:free` ("GPT-4o" in notes was shorthand; project rule is Nemotron only).
- **Strong match**: `match_score >= MATCH_THRESHOLD` (70, imported from `lib/utils.ts` — never hardcoded).
- **Country detection**: keyword match on the location string, default `'us'`.
- **No page reload**: API returns `{ jobs: Job[], successMessage: string }`; client calls `setJobs(res.jobs)`. `force-dynamic` separately ensures a fresh page navigation re-queries the DB.

---

## Decisions made
- **FindJobsClient becomes the container** (confirmed): it owns search state (`jobTitle`, `location`, `isLoading`, `searchStatus`) + `jobs` state + the existing filter/sort/pagination pipeline. `SearchControls` becomes a presentational leaf taking props. `page.tsx` renders only `<FindJobsClient initialJobs={...} />`.
- **Batch scoring over sequential** (confirmed): one Nemotron call for all jobs — faster, single API hit, avoids 10× free-tier round-trips.
- **Best-effort scoring**: empty/incomplete profile never blocks the search; Nemotron scores on whatever profile data exists.
- **API returns the saved jobs array** so the client updates state directly — no `router.refresh()`.
- **`force-dynamic` on page.tsx** so a real reload/navigation always re-queries the DB.
- **Job.source type fix**: ensure `JobSource = 'search' | 'url'` (not `'linkedin' | 'url'`) is correct in `types/index.ts`.

---

## Assumptions
- Profile row may not exist yet — use `maybeSingle()`, proceed with `null`/empty profile.
- Adzuna returns up to 10 results (`results_per_page: "10"`).
- Duplicates are allowed for now: re-searching the same terms inserts new rows. Dedup is out of scope for Feature 10 (spec says "save complete record"); revisit in Feature 11 if needed.
- **Batch-ordering guard**: if the returned scores array length ≠ jobs length, fall back to `matchScore: 0` (empty reason/skills) for unmatched jobs rather than failing the route — index alignment is the contract.

---

## How to build it

### Step 1 — `lib/adzuna.ts` (new)
`AdzunaJob` type + `detectCountry()` + `searchJobs()` per `context/library-docs.md` (Adzuna section).
- Always `category: "it-jobs"`; omit `where` when location is empty; default country `'us'`.
- `detectCountry`: uk/england/scotland/wales → `'gb'`, australia → `'au'`, canada → `'ca'`, else `'us'`.
- Throw on non-ok response.

### Step 2 — `agent/job-matcher.ts` (new)
`scoreJobs(jobs: AdzunaJob[], profile: Profile | null): Promise<JobScore[]>` — single batch Nemotron call. Reuse the exact OpenAI client setup from `agent/extractor.ts`.
- Model `nvidia/nemotron-3-ultra-550b-a55b:free`, `response_format: { type: 'json_object' }`, `temperature: 0.3`, `max_tokens: 2000`.
- System prompt: score each job against the candidate; return `{ "scores": [{ matchScore: 0-100, matchReason: string, matchedSkills: string[], missingSkills: string[] }] }` — array same length & order as input.
- User prompt: profile summary (title, level, years, skills, work history) + numbered job list (title, company, description snippet).
- `JobScore` type exported. Null profile → pass empty profile fields.

### Step 3 — `app/api/agent/find/route.ts` (new)
POST handler, auth + error shape identical to `app/api/profile/extract/route.ts`.
1. Auth → 401 if no user.
2. Parse `{ jobTitle, location }`.
3. `detectCountry(location)`.
4. Fetch profile (`maybeSingle()`) — null OK.
5. Insert `agent_runs` row (`status: 'running'`, `job_title_searched`, `location_searched`) → capture `runId`.
6. PostHog server event `job_search_started` (`distinctId: userId`, `{ jobTitle, location }`).
7. `searchJobs(...)` — on throw: update agent_run → `'failed'`, return 500.
8. `scoreJobs(adzunaJobs, profile)` — on throw or length mismatch: apply batch-ordering guard (score 0).
9. For each job+score: build `JobInsert` (mapping from library-docs Adzuna section, `source: 'search'`, `run_id: runId`); insert into `jobs`, collect inserted rows; if `matchScore >= MATCH_THRESHOLD` fire `job_found` PostHog event.
10. Update `agent_runs` → `{ status: 'completed', jobs_found: total, completed_at: now }`.
11. Count strong matches; `await posthogServer.shutdown()`.
12. Return `{ jobs: insertedJobs, successMessage: "Found X jobs and saved Y strong matches." }`.

Use `JobInsert`, `AgentRunInsert` from `types/index.ts`; import `MATCH_THRESHOLD` from `lib/utils.ts`.

### Step 4 — `components/find-jobs/FindJobsClient.tsx` (update → container)
- Prop rename: `jobs` → `initialJobs: Job[]`.
- New state: `jobs` (init `initialJobs`), `jobTitle`, `location`, `isLoading`, `searchStatus`.
- `handleSearch()` async: `setIsLoading(true)`; `POST /api/agent/find` with `{ jobTitle, location }`; on success `setJobs(res.jobs)` + `setSearchStatus({ jobsFound, strongMatches })`; `finally setIsLoading(false)`.
- `useMemo` pipeline depends on `jobs` state.
- Render `<SearchControls />` as a child above the filter/table/pagination, passing all props.
- No `router.refresh()`.

### Step 5 — `components/find-jobs/SearchControls.tsx` (update → leaf)
Remove all internal state/handlers. New props:
```ts
type Props = {
  jobTitle: string; location: string; isLoading: boolean;
  searchStatus: { jobsFound: number; strongMatches: number } | null;
  onJobTitleChange: (v: string) => void;
  onLocationChange: (v: string) => void;
  onSearch: () => void;
};
```
Button disabled + "Finding jobs..." while `isLoading`. Success banner reads from `searchStatus`.

### Step 6 — `app/find-jobs/page.tsx` (update)
- Add `export const dynamic = 'force-dynamic'`.
- Delete `MOCK_JOBS`. After auth, query:
```ts
const { data: jobs } = await insforge.database
  .from("jobs").select("*")
  .eq("user_id", authData.user.id)
  .order("found_at", { ascending: false });
```
- Render only `<FindJobsClient initialJobs={jobs ?? []} />` (remove the separate `<SearchControls />`).

### Step 7 — `types/index.ts` (fix)
Verify/fix `Job.source` → `JobSource` (`'search' | 'url'`), not `'linkedin' | 'url'`.

### Step 8 — `components/profile/ProfileForm.tsx` (cleanup)
- Delete the Connected Accounts card (~lines 551–582).
- Remove `const [linkedinConnected] = useState(profile?.linkedin_connected ?? false)`.
- In `handleSave`, pass through the existing DB value: `linkedin_connected: profile?.linkedin_connected ?? false`.
- Leave the LinkedIn URL `<input>` under Personal Info untouched.

---

## Files created / modified
| File | Change |
|------|--------|
| `lib/adzuna.ts` | New — type, country detection, search |
| `agent/job-matcher.ts` | New — batch Nemotron scoring |
| `app/api/agent/find/route.ts` | New — orchestration route |
| `components/find-jobs/FindJobsClient.tsx` | Update — container: search + jobs state |
| `components/find-jobs/SearchControls.tsx` | Update — presentational leaf |
| `app/find-jobs/page.tsx` | Update — force-dynamic, DB query, render only FindJobsClient |
| `types/index.ts` | Fix — Job.source type |
| `components/profile/ProfileForm.tsx` | Update — remove Connected Accounts card |

---

## Verification
1. `npm run dev` → `/find-jobs`. Enter title + location → Find Jobs.
2. Button disables → "Finding jobs..."; after batch scoring, success banner shows counts.
3. Jobs table populates immediately — no page reload.
4. Filter/sort/pagination still work (useMemo on `jobs` state).
5. Hard-reload `/find-jobs` → real jobs persist (force-dynamic DB query).
6. InsForge DB: new `jobs` rows scoped to user; one `agent_runs` row `status: 'completed'` with correct count.
7. `/profile` → Connected Accounts card gone; LinkedIn URL field still present and saves.
8. `npm run lint` clean.
