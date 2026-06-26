# Tutorial 17 — Adzuna Job Discovery: Batch Scoring, the Adapter Pattern, and Two Layers of Freshness

**After completing this tutorial you will understand:** why `FindJobsClient` was promoted to a container and `SearchControls` demoted to a leaf — reversing the sibling + `router.refresh()` design Tutorial 15 anticipated; how a single batch LLM call introduces an index-drift failure mode and how the ordering guard defends against it; why a client named `OpenAI` correctly talks to Nemotron through OpenRouter; why `setJobs` and `force-dynamic` are complementary rather than redundant; and how to delete dead UI without corrupting the column it used to surface.

---

> [!NOTE]
> **Prerequisites:**
> - Tutorial 15 (`../15-find-jobs-ui/README.md`) — builds the Find Jobs UI this feature wires to real data. **This tutorial revises two claims made there** (the propless `SearchControls` and the `router.refresh()` plan); you will get the most out of it if you remember those.
> - Tutorial 16 (`../16-ai-model-smoke-test/README.md`) — the Nemotron-via-OpenRouter call shape reappears here in `scoreJobs`.
> - Tutorial 10 (`../10-profile-extraction/README.md`) — the `agent/` module pattern and the `import OpenAI` transport convention introduced there are reused verbatim.
>
> Open [`lib/adzuna.ts`](../../../lib/adzuna.ts),
> [`agent/job-matcher.ts`](../../../agent/job-matcher.ts),
> [`app/api/agent/find/route.ts`](../../../app/api/agent/find/route.ts),
> [`components/find-jobs/FindJobsClient.tsx`](../../../components/find-jobs/FindJobsClient.tsx),
> [`components/find-jobs/SearchControls.tsx`](../../../components/find-jobs/SearchControls.tsx), and
> [`app/find-jobs/page.tsx`](../../../app/find-jobs/page.tsx) alongside this tutorial.

---

## CS & language concepts in this tutorial

| Concept | Where it appears | Category |
|---------|-----------------|----------|
| Adapter pattern | `import OpenAI` configured with OpenRouter `baseURL` + Nemotron model | Design patterns |
| Positional correspondence / index invariant | `jobs.map((_, i) => scores[i] ?? FALLBACK_SCORE)` | Data structures |
| Graceful degradation | `maybeSingle()` profile, all-neutral fallback scores | System design |
| State machine + audit record | `agent_runs`: `running → completed / failed` | System design |
| Two-layer cache freshness | `setJobs` (client state) vs `force-dynamic` (render cache) | Distributed systems |

---

## How to use an LLM before this tutorial

Run these prompts before reading code. Budget 25–35 minutes.

### Concept 1 — The adapter pattern and wire-compatible clients

> "Some API providers implement another provider's exact request/response format so existing client libraries 'just work' against them. Explain the adapter pattern in software design. Then explain how an SDK named for one vendor can be pointed at a different vendor's server by changing only a base URL and an API key, while the model named in each request is the new vendor's. Give a concrete example and quiz me."

*What to listen for:* The adapter pattern lets a client written against interface A talk to a system that natively speaks interface B, as long as B exposes A's shape. An "OpenAI-compatible" endpoint implements the same `POST /chat/completions` request and response schema. The OpenAI SDK is just an HTTP client for that schema — set `baseURL` to the new host and `apiKey` to the new key, and every request goes there instead. The `model` field is a plain string the *server* interprets, so it can name any model the new host serves. The class name is a label for the wire format, not a routing decision.

*Practice question:* If a request sets `baseURL: "https://openrouter.ai/api/v1"` and `model: "nvidia/nemotron-3-ultra-550b-a55b:free"`, which company's servers handle it, and which model produces the tokens?

---

### Concept 2 — Positional correspondence and the index invariant

> "I have an array of 10 inputs and I ask a service to return an array of 10 results, one per input, in the same order. I then pair them by index: `result[i]` belongs to `input[i]`. What silent bug appears if the service returns 9 results, or returns them reordered? How would I make my pairing code robust so a malformed response can never assign the wrong result to an input? Quiz me."

*What to listen for:* Index pairing assumes a strict positional invariant: position carries the identity link. If the response is short, every pair past the gap shifts and silently misaligns — no exception, just wrong data. The robust move is to iterate over the *trusted* array (your inputs) and look up `result[i]` defensively, substituting a safe default when it is missing or malformed, so the output length always equals the input length. Reordering with the same length is undetectable by length checks alone — you would need an explicit id on each result to catch it.

*Practice question:* Why is iterating `inputs.map((_, i) => results[i] ?? fallback)` safer than iterating `results.map(...)` directly?

---

### Concept 3 — Graceful degradation for top-of-funnel features

> "Explain 'graceful degradation' / 'best-effort' design. When is it correct for a feature to produce a lower-quality result instead of refusing to run? Contrast a top-of-funnel discovery feature with a payment step. Quiz me on which should hard-fail on missing input and which should degrade."

*What to listen for:* Graceful degradation means the system keeps working with reduced quality when an input is missing, rather than erroring. It is correct when the cost of refusing (a dead-end for the user) exceeds the cost of a weaker result. A discovery feature should degrade — show *some* jobs even with an empty profile — because its job is to get the user to a first result. A payment step should hard-fail on a missing card, because a wrong result there is catastrophic. The choice is about blast radius, not effort.

