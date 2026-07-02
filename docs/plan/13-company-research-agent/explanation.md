# Explanation — Feature 13-company-research-agent: Company Research Agent

---

## 1. The end-to-end data flow

When the user clicks "Research Company" on a job details page, the flow has six distinct phases.

**Phase 1 — Client fetch.** `CompanyResearch.tsx` calls `POST /api/agent/research` with `{ jobId }` in the body. While the fetch is in flight, `setLoading(true)` renders the spinner state and disables the button.

**Phase 2 — API auth and routing.** The route handler in `app/api/agent/research/route.ts` reads the session via `createInsforgeServer()` and `getCurrentUser()`. If the session is absent, it returns a 401. If `jobId` is missing or not a string, it returns a 400. Otherwise it calls `researchCompany(jobId, userId)` from `agent/research.ts`.

**Phase 3 — Job and profile load.** `researchCompany()` fetches the job row from `jobs` scoped to both `id` and `user_id`. It fetches the profile with `maybeSingle()` — the profile is best-effort (null is acceptable; synthesis handles it). The job must exist or the function throws, which the route's catch block converts to a generic 500.

**Phase 4 — Browser research.** The function calls `deriveHomepageUrl(job)` to get the target URL. If a URL is derived, it creates a Hyperbrowser session (`createHyperbrowserSession()`), initialises Stagehand against the CDP endpoint (`createStagehand(session.wsEndpoint)`), and calls `conductBrowserResearch()`. Failures are caught individually — sub-page failures are caught per-link, homepage failures propagate to the outer catch which leaves `content` at the empty default. The `finally` block always runs, closing Stagehand then stopping the Hyperbrowser session.

**Phase 5 — Nemotron synthesis.** `synthesizeDossier(content, job, profile)` constructs a system prompt and user prompt that includes the extracted browser content, the job posting, and the candidate's profile. It calls Nemotron via OpenRouter with `response_format: { type: "json_object" }` and parses the structured output into a `CompanyResearchDossier`. The `researchedAt` timestamp is set here to `new Date().toISOString()`. Sources from Nemotron are merged with `visitedUrls` and deduplicated with `new Set()`.

**Phase 6 — DB write and response.** The dossier is written to `jobs.company_research` with an update scoped to `id` and `user_id`. The route returns `{ success: true, data: { companyResearch: dossier } }`. Back in the component, `setResearch(body.data.companyResearch)` triggers a re-render with the dossier — no `router.refresh()`, no page reload.

---

## 2. Provider setup: reading SDK types before writing code

The original `context/architecture.md` and `context/library-docs.md` were written with Browserbase as the planned provider. Before writing any code, both the `@hyperbrowser/sdk` and `@browserbasehq/stagehand` installed packages were inspected directly in `node_modules` to verify the actual TypeScript type signatures — not assumed from documentation or training data.

This check revealed several things that were not obvious from the published docs:

**`HyperbrowserClient` vs `Hyperbrowser`:** The `Hyperbrowser` class is the main constructor (what you `new`). `HyperbrowserClient` is the type of the instance. They differ: `Hyperbrowser` is the class (constructor), `HyperbrowserClient` is the interface that the instance conforms to. For the `lib/hyperbrowser.ts` return type, the correct type is `HyperbrowserClient`.

**`SessionDetail` import path:** The `SessionDetail` type (the shape of what `sessions.create()` returns) is not exported from the main `@hyperbrowser/sdk` index. It lives in `@hyperbrowser/sdk/types`. Using the wrong import path would have produced a TypeScript error.

**Stagehand model configuration shape:** The `V3Options` type used by Stagehand accepts a `model` property that takes `modelName`, `apiKey`, and `baseURL` as a flat object — not nested under `modelClientOptions` as an earlier version of the docs suggested. The correct shape used in `lib/stagehand.ts` is:

```typescript
model: {
  modelName: "nvidia/nemotron-3-ultra-550b-a55b:free",
  apiKey: process.env.OPENROUTER_API_KEY!,
  baseURL: "https://openrouter.ai/api/v1",
}
```

**`stagehand.extract()` positional signature:** The `context/library-docs.md` had documented `stagehand.extract({ instruction, schema })` — the object form. The actual installed V3 type signature is positional:

