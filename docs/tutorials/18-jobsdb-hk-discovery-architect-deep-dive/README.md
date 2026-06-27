# Tutorial 18 — JobsDB HK Discovery: Architect Deep-Dive — Provider Selection, Session Security, and Type Generalization

**After completing this tutorial you will understand:** why a Store-first actor sourcing strategy reduces maintenance commitment and what specific criteria disqualify a Store actor; how Playwright `storageState` works as an authenticated session mechanism and why it lives on Apify's side rather than in the codebase; why `source` and `source_provider` are orthogonal columns and which SQL queries silently break when they are collapsed; how narrowing a type parameter from `AdzunaJob[]` to `ScoringInput[]` makes the scorer source-agnostic without any logic changes; and why `export const maxDuration` is a compile-time literal and what the deployment-tier table means for choosing synchronous vs. background execution.

---

> [!NOTE]
> **Prerequisites:**
> Tutorial 17 (`../17-adzuna-job-discovery/README.md`) — the implementation tutorial for the predecessor feature; establishes the batch scoring pipeline, adapter pattern, and route lifecycle that this deep-dive extends. You will need it for Part 6 especially.
> Tutorial 08 (`../08-profile-save-architect-deep-dive/README.md`) — introduces the architect deep-dive format; explains that these sessions capture the *why* behind decisions before any code is written.
>
> Open [`lib/apify.ts`](../../../lib/apify.ts), [`agent/jobsdb.ts`](../../../agent/jobsdb.ts), [`agent/job-matcher.ts`](../../../agent/job-matcher.ts), [`app/api/agent/find/route.ts`](../../../app/api/agent/find/route.ts), [`apify/jobsdb-hk-actor/src/main.ts`](../../../apify/jobsdb-hk-actor/src/main.ts), and [`types/index.ts`](../../../types/index.ts) alongside this tutorial.

---

## CS & language concepts in this tutorial

| Concept | Where it appears | Category |
|---------|-----------------|----------|
| Facade pattern | `lib/apify.ts` — `runJobsDbActor()` hides actor ID, timeout, dataset read | Design patterns |
| Interface segregation | `ScoringInput` replaces `AdzunaJob` with only 4 fields the scorer reads | Type theory |
| Hash set deduplication | `Set<string>` in route for O(1) URL membership lookup | Data structures |
| Orthogonal decomposition | `source` × `source_provider` as independent classification axes | System design |
| Static vs. dynamic configuration | `export const maxDuration = 300` must be compile-time, not runtime | OS fundamentals |

---

## How to use an LLM before this tutorial

Run these prompts before reading code. Budget 30–40 minutes.

### Concept 1 — The facade pattern

> "Explain the facade design pattern. When does it appear, and what problem does it solve? Give an example of a library that has complex configuration (a client object, auth token, a run call, a separate read call) wrapped by a single function a caller invokes. Explain what the caller gains and what they give up. Then quiz me on when to reach for a facade vs. exposing the underlying library directly."

*What to listen for:* A facade is a simplified interface over a complex subsystem. The key insight is directionality: the facade wraps *for a specific use case*, so it is correct to make it simpler than the underlying library, but it becomes a design problem if it needs to expose every option the library offers. When the single function you expose handles 95% of callers, a facade is the right abstraction. When callers regularly need to escape it, it's a leaky facade and should be replaced with direct library use.

*Practice question:* If `runJobsDbActor(input)` in `lib/apify.ts` needed to support both blocking-wait and async-polling modes, would a single facade function still be the right design? What would you do instead?

---

### Concept 2 — Interface segregation: type the caller's need, not the supplier's shape

> "Explain the interface segregation principle from software design. How does it apply to TypeScript function parameters — specifically the idea that a function should accept the minimal type it actually needs, not the full shape of whatever is available? Give a concrete example where using a larger type than necessary causes a problem when a second caller needs to use the same function. Quiz me at the end."

*What to listen for:* ISP says no client should be forced to depend on methods (or fields) it doesn't use. Applied to TypeScript parameters: if a function reads 4 fields from a 20-field type, the parameter type should name those 4 fields, not the full object. The concrete problem with using the full type: a second caller with a different object shape can't pass its object — it must manufacture a fake instance of the wrong type. A narrow type accepts both.

*Practice question:* A function accepts `AdzunaJob` but only reads `title`, `company.display_name`, `location.display_name`, and `description`. A new caller has an object with `title`, `company: string`, `location: string`, `description: string`. What is the minimum change needed to accept both callers without changing any logic inside the function?

---

### Concept 3 — Browser sessions as credential equivalents

> "In web security, what makes a session cookie functionally equivalent to a password? What information does a session cookie contain, what does a server use it to prove, and for how long? What are the specific risks of storing a session cookie in a file on your filesystem vs. in a dedicated secret manager? Quiz me."

*What to listen for:* A session cookie doesn't contain credentials — it contains a token the server issued after successful authentication. Presenting it to the server proves the user authenticated at some point without re-transmitting the password. Its risk profile is similar to a password: anyone who possesses it can impersonate the user until it expires. The filesystem risk: accidental git commit or any process that reads the file gains full session access. A secret manager (Apify KV store, AWS Secrets Manager, etc.) applies access control, audit logging, and rotation support that a plain file cannot.

*Practice question:* A session cookie expires in 14 days. Your actor uses it to authenticate scraping runs. What is the developer experience when it expires — what must they do, and how quickly does the failure surface?

---

### Concept 4 — Column orthogonality: classifying rows on two independent axes

> "In a relational database, when should information about an entity be split across two columns instead of encoded in one column with compound values like 'search_adzuna' or 'url_jobsdb'? What specific operations become impossible or error-prone when two independent concepts are merged into one field? Give an example with SQL GROUP BY. Quiz me."

*What to listen for:* Two concepts are orthogonal if they vary independently. When merged, the combined value creates a cartesian product of possible values that grows with each new dimension. `GROUP BY source_type` and `GROUP BY source_provider` become impossible without parsing the combined string. Filtering "all user-added URLs regardless of provider" requires a LIKE clause on an encoded string rather than a simple equality check. NULL handling becomes ambiguous. Each dimension should be its own column, even if today one column only ever has one value.

*Practice question:* If `source` and `source_provider` were merged into a single column and someone adds a new provider "linkedin_hk", how many unique values does the merged column now need to support, and how many does each separate column need?