*Practice question:* A job search scores results against a profile. The user has no profile yet. Should the search return 400, or run anyway? Why?

---

### Concept 4 — Audit records and state machines for long operations

> "I'm building an operation that takes several seconds and calls external APIs. Before I start, I write a row marking it 'running'; when it finishes I update it to 'completed', or to 'failed' if it threw. Why is creating the record *before* the work better than after? What does this give me for debugging and metrics? Relate it to the idea of a state machine. Quiz me."

*What to listen for:* Writing the record first means even a crash leaves evidence the operation was attempted — a row stuck in 'running' is itself a signal. Creating it after would lose all trace of failed attempts. The status field is a small state machine (`running → completed | failed`) whose transitions are an audit trail and the join key for child records produced by the run. This is the foundation of observability for async work.

*Practice question:* If the external API call throws, which status should the row end in, and what would be lost if the row had only been created on success?

---

### Concept 5 — Two layers of data freshness

> "In a server-rendered web app, I have two separate mechanisms that can make a list show new data: updating React state on the client after a fetch, and forcing the server to re-render (and re-query the database) on navigation. Explain why these are not the same thing and cover different moments in a user's session. What bug appears if I rely on only one? Quiz me."

*What to listen for:* Client state (`setState`) updates the current view instantly using data already in hand — it covers the in-session moment. Forcing a fresh server render covers a *new* request: navigating away and back, or a hard reload, where the client state is gone and the page is rebuilt from the server. Relying only on client state means a return visit can show a stale or empty server render; relying only on the server render means re-querying for data you already had. They are disjoint layers.

*Practice question:* A user searches, sees results via client state, navigates to another page, then returns. Which mechanism populates the list on the return visit?

---

## Architecture: what Feature 10 wires

Feature 09 (Tutorial 15) rendered `/find-jobs` from `MOCK_JOBS`. Feature 10 deletes the mocks and makes the page real: a search calls Adzuna, scores every result against the profile in one Nemotron call, saves the rows, and returns them so the table updates with no reload.

```
CLICK "Find Jobs"  (SearchControls — presentational leaf)
        │ onSearch()
        ▼
FindJobsClient.handleSearch()   [CLIENT — container, owns jobs state]
        │ POST /api/agent/find  { jobTitle, location }
        ▼
┌──────────────────────────────────────────────────────────────┐
│ app/api/agent/find/route.ts            [SERVER]               │
│  1. getCurrentUser() ............... 401 if none              │
│  2. parse body ..................... 400 if no jobTitle       │
│  3. detectCountry(location)                                   │
│  4. profile = .maybeSingle() ....... null OK (best-effort)    │
│  5. INSERT agent_runs (running) → runId                       │
│  6. PostHog: job_search_started                               │
│  7. searchJobs() ── throws? → run=failed, 500                │
│  8. scoreJobs(jobs, profile) ── one Nemotron call, never throws│
│  9. map AdzunaJob+score → JobInsert[]                         │
│ 10. INSERT jobs .select() → insertedJobs                      │
│ 11. PostHog: job_found per strong match                       │
│ 12. UPDATE agent_runs (completed, jobs_found)                 │
│ 13. return { jobs, jobsFound, strongMatches, successMessage } │
└───────────────────────────────┬──────────────────────────────┘
                                 │ res.jobs
                                 ▼
        setJobs(res.jobs)  → useMemo pipeline → table re-renders
                                 │
        (separately) GET /find-jobs on navigation:
        page.tsx [force-dynamic] → DB query scoped to user_id → initialJobs
```

**Key invariants for this feature:**
1. `scoreJobs` output is index-aligned to its input and **never throws** — a job is always saved, even unscored.
2. Adzuna calls always include `category=it-jobs`; `where` is omitted when location is empty; country is one of `gb/au/ca/sg/us` (real endpoints only).
3. `FindJobsClient` is the single owner of `jobs` state. `SearchControls` holds none.

---

## Part 1 — The architecture pivot: container promotion over sibling refresh

Tutorial 15 (Part 2) stated two things about how Feature 10 *would* work: `SearchControls` has no props and is self-contained, and it would synchronise with the table by calling `router.refresh()`. Feature 10 chose differently on both counts. Understanding why is the spine of this whole feature.

Open [`components/find-jobs/FindJobsClient.tsx`](../../../components/find-jobs/FindJobsClient.tsx):

```tsx
export function FindJobsClient({ initialJobs }: Props) {
  // Search state — owned here so a search can update the table without a reload.
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [jobTitle, setJobTitle] = useState("");
  const [location, setLocation] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [searchStatus, setSearchStatus] = useState<SearchStatus | null>(null);

  // View state — filter / sort / pagination over the current jobs.
  const [filterText, setFilterText] = useState("");
  const [matchFilter, setMatchFilter] = useState<MatchFilter>("all");
  const [sort, setSort] = useState<Sort>("score");
  const [page, setPage] = useState(1);
```

