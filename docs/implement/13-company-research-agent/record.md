# Record — Implement Session: Feature 13 Project-Review Fixes

## What was fixed

8 issues from the `/project-review` session, all resolved in one implement pass.

### Code changes

**`agent/research.ts`**
- Changed public export return type: `Promise<CompanyResearchDossier>` → `Promise<{ dossier: CompanyResearchDossier; company: string | null }>`
- Changed return statement: `return dossier` → `return { dossier, company: job.company }`

**`app/api/agent/research/route.ts`**
- Destructured `{ dossier, company }` from `researchCompany()` result
- Moved PostHog call outside the main try block into its own isolated `try/catch`
- Added `company: company ?? ""` to PostHog event properties

**`components/job-details/CompanyResearch.tsx`**
- Sources section now conditionally renders `<a target="_blank" rel="noopener noreferrer">` for `http://`/`https://` URL strings; plain `<li>` text for all other strings
- Added `ExternalLink` Lucide icon import for the sources header
- Added `Source link` token row to `context/ui-registry.md` CompanyResearch entry

### Context file changes

**`context/architecture.md`**
- Fixed Company Research Pattern `modelName`: `"nvidia/..."` → `"openai/nvidia/..."`
- Added comment explaining the `openai/` prefix routing to OpenRouter

**`context/library-docs.md`**
- Fixed Stagehand Initialisation `modelName`: same `openai/` prefix correction
- Deleted lines 543–689 via Python line-range deletion (corrupt editorial note + old object-form extraction pattern)
- Updated temperature table: split 0.3 into `0.3 (matching/scoring/extraction)` and `0.4 (company research synthesis)`
- Updated company research max_tokens entry: 800 → 2000

## What was run

- `npm run build` — clean build, zero TypeScript errors
- `npm run test:run` — 42/42 tests pass
- `/imprint components/job-details/CompanyResearch.tsx` — updated `context/ui-registry.md` CompanyResearch entry to document sources-as-links pattern