---

### Concept 5 — Static vs. dynamic configuration in web frameworks

> "Web frameworks often have configuration that must be known at build time (static) versus configuration that can be read at runtime (dynamic). Give examples of both kinds and explain why some values cannot be made into environment variables. Then specifically explain how a serverless-hosting platform's request-timeout behavior might be controlled by a value the framework reads at compile time, not at request time. Quiz me."

*What to listen for:* Static configuration values are embedded into the built artifact and cannot vary between environments without a rebuild. Examples: chunk size limits, route segment settings, build-time feature flags. Dynamic values are read when the process starts or when a request arrives. Environment variables are dynamic in application code, but framework conventions sometimes require static exports for build-time optimizations. A request timeout that the hosting provider enforces must be declared at build time so the provider's infrastructure can route and kill requests accordingly — it cannot be read from an env var at request time because the provider's network layer needs it before the function even starts.

*Practice question:* `export const maxDuration = 300` is in a Next.js route file. If you change it to `export const maxDuration = parseInt(process.env.MAX_DURATION ?? "300")`, what happens at build time and at runtime?

---

## Architecture overview: what Feature 10b adds

Feature 10b replaces Adzuna with a JobsDB HK Apify actor as the active job discovery source. The new system adds two separate runtimes — Next.js and Apify cloud — that cooperate through the `apify-client` SDK.

```
/find-jobs  CLICK "Find Jobs"
      │ POST /api/agent/find { jobTitle, location }
      ▼
┌──────────────────────────────────────────────────────────────────────┐
│ app/api/agent/find/route.ts             [NEXT.JS SERVER]             │
│ export const maxDuration = 300;                                      │
│                                                                      │
│  auth → profile(maybeSingle) → INSERT agent_runs(running)            │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ discoverJobsDbJobs()  →  runJobsDbActor()                    │   │
│  │    [lib/apify.ts — apify-client SDK]                         │   │
│  │    client.actor(ACTOR_ID).call(input, { timeoutSecs: 270 })  │   │
│  │    ← BLOCKING WAIT → actor runs on Apify's cloud ─────────────────────►
│  │    client.dataset(run.defaultDatasetId).listItems()          │   │
│  └──────────────────────────────────────────────────────────────┘   │
│       │ JobsDbJob[]                                                  │
│  two-pass URL dedup (DB Set + batch Set) → newJobs[]                 │
│  scoreJobs(newJobs.map(toScoringInput), profile)  [one Nemotron call]│
│  INSERT jobs (source_provider: 'jobsdb_hk')                          │
│  UPDATE agent_runs(completed)                                        │
│  return { jobs, jobsFound, newJobs, strongMatches, successMessage }  │
└──────────────────────────────────────────────────────────────────────┘
                                                    │
                              ┌─────────────────────┴────────────────────┐
                              │ apify/jobsdb-hk-actor/   [APIFY CLOUD]   │
                              │                                          │
                              │  Actor.getValue('JOBSDB_SESSION')        │
                              │    [loads storageState from Apify KV]    │
                              │  PlaywrightCrawler                       │
                              │    preNavigationHooks: addCookies()      │
                              │    SEARCH label: search page → URLs      │
                              │    DETAIL label: each URL → JobResult    │
                              │  Dataset.pushData(result)                │
                              └──────────────────────────────────────────┘

┌──────────────────┐
│  Apify KV store  │
│  JOBSDB_SESSION  │  ◄── developer uploads once (storageState JSON)
│  (managed by     │      actor reads at runtime — never touches JobPilot
│   Apify, scoped  │
│   to the project)│
└──────────────────┘
```

**Three key invariants governing this design:**

1. `JOBSDB_SESSION` never appears in JobPilot source, `.env.local`, or InsForge — it lives in Apify's KV store only, read by the actor via `Actor.getValue`.
2. `lib/apify.ts` uses the `apify-client` npm SDK (not the `apify` CLI) — the CLI is development-only tooling.
3. `source_provider` must always be set on every search-sourced row — `'jobsdb_hk'` for this adapter, `'adzuna'` for existing rows (backfilled).

---

## Part 1 — Why the provider switch matters: description depth and scoring quality

Open [`docs/architect/10b-jobsdb-hk-discovery/discussion.md`](../../architect/10b-jobsdb-hk-discovery/discussion.md), section "Why Adzuna isn't enough for Hong Kong":

```
Adzuna is a job aggregator — it pulls listings from employer sites and other
boards, standardises them, and exposes them via a search API. For most
English-speaking markets (US, UK, AU) its coverage is reasonable. For Hong Kong
specifically, the dominant job boards are JobsDB (SEEK-owned), LinkedIn, and
Recruit.com. Adzuna's HK index is thin — fewer listings, less frequent updates,
and the descriptions it returns are always *snippets* (a few hundred characters),
not the full job text.
```

The switch from Adzuna to JobsDB is not a preference for one API over another — it's a decision about the data quality that enters the scoring pipeline. The Nemotron prompt in `agent/job-matcher.ts` asks for `matchedSkills`, `missingSkills`, and a `matchReason`. With a snippet like "Frontend engineer needed, React experience preferred," there is nothing to match against. With a full description listing the tech stack, team structure, and specific responsibilities, the model produces actionable output.

Adzuna's snippet limitation is structural, not fixable by changing API parameters. The `description` field it returns is always a short excerpt of the listing — the full text requires navigating to the source page. JobsDB, scraped via Playwright, gives the full listing because the actor navigates the actual detail page.

This is why the entire Feature 10b exists: not to add another source for the sake of it, but to fix the quality of the input to an existing pipeline that was already working correctly.

**Checkpoint:** Adzuna returns `"matchScore": 35` with `matchReason: "Limited description prevented meaningful scoring."` The same job from JobsDB returns `"matchScore": 78` with specific `matchedSkills` and `missingSkills`. Which element of the system is responsible for this difference, and what does it tell you about the relative importance of model quality vs. input quality in the scoring pipeline?

<details>
<summary>Reveal answer</summary>

The difference is entirely the description depth — the model, the prompt, and all scoring logic are unchanged. `agent/job-matcher.ts` sends whatever text is in `job.description` to Nemotron, so when that text is "React experience preferred," the model literally cannot surface skills from a description that doesn't name them. When the text is 800 words describing the actual role, the model has content to match against.