In Tutorial 15, `SearchControls` and `FindJobsClient` were **siblings** under the page. That was fine while the search did nothing — `handleSearch` set a hardcoded banner and the table rendered a static prop, so no data ever crossed between them. Feature 10 breaks that peace: the search must *produce* the jobs the table *consumes*. The moment two siblings need to share a runtime-mutable value, you have three options — lift state to a common ancestor, introduce a new ancestor, or reach for a global store.

The page itself can't hold the state: `app/find-jobs/page.tsx` is an async Server Component, and Server Components have no `useState`. So the common ancestor of "search" and "table" has to be a client component. The cheapest such ancestor is `FindJobsClient`, which already owned the filter/sort/pagination pipeline. Promoting it to also own `jobs`, `jobTitle`, `location`, `isLoading`, and `searchStatus` keeps everything in one cohesive container. `SearchControls` becomes a child of it, demoted to a presentational leaf.

The rejected alternative was a new `FindJobsPageClient` wrapper that owned `jobs` and rendered both `SearchControls` and `FindJobsClient` as siblings. That splits "owns the jobs array" from "owns the filtered view of the jobs array" across two components — two claims on overlapping state, a fuzzier source of truth, and an extra file for no benefit.

> **System design — state at the lowest common ancestor:** Runtime-mutable state shared by several components belongs in the lowest component that is a common ancestor of everything reading or writing it. Here that derivation lands on `FindJobsClient`. Pushing it higher (a new wrapper) scatters cohesion; the page can't hold it at all because Server Components are stateless by construction.

**Checkpoint:** Why can't `app/find-jobs/page.tsx` itself hold the shared `jobs` state, given it is the common ancestor of `SearchControls` and the table?

<details>
<summary>Reveal answer</summary>

`page.tsx` is an async Server Component. Server Components run once on the server, render, and are done — there is no `useState`, no event handler, no re-render on interaction. Any runtime-mutable state must live in a client component. So the common ancestor that holds the search/jobs state must itself be a client component, and the cheapest one already present is `FindJobsClient`. That is exactly why the state was lifted *into* `FindJobsClient` rather than up into the page.

</details>

**Checkpoint:** Tutorial 15 predicted `router.refresh()` as the sync mechanism. Feature 10 doesn't use it. What does it use instead, and why is `router.refresh()` strictly wasteful here?

<details>
<summary>Reveal answer</summary>

It uses `setJobs(res.jobs)` — the API returns the rows it just inserted, and the client sets them into state directly. `router.refresh()` would tell Next.js to re-run the Server Component, which would re-query the DB for the rows the API *already returned* — a redundant read and a heavier server-down re-render, for data we already hold in the response. Returning the jobs and calling `setJobs` is strictly cheaper. (The DB query in `page.tsx` still exists, but only to seed the *initial* render on navigation — see Part 5.)

</details>

---

## Part 2 — `lib/adzuna.ts`: the search helper and its invariants

Open [`lib/adzuna.ts`](../../../lib/adzuna.ts):

```ts
export async function searchJobs(
  jobTitle: string,
  location: string,
  country: string = "us",
): Promise<AdzunaJob[]> {
  const params = new URLSearchParams({
    app_id: process.env.ADZUNA_APP_ID!,
    app_key: process.env.ADZUNA_APP_KEY!,
    what: jobTitle,
    category: "it-jobs", // always filter to IT jobs
    results_per_page: "10",
    "content-type": "application/json",
  });

  // Only add `where` if location is provided — never pass an empty value.
  if (location.trim()) {
    params.set("where", location);
  }

  const response = await fetch(
    `https://api.adzuna.com/v1/api/jobs/${country}/search/1?${params.toString()}`,
  );

  if (!response.ok) {
    throw new Error(`Adzuna API error: ${response.status}`);
  }

  const data = (await response.json()) as AdzunaSearchResponse;
  return data.results ?? [];
}
```

Three project invariants are baked in here, each documented in `context/library-docs.md`. `category=it-jobs` is always sent — JobPilot is an IT-jobs product and an unfiltered search would return noise. `where` is set *only* when location is non-empty: Adzuna treats an empty `where` as a malformed filter, so the parameter is omitted entirely rather than passed blank. And the function **throws** on a non-ok response rather than returning `[]` — it is the caller's job (the route) to decide how a search failure is surfaced, and conflating "zero results" with "the API errored" would hide outages.

The country comes from `detectCountry`:

```ts
type Country = "gb" | "au" | "ca" | "sg" | "us";