```typescript
extract<T>(instruction: string, schema: T, options?: ExtractOptions): Promise<InferStagehandSchema<T>>
```

The object form would fail at runtime. The code uses positional arguments throughout, and `library-docs.md` was corrected during the feature. This is the highest-stakes discovery because it would have caused a silent runtime failure rather than a TypeScript error — `{ instruction, schema }` is a valid object argument, just not the one the function expects.

**`stagehand.context.activePage()`:** The installed types do not expose a `stagehand.page` property. The active Playwright page is accessed via `stagehand.context.activePage()`, which returns `Page | undefined`. The code checks for `undefined` before calling `page.goto()`.

---

## 3. The PostHog null error — build failure and fix

The build failed on the first attempt with:

```
Type error: 'posthog' is possibly 'null'.
./app/api/agent/research/route.ts:26:5
```

The route had called `createPostHogServer()` and then directly called `.capture()` on the result:

```typescript
const posthog = createPostHogServer();
posthog.capture({ ... }); // TypeScript error
```

`createPostHogServer()` returns `PostHog | null` — it returns `null` when `NEXT_PUBLIC_POSTHOG_KEY` is not set in the environment, to safely no-op in environments without analytics. TypeScript requires a null check before calling any method on a nullable value.

The correct pattern is `captureServerEvent()`, a wrapper in `lib/posthog-server.ts` that already handles the null guard, calls `shutdown()` in a `finally` block, and accepts the typed event name. Every other API route in the project uses this helper. The route was updated to:

```typescript
await captureServerEvent({
  distinctId: userId,
  event: "company_researched",
  properties: { userId, jobId },
});
```

This is consistent with how `job_search_started` and `job_found` fire in `app/api/agent/find/route.ts`. The pattern: always use `captureServerEvent()`, never `createPostHogServer()` directly in route handlers.

---

## 4. Why `env: "LOCAL"` doesn't mean "local machine"

Stagehand's `env` option accepts two values: `"BROWSERBASE"` and `"LOCAL"`. The naming is confusing. `"BROWSERBASE"` means "let Stagehand manage a Browserbase session on my behalf using my API key." `"LOCAL"` means "I am providing the browser connection externally — here is how to reach it."

The `localBrowserLaunchOptions.cdpUrl` field is how you supply that external browser. When set to `session.wsEndpoint` (the WebSocket URL from Hyperbrowser), Stagehand connects to the Hyperbrowser-managed Chrome instance as if it were a browser running locally. The behaviour is identical from Stagehand's perspective — it issues CDP commands to a Chrome instance. The only difference is who manages that Chrome instance.

This is the key architectural join: Hyperbrowser owns the browser lifecycle (start, stop, timeout); Stagehand owns AI page control and extraction within it.

---

## 5. The homepage URL derivation — why three steps

The job data never contains the company homepage URL directly. It contains:
- `source_url` — the JobsDB listing URL (e.g. `https://hk.jobsdb.com/job/12345`)
- `external_apply_url` — scraped from the listing's apply button, often a direct link to the company's careers portal

The goal is to reach `https://stripe.com` from `https://jobs.stripe.com/jobs/software-engineer-123`.

**Step 1 follows HTTP redirects server-side.** Many job board apply links are redirect chains: the click goes through a tracking server before reaching the employer's careers page. `fetch(url, { redirect: "follow" })` resolves the entire chain synchronously and `response.url` is the final destination. Parsing `response.url` with `new URL()` then gives us the hostname — `jobs.stripe.com` — which the `normalizeToRootDomain()` function converts to `stripe.com` by stripping the job-related subdomain.

The `JOB_SUBDOMAINS` Set contains known job-related prefixes: `careers`, `jobs`, `apply`, `job`, `work`, `hiring`. If the first part of the hostname matches one, the function strips it. The `JOB_BOARD_DOMAINS` Set contains known job board hostnames: if the resolved URL still points to a job board (which can happen when the apply link didn't redirect off the job board's domain), Step 1 fails gracefully and Step 2 runs.

