# Implementation Plan — Feature 13 Company Research Agent with Hyperbrowser

## Context

Feature 13 wires the disabled "Research Company" button on the job details page into a live agent. The original build plan specified Browserbase as the cloud browser provider. Before any code is written, the provider is being swapped to Hyperbrowser — it manages the cloud browser session while Stagehand (unchanged) still owns AI page control and Zod-based extraction, and Nemotron (unchanged) still owns final dossier synthesis. No Browserbase code or config has been written yet, so this is a greenfield implementation using Hyperbrowser from the start.

---

## Language agreed on

- **Hyperbrowser session** — a managed cloud browser from `hb.sessions.create()`, returning `wsEndpoint` (WebSocket/CDP URL) and `liveUrl`. One per research run. Always stopped in `finally`.
- **Stagehand extraction** — `stagehand.extract({ instruction, schema })` per page using a Zod schema. Runs inside the Hyperbrowser session via CDP. Per-page, not per-dossier.
- **Dossier synthesis** — single Nemotron call in `agent/research.ts` that takes all extracted content and returns the typed `CompanyDossier` saved to `jobs.company_research`.
- **Fallback research** — Nemotron synthesis using only job fields (`company`, `about_company`, `title`) + user profile, when browser navigation fails entirely. Never returns empty.
- **CDP endpoint** — `session.wsEndpoint` from Hyperbrowser. Stagehand `env: "LOCAL"` means "I supply the browser via this URL", not that it runs on the developer's machine.

---

## Decisions made

| Decision | Choice | Reason |
|---|---|---|
| Provider abstraction name | `lib/hyperbrowser.ts` (not `cloud-browser`) | Intentional provider choice; no premature abstraction |
| Extraction layer | Keep Stagehand | Matches existing build plan; Zod schema extraction already designed |
| Session timeout | `timeoutMinutes: 2` | Covers homepage + 3 sub-pages with room for fallback |
| Live session URL | Log only, never stored or shown | No UI need in v1 |
| Docs | Replace all Browserbase references with Hyperbrowser | No Browserbase code was ever written; no history to preserve |
| Dossier schema | 9-field `CompanyDossier` (see Types below) | Avoids hallucination-prone fields (teamSize, recentNews) while covering what a job seeker needs |
| UI update after research | `useState(initialResearch)` in CompanyResearch | Matches FindJobsClient pattern; no `router.refresh()` round-trip |
| Homepage URL derivation | Parse from `external_apply_url ?? source_url` → normalize to root domain → fallback to name construction → fallback to Nemotron synthesis | More reliable than guessing from company name |

---

## Amendments from architect review

1. **`deriveHomepageUrl()` must follow redirects first** — use `fetch(raw, { redirect: "follow" })` then parse `response.url` before falling back to parsing the original URL. The 3-step chain: (1) follow redirects → strip job-board subdomains, (2) parse original URL → strip subdomains, (3) construct from company name.
2. **API route returns generic errors only** — catch block logs real error server-side but returns `{ success: false, error: "Failed to research company" }` — never expose internal error messages.
3. **Nullable variable pattern in `finally`** — all external resources declared as `null` before the try block; each cleanup call is guarded by a truthy check. Prevents null reference errors when initialization partially fails.
4. **Phase 0b env key documentation** — update `.env.example`, `context/code-standards.md`, and `context/library-docs.md` with Hyperbrowser key requirements before writing any agent code.
5. **`.env.example` required** — create if absent; must have `HYPERBROWSER_API_KEY=` placeholder with comment directing user to Hyperbrowser docs.

---

## Assumptions

1. `@hyperbrowser/sdk` exposes `Hyperbrowser` class with `sessions.create(options)` and `sessions.stop(id)`, and the session object has `wsEndpoint` property. Verify against SDK docs at install time.
2. `@browserbasehq/stagehand` supports `env: "LOCAL"` with `localBrowserLaunchOptions: { cdpUrl }`. Verify against installed version.
3. Stagehand's `extract()` works with Nemotron via OpenRouter. If Nemotron lacks structured output support, Stagehand may need a different model — flag during implementation.
4. `jobs.company_research` JSONB column already exists from Feature 04 schema (confirmed in `context/architecture.md`).
5. Homepage URL parsing uses `new URL()` + subdomain normalization + a small denylist of known job-board domains (jobsdb.com, linkedin.com, etc.). Multi-part TLDs (`.co.uk`) are handled conservatively in v1.

---

## Types

Add to `types/index.ts`:

```typescript
export interface CompanyDossier {
  companyOverview: string;
  techStack: string[];
  culture: string[];
  whyThisRole: string;
  yourEdge: string[];
  gapsToAddress: string[];
  smartQuestions: string[];
  sources: string[];
  researchedAt: string;
}
```

Update the `Job` interface: `company_research: CompanyDossier | null` (currently typed as `jsonb`).

---

## Build steps

### Phase 0 — Dependencies and environment
1. `npm install @hyperbrowser/sdk @browserbasehq/stagehand zod`
2. Add `HYPERBROWSER_API_KEY` to `.env.local` (server-only — never prefix with `NEXT_PUBLIC_`)
3. Remove `BROWSERBASE_API_KEY` and `BROWSERBASE_PROJECT_ID` from `.env.local`

### Phase 0b — Environment key documentation
4. Update `.env.example` (or create it if absent):
   ```
   HYPERBROWSER_API_KEY=
   OPENROUTER_API_KEY=
   ```
5. Update setup docs (README or equivalent) — instruct: create Hyperbrowser account → copy API key → add to `.env.local` → restart dev server
6. Update `context/code-standards.md` env var table: add `HYPERBROWSER_API_KEY — used by lib/hyperbrowser.ts`; remove BROWSERBASE rows
7. Update `context/library-docs.md` Hyperbrowser section with "Required environment" block:
   - `HYPERBROWSER_API_KEY` required
   - Server-only: never `NEXT_PUBLIC_HYPERBROWSER_API_KEY`
   - Only `lib/hyperbrowser.ts` initializes the client
8. Add deployment checklist note: set `HYPERBROWSER_API_KEY` in production hosting environment before enabling Feature 13

### Phase 1 — Library layer (create both files from scratch)

**`lib/hyperbrowser.ts`**
- Export `createHyperbrowserSession(): Promise<{ client: Hyperbrowser; session: HyperbrowserSession }>`
- Options: `useStealth: true`, `adblock: true`, `acceptCookies: true`, `timeoutMinutes: 2`
- Client: `new Hyperbrowser({ apiKey: process.env.HYPERBROWSER_API_KEY! })`

**`lib/stagehand.ts`**
- Export `createStagehand(cdpUrl: string): Promise<Stagehand>`
- Config: `env: "LOCAL"`, `localBrowserLaunchOptions: { cdpUrl }`
- Model: `modelName: "nvidia/nemotron-3-ultra-550b-a55b:free"`, `modelClientOptions: { apiKey: process.env.OPENROUTER_API_KEY!, baseURL: "https://openrouter.ai/api/v1" }`
- Call `await stagehand.init()` before returning

### Phase 2 — Agent logic (`agent/research.ts`)

Four internal functions, one public export:

```
deriveHomepageUrl(job: Job): Promise<string>
  1. raw = external_apply_url ?? source_url
  2. try fetch(raw, { redirect: "follow" }) → parse response.url with new URL()
     → strip known job-board subdomains → return root domain
  3. catch: parse original raw URL with new URL()
     → strip known job-board subdomains → return root domain
  4. catch: company name construction (https://www.${cleanName}.com)
  Each step logs failure before falling through to the next.

conductBrowserResearch(
  job: Job,
  profile: Profile,
  stagehand: Stagehand
): Promise<ExtractedContent>
  → wrapped in try/catch; logs failures to agent_logs; never throws
  → navigate to homepageUrl
  → stagehand.extract(HomepageSchema) — summary, usefulLinks
  → select up to 3 useful links
  → for each: stagehand.extract(SubpageSchema) — content, relevance
  → return all extracted content (partial results acceptable)

synthesizeDossier(
  content: ExtractedContent,
  job: Job,
  profile: Profile
): Promise<CompanyDossier>
  → single Nemotron call via OpenAI client
  → prompt includes all extracted text + job fields + profile summary
  → returns typed CompanyDossier
  → researchedAt = new Date().toISOString()

researchCompany(jobId: string, userId: string): Promise<CompanyDossier>
  → fetch job row (scoped to user_id)
  → declare: let stagehand: Stagehand | null = null
             let session: HyperbrowserSession | null = null
             let client: Hyperbrowser | null = null
  → createHyperbrowserSession() → assign client + session
  → createStagehand(session.wsEndpoint) → assign stagehand
  → try: conductBrowserResearch()
  → catch: log error, use empty ExtractedContent (fallback path)
  → finally:
      if (stagehand) await stagehand.close()
      if (client && session) await client.sessions.stop(session.id)
  → synthesizeDossier(content, job, profile)  ← always runs
  → insforge.from("jobs").update({ company_research: dossier }).eq("id", jobId)
  → return dossier
```