This is an important lesson in AI systems: the model is rarely the bottleneck. Improving input quality (description depth) produced a 43-point score improvement. Upgrading the model would likely produce a much smaller gain on snippet-quality input because there is nothing more to extract.

</details>

**Try it yourself:** Open `agent/job-matcher.ts` and find `buildJobsList`. The description field is passed directly into the Nemotron prompt. Try replacing a job's description with a 10-word snippet and then the full 500-word version in a local test — observe how the `matchedSkills` array changes length.

---

## Part 2 — The two Apify surfaces: consumer vs. builder

Open [`docs/architect/10b-jobsdb-hk-discovery/decisions.md`](../../architect/10b-jobsdb-hk-discovery/decisions.md), Decision 6:

```
| Layer | Tool | When used |
|-------|------|-----------|
| Runtime (Next.js lib/apify.ts) | apify-client npm SDK | Production: start actor run, wait, read dataset |
| Development | apify CLI + /apify-ultimate-scraper skill | Build time: search Store, inspect schemas, push custom actor, test runs |
```

The Apify ecosystem presents two completely different surfaces that must never be mixed:

**The consumer surface** is the Apify Store and CLI commands like `apify actors call`. The `/apify-ultimate-scraper` skill operates at this layer — it searches published actors, retrieves their input schemas, and calls them. This surface is interactive and designed for humans. The `apify` CLI writes auth state to `~/.apify/auth.json`, outputs progress to stderr, and assumes a terminal session. None of these behaviors are acceptable inside a Next.js route handler.

**The builder surface** is `apify create`, `apify run`, and `apify push` — the toolchain for developing and deploying custom actors. These are also CLI-only tools, used once at build time, not called at runtime.

**The runtime surface** is the `apify-client` npm SDK, used exclusively in `lib/apify.ts`. This is a pure HTTP client. No filesystem writes, no global config, no terminal assumptions. It initializes from an env var and returns typed Promises.

Open [`lib/apify.ts`](../../../lib/apify.ts):

```typescript
import { ApifyClient } from "apify-client";

export async function runJobsDbActor(
  input: JobsDbActorInput,
): Promise<JobsDbActorOutput[]> {
  const client = new ApifyClient({ token: process.env.APIFY_TOKEN! });

  const run = await client
    .actor(process.env.APIFY_JOBSDB_ACTOR_ID!)
    .call(input, {
      timeoutSecs: 270,
    });

  if (run.status !== "SUCCEEDED") {
    throw new Error(`JobsDB actor run ${run.status} (runId: ${run.id})`);
  }

  const { items } = await client
    .dataset(run.defaultDatasetId!)
    .listItems();

  return items as JobsDbActorOutput[];
}
```

> **Design patterns — Facade pattern:** `runJobsDbActor` is a facade: it hides the `apify-client` configuration, the two-step call-then-read pattern, and the non-SUCCEEDED throw behind a single `input → JobsDbActorOutput[]` interface. The caller in `agent/jobsdb.ts` doesn't need to know how actors work — only what they return. This is the standard solution when a library has a complex initialization ceremony that is always done the same way in your codebase. The same pattern appears in `lib/insforge-server.ts` (wrapping `createInsforgeServer()`) and in `agent/extractor.ts` (wrapping the OpenAI client construction).

The `timeoutSecs: 270` is set slightly below the route's `maxDuration = 300`. This ordering is intentional: if the actor times out on Apify's side, the SDK throws, the route catches it, marks `agent_runs` as `failed`, and returns a 500 with a user-facing error message. If the actor timeout were *higher* than the route timeout, the route would be killed by Next.js before it received the actor's failure, leaving the `agent_runs` row stuck in `'running'` with no cleanup path.

**Checkpoint:** The plan says "actor runs on Apify's cloud, not inside the Next.js route." During the 90 seconds the actor is running, what is the Next.js server doing, and is it consuming CPU proportional to the scraping work?

<details>
<summary>Reveal answer</summary>

The Next.js server is waiting — it has an open HTTP connection to the Apify API that will receive a response when the run finishes. Internally, `client.actor(id).call(input)` is polling Apify's run status endpoint on a timer (roughly every 1–2 seconds). The route handler is awaiting that Promise, so the Node.js event loop's thread is not spinning — it is suspended, waiting for I/O. CPU usage is negligible, approximately the same as keeping a database connection open.

This matters for understanding `maxDuration`: the 300-second limit is wall-clock time (the router/load balancer kills the connection after 300 seconds), not CPU time. The actual compute used during a 90-second actor run is a fraction of a second of server CPU for the polling and JSON parsing.

</details>

**Checkpoint:** What specific failure happens if you try to call `apify actors call ACTOR_ID --input '...'` inside a `child_process.exec` inside a Next.js route handler on a Vercel deployment?

<details>
<summary>Reveal answer</summary>

At minimum three things break:
1. `apify` CLI is not installed on the Vercel runtime image — only npm dependencies in `node_modules` are available; the `apify` package is a dev dependency and its CLI binary is not in the PATH.
2. `~/.apify/auth.json` doesn't exist in the serverless environment, so the CLI cannot authenticate even if it were installed.
3. Even on a server where the CLI is available, `child_process.exec` in a serverless function has a process lifecycle mismatch — the function may be killed before `exec` returns, and there's no way to pipe the CLI's stdout reliably without a complex stream setup.

The `apify-client` SDK sidesteps all three problems: it's an npm package, it authenticates via a single env var, and it returns a Promise that Next.js's async/await handles correctly.

</details>

**Try it yourself:** Run `node -e "const { ApifyClient } = require('apify-client'); console.log(typeof ApifyClient)"` from the project root. This confirms the SDK is available as a production dependency and importable from Node.js without any global config.

---

## Part 3 — Store-first is genuinely a decision: the two qualification criteria

Open [`docs/architect/10b-jobsdb-hk-discovery/decisions.md`](../../architect/10b-jobsdb-hk-discovery/decisions.md), Decision 1:

```
**Why this over "build custom immediately":**
Building and maintaining a custom Crawlee actor is a meaningful ongoing commitment —
DOM selectors break on site updates, session formats change, Playwright versions need
bumping. A Store actor is someone else's maintenance burden. The search is a 10-minute
step that could save days of work.
```