**Step 2 parses the original URL** without following redirects. This is useful for `external_apply_url` values that are already direct employer links, where the redirect chain in Step 1 doesn't help but parsing the original URL reveals a usable root domain.

**Step 3 constructs from the company name** as a last resort. The regex `replace(/\s*(Inc\.?|LLC|Ltd\.?|Corp\.?|Co\.?|Limited|Group|Holdings?).*$/i, "")` strips common legal suffixes before lowercasing and removing non-alphanumeric characters. `"Deliveroo Ltd"` becomes `deliveroo`, producing `https://www.deliveroo.com`. This fails for companies with non-.com TLDs but provides a non-empty fallback before Nemotron synthesis runs without any URL.

When `deriveHomepageUrl()` returns an empty string (all three steps failed), the browser research block is skipped entirely and synthesis runs from job posting + profile only.

---

## 6. Synthesis with partial or no browser data — the "never empty" invariant

The most important structural decision in `agent/research.ts` is that `synthesizeDossier()` is called unconditionally at the end of `researchCompany()` — outside any try/catch, always after the browser block completes or fails. This is the "never empty" invariant.

The reason this works is the `content` variable initialisation:

```typescript
let content: ExtractedContent = {
  homepage: {},
  subpages: [],
  homepageUrl: "",
  visitedUrls: [],
};
```

This empty `ExtractedContent` is a valid input to `synthesizeDossier()`. When `content.homepageUrl` is empty string (falsy), the synthesis prompt substitutes: `"No browser research available — synthesize from job posting and candidate profile only."` Nemotron uses the job description and candidate profile to produce the `yourEdge`, `gapsToAddress`, `smartQuestions`, and `interviewPrep` sections without any website data. The `companyOverview` and `techStack` fields may be thin or absent, but the candidate still gets actionable output.

The browser research block is wrapped in its own `try/catch`:

```typescript
if (homepageUrl) {
  try {
    // session creation, stagehand, conductBrowserResearch
  } catch (err) {
    await logAgentError(...);
    // content remains the empty default
  } finally {
    // cleanup always runs
  }
}
// synthesis always runs here
const dossier = await synthesizeDossier(content, job, profile);
```

If the Hyperbrowser session fails to create, if Stagehand throws during init, or if the page is entirely unreachable, the `catch` logs the error and leaves `content` untouched. Synthesis runs with the empty content. The user gets a dossier.

---

## 7. Source deduplication

The `sources` field in the dossier is populated from two sources: Nemotron's own output (which may include citations it infers from the research text) and the `visitedUrls` list built up during browser navigation.

```typescript
const allSources = [
  ...((raw.sources as string[] | undefined) ?? []),
  ...content.visitedUrls,
].filter(Boolean);

return {
  // ...
  sources: [...new Set(allSources)],
};
```

The `new Set()` spread deduplicates because Nemotron often repeats the homepage URL in its output when `visitedUrls` also contains it. Without deduplication the UI would render the same URL twice.

The `filter(Boolean)` before the Set handles empty strings — `visitedUrls` can contain empty strings if a navigation target had no URL (defensive coding from `content.visitedUrls[i + 1] ?? ""` in the synthesis prompt string).

---

## 8. Context file corrections made during this feature

Three context files contained stale or incorrect information that was corrected during implementation:

**`context/architecture.md`** — The "Company Research Pattern" section showed `stagehand.page` as the way to get the active Playwright page. The actual API is `stagehand.context.activePage()` returning `Page | undefined`. The section was updated to show the correct pattern including the null check.

**`context/library-docs.md`** — The Stagehand section showed `stagehand.extract({ instruction, schema })` (object form). Corrected to the positional form `stagehand.extract(instruction, schema)` to match the installed V3 type signature. This file is the source of truth for library usage patterns — an agent reading the stale version would have written code that compiles but fails at runtime.

**`context/build-plan.md`** — Three Feature 13 references still named Browserbase as the session provider. Updated to Hyperbrowser with correct cleanup description.

The pattern established here: always verify library APIs against installed `node_modules` `.d.ts` types before writing code, and update context docs when they diverge from the installed version. Stale library docs are a compound problem — they cause wrong code in this session and wrong guidance to every future agent session.
