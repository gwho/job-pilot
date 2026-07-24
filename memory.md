# Memory — Company Research Synthesis Recovery (Issue #38)

Last updated: 2026-07-23

## What was built

### Company Research Synthesis Recovery — fully complete

- `agent/research.ts` — `synthesizeDossier()` rewritten. Added `DossierSynthesisSchema` (zod: `companyOverview`/`whyThisRole` required, rest optional arrays), `parseSynthesisAttempt()` (treats `finish_reason === "length"`, empty content, `JSON.parse` failure, and zod validation failure all as one "invalid" outcome), `requestDossierSynthesis()` (non-streaming typed OpenAI request), one bounded retry with compact-instructions suffix at a higher token budget (2000 → 2600) on any invalid first attempt, and `buildFallbackDossier()` — a deterministic non-AI dossier built from `job.about_role`/`job.matched_skills`/`job.missing_skills`/already-collected browser research, used only when both attempts are invalid (no third model call). `researchCompany()`'s browser-research logic, DB fetch/save, and route caller were untouched.
- `__tests__/agent/research-synthesis.test.ts` — new file, 8 tests, exercises `researchCompany()` (not a shallow helper) with OpenAI/InsForge/Hyperbrowser/Stagehand mocked, browser research disabled via a job fixture with no company/URL. Two of the original red failures reproduced the exact production error strings byte-for-byte.
- `context/library-docs.md` — Nemotron section updated: retry budget, "retries on any invalid shape not just truncation" (differs from `agent/extractor.ts`), fallback-dossier policy, PII-safe logging rule extended to company research.
- `context/ui-registry.md` — non-UI change note added (backend-only, `CompanyResearch.tsx` already guards every field so sparse fallback dossiers render fine unmodified).
- `context/progress-tracker.md` — decision entry added.
- `docs/plan/company-research-synthesis-recovery/{plan.md,explanation.md,ai-discussion-topics.md}` — full docs written.
- GitHub issue [#38](https://github.com/gwho/job-pilot/issues/38) filed before implementation with confirmed root cause and expected behavior.
- Branch `fix/company-research-synthesis-recovery`, checked out from `fix/find-jobs-pipeline-reliability` (this repo uses a stacked-PR workflow — every fix/feature branch's PR targets the previous branch, not `main`; **PR not yet opened for this branch**).

## Decisions made

- **Root cause (confirmed, not theoretical)**: `synthesizeDossier()` called `JSON.parse()` directly on Nemotron output with no `finish_reason` check, no try/catch, no runtime shape validation (`as Record<string, unknown>` cast). Truncated or prose output threw an uncaught `SyntaxError` through `researchCompany()` to a generic 500 in `/api/agent/research`.
- **Retry on ANY invalid shape, not just truncation** — deliberately diverges from `agent/extractor.ts` precedent (which only retries on `finish_reason === "length"` and hard-fails immediately on parse/shape errors). Justified because company research has a fallback safety net to fall back on if the retry also fails, making a broader retry cheap insurance rather than the last line of defense.
- **Terminal behavior after exhausted retry: deterministic non-AI fallback dossier, not a controlled failure** — confirmed with the user before implementation. Chosen because CLAUDE.md's "company research always returns a dossier" invariant, read strictly, should cover synthesis failure the same way it already covers browser-research failure — not leave the user with nothing after the expensive browser step.
- **Fallback deliberately does NOT take the full candidate `profile`** — confirmed with the user after `/project-review` flagged it as a judgment call. `job.matched_skills`/`missing_skills` already encode the profile comparison (computed earlier by the matcher); re-deriving from raw profile would duplicate that work for a last-resort path. Documented explicitly in `agent/research.ts`'s comment and `explanation.md`.
- **No third Nemotron call ever** — the fallback exists specifically because it can't fail the way the first two attempts can (no AI call in it at all).

## Problems solved

- **Test mock leakage between test cases**: `vi.clearAllMocks()` only resets call history, not queued `mockResolvedValueOnce()` values — an unconsumed second queued response from a test where the code only made one call (because it threw) leaked into the next test's first call, causing confusing cross-test failures. Fixed by also calling `mocks.create.mockReset()` in `beforeEach` (purges the queue) while leaving the `vi.mock("openai", ...)` constructor's `mockImplementation` — set on a different mock object — untouched.
- **Diagnosis-phase red loop**: reproduced the bug by disabling browser research entirely (job fixture with no `company`/`source_url`/`external_apply_url`, so `deriveHomepageUrl()` returns `""`), reaching `synthesizeDossier()` directly without needing to mock Stagehand page interactions — kept the loop fast (~1.3s) and deterministic while still exercising the real `researchCompany()` boundary.

## Current state

- Fix fully implemented and verified: 8/8 new tests green, full suite 95/95 green, lint clean, `next build` clean.
- All required documentation written and committed to working tree (not yet committed to git — working tree has uncommitted changes on `fix/company-research-synthesis-recovery`).
- **No git commit made yet, no PR opened.** The user has not been asked to confirm a commit/push/PR — this session stopped at `/remember save` per the debug brief's skill order, before the commit step.
- Repo-wide: this session also discovered (via git/gh, not memory) that Feature 17 (Analytics Charts — Real Data) and the entire `fix/find-jobs-pipeline-reliability` hardening effort (actor outcome classification, InsForge token refresh, resume extraction truncation recovery) are complete and already pushed as PR #36 — but **PR #36 and all 19 other feature PRs are still open, none merged to `main`**. This stacked-PR backlog was not addressed this session.

## Next session starts with

Run `/remember restore`. Immediate next step: commit the uncommitted changes on `fix/company-research-synthesis-recovery` (agent/research.ts, __tests__/agent/research-synthesis.test.ts, context/library-docs.md, context/ui-registry.md, context/progress-tracker.md, docs/plan/company-research-synthesis-recovery/) and open PR against `fix/find-jobs-pipeline-reliability` per the debug brief's branch strategy (`docs/debug/debug-ideas.md`) — but confirm with the user first, since committing/pushing/opening a PR are visible actions this session did not get explicit go-ahead for yet.

After that: no feature is queued (progress-tracker's Phase 5 is the last phase, "Next: —"). Worth raising with the user: the 20-PR stacked backlog on GitHub, none merged to `main` — is that intentional, or does it need addressing before starting anything new?

## Open questions

- Should the 20 open, unmerged stacked PRs (including this new one once opened) be merged down to `main` at some point, or is the stack itself the intended long-term state? Not addressed this session.
- No new product feature is queued after Phase 5 / the reliability fixes — next direction needs deciding with the user.
- `docs/debug/debug-ideas.md` (the source of this session's task) remains untracked in git — not committed, not cleaned up. Leave for the user to decide (it's their working note, not something to delete unprompted).
