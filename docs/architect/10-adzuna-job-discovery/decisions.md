# Architect Session — Feature 10: Adzuna Job Discovery

## Decisions

This file records every architectural decision settled during the `/architect` session for Feature 10. Each section states the decision, how it works, why it was chosen, and what the rejected alternative would have cost.

---

### 1. FindJobsClient becomes the container; SearchControls drops to a leaf

**Decision:** Move all search state (`jobTitle`, `location`, `isLoading`, `searchStatus`) and the new `jobs` state into `FindJobsClient`. It renders `SearchControls` as a child. `page.tsx` renders only `<FindJobsClient initialJobs={...} />`.

**How it works:**

```
page.tsx
  └─ <FindJobsClient initialJobs={dbJobs} />
       ├─ owns: jobTitle, location, isLoading, searchStatus, jobs (useState)
       ├─ handleSearch() -> POST /api/agent/find -> setJobs(res.jobs)
       ├─ <SearchControls ...props />   (presentational leaf)
       ├─ <JobFilters ...props />
       ├─ <JobsTable jobs={pageItems} />
       └─ <JobsPagination ...props />
```

**Why this choice:** In Feature 09's final structure, `SearchControls` and `FindJobsClient` were **siblings** under `page.tsx`. Siblings cannot share state. The search produces jobs; the table consumes jobs. For the search to update the table without a page reload, the jobs state has to live in a common ancestor. Promoting `FindJobsClient` to own that state keeps the established container/leaf pattern intact — it already owned the filter/sort/pagination pipeline, so the jobs array naturally belongs there too.

**Alternative considered — a new parent wrapper (`FindJobsPageClient`):** Create a third component that owns `jobs` and renders both `SearchControls` and `FindJobsClient` as siblings, lifting only the jobs array up via callback. This was rejected because it adds a file and a layer of indirection for no benefit: `FindJobsClient` is already a client component that owns derived list state. Splitting "owns jobs" from "owns the filtered view of jobs" across two components would scatter one cohesive concern.

**Cost of the rejected path:** An extra component, an extra props hop, and a fuzzier mental model — two components would both have a claim on "the jobs," inviting future bugs about which one is the source of truth.

---

### 2. Batch scoring (one Nemotron call) over sequential (ten calls)

**Decision:** Score all Adzuna results in a single Nemotron call that returns `{ scores: [...] }`, an array aligned by index to the input jobs.

**Why this choice:** The first draft of the plan used 10 sequential calls (~20–30s, with a loading state). The developer revised this to a single batch call. One round-trip is faster (~3–5s) and removes any concern about OpenRouter free-tier throttling that 10 back-to-back requests could trigger.

**Alternative considered — sequential scoring:** Safer against a single malformed response (one bad score doesn't corrupt the batch) and conceptually simpler. Rejected for speed and to minimise free-tier request count.

**Cost of the chosen path — and its mitigation:** A batch call couples all scores into one response. If the model returns the wrong number of scores or reorders them, jobs get mismatched scores. This is mitigated by the **batch-ordering guard** (decision 5).

---

### 3. API returns the saved jobs array; client calls setJobs (no router.refresh)

**Decision:** `POST /api/agent/find` returns `{ jobs: Job[], successMessage: string }`. The client sets `jobs` state directly from the response.

**Why this choice:** The search just wrote the rows and already has them in hand. Returning them lets the table update instantly with no second round-trip. Using `router.refresh()` would discard the data we already have and force the Server Component to re-query the DB — a wasted fetch and a visible flash.

**Alternative considered — `router.refresh()` after save:** The API returns only counts; the client calls `router.refresh()`, re-running the Server Component which re-queries the DB. Rejected because it's a redundant DB read for data the API already produced, and it re-renders the whole page rather than just updating the list.

**Cost of the rejected path:** An extra DB query per search and a heavier re-render for no correctness gain.

---

### 4. force-dynamic on page.tsx — complementary to, not redundant with, setJobs

**Decision:** Add `export const dynamic = 'force-dynamic'` to `page.tsx` **and** update jobs via `setJobs` in the client.

**Why both:** They cover different moments. `setJobs` handles the **in-session** update right after a search — no reload. `force-dynamic` handles a **fresh navigation or hard reload** — it guarantees the Server Component re-queries the DB instead of serving a statically cached render, so previously-saved jobs always appear. Without `force-dynamic`, Next.js could cache the first render and show a stale (or empty) list on return visits.

**Alternative considered — rely on setJobs alone:** Rejected because it only covers the live session. A user who searches, navigates away, and comes back would hit a cached empty render.

---

### 5. Batch-ordering guard

**Decision:** If the scores array length ≠ the jobs array length, fall back to `matchScore: 0` (empty reason/skills) for the unmatched jobs rather than failing the route.

**Why:** Index alignment is the contract between the batch prompt and the insert loop. A free-tier model can occasionally return a short or reordered array. Failing the whole search because one score is missing is a worse outcome than saving that job with a neutral score. The search still succeeds; the user still sees jobs.

**Cost:** A job can be saved with an unfairly low score on a malformed response. Acceptable — rare, non-fatal, and re-searchable.

---

### 6. Best-effort scoring — incomplete profile never blocks the search

**Decision:** Fetch the profile with `maybeSingle()`; if it's null or sparse, still run the search and score on whatever data exists.

**Why:** Blocking a search because the profile isn't complete is a hostile UX surprise — the user clicked "Find Jobs," not "Validate Profile." A sparse profile yields generic-but-not-wrong scores. The product stays usable from the first session.

**Alternative considered — gate on `profile.is_complete`:** Return 400 until the profile is finished. Rejected as user-hostile for a discovery feature.

---

### 7. Model stays Nemotron — "GPT-4o" was shorthand

**Decision:** Keep `nvidia/nemotron-3-ultra-550b-a55b:free` for scoring.

**Why:** The developer's notes said "GPT-4o batch scoring call," but the project rule (CLAUDE.md + `library-docs.md`) is Nemotron only. The `library-docs.md` itself carries stale "GPT-4o synthesis" labels over code that actually calls Nemotron — the same shorthand. Clarified and aligned on Nemotron.

---

### 8. Page scope — Feature 10 updates page.tsx to real DB data

**Decision:** Feature 10 replaces `MOCK_JOBS` in `page.tsx` with a real user-scoped DB query. Feature 11 later moves filter/sort/pagination from client-side `useMemo` to DB queries.

**Why:** Without this, the feature would be invisible — the search would write rows the page never reads. The clean seam: Feature 10 makes jobs **real**; Feature 11 makes filtering **server-side**.

---

### 9. Country detection by keyword, not geolocation

**Decision:** `detectCountry(location)` does a keyword match — uk/england/scotland/wales → `gb`, australia → `au`, canada → `ca`, else `us`.

**Why:** Adzuna's endpoint requires a country code in the path. A keyword match on the free-text location field is sufficient for an IT-jobs MVP and avoids pulling in a geolocation dependency. Default `us` is the safe fallback.

---

### 10. Remove the Connected Accounts card; keep the LinkedIn URL field

**Decision (out-of-band cleanup bundled into this session):** Delete the non-functional Connected Accounts card from the top of the Profile page. Keep the LinkedIn URL `<input>` under Personal Info. In `handleSave`, pass the existing `linkedin_connected` DB value through unchanged.

**Why:** The card's connect/disconnect button was never wired — dead UI. Removing it cleans the page without touching the LinkedIn URL field, which is a real, saved profile field. Passing the DB value through in `handleSave` avoids accidentally resetting a column we no longer surface in the UI.
