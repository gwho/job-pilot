# Explanation — Feature 10-adzuna-job-discovery: Adzuna Job Discovery

## 1. The end-to-end data flow

Feature 09 left the Find Jobs page rendering a static `MOCK_JOBS` array, with a `SearchControls` button whose `handleSearch` just set a hardcoded success banner. Feature 10 turns that into a real loop. Following a single click of "Find Jobs":

1. `FindJobsClient.handleSearch()` sets `isLoading` true and POSTs `{ jobTitle, location }` to `/api/agent/find`.
2. The route authenticates via `createInsforgeServer().auth.getCurrentUser()`. No user → 401.
3. It parses the body and rejects an empty `jobTitle` with 400 — there is no point searching Adzuna with no `what`.
4. `detectCountry(location)` maps the free-text location to an Adzuna country code.
5. It fetches the profile with `.maybeSingle()` — deliberately tolerant of a missing row (see §4).
6. It inserts an `agent_runs` row with `status: "running"` and captures `runId`. This row is the audit trail for the search and the foreign key (`run_id`) on every job it produces.
7. It fires the `job_search_started` PostHog event.
8. `searchJobs(...)` calls Adzuna. On a thrown error the run is marked `failed` and the route returns 500.
9. `scoreJobs(adzunaJobs, profile)` makes **one** Nemotron call to score the whole batch.
10. Each Adzuna result is mapped to a `JobInsert` record (with its index-aligned score) and all are inserted into `jobs` in a single `.insert(records).select()` — the `.select()` returns the saved rows, including their DB-generated `id` and `found_at`.
11. A `job_found` event fires for each row whose `match_score >= MATCH_THRESHOLD`.
12. The run is updated to `completed` with `jobs_found` and `completed_at`.
13. The route returns `{ jobs: insertedJobs, jobsFound, strongMatches, successMessage }`.
14. Back in the client, `handleSearch` calls `setJobs(data.jobs)` and `setSearchStatus(...)`, resets to page 1, and clears `isLoading` in `finally`. The `useMemo` filter/sort/pagination pipeline recomputes against the new `jobs` and the table re-renders — **no page reload, no second fetch**.

The key property: the API returns the rows it just wrote, so the client never has to re-query for them. The DB read in `page.tsx` exists only to populate the *initial* render on navigation (§3).

## 2. Why batch scoring — and the failure mode it introduced

The first plan scored jobs sequentially (one Nemotron call per job, ~20–30s with a loading state). During the architect session this was revised to a single batch call that scores all jobs together and returns `{ scores: [...] }`. The motivation was speed (one round-trip instead of ten) and a smaller footprint against OpenRouter's free tier, which can throttle ten back-to-back requests.

Batching is not a free win. Collapsing ten independent calls into one also collapses ten independent failure domains into one, and it introduces a failure mode that does not exist in the sequential design: **index drift**. The route trusts that `scores[i]` describes `adzunaJobs[i]`. If the model returns nine scores instead of ten, or silently reorders them, every job past the drift point gets the wrong score — and nothing throws, so the wrong data lands in the DB unnoticed.

`scoreJobs` therefore does not trust the model's array shape. After parsing, it rebuilds the result by mapping over the *input* jobs, not the model's output:

```ts
return jobs.map((_, i) => {
  const s = scores[i];
  if (!s || typeof s.matchScore !== "number") return FALLBACK_SCORE;
  return {
    matchScore: Math.max(0, Math.min(100, Math.round(s.matchScore))),
    matchReason: s.matchReason ?? "",
    matchedSkills: Array.isArray(s.matchedSkills) ? s.matchedSkills : [],
    missingSkills: Array.isArray(s.missingSkills) ? s.missingSkills : [],
  };
});
```

This guarantees the output length always equals the input length, clamps the score to 0–100, and substitutes a neutral `FALLBACK_SCORE` for any entry the model dropped or malformed. The whole function is wrapped in try/catch that returns all-neutral scores on any thrown error. The contract is: **a job is always saved, even if it could not be scored.** This is the price of batching, paid deliberately.

## 3. `setJobs` and `force-dynamic` are not redundant

It is tempting to think the client's `setJobs` makes `force-dynamic` on the page pointless, or vice versa. They cover disjoint moments.

`setJobs(res.jobs)` is a pure client-state update using data the API already returned. It handles the **in-session** case: the user searches and the table updates instantly with zero extra network. It does nothing for someone who navigates away and comes back — that is a fresh server render with its own `jobs` array.

`export const dynamic = "force-dynamic"` governs that fresh render. Without it, Next.js may cache the route's output, and a user who searched, left, and returned could be served a stale or empty list captured before their first search. `force-dynamic` forces the Server Component to re-execute — and therefore re-query the DB — on every request.

The mental model worth carrying forward: in-session interactivity is a React client-state concern (`setJobs`); cross-navigation freshness is a Next render-cache concern (`force-dynamic`). Confusing the two produces the classic "it works until I reload" bug.

A deliberate consequence: we do **not** call `router.refresh()` after the search. `router.refresh()` would re-run the Server Component and re-query the DB for rows the API already handed us — a wasted query and a heavier re-render. Returning the jobs and calling `setJobs` is strictly cheaper.