The spec for this feature assumed "build custom immediately" — it didn't know what the Apify Store contained. The architect session added a Store-first step based on a simpler principle: maintenance is expensive. The Apify Store has 4,000+ actors. Some may already scrape JobsDB. If one does, and it meets both qualification criteria, adopting it costs 10 minutes of Store search and avoids owning a Playwright actor indefinitely.

A Store actor qualifies if and only if it satisfies **both** of these independently:

1. **Returns full detail-page descriptions** — not search-level snippets. The entire reason for this integration is description depth. A Store actor that returns snippets has the same problem as Adzuna.

2. **Accepts an authenticated session/cookie input** — specifically, an input field for cookies or `storageState`. Most Store actors are anonymous-only (they don't accept session credentials as input). Building an onboarding story for an actor that takes a user's personal cookies is complex, so published actors rarely support it.

The realistic outcome for JobsDB HK: there may not be a Store actor satisfying both criteria. JobsDB is a regional board, and authenticated-session actors are rare. The Store search is still worth 10 minutes to check. When it finds nothing suitable, the custom actor build begins — but now it starts from a reasoned decision, not an assumption.

**Checkpoint:** How would you evaluate whether a community Store actor is trustworthy enough to add as a production dependency? What signals distinguish a maintained actor from an abandoned one?

<details>
<summary>Reveal answer</summary>

Signals of a maintained actor:
- Recent last-modified date on the actor's Apify Store page
- Active build status (no broken builds in history)
- Versioned releases or a visible changelog
- Responsive author (check issue tracker if public)
- High usage count (community stress-testing)
- TypeScript source (easier to audit)

Signals of abandonment:
- Last modified years ago
- Broken builds or "FAILED" status on recent runs
- No issue responses
- Undocumented or untyped input schema

The key production risk is unilateral breaking changes: the actor author can change output shape or behavior at any time, and your app would break silently if you pin to `latest`. The mitigation is to pin to a specific actor version ID (`actor~version` syntax) rather than using the actor's default version. This is the same argument for pinning npm packages to specific versions rather than `^latest`.

</details>

**Try it yourself:** From a terminal with `APIFY_TOKEN` set, run: `apify actors search "jobsdb" --json | jq '.[].actorId'` to list what's actually in the Store. Then run `apify actors info ACTOR_ID --input` on any result to check its input schema for a `cookies` or `storageState` field.

---

## Part 4 — Playwright `storageState`: session as credential (the security boundary)

This part covers the most security-sensitive architectural decision in Feature 10b.

Open [`apify/jobsdb-hk-actor/src/main.ts`](../../../apify/jobsdb-hk-actor/src/main.ts), the `loadStorageState` function:

```typescript
async function loadStorageState(): Promise<object | null> {
  const raw = await Actor.getValue("JOBSDB_SESSION");
  if (!raw) {
    console.warn(
      "[jobsdb-actor] JOBSDB_SESSION not found in KV store — proceeding without auth. Results may be degraded.",
    );
    return null;
  }
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    console.warn("[jobsdb-actor] JOBSDB_SESSION is not valid JSON — proceeding without auth.");
    return null;
  }
}
```

And the hook that applies it to every navigation:

```typescript
preNavigationHooks: [
  async ({ page }) => {
    if (storageState) {
      await page.context().addCookies(
        (storageState as { cookies?: Parameters<typeof page.context.prototype.addCookies>[0] }).cookies ?? [],
      );
    }
  },
],
```

A Playwright `storageState` is a JSON blob containing two things: the browser's cookies (including session tokens) and localStorage values. When a user logs into JobsDB successfully, the server issues session cookies. Every subsequent request that includes those cookies is treated as authenticated — the server doesn't re-verify credentials, it trusts the session token.

This makes the `storageState` blob **functionally equivalent to a password**: anyone who possesses it can make authenticated requests to JobsDB as the user, until the session expires. The difference from a password: it expires on its own (days to weeks rather than never), and revoking it requires logging out on the source device rather than changing a credential.

**Why on Apify's side, not `.env.local`:**
Storing a session blob in `.env.local` creates two risks. First, any `git add -A` that accidentally includes dotfiles commits live credentials to version history — a mistake that requires credential rotation and git history rewriting to fix. Second, `.env.local` is readable by any process on the developer's machine, including malicious processes. Apify's KV store applies access control scoped to the actor's project: only actors in that project can read the value, and it appears in Apify's audit log.

The security boundary enforced in this design:
- JobPilot source code: no credentials
- `.env.local`: no credentials
- InsForge DB: no credentials
- Apify actor *input* (passed per-run via `client.actor(id).call(input)`): no credentials
- Apify KV store (`Actor.getValue('JOBSDB_SESSION')`): credentials live here only

> **System design — Stateful session / credential separation:** Keeping credentials in a dedicated secrets manager rather than the application's configuration files is the standard pattern for externally-managed auth. The same architecture appears in AWS Secrets Manager, Kubernetes Secrets, Vault, and GitHub Actions secrets — all separate the secret from the code that uses it. The actor reads from a storage layer it can access; the caller (JobPilot) never touches it. This is also why `APIFY_JOBSDB_ACTOR_ID` (non-sensitive) lives in `.env.local` while `JOBSDB_SESSION` (sensitive) lives in Apify's KV store.

**Why `preNavigationHooks`, not `storageState` in browser context constructor:**

The `PlaywrightCrawler` manages its own browser pool and context creation. The `storageState` option on `browser.newContext({ storageState })` sets the initial state when the context is created, but `PlaywrightCrawler` creates contexts internally and doesn't expose a hook for passing `storageState` at that point. The `preNavigationHooks` array runs before every navigation — the cookies are applied to the already-open context before each request, achieving the same authentication effect.

**Checkpoint:** What is the exact process a developer follows to capture a `storageState` after logging into JobsDB manually, and what commands or UI steps are involved?

<details>
<summary>Reveal answer</summary>

One method using Playwright's built-in browser launch:

```javascript
// capture-session.js (run with node)
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('https://hk.jobsdb.com/login');
  // PAUSE: log in manually in the opened browser window
  await page.waitForTimeout(60000); // wait for manual login
  // After login is complete, save the session
  await context.storageState({ path: 'jobsdb_session.json' });
  await browser.close();
  console.log('Session saved to jobsdb_session.json');
})();
```

Then upload the JSON to Apify:
```bash
apify kv-stores set-value [STORE_ID] JOBSDB_SESSION jobsdb_session.json --content-type application/json
```

Or via the Apify Console: Key-Value Stores → Select the actor's default KV store → + Add item → Key: `JOBSDB_SESSION`, Value: paste the JSON content.

The key insight: the developer does this once and then the actor can run authenticated indefinitely — until the session expires (typically 14–30 days). Session expiry is detected by `extractSearchResults` checking `page.url().includes('/login')` after navigating to the search page.

</details>

**Checkpoint:** `Actor.getValue` returns `object | null`. The code handles both a JSON string and an already-parsed object. Why does Apify KV store sometimes return one format vs. the other?

<details>
<summary>Reveal answer</summary>

Apify's KV store infers the content type of stored values. If the value was uploaded with `content-type: application/json`, Apify parses it automatically and `Actor.getValue` returns the parsed JavaScript object. If it was uploaded as a raw string (via some CLI versions or manual entry in the Console), it returns the raw string and the actor must `JSON.parse` it.

The dual-handling (`typeof raw === "string" ? JSON.parse(raw) : raw`) is defensive programming against both storage paths. The `try/catch` handles the case where the value is a string but not valid JSON — for example, if someone accidentally stored the file path instead of the file contents.

</details>

**Try it yourself:** Open `apify/jobsdb-hk-actor/src/main.ts` and find the `extractSearchResults` function. Locate the session-expiry detection. What happens to the actor run if it returns an empty array — does it succeed or fail? Trace through the `requestHandler` to find out.

---

## Part 5 — The `source` vs. `source_provider` split: column orthogonality

Open [`types/index.ts`](../../../types/index.ts):

```typescript
export type JobSource = 'search' | 'url'
export type JobProvider = 'adzuna' | 'jobsdb_hk'

export interface Job {
  // ...
  source: JobSource
  source_provider: JobProvider | null
  // ...
}
```

The `jobs` table has always had `source: 'search' | 'url'`. This column answers the question: *how did this job enter the app?* — either via an agent search run or via a user pasting a URL manually. Before Feature 10b, `source = 'search'` implicitly meant "Adzuna" because there was only one search provider.

`source_provider` answers a different question: *which external system produced this data?* These two questions are independent — they vary along separate axes. A future "Add by URL" flow for a JobsDB posting would produce `source: 'url', source_provider: 'jobsdb_hk'`. A hypothetical manual-entry Adzuna import would be `source: 'url', source_provider: 'adzuna'`. Every combination is meaningful.

**What breaks if they're collapsed into one field:**
If you merge them into `source: 'jobsdb_search' | 'adzuna_search' | 'url'`, two SQL queries break immediately:

```sql
-- 1. "How many jobs did the user add manually?" — requires parsing the compound value:
SELECT COUNT(*) FROM jobs WHERE source = 'url';          -- WORKS with two columns
SELECT COUNT(*) FROM jobs WHERE source LIKE '%url%';     -- FRAGILE with one column

-- 2. "How many jobs from JobsDB, regardless of how they were added?"
SELECT COUNT(*) FROM jobs WHERE source_provider = 'jobsdb_hk';  -- WORKS
SELECT COUNT(*) FROM jobs WHERE source LIKE 'jobsdb%';          -- FRAGILE
```

**The backfill matters more than it appears:**

```sql
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source_provider text;
UPDATE jobs SET source_provider = 'adzuna' WHERE source_provider IS NULL;
```

Without the `UPDATE`, existing Adzuna rows have `source_provider = NULL`. SQL aggregates ignore NULLs silently:

```sql
SELECT source_provider, COUNT(*) FROM jobs GROUP BY source_provider;
-- Returns:   jobsdb_hk | 45
-- Missing:   adzuna    | 120  ← those rows have NULL, they don't appear
```

The developer would see only JobsDB jobs in the count and assume Adzuna has zero jobs. No error is raised. The `UPDATE` makes all existing rows unambiguous from day one.

> **System design — Orthogonal decomposition:** When two attributes of an entity vary independently, they belong in separate columns. The test: "Can one change without the other?" Source (how it entered) can change without changing provider (JobsDB job added by URL vs. by search). Provider can change without changing source (Adzuna job found by search, LinkedIn job also found by search). When the answer is yes, the attributes are orthogonal. Merging them builds a combinatorial explosion of compound values and makes future dimensions impossible to add cleanly.

**Checkpoint:** `JobProvider = 'adzuna' | 'jobsdb_hk'` is a TypeScript union, but the DB column is `text`. What enforces the type constraint at the database level? What breaks if a developer writes `source_provider = 'ADZUNA'` (wrong casing) directly in SQL?

<details>
<summary>Reveal answer</summary>

Nothing enforces the constraint at the DB level — the column is plain `text`, so any string is accepted. The TypeScript union only applies at compile time in the Next.js codebase. If someone writes `source_provider = 'ADZUNA'` directly in SQL (or via the InsForge dashboard), the row is accepted by the DB, but it won't match `WHERE source_provider = 'adzuna'` queries. The TypeScript type would never produce that row because every insert that goes through `JobInsert` is typed.

The DB-level enforcement would require a `CHECK constraint` or a `CREATE TYPE` enum:
```sql
ALTER TABLE jobs ADD CONSTRAINT jobs_source_provider_check
  CHECK (source_provider IN ('adzuna', 'jobsdb_hk'));
```

This was deferred for v1 because adding a `CHECK` constraint to an existing table with data requires verifying all rows pass the check, and it makes migrations more complex when adding a third provider. The TypeScript layer catches 99% of misuse in practice.

</details>

**Checkpoint:** The plan uses `(user_id, source_provider, source_url)` as the deduplication key in code rather than adding a DB unique constraint. What are the specific tradeoffs, and when would you add the unique constraint instead?

<details>
<summary>Reveal answer</summary>

**Pre-insert code dedup (current approach):**
- No schema migration required — works with the existing table
- Extra query per search (fetch existing URLs → build Set)
- Race condition possible: two concurrent searches by the same user could both pass the dedup check and insert duplicates
- At 10 items per search, the extra query is negligible

**DB unique constraint:**
```sql
ALTER TABLE jobs ADD CONSTRAINT jobs_dedup UNIQUE (user_id, source_provider, source_url);
```
- Eliminates the race condition (the DB rejects the duplicate atomically)
- Enables `INSERT ... ON CONFLICT DO NOTHING` instead of two separate queries
- Requires a migration — and if any existing rows have the same `(user_id, source_provider, source_url)`, the migration fails until duplicates are cleaned up
- The constraint adds an index, which adds write overhead and storage

When to add it: when user concurrency is high enough that the race condition matters (multiple tabs, scheduled searches), or when the codebase grows enough that the pre-insert pattern is replicated in too many places to maintain consistently.

</details>

**Try it yourself:** Open `app/api/agent/find/route.ts` and locate the two-pass dedup. Identify where `seenInBatch` is populated and where `existingUrls` is populated. Then trace what happens when a job has `sourceUrl: ""` — which pass catches it and what code path handles it?

---

## Part 6 — `ScoringInput`: narrowing the type interface to what the scorer actually needs

Open [`agent/job-matcher.ts`](../../../agent/job-matcher.ts):

```typescript
export type ScoringInput = {
  title: string;
  company: string;
  location: string;
  description: string;
};

function buildJobsList(jobs: ScoringInput[]): string {
  return jobs
    .map(
      (job, i) =>
        `Job ${i + 1}:\nTitle: ${job.title}\nCompany: ${job.company}\nLocation: ${job.location}\nDescription: ${job.description}`,
    )
    .join("\n\n");
}
```

Before Feature 10b, `scoreJobs` accepted `AdzunaJob[]`. But `AdzunaJob` has fields like `id`, `salary_min`, `salary_max`, `redirect_url`, `created`, and nested shapes like `company: { display_name: string }`. The scorer never read any of those — `buildJobsList` extracted exactly four flat strings per job.

The problem became visible the moment a second source was added. `AdzunaJob.company` is `{ display_name: string }`, but JobsDB's `company` is a flat string. If `scoreJobs` still required `AdzunaJob[]`, `agent/jobsdb.ts` would have had to manufacture fake `AdzunaJob` objects with artificial nesting just to satisfy the type. That is a backwards abstraction: a transport-layer type (Adzuna's response shape) leaking into a domain function (scoring).