export function detectCountry(location: string): Country {
  const loc = location.toLowerCase();

  if (
    loc.includes("united kingdom") || loc.includes("uk") ||
    loc.includes("england") || loc.includes("scotland") ||
    loc.includes("wales") || loc.includes("london")
  ) {
    return "gb";
  }
  if (loc.includes("australia") || loc.includes("sydney") || loc.includes("melbourne")) {
    return "au";
  }
  if (loc.includes("canada") || loc.includes("toronto") || loc.includes("vancouver")) {
    return "ca";
  }
  if (loc.includes("singapore")) {
    return "sg";
  }
  return "us";
}
```

This is keyword matching, not geolocation — sufficient for an MVP and free of an external dependency. The `Country` union is deliberately limited to country codes Adzuna actually serves. During this build, Hong Kong was requested; Adzuna has no `hk` endpoint, so adding it would have produced a URL like `…/api/jobs/hk/search/1` that returns 404 and fails every HK search. Singapore (`sg`) — a real Adzuna market — was added instead, and Hong Kong locations fall through to the `us` default.

> **Design patterns — fail-fast at the boundary:** `searchJobs` throws on a non-ok HTTP status instead of swallowing it into an empty array. Pushing the error to the boundary keeps "no jobs found" and "the upstream is down" as distinct outcomes the caller can handle differently — the route marks the run `failed` and returns 500 for the second, but treats the first as a normal empty result.

**Checkpoint:** Why is `where` omitted entirely when location is empty, rather than passed as `where=""`?

<details>
<summary>Reveal answer</summary>

Adzuna treats an empty `where` as a malformed location filter, which can error or return degraded results. Omitting the parameter means "no location constraint" — a nationwide search — which is the intended behaviour when the user leaves location blank. The `if (location.trim())` guard is the difference between "search everywhere" and "search nowhere / error."

</details>

**Checkpoint:** Hong Kong was requested as a country. Why was adding `hk` the wrong move, and what would the runtime symptom have been?

<details>
<summary>Reveal answer</summary>

Adzuna exposes no `hk` endpoint. Adding `hk` to the `Country` union and routing Hong Kong keywords to it would build the URL `https://api.adzuna.com/v1/api/jobs/hk/search/1`, which returns 404. `searchJobs` would throw on the non-ok response, the route would mark the run `failed`, and every Hong Kong search would return a 500 to the user. Surfacing the constraint (no `hk` endpoint) and choosing a real market (`sg`) avoided shipping a guaranteed-broken code path.

</details>

---

## Part 3 — `agent/job-matcher.ts`: batch scoring, the transport trap, and the index guard

Open the top of [`agent/job-matcher.ts`](../../../agent/job-matcher.ts):

```ts
// NOTE: The `openai` package is only the HTTP transport — it speaks the
// OpenAI-compatible wire format that OpenRouter implements. The baseURL points
// at OpenRouter and the model is Nemotron; no request reaches OpenAI. This
// matches agent/extractor.ts and the Nemotron section of context/library-docs.md.
import OpenAI from "openai";
```

This comment exists because the import looks like a contradiction: the project rule is Nemotron-only, yet the file imports `OpenAI`. There is no contradiction. The `openai` package is just an HTTP client for the OpenAI-compatible request/response schema. OpenRouter implements that schema, so the client is configured to point at it:

```ts
const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY!,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: { "HTTP-Referer": "https://job-pilot.app", "X-Title": "JobPilot" },
});
```

The `model` string in the request is Nemotron. No traffic reaches OpenAI's servers — the class name labels the *wire format*, not the vendor. This mirrors `agent/extractor.ts` from Tutorial 10. The same naming confusion is latent in the repo itself: `library-docs.md` carries stale "GPT-4o synthesis" headings over code that calls Nemotron. When a label and the code under it disagree, the label is a trap for the next reader — which is exactly why the file opens with a comment naming the trap.

> **Design patterns — Adapter / wire-compatible client:** An "OpenAI-compatible" endpoint is an adapter: it exposes a different system (OpenRouter routing to Nemotron) behind the interface an existing client already speaks. Swapping `baseURL` + `apiKey` retargets every call. The pattern is everywhere — S3-compatible object stores, Postgres-wire-compatible databases — and the lesson is identical: the client library names a protocol, not a destination.

### Batch scoring and the index invariant

The whole batch is scored in one call, and the result is reassembled defensively:

```ts
const raw = response.choices[0].message.content!;
const parsed = JSON.parse(raw) as { scores?: JobScore[] };
const scores = parsed.scores ?? [];

// Batch-ordering guard — align scores to jobs by index, falling back where
// the model returned too few entries or a malformed shape.
return jobs.map((_, i) => {
  const s = scores[i];
  if (!s || typeof s.matchScore !== "number") {
    return FALLBACK_SCORE;
  }
  return {
    matchScore: Math.max(0, Math.min(100, Math.round(s.matchScore))),
    matchReason: s.matchReason ?? "",
    matchedSkills: Array.isArray(s.matchedSkills) ? s.matchedSkills : [],
    missingSkills: Array.isArray(s.missingSkills) ? s.missingSkills : [],
  };
});
```

Batching is not a free win over scoring each job in its own call. It is ~5× faster and one-tenth the request count against OpenRouter's free tier, but it collapses ten independent failure domains into one and introduces a failure mode that sequential scoring does not have: **index drift**. The route trusts that `scores[i]` describes `jobs[i]`. If the model returns nine scores instead of ten, every job past the gap gets the wrong score — and nothing throws, so wrong data lands silently in the DB.

The guard refuses to trust the model's array shape. It iterates over the *input* `jobs` (the trusted length), looks up `scores[i]` defensively, and substitutes `FALLBACK_SCORE` for any missing or malformed entry. The output length therefore always equals the input length, and the score is clamped to 0–100. The whole function is wrapped in a try/catch that returns all-neutral scores on any thrown error. The contract is absolute: **a job is always saved, even if it could not be scored.**