## 4. Best-effort profile and `maybeSingle()` vs `single()`

The existing resume route fetches the profile with `.single()`, which errors if zero rows match. This route uses `.maybeSingle()`, which returns `data: null` instead. The difference is intentional and load-bearing.

Find Jobs is a top-of-funnel feature. Its entire purpose is to let a user type a job title and see results. Blocking the search because the profile is incomplete — or worse, erroring because no profile row exists yet — would defeat that purpose. So the profile is treated as best-effort: a `null` profile flows into `scoreJobs`, where `buildProfileSummary(null)` emits "No profile on file. Score from the job title and description only." Nemotron then scores on the job text alone — generic, but a real ordered list the user can act on.

This is the same "bend, don't break" instinct as the scoring fallback in §2: the feature degrades rather than refusing to run.

## 5. Mapping an `AdzunaJob` to a `JobInsert`

The `JobInsert` type is `Omit<Job, 'id' | 'found_at'> & { id?, found_at? }`. Crucially, the omitted fields are only `id` and `found_at` — every *other* column on `Job` is still required by the type, even the nullable ones. That is why the mapping in the route explicitly sets `responsibilities: null, requirements: null, nice_to_have: null, benefits: null, about_company: null, company_research: null` rather than leaving them off. TypeScript would reject the object literal otherwise: a nullable column is "may be null," not "may be omitted."

Two field translations are worth noting:
- **Salary** is a formatted string, not a number. Adzuna gives `salary_min`/`salary_max` as numbers; the DB column `salary` is text. The route formats `$${Math.round(min/1000)}k - $${Math.round(max/1000)}k`, and only when both bounds are present — otherwise `null`.
- **`job_type`** is a constrained union (`'fulltime' | 'parttime' | 'contract'`). Adzuna's `contract_type` is free-ish (`part_time`, `contract`, or absent). The route maps `part_time → parttime`, `contract → contract`, and everything else (including missing) to `fulltime`, so the value always satisfies the `JobType` union.

## 6. The "GPT-4o" naming trap

The developer's working notes twice referred to a "GPT-4o batch scoring call." This project does not use GPT-4o — the rule in `CLAUDE.md` and `context/library-docs.md` is Nemotron only (`nvidia/nemotron-3-ultra-550b-a55b:free`). The confusion is latent in the repo itself: `library-docs.md` carries stale "GPT-4o synthesis" headings over code that actually calls Nemotron.

There is a second, related point that surfaced during implementation: the scorer `import OpenAI from "openai"`. That is *not* a contradiction. The `openai` package is only an HTTP client that speaks the OpenAI-compatible wire format. The client is configured with `baseURL: "https://openrouter.ai/api/v1"` and the OpenRouter API key, and the model string is Nemotron. No request reaches OpenAI's servers — OpenRouter implements the same `chat.completions.create` shape, so the OpenAI SDK is just the transport. This exactly mirrors `agent/extractor.ts`. The class name is a wire-protocol label, not a vendor choice. The lesson: when a label and the code under it disagree, the label is a trap for the next reader — name it explicitly rather than route around it silently.

## 7. The `JobSource` "fix" that wasn't

The plan listed a step to fix `Job.source` from `'linkedin' | 'url'` to `'search' | 'url'`. On inspection, `types/index.ts` already declared `export type JobSource = 'search' | 'url'` and `Job.source: JobSource`. A grep confirmed the only `linkedin` references were the legitimate profile fields `linkedin_url` and `linkedin_connected`. So no change was made. This is recorded honestly: a planned edit that turned out to be unnecessary is not an edit to invent. The plan's assumption about the type was simply out of date relative to the actual file.

## 8. Removing UI is a data operation

The Connected Accounts card on the Profile page had a connect/disconnect button wired to nothing — dead UI implying a capability that did not exist. Removing it was straightforward, but the `linkedin_connected` column it surfaced needed care. That card was the column's only UI, yet `handleSave` writes the *entire* profile on every save. The original code read the value from a `linkedinConnected` state initialised from the profile and passed it back. Deleting the card and its state without thought would leave `handleSave` referencing an undefined variable.

That is exactly what happened mid-edit: after removing `const [linkedinConnected] = useState(...)` but before updating `handleSave`, the IDE flagged `Cannot find name 'linkedinConnected'`. The fix completed the second half of the change: `handleSave` now sends `linkedin_connected: profile?.linkedin_connected ?? false`, passing the stored value straight back through. The UI shrinks; the column's value is preserved on every subsequent save. The LinkedIn *URL* field is a separate, user-edited profile field and was left untouched. The general rule: before deleting a control that participated in a save path, trace every column it touched and confirm the save still preserves them.

## 9. Build/type-check note

`npx tsc --noEmit` surfaced errors — but all of them were inside `.next/types/` generated files (with duplicated ` 3.ts`/` 4.ts` filenames, the signature of a previous interrupted build). Filtering the output to project source files (`grep -vE "^\.next/"`) returned no errors. These stale artifacts regenerate cleanly on a real `next build` and are not related to this feature. ESLint passed clean after replacing an unused `SUPPORTED_COUNTRIES` array (flagged as "assigned a value but only used as a type") with a plain `type Country = "gb" | "au" | "ca" | "sg" | "us"` union.