The fix is to name the type the scorer actually needs. `ScoringInput` has exactly four fields. Any source adapter can produce it by extracting and flattening its own shape. The scorer never needs to know about Adzuna's or JobsDB's original structure.

Open [`agent/jobsdb.ts`](../../../agent/jobsdb.ts):

```typescript
/** Map a JobsDbJob to the flat shape scoreJobs expects. */
export function toScoringInput(job: JobsDbJob): ScoringInput {
  return {
    title: job.title,
    company: job.company,
    location: job.location,
    description: job.description,
  };
}
```

This is the normalization boundary: `job.company` is already a flat string on `JobsDbJob`, so `toScoringInput` passes it directly. For a future Adzuna adapter that goes through the same scorer, the equivalent would be `company: job.company.display_name`. The flattening happens in the adapter, never inside the scorer.

> **Type theory — Interface segregation:** `ScoringInput` is the scorer's "required interface" — the minimum contract a job object must satisfy to be scored. This is the Interface Segregation Principle applied to TypeScript parameters: depend on the narrowest type you actually need. `AdzunaJob` satisfies `ScoringInput` structurally (it has all four fields, though some are nested), but `ScoringInput` doesn't satisfy `AdzunaJob` — it has none of the extra fields. By declaring the parameter as `ScoringInput[]`, the scorer is now usable by any source that can produce four flat strings.