> **Data structures — positional correspondence:** Pairing two arrays by index assumes a positional invariant — position *is* the identity link. Robust code iterates the trusted array and reads the untrusted one defensively, never the reverse, so a short or malformed response can never shift identities. (Length checks still can't catch *reordering* at the same length — that would need an explicit id per result. See the challenge.)

**Checkpoint:** Name every new failure mode batching introduced that scoring each job in its own call would not have.

<details>
<summary>Reveal answer</summary>

(1) **Index drift** — a short or reordered `scores` array misassigns scores to jobs, silently. (2) **All-or-nothing blast radius** — one malformed response affects every job in the batch, where a sequential design would corrupt only the one job whose call failed. (3) **No per-job retry** — you cannot re-score job #4 alone; you would re-run the whole batch. The ordering guard plus the all-neutral catch are the price paid to get batching's speed while bounding these modes.

</details>

**Checkpoint:** Why does the guard iterate `jobs.map((_, i) => scores[i] ...)` rather than `scores.map(...)`? What does iterating the model's array directly risk?

<details>
<summary>Reveal answer</summary>

Iterating `jobs` guarantees the output has exactly one entry per input job, in input order — the table and the DB insert both depend on that one-to-one correspondence. Iterating `scores` directly would make the output length equal to whatever the model returned: a short array would produce fewer job records than jobs (some jobs silently dropped), and there would be no anchor to detect the mismatch. The trusted array must drive the loop.

</details>

**Checkpoint:** The function imports `OpenAI` but uses Nemotron. Convince a skeptical reviewer this is correct. Which two configuration values make it true?

<details>
<summary>Reveal answer</summary>

`baseURL: "https://openrouter.ai/api/v1"` and `apiKey: process.env.OPENROUTER_API_KEY!`. Those retarget the OpenAI HTTP client at OpenRouter's servers using an OpenRouter key. The `model: "nvidia/nemotron-3-ultra-550b-a55b:free"` string tells OpenRouter which model to run. The `openai` package only implements the OpenAI-compatible request/response *format*, which OpenRouter speaks — no request ever reaches OpenAI. It is the same pattern as `agent/extractor.ts`.

</details>

---

## Part 4 — The orchestration route: a state machine with best-effort inputs

Open [`app/api/agent/find/route.ts`](../../../app/api/agent/find/route.ts). The profile fetch is deliberately tolerant:

```ts
// Profile is best-effort — a null/sparse profile still produces a search.
const { data: profile } = await insforge.database
  .from("profiles")
  .select("*")
  .eq("id", userId)
  .maybeSingle();
```

The resume route (Tutorial 10) uses `.single()`, which errors when zero rows match. This route uses `.maybeSingle()`, which returns `null` instead. The difference is load-bearing: Find Jobs is a top-of-funnel feature whose entire purpose is to get a user to a first result. Erroring because no profile row exists — or blocking because it is incomplete — would defeat that. A `null` profile flows into `scoreJobs`, where `buildProfileSummary(null)` emits "No profile on file. Score from the job title and description only," and Nemotron scores on the job text alone. Generic, but a real list the user can act on.

The `agent_runs` row is the run's state machine, written *before* the work:

```ts
const { data: run, error: runError } = await insforge.database
  .from("agent_runs")
  .insert([{ user_id: userId, status: "running", job_title_searched: jobTitle, location_searched: location || null }])
  .select()
  .single();
// ...
const runId = run.id as string;
```

Creating it first means a crash mid-search still leaves a row stuck in `running` — itself a signal. The Adzuna failure path transitions it to `failed`:

```ts
try {
  adzunaJobs = await searchJobs(jobTitle, location, country);
} catch (error) {
  await insforge.database.from("agent_runs")
    .update({ status: "failed", completed_at: new Date().toISOString() })
    .eq("id", runId).eq("user_id", userId);
  return NextResponse.json({ success: false, error: "Job search failed. Please try again." }, { status: 500 });
}
```

and the happy path closes it as `completed` with the count. Every `jobs` row carries `run_id: runId`, so the run is also the join key tying a batch of jobs back to the search that produced them.

> **System design — audit record as state machine:** `status: running → completed | failed` is a minimal state machine whose transitions are an observability trail. Writing the record before the work (not after) is what makes failed attempts visible at all. The same pattern underlies job queues, sagas, and any durable async workflow.

### Mapping `AdzunaJob` → `JobInsert`

```ts
const records: JobInsert[] = adzunaJobs.map((job, i) => {
  const score = scores[i];
  const salary =
    job.salary_min && job.salary_max
      ? `$${Math.round(job.salary_min / 1000)}k - $${Math.round(job.salary_max / 1000)}k`
      : null;

  return {
    user_id: userId, run_id: runId, source: "search",
    source_url: job.redirect_url, external_apply_url: job.redirect_url,
    title: job.title, company: job.company.display_name,
    location: job.location.display_name, salary,
    job_type: job.contract_type === "part_time" ? "parttime"
      : job.contract_type === "contract" ? "contract" : "fulltime",
    about_role: job.description,
    responsibilities: null, requirements: null, nice_to_have: null,
    benefits: null, about_company: null,
    match_score: score.matchScore, match_reason: score.matchReason,
    matched_skills: score.matchedSkills, missing_skills: score.missingSkills,
    company_research: null,
  };
});
```

`JobInsert` is `Omit<Job, 'id' | 'found_at'> & { id?, found_at? }`. Only `id` and `found_at` become optional; every *other* `Job` field is still required by the type — including the nullable ones. That is why the mapping explicitly writes `responsibilities: null`, `company_research: null`, and so on, rather than omitting them: a nullable column means "may be null," not "may be omitted." Two values are translated, not copied: `salary` is formatted to a string only when both bounds exist (the DB column is text, Adzuna gives numbers), and `job_type` is funnelled into the `JobType` union with `fulltime` as the catch-all.

The rows are inserted in one call, and `.select()` returns them with their DB-generated `id` and `found_at` — which is exactly what gets returned to the client:

```ts
const { data: insertedJobs, error: jobsError } = await insforge.database
  .from("jobs").insert(records).select();
```

A `job_found` PostHog event fires for each row at or above `MATCH_THRESHOLD` (imported from `lib/utils.ts`, never hardcoded), and the route returns `{ jobs: insertedJobs, jobsFound, strongMatches, successMessage }`.

> **System design — graceful degradation:** `maybeSingle()` (null-tolerant profile) and the all-neutral fallback in `scoreJobs` are the same instinct: the feature bends rather than breaks. A discovery feature degrades to a generic-but-real result; it never dead-ends the user over a missing input.

**Checkpoint:** Why does the `JobInsert` mapping set `responsibilities: null`, `company_research: null`, etc., instead of omitting them? What does `JobInsert` actually let you omit?

<details>
<summary>Reveal answer</summary>

`JobInsert = Omit<Job, 'id' | 'found_at'> & { id?, found_at? }` makes *only* `id` and `found_at` optional — those have DB defaults. Every other `Job` field, including nullable ones like `responsibilities` and `company_research`, is still a required key on the object literal. A nullable column is typed `T | null`, which means the key must be present with value `null`; it is not the same as an optional key (`key?`). Omitting them is a TypeScript error, so the mapping writes the nulls explicitly.

</details>

**Checkpoint:** Why is the `agent_runs` row created *before* the Adzuna call rather than after the jobs are saved?

<details>
<summary>Reveal answer</summary>

Creating it first guarantees a durable record that the search was attempted, even if Adzuna throws or the process crashes mid-run — the row is left in `running` (or transitioned to `failed`), which is itself diagnostic. Creating it only after success would erase every trace of failed attempts, making outages invisible in the data. It also gives every job row a `run_id` to reference before the jobs are built. The status field is the run's state machine; the pre-write is what makes failure observable.

</details>

**Checkpoint:** The profile uses `.maybeSingle()` where the resume route uses `.single()`. What would the user experience be if this route used `.single()` and the user had no profile row yet?

<details>
<summary>Reveal answer</summary>

`.single()` errors when zero rows match. With no profile row, the query would return an error; if the route treated that as fatal, the search would 500 — the user clicks "Find Jobs" and gets a failure, despite Adzuna being perfectly capable of returning jobs. `.maybeSingle()` returns `null`, which flows into `scoreJobs` as an empty profile, and the user still gets a scored (if generic) list. The choice is what makes the feature usable from the very first session, before any profile exists.

</details>

---

## Part 5 — `setJobs` vs `force-dynamic`: two disjoint layers of freshness

Open [`app/find-jobs/page.tsx`](../../../app/find-jobs/page.tsx):

```tsx
// Per-user, frequently-mutated list — never serve a cached render.
export const dynamic = "force-dynamic";

export default async function FindJobsPage() {
  const insforge = await createInsforgeServer();
  const { data: authData, error: authError } = await insforge.auth.getCurrentUser();
  if (authError || !authData.user) redirect("/login");

  const { data: jobs } = await insforge.database
    .from("jobs").select("*")
    .eq("user_id", authData.user.id)
    .order("found_at", { ascending: false });

  return (
    <>
      <Navbar />
      <main className="min-h-[calc(100vh-4rem)] bg-background">
        <div className="max-w-[1440px] mx-auto px-6 py-8">
          <FindJobsClient initialJobs={(jobs as Job[]) ?? []} />
        </div>
      </main>
    </>
  );
}
```

And the client side of the loop in `FindJobsClient.handleSearch`:

```tsx
const data = await res.json();
if (!res.ok || !data.success) { console.error(...); return; }
setJobs(data.jobs as Job[]);
setSearchStatus({ jobsFound: data.jobsFound, strongMatches: data.strongMatches });
setPage(1);
```

It is tempting to think `setJobs` makes `force-dynamic` redundant, or vice versa. They cover disjoint moments. `setJobs(data.jobs)` is a pure client-state update using data the API already returned — it handles the **in-session** case: the user searches and the table updates instantly, no extra network, no reload. It does nothing for someone who navigates to `/dashboard` and comes back — that return visit is a *fresh server render* with its own `initialJobs`.

`force-dynamic` governs that fresh render. Without it, Next.js may cache the route's output and serve a stale (or pre-first-search empty) list on the return visit. `force-dynamic` forces the Server Component to re-execute — and therefore re-query the DB — on every request. In-session interactivity is a React client-state concern; cross-navigation freshness is a Next render-cache concern. Confusing them produces the classic "it works until I reload" bug.

> **Distributed systems — layered cache invalidation:** Freshness in a server-rendered app lives at two layers — the client's in-memory view and the server's render cache — and each needs its own invalidation trigger. `setJobs` invalidates the first; `force-dynamic` (re-querying on every request) invalidates the second. Reasoning about "which layer is stale, and what refreshes it" is the general discipline; this feature is one concrete instance.

`SearchControls` is now a pure leaf — note it holds no state at all:

```tsx
export function SearchControls({
  jobTitle, location, isLoading, searchStatus,
  onJobTitleChange, onLocationChange, onSearch,
}: Props) {
```

While `isLoading`, the inputs and button disable and the button swaps to a spinner + "Finding jobs..." — the only visual feedback for the multi-second search.

**Checkpoint:** Describe one user journey where `setJobs` is sufficient and `force-dynamic` is irrelevant, and one where the reverse is true.

<details>
<summary>Reveal answer</summary>

*setJobs sufficient, force-dynamic irrelevant:* the user is on `/find-jobs`, runs a search, and watches the table update. The API returned the rows; `setJobs` renders them; no navigation happens, so the page is never re-rendered from the server. *force-dynamic essential, setJobs irrelevant:* the user ran a search earlier, navigated to `/dashboard`, and now clicks back to `/find-jobs`. The client component remounts with whatever `initialJobs` the server provides — `setJobs`'s earlier in-memory update is gone. `force-dynamic` ensures that fresh render re-queries the DB and includes the jobs the earlier search saved, instead of a cached/empty render.

</details>

**Checkpoint:** If `force-dynamic` were removed but `setJobs` kept, what bug appears and on which user action?

<details>
<summary>Reveal answer</summary>

A return navigation (or hard reload) of `/find-jobs` could be served from Next's cached render — potentially the version captured before the user's first search, i.e. an empty or stale list. The in-session search still works (that's `setJobs`), but the moment the user leaves and comes back, their saved jobs vanish from view until something else busts the cache. The symptom is "my jobs disappear when I reload," and the trigger is navigation/reload, not the search itself.

</details>

---

## Part 6 — Removing dead UI without corrupting its column

The Connected Accounts card on the Profile page had a connect/disconnect button wired to nothing — dead UI implying a capability that didn't exist. Removing it was bundled into this session, and it required care because the card was the *only* UI surface for the `linkedin_connected` column.

Open the `handleSave` field list in [`components/profile/ProfileForm.tsx`](../../../components/profile/ProfileForm.tsx):

```tsx
work_experience: workExperience,
education,
linkedin_connected: profile?.linkedin_connected ?? false,
is_tailored: isTailored,
```

`handleSave` writes the *entire* profile on every save. The original code read `linkedin_connected` from a `linkedinConnected` state initialised from the profile and passed it back. Deleting the card and its `const [linkedinConnected] = useState(...)` without finishing the job leaves `handleSave` referencing an undefined variable — which is exactly what happened mid-edit: the IDE flagged `Cannot find name 'linkedinConnected'`. The fix passes the existing DB value straight through: `linkedin_connected: profile?.linkedin_connected ?? false`. The UI shrinks; the stored value is preserved on every subsequent save. The LinkedIn **URL** field under Personal Info is a separate, user-edited field and was left untouched.

> **System design — referential preservation on deletion:** Removing a control that participated in a save path is a data operation, not just a visual one. Before deleting it, trace every column it read or wrote and ensure the save still preserves them — otherwise the next save silently overwrites a column the UI no longer shows.

**Checkpoint:** Removing the card produced `Cannot find name 'linkedinConnected'`. Walk through why, and what a careless "fix" (deleting the `linkedin_connected` line from `handleSave`) would have done to the stored value.

<details>
<summary>Reveal answer</summary>

The card and `handleSave` both referenced `linkedinConnected` state. Deleting the `const [linkedinConnected] = useState(...)` declaration (it was only rendered by the card) left `handleSave`'s `linkedin_connected: linkedinConnected` referencing a name that no longer exists — a compile error. A careless fix would be to delete the `linkedin_connected` line from `handleSave` entirely. But `handleSave` upserts the whole profile, so omitting the field would write `undefined`/default for `linkedin_connected` on the next save, silently flipping a stored DB value to `false`. The correct fix reads the value straight from `profile` and passes it through, so the save is a no-op for that column.

</details>

**Checkpoint:** Why keep the `linkedin_connected` *column* and the LinkedIn URL field when the card that surfaced the column is being deleted?

<details>
<summary>Reveal answer</summary>

The column still holds real data and may get a real UI again later (e.g. an actual LinkedIn OAuth integration); dropping it would require a migration and would discard any existing values, so it is left intact and preserved through `handleSave`. The LinkedIn **URL** field is an entirely separate concern — a user-entered profile field, not the dead connect/disconnect toggle — so it has nothing to do with the card's removal and stays exactly as it was.

</details>

---

## Full data flow: one click of "Find Jobs" to a populated table

1. The user types "Frontend Engineer" / "Singapore" into `SearchControls`. Each keystroke calls `onJobTitleChange` / `onLocationChange` — handlers passed from `FindJobsClient` (`setJobTitle` / `setLocation`). `SearchControls` holds no state of its own.
2. The user clicks "Find Jobs". `onSearch` → `FindJobsClient.handleSearch()`. `setIsLoading(true)` disables the inputs and swaps the button to a spinner + "Finding jobs...".
3. `handleSearch` POSTs `{ jobTitle, location }` to `/api/agent/find`.
4. The route authenticates (`getCurrentUser`), rejects an empty `jobTitle` with 400, and runs `detectCountry("Singapore") → "sg"`.
5. It fetches the profile with `.maybeSingle()` (null tolerated) and inserts an `agent_runs` row with `status: "running"`, capturing `runId`. It fires `job_search_started`.
6. `searchJobs("Frontend Engineer", "Singapore", "sg")` hits `…/api/jobs/sg/search/1?...&category=it-jobs&where=Singapore` and returns up to 10 `AdzunaJob`s. (A throw here → run `failed`, 500.)
7. `scoreJobs(adzunaJobs, profile)` makes **one** Nemotron call via the OpenRouter-configured client and returns one `JobScore` per job, index-aligned, never throwing.
8. Each `AdzunaJob` + its `scores[i]` is mapped to a `JobInsert` (salary formatted, `job_type` funnelled, nullable columns set to `null`, `source: "search"`, `run_id: runId`).
9. `insert(records).select()` writes all rows and returns them with DB-generated `id` and `found_at` as `insertedJobs`.
10. A `job_found` event fires for each row with `match_score >= MATCH_THRESHOLD`. The `agent_runs` row is updated to `completed` with `jobs_found`.
11. The route returns `{ jobs: insertedJobs, jobsFound, strongMatches, successMessage }`.
12. Back in `handleSearch`: `setJobs(data.jobs)`, `setSearchStatus(...)`, `setPage(1)`, and `setIsLoading(false)` in `finally`.
13. `setJobs` triggers the `useMemo` filter/sort/pagination pipeline (Tutorial 15, Part 7) over the new `jobs`, and the table re-renders — **no reload, no second fetch**. The success banner reads "Found N jobs and saved M strong matches."

---

## Extend it (challenges)

### Challenge 1 — Trace a single job from Adzuna to the table (15–20 min)

Pick one Adzuna result with a `salary_min` of `120000` and `salary_max` of `160000`, `contract_type` absent, and a score of `82`. Without running anything, write out the exact `JobInsert` object the route builds for it (every field), then the `MatchScoreBar` color it will render (consult Tutorial 15, Part 4 / `getMatchBarColor`), then whether it fires a `job_found` event.

<details>
<summary>Hint</summary>

`salary` = `"$120k - $160k"`. `job_type` = `"fulltime"` (absent `contract_type` hits the catch-all). The nullable columns (`responsibilities`, `requirements`, `nice_to_have`, `benefits`, `about_company`, `company_research`) are all `null`. Score 82 → `getMatchBarColor` returns `var(--color-info-medium)` (blue). 82 ≥ `MATCH_THRESHOLD` (70), so a `job_found` event fires.

</details>

---

### Challenge 2 — Add an `id` to each score to detect reordering (20–30 min)

The length guard catches a *short* `scores` array but not a *reordered* one (right length, wrong order). Change the `scoreJobs` prompt to ask the model to echo each job's 1-based index as an `index` field per score, then in the guard, verify `scores[i].index === i + 1` and fall back to `FALLBACK_SCORE` when it doesn't. Update the `JobScore` type and the system prompt accordingly. No route changes should be needed.

<details>
<summary>Hint</summary>

Add `index: number` to the returned shape in the system prompt's JSON spec and to a local parse type (not necessarily the exported `JobScore`). In the `jobs.map((_, i) => ...)` guard, add `s.index !== i + 1` to the condition that returns `FALLBACK_SCORE`. This converts a silent reordering into a detectable, recoverable event — the cost is trusting the model to echo an integer correctly.

</details>

---

### Challenge 3 — Break the index invariant and observe (30–45 min)

In `scoreJobs`, temporarily replace the defensive `jobs.map((_, i) => ...)` reassembly with a naive `return scores;` (return the model's array directly). Then simulate a short response by slicing one element off in code (`return scores.slice(0, -1);`). Run a search in the dev server and inspect the `jobs` rows written to InsForge. Describe in writing: how many rows were inserted, what the route did when `scores[i]` was `undefined` for the last job, and why the original guard prevents this. Restore the guard when done.

<details>
<summary>Hint</summary>

With `return scores.slice(0, -1)`, the route's `adzunaJobs.map((job, i) => { const score = scores[i]; ... })` reads `scores[lastIndex]` as `undefined`, then `score.matchScore` throws a `TypeError` — the outer try/catch returns a 500 and the run is left without a `completed` transition. The original guard guarantees `scores.length === jobs.length` with `FALLBACK_SCORE` filling gaps, so `score` is never `undefined` and the insert always succeeds. This is the concrete cost of trusting positional correspondence without a guard.

</details>

---

For deeper exploration, `docs/plan/10-adzuna-job-discovery/ai-discussion-topics.md` (22 prompts) and `docs/architect/10-adzuna-job-discovery/ai-discussion-topics.md` (22 prompts) cover the search data flow, batch failure modes, cache-vs-client-state freshness, the Adzuna mapping, and safe deletion. Feed them to an LLM *after* forming your own answer first — the gap between what you thought and what you learn is where understanding lands.
