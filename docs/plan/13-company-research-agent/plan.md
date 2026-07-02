# Plan — Feature 13-company-research-agent: Company Research Agent

## What was built

- **`lib/hyperbrowser.ts`** (new) — factory that creates a Hyperbrowser client and cloud browser session; exports `HyperbrowserSession` type alias for `SessionDetail`
- **`lib/stagehand.ts`** (new) — factory that initialises Stagehand against a Hyperbrowser CDP endpoint; `disablePino: true` suppresses verbose logging
- **`agent/research.ts`** (new) — full research orchestration: `deriveHomepageUrl()`, `conductBrowserResearch()`, `synthesizeDossier()`, public `researchCompany()`; Zod schemas for homepage and sub-page extraction
- **`app/api/agent/research/route.ts`** (new) — POST handler; auth guard → body validation → `researchCompany()` → `captureServerEvent("company_researched")` → response
- **`components/job-details/CompanyResearch.tsx`** (rewritten) — converted from inert Server Component to live Client Component with 4 UI states (empty, loading, error, dossier)
- **`app/find-jobs/[id]/page.tsx`** (modified) — passes `jobId` and `initialResearch` props to CompanyResearch
- **`types/index.ts`** (modified) — added `researchedAt?: string` to `CompanyResearchDossier`; `Job.company_research` was already typed as `CompanyResearchDossier | null`
- **`.env.local`** (modified) — added `HYPERBROWSER_API_KEY`
- **`.env.example`** (new) — all env var placeholders; `HYPERBROWSER_API_KEY` documented with account setup comment
- **`context/architecture.md`**, **`context/build-plan.md`**, **`context/library-docs.md`**, **`context/code-standards.md`**, **`CLAUDE.md`** — all Browserbase references replaced with Hyperbrowser

## Schema changes

None. `jobs.company_research` JSONB column already existed from Feature 04 schema.

## Key invariants

- `HYPERBROWSER_API_KEY` is server-only — never prefix with `NEXT_PUBLIC_`. Only `lib/hyperbrowser.ts` initialises the Hyperbrowser client.
- Stagehand must close before the Hyperbrowser session is stopped (see `finally` in `researchCompany()`). Reversing order can produce spurious CDP teardown errors.
- All three nullable variables (`stagehand`, `session`, `client`) must be declared as `null` before the `try` block and individually guarded in `finally`. Never assume all three are assigned.
- `synthesizeDossier()` must always run, even when `content` is the empty default. The browser research block is wrapped in `try/catch` specifically so synthesis is not gated on it.
- `stagehand.extract()` takes positional arguments: `extract(instruction: string, schema: ZodSchema)` — not `extract({ instruction, schema })`. The object form is wrong and will fail at runtime.
- `stagehand.context.activePage()` returns `Page | undefined`, not `Page`. The code must null-check before calling `page.goto()`.
- The API route returns a generic error string (`"Failed to research company"`) from the catch block — never the raw error. Real errors are logged server-side with `[api/agent/research]` prefix only.
- PostHog events must use `captureServerEvent()` from `lib/posthog-server.ts`, not `createPostHogServer()` directly. `createPostHogServer()` returns `PostHog | null` and TypeScript rejects calling methods on it without a null check.
- Sources in the dossier are deduplicated with `new Set(allSources)` — raw Nemotron output may repeat URLs also present in `visitedUrls`.
- `researchCompany()` queries jobs scoped to both `id` and `user_id`. Never query without the user filter.