**Why `ScoringInput` is exported from `agent/job-matcher.ts`, not `types/index.ts`:**

`types/index.ts` contains types derived from the database schema — they describe what exists in storage. `ScoringInput` is an interface describing what a function needs — it's tightly coupled to `scoreJobs` and belongs in the same file. Moving it to `types/index.ts` would suggest it's a data type, not a function contract. If `scoreJobs` were refactored to need a fifth field, you'd want to change the type and the function in the same edit.

**Checkpoint:** What specifically triggered the need for the refactor in Feature 10b, and at which point did TypeScript surface the problem?

<details>
<summary>Reveal answer</summary>

The trigger was `toScoringInput` in `agent/jobsdb.ts` calling `scoreJobs(newJobs.map(toScoringInput), profile)`. `newJobs` is `JobsDbJob[]`. `toScoringInput` produces `{ title: string; company: string; location: string; description: string }`. Before the refactor, `scoreJobs` expected `AdzunaJob[]`, and `{ title: string; company: string; location: string; description: string }` does not satisfy `AdzunaJob` because `AdzunaJob.company` is `{ display_name: string }`, not `string`.

TypeScript surfaced the error at the call site in `route.ts` — `newJobs.map(toScoringInput)` would produce a type mismatch against `scoreJobs`'s parameter. The secondary errors appeared inside `buildJobsList` at the two lines that accessed `job.company.display_name` (removed) and `job.location.display_name` (removed). All three errors were fixed by the same edit: removing the `AdzunaJob` import and introducing `ScoringInput`.

</details>

**Checkpoint:** If a future LinkedIn source adapter is added, what is the exact sequence of steps needed to wire it into the scoring pipeline without modifying `agent/job-matcher.ts`?

<details>
<summary>Reveal answer</summary>

1. Create `agent/linkedin.ts` with a `LinkedInJob` type that matches LinkedIn's output shape
2. Export a `toScoringInput(job: LinkedInJob): ScoringInput` function that maps LinkedIn's fields to `{ title, company, location, description }` — handling any nesting or naming differences in LinkedIn's data
3. In `app/api/agent/find/route.ts`, import `discoverLinkedInJobs` and `toScoringInput as toLinkedInScoringInput` from `agent/linkedin.ts`
4. Call `scoreJobs(newJobs.map(toLinkedInScoringInput), profile)` — no changes to `job-matcher.ts`
5. Add `'linkedin_hk'` to the `JobProvider` union in `types/index.ts`
6. Set `source_provider: 'linkedin_hk'` on inserted rows

The key insight: the adapter boundary (the `toScoringInput` function in each source-specific module) is what makes `job-matcher.ts` source-agnostic. It never needs to change when new sources are added.

</details>

**Try it yourself:** Open `agent/job-matcher.ts` and count the number of places `AdzunaJob` is referenced. There should be zero — the import was removed. Then run `grep -r "AdzunaJob" agent/` to confirm no adapter is manufacturing fake Adzuna shapes.

