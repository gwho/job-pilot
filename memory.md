# Memory — Feature 13 Complete + Full Documentation Suite

Last updated: 2026-07-02

## What was built

### Feature 13 implementation (fully complete)

- `lib/hyperbrowser.ts` — Hyperbrowser client + session factory; exports `HyperbrowserSession` type alias
- `lib/stagehand.ts` — Stagehand factory initialised against Hyperbrowser CDP endpoint; `disablePino: true`
- `agent/research.ts` — full research orchestration: `deriveHomepageUrl()`, `conductBrowserResearch()`, `synthesizeDossier()`, public `researchCompany(jobId, userId)`; Zod schemas for homepage/subpage extraction
- `app/api/agent/research/route.ts` — POST handler; auth guard → body validation → `researchCompany()` → isolated PostHog capture → response
- `components/job-details/CompanyResearch.tsx` — rewritten from placeholder to full `"use client"` component; 4 UI states (empty, loading, error, dossier); source URLs clickable for `http://`/`https://` strings with `rel="noopener noreferrer"`
- `app/find-jobs/[id]/page.tsx` — modified: passes `jobId` and `initialResearch` props to `CompanyResearch`
- `types/index.ts` — added `researchedAt?: string` to `CompanyResearchDossier`
- `.env.local` — added `HYPERBROWSER_API_KEY`
- `.env.example` — created with all env var placeholders
- Context files updated: `context/architecture.md`, `context/build-plan.md`, `context/library-docs.md`, `context/code-standards.md`, `CLAUDE.md` — all Browserbase refs replaced with Hyperbrowser

### Feature 13 project-review fixes (post-diagnosing-bugs session)

- `app/api/agent/research/route.ts` — PostHog isolated in its own try/catch; `company` added to `company_researched` event from `researchCompany()` return value
- `agent/research.ts` — return type changed to `Promise<{ dossier: CompanyResearchDossier; company: string | null }>` to surface company without a second DB query
- `context/architecture.md` — model name fixed: `"openai/nvidia/nemotron-3-ultra-550b-a55b:free"`
- `context/library-docs.md` — model name fixed; corrupt editorial block (lines 543-689) deleted; max_tokens updated 800→2000; temperature split documented (0.3 matching, 0.4 synthesis)

### Regression tests

- `__tests__/api/agent/research.test.ts` — NEW: 3 tests covering PostHog isolation (throws → success:true still returned) and company property derivation (from `researchCompany()` return, not client body; null→"")
- 45/45 tests passing (up from 42)

### Documentation

- `docs/diagnosing-bugs/13-company-research-agent/` — diagnosis.md, resolution.md, ai-discussion-topics.md
- `docs/project-review/13-company-research-agent/` — review.md, findings.md, ai-discussion-topics.md
- `docs/implement/13-company-research-agent/` — record.md, principles.md, ai-discussion-topics.md
- `docs/tdd/01-research-route-regression/` — record.md, principles.md, ai-discussion-topics.md
- `docs/plan/13-company-research-agent/` — plan.md, explanation.md, ai-discussion-topics.md (created earlier)
- `docs/tutorials/24-company-research-agent/README.md` — Tutorial 24: CDP, Stagehand, RAII, fallback chains
- `docs/tutorials/25-company-research-agent-review-fixes/README.md` — Tutorial 25: analytics isolation, return type extension, context file drift
- `docs/tutorials/26-research-route-regression-tdd/README.md` — Tutorial 26: module mocking, vi.mock() hoisting, partial matchers
- `context/ui-registry.md` — CompanyResearch entry updated with sources-as-links pattern

## Decisions made

- **`researchCompany()` returns `{ dossier, company }`** — not just the dossier. Avoids a second DB query in the route for the company name. Company is used only in the PostHog event.
- **PostHog in isolated try/catch** — analytics failure must never change the HTTP status. PostHog is a side effect; research success is the core operation.
- **Stagehand model name format** — `"openai/nvidia/nemotron-3-ultra-550b-a55b:free"` for Stagehand (needs `openai/` prefix to route via its OpenAI provider); `"nvidia/nemotron-3-ultra-550b-a55b:free"` for direct OpenAI client in `synthesizeDossier()` (different contexts, different formats — both correct).
- **Source URLs guarded by `http://`/`https://` prefix** — not `new URL()` parsing; prefix check is O(1) with no failure mode for non-URL strings.
- **`max_tokens: 2000`** for company research synthesis — 9-field schema worst case is ~1000-1400 tokens; 2000 gives 1.5-2x headroom.
- **Temperature split** — 0.3 for matching/extraction, 0.4 for synthesis.

## Problems solved

- **Stagehand `UnsupportedAISDKModelProviderError`** — `"nvidia/..."` parsed as unsupported sub-provider. Fix: `"openai/nvidia/..."`. Stagehand splits at first `/`; `"openai"` is a supported provider.
- **Nemotron JSON truncation** — `max_tokens: 800` cut the 9-field JSON mid-field. Fix: `max_tokens: 2000`.
- **Corrupt editorial note in `library-docs.md`** — lines 543-689 contained an instruction "Replace the existing section with this:" appended as document content. Also promoted the old `stagehand.extract({ instruction, schema })` object form (wrong; correct form is positional). Deleted with Python line arithmetic.
- **PostHog inside main try** — moved to isolated try/catch so analytics failure doesn't kill a successful research response.
- **Missing `company` on PostHog event** — `code-standards.md` requires `{ userId, jobId, company }`. Added via return type change.

## Current state

- **Feature 13 fully complete** — implementation working, all 8 project-review findings resolved, tests passing
- **Build clean** — `npm run build` passes
- **45/45 Vitest tests passing**
- Feature 14 is next in `context/build-plan.md`
- Teaching workspace: 26 tutorials, lessons up through Feature 12 teach series

## Next session starts with

Run `/remember restore`, check `context/build-plan.md` to confirm Feature 14, then `/architect Feature 14` before any code.

## Open questions

- **`catch` path still silent** — `handleSearch` `catch` block only calls `console.error`. Needs `setSearchStatus({ message: "Network error...", isError: true })`. Deferred.
- **GitHub Issue #19** — `job_found` PostHog event fires only for `match_score >= 70`. Fix in `app/api/agent/find/route.ts`. Deferred until before Feature 17.
- **DB-level race condition** — concurrent `/api/agent/find` requests from same user could insert duplicate jobs. Needs `UNIQUE (user_id, source_url)`. Deferred.
- **JobsDB session expiry** — re-capture needed ~mid-July 2026. Run `node scripts/capture-jobsdb-session.mjs`.
- **`not-found.tsx`** — custom 404 page absent. Minor; deferred.