Zod schemas:
- `HomepageSchema` — `{ summary: z.string(), usefulLinks: z.array(z.string()) }`
- `SubpageSchema` — `{ content: z.string(), relevance: z.string() }`

### Phase 3 — API route (`app/api/agent/research/route.ts`)

- `POST` only
- Auth: `createInsforgeServer()` → `getCurrentUser()` → 401 if no session
- Body: `{ jobId: string }` → 400 if missing
- Call `researchCompany(jobId, userId)` from `agent/research.ts`
- Fire `company_researched` PostHog event (server-side, one-shot client)
- Return: `{ success: true, data: { companyResearch: dossier } }`
- Catch: log real error server-side; return **generic** `{ success: false, error: "Failed to research company" }` — never expose internal error messages to the client

### Phase 4 — Component (`components/job-details/CompanyResearch.tsx`)

Convert from Server Component → Client Component:

```
"use client"
Props: { jobId: string; initialResearch: CompanyDossier | null }

State:
  research: CompanyDossier | null  (from initialResearch)
  loading: boolean
  error: string | null

handleResearch():
  setLoading(true); setError(null)
  POST /api/agent/research { jobId }
  if success: setResearch(body.data.companyResearch)
  if error: setError(body.error)
  finally: setLoading(false)
```

Four UI states using design tokens only:
- **Idle/empty** — existing empty state + enabled Research Company button
- **Loading** — spinner, button disabled, "Researching..." text
- **Error** — error message in `text-error`, retry button
- **Success** — rendered dossier sections (overview paragraph, techStack badges, culture bullets, whyThisRole paragraph, yourEdge bullets, gapsToAddress bullets, smartQuestions numbered list, sources muted text, researchedAt timestamp)

Update `app/find-jobs/[id]/page.tsx`: pass `job.company_research as CompanyDossier | null` as `initialResearch` prop.

### Phase 5 — Context file updates

| File | What changes |
|---|---|
| `context/architecture.md` | Stack table: Browserbase → Hyperbrowser; folder: `lib/browserbase.ts` → `lib/hyperbrowser.ts`, add `lib/stagehand.ts`; Company Research data flow; Browserbase Session Pattern → Hyperbrowser Session Pattern; Company Research Pattern (Stagehand config); invariants (session cleanup order) |
| `context/build-plan.md` | Feature 13 all Browserbase refs → Hyperbrowser |
| `context/library-docs.md` | Replace Browserbase section with Hyperbrowser session pattern; update Stagehand section to show `env: "LOCAL"` + CDP init |
| `context/code-standards.md` | Env var table: remove BROWSERBASE_*, add HYPERBROWSER_API_KEY; package list: remove `@browserbasehq/sdk`, add `@hyperbrowser/sdk`, `@browserbasehq/stagehand`, `zod` |
| `CLAUDE.md` | Stack table: Browserbase → Hyperbrowser; env vars list |
| `components/homepage/Features.tsx` | Verify "Company Research" card copy — update if it mentions Browserbase by name |

### Phase 6 — Post-implementation docs

After Feature 13 is working:
- Mark Feature 13 complete in `context/progress-tracker.md`
- Add `CompanyResearch.tsx` (upgraded) entry to `context/ui-registry.md`
- Create `docs/plan/13-company-research-agent/` with `plan.md`, `explanation.md`, `ai-discussion-topics.md`
- Create `docs/architect/13-company-research-agent/` from this session

---

## Cleanup order in `finally` (invariant)

```typescript
let stagehand: Stagehand | null = null;
let session: HyperbrowserSession | null = null;
let client: Hyperbrowser | null = null;

// ... initialization and try/catch ...

finally {
  if (stagehand) await stagehand.close();
  if (client && session) await client.sessions.stop(session.id);
}
```

Stagehand first — it may still use the browser connection during teardown. Hyperbrowser session second. Null-guards protect against partial initialization failures (e.g. Stagehand creation throws before assignment).

---

## Verification

1. `npm install` — no missing module errors
2. `npm run build` — clean TypeScript build
3. Manual: click "Research Company" on a job with a known company URL
   - Loading spinner appears
   - Dossier renders (or error state appears)
   - DB: `jobs.company_research` column populated for that row
   - PostHog: `company_researched` event fires
4. Fallback: test with a job that has `source_url` pointing to a job-board URL only — dossier still returns via Nemotron synthesis
5. `npm run test:run` — all 42 existing tests still pass