---

## Part 7 — Synchronous route and `maxDuration`: the timeout contract

Open [`app/api/agent/find/route.ts`](../../../app/api/agent/find/route.ts), line 12:

```typescript
// Block on actor run + dataset read — set high enough for a 10-job scrape.
// Vercel Pro max is 300s; adjust down for Hobby (60s) or self-hosted.
export const maxDuration = 300;
```

This single line encodes a constraint about the deployment environment. The 10-job JobsDB scrape has a realistic runtime of 60–130 seconds:

```
Actor cold start on Apify:              5–15s
Load JOBSDB_SESSION from KV:               1s
Search result page navigation:          5–10s
10 detail page navigations (5–10s each):  50–100s
apify-client polling + dataset read:     2–5s
────────────────────────────────────────────────
Realistic total:                         63–131s
```

The `timeoutSecs: 270` in `lib/apify.ts` is set 30 seconds below `maxDuration = 300`. This ordering is critical: the actor-side timeout fires before the route-side timeout, which means the SDK throws an error, the route's `catch` block fires, `agent_runs` is marked `failed`, and the user receives a `500`. If the actor timeout were above 300, the route would be killed by the framework before it received any signal from the actor, leaving `agent_runs` stuck in `'running'` with no cleanup path.

**Why it's a static export, not an environment variable:**

```typescript
// This would NOT work:
export const maxDuration = parseInt(process.env.MAX_DURATION ?? "300");
```

`maxDuration` is read by the Next.js build toolchain (and Vercel's deployment infrastructure) at build time to configure the network-layer timeout. It's embedded in the route's metadata before the function ever runs. An expression like `parseInt(process.env.MAX_DURATION)` is evaluated at *module load time* in Node.js, but the framework tools that read `maxDuration` do so by static analysis of the source file — they parse the AST, not evaluate it. They cannot reliably extract the value from an expression and wouldn't be able to communicate it to Vercel's load balancer anyway, which needs to know the timeout before the function starts.

**The deployment tier table:**

```
Deployment        │ Default timeout │ Max maxDuration
──────────────────┼─────────────────┼─────────────────
Vercel Hobby      │ 10s             │ 60s
Vercel Pro        │ 60s             │ 300s
Vercel Enterprise │ 60s             │ 900s
Self-hosted       │ Configurable    │ Configurable
```

On Vercel Hobby, `maxDuration = 300` has no effect — the route is capped at 60 seconds regardless. A cold actor start + 10 detail pages almost certainly exceeds 60 seconds. The migration path when this becomes a blocking constraint is v2 (background actor start + polling endpoint + UI "pending" state), not reducing `maxItems` indefinitely.

**Checkpoint:** `export const maxDuration = 300` is a static export at the top of `route.ts`. Why can't this be an environment variable — what is it that requires it to be a compile-time literal?

<details>
<summary>Reveal answer</summary>

Three separate layers need this value:

1. **Next.js build toolchain** — reads it during `next build` to include it in the route's metadata bundle. It does this by static analysis (AST parsing), not by running the code.
2. **Vercel's deployment infrastructure** — reads the built metadata to configure the network-layer timeout for that specific route before any requests arrive. It cannot read environment variables because the function isn't running yet.
3. **The route handler itself** — doesn't actually read `maxDuration` at runtime; the framework enforces it externally.

An `parseInt(process.env.MAX_DURATION)` expression evaluates when the module loads, which is after the build. The static analysis tools see `parseInt(...)` and cannot extract a numeric value from it, so they fall back to a default. The timeout is not configurable at deploy time — it's a build artifact.

</details>

**Checkpoint:** If the actor run takes 130 seconds and the Next.js route times out at 60 seconds (Vercel Hobby), the route is killed before it can mark `agent_runs` as `failed`. What state is the row left in, and how would you detect and clean up orphaned `'running'` runs?

<details>
<summary>Reveal answer</summary>

The `agent_runs` row is stuck in `status: 'running'` with a `started_at` timestamp and no `completed_at`. The actor run continues on Apify's side — it will finish and push data to the dataset — but no one in JobPilot will ever read that dataset.

Detection: query `agent_runs WHERE status = 'running' AND started_at < NOW() - INTERVAL '10 minutes'`. Any row older than a reasonable upper bound for a search is orphaned.

Cleanup approaches:
1. **Manual cron query** — a scheduled SQL update that marks stale `'running'` rows as `'failed'`. Could run daily via the InsForge MCP `run-raw-sql` tool or a serverless function.
2. **On-startup sweep** — at the beginning of each new search request, check if the user has any `'running'` runs older than X minutes and update them to `'failed'` before creating the new run. This is the simplest implementation that requires no additional infrastructure.
3. **Webhook from Apify** — Apify can POST to a webhook when an actor run completes, regardless of whether the calling route is still alive. The webhook handler would update `agent_runs` based on run status.

For v1, option 2 (on-startup sweep) is the pragmatic choice — it piggybacks on the next user action without requiring new infrastructure.

</details>

**Try it yourself:** In `lib/apify.ts`, change `timeoutSecs: 270` to `timeoutSecs: 400` and observe the resulting logic error: the actor-side timeout is now higher than the route's `maxDuration = 300`. Trace through what happens in the route if the actor runs for 305 seconds. Then revert.

---

## Full data flow: a "software engineer" search resulting in 3 new jobs from JobsDB HK

1. User types "software engineer" in `SearchControls.tsx`, clicks "Find Jobs"
2. `FindJobsClient.handleSearch()` — `POST /api/agent/find { jobTitle: "software engineer", location: "Hong Kong" }`
3. `route.ts` — authenticates, fetches profile with `.maybeSingle()`
4. `route.ts` — `INSERT agent_runs { status: 'running' }` → `runId`
5. `route.ts` — fires `job_search_started` PostHog event
6. `route.ts` — calls `discoverJobsDbJobs("software engineer", "Hong Kong", 10)` in `agent/jobsdb.ts`
7. `agent/jobsdb.ts` — calls `runJobsDbActor({ query, location, maxItems: 10 })` in `lib/apify.ts`
8. `lib/apify.ts` — `client.actor(APIFY_JOBSDB_ACTOR_ID).call(input, { timeoutSecs: 270 })` — **BLOCKING WAIT starts**
9. Apify cloud — actor starts, calls `Actor.getValue('JOBSDB_SESSION')`, gets cookies
10. Apify cloud — `PlaywrightCrawler` navigates to `https://hk.jobsdb.com/hk/search-jobs/software%20engineer/Hong%20Kong`
11. Apify cloud — `preNavigationHooks` applies cookies via `page.context().addCookies()`
12. Apify cloud — `extractSearchResults(page, 10)` waits for `[data-automation="jobListing"]`, returns 10 detail URLs
13. Apify cloud — `extractJobDetail(page, url)` × 10: each detail page scraped, `Dataset.pushData(result)`
14. Apify cloud — actor completes, run status becomes `SUCCEEDED`
15. `lib/apify.ts` — **BLOCKING WAIT ends**, `run.status === 'SUCCEEDED'`
16. `lib/apify.ts` — `client.dataset(run.defaultDatasetId).listItems()` → 10 `JobsDbActorOutput` items
17. `agent/jobsdb.ts` — normalizes each item (nullish coalescing), returns `JobsDbJob[]`
18. `route.ts` — queries `jobs WHERE user_id = X AND source_provider = 'jobsdb_hk'` → builds `existingUrls Set`
19. `route.ts` — filters 10 jobs through two-pass dedup: 7 already in DB → 3 new jobs remain
20. `route.ts` — `scoreJobs(newJobs.map(toScoringInput), profile)` → single Nemotron call → 3 `JobScore` objects
21. `route.ts` — builds 3 `JobInsert` records with `source: 'search', source_provider: 'jobsdb_hk'`
22. `route.ts` — `INSERT jobs` → `insertedJobs` (3 rows)
23. `route.ts` — fires `job_found` PostHog event for each job with `match_score >= MATCH_THRESHOLD`
24. `route.ts` — `UPDATE agent_runs { status: 'completed', jobs_found: 3 }`
25. `route.ts` — returns `{ jobs: insertedJobs, jobsFound: 10, newJobs: 3, successMessage: "Found 10 jobs and saved 3 new jobs." }`
26. `FindJobsClient.handleSearch()` — receives response, calls `setJobs(res.jobs)` → table re-renders with 3 new rows

---

## Extend it (challenges)

### Challenge 1 — Trace the session credential path (15–20 min)

The `JOBSDB_SESSION` KV value enters the system at upload time and exits when cookies are applied to the browser. Trace the complete path:

- Where does the developer upload the value? (Apify Console or CLI — what command?)
- What API call does `Actor.getValue('JOBSDB_SESSION')` make under the hood?
- What format does the value arrive as — string or object? How does the code handle both?
- What method applies the cookies to the Playwright context?
- After `addCookies` runs, what does the next HTTP request from the browser look like — what headers are sent?

Write out each step with the relevant code lines from `apify/jobsdb-hk-actor/src/main.ts`.

<details>
<summary>Hint</summary>

Start at `loadStorageState()`. The `Actor.getValue` call is Apify SDK's API for reading from the actor's default KV store. The return value type is `object | null` — trace the `typeof raw === "string"` branch. Then find where `storageState` is used: the `preNavigationHooks` array in the `PlaywrightCrawler` config. Look at what `page.context().addCookies()` does in Playwright's documentation — each cookie object has `name`, `value`, `domain`, `path`, and optionally `expires`.

</details>

---

### Challenge 2 — Add a `minSalary` filter (20–30 min)

The actor currently scrapes jobs and returns all results regardless of salary. Add an optional `minSalary: number` filter that:
1. Accepts `minSalary` as an optional actor input field in `apify/jobsdb-hk-actor/.actor/input_schema.json`
2. Uses it in `apify/jobsdb-hk-actor/src/main.ts` to filter out jobs where `salary` cannot be parsed as a number above the threshold
3. Propagates it from `lib/apify.ts` (`JobsDbActorInput` type update + pass-through)
4. Exposes it from `agent/jobsdb.ts` (`discoverJobsDbJobs` signature update)

You do not need to change `route.ts` for this challenge — just wire it down to the actor. What is the hardest part of this extension? (Hint: salary strings on JobsDB are unstructured — "HK$30,000–HK$50,000 per month".)

<details>
<summary>Hint</summary>

The `minSalary` field in `input_schema.json` should be type `integer`, optional, with a `description`. In `main.ts`, after `extractJobDetail` returns a result, parse `result.salary` with a regex that extracts the lower bound of a range and compare it to `minSalary`. If parsing fails, include the job anyway (don't discard jobs with unstructured salary strings). In `lib/apify.ts`, add `minSalary?: number` to `JobsDbActorInput`. The chain of changes follows the adapter pattern — each layer passes the value down.

</details>

---

### Challenge 3 — Break `maxDuration` and understand why (30–45 min)

Make the following change to `app/api/agent/find/route.ts`:

```typescript
// Change this:
export const maxDuration = 300;

// To this:
export const maxDuration = parseInt(process.env.NEXT_PUBLIC_MAX_DURATION ?? "300");
```

Then:
1. Run `npm run build` and observe what happens
2. Check the Next.js docs in `node_modules/next/dist/docs/` for what `maxDuration` accepts
3. Check if there is a lint or build error, and if so, what it says
4. Explain in writing: why does the expression break the static-analysis contract, and what would a developer who didn't know this assume would work?

Revert the change after you understand it.

<details>
<summary>Hint</summary>

Next.js's route segment config (`maxDuration`, `revalidate`, `dynamic`) must be static literal values — numbers, strings, or booleans. The build toolchain parses the file as an AST and extracts the value literally. When it sees `parseInt(...)`, it cannot extract a number and may silently ignore the export or emit a warning. The resulting deployed function may not have the correct timeout configuration. Environment variables in `NEXT_PUBLIC_*` are substituted at build time for client bundles, but not for server route segment configs.

</details>

---

For deeper exploration, `docs/architect/10b-jobsdb-hk-discovery/ai-discussion-topics.md` has 27 prompts covering Apify platform fundamentals (Groups 1–2), session security (Group 2), data model design (Group 3), scoring pipeline generalization (Group 4), route handler design (Group 5), and Crawlee actor architecture (Group 6). Feed them to an LLM *after* forming your own answer first — the gap between what you thought and what you learn is where understanding lands.
