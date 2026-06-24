# Memory — Feature 08 Complete + Tutorial and Docs Catch-Up Session

Last updated: 2026-06-25

## What was built

### Feature 08 — Resume PDF Generation from Profile (complete, was already built)

All code fully working before this session. Documented in `context/progress-tracker.md` and `docs/plan/08-resume-pdf-generation/`. Key files:
- `agent/resume-template.tsx` — @react-pdf `ResumeDocument` component (header, summary, skills, experience, education)
- `agent/pdf-generator.tsx` — Gemini call (temp 0.7, max_tokens 1000) + `renderToBuffer()` → `Buffer`
- `app/api/resume/generate/route.ts` — POST handler: auth → profile fetch → `is_complete` guard → generate → remove-then-upload → partial upsert (`resume_pdf_key`, `resume_pdf_url`, `resume_pdf_filename: "AI Generated Resume.pdf"`)
- `next.config.ts` — `serverExternalPackages: ["pdf-parse", "@react-pdf/renderer"]`
- `components/profile/ProfileForm.tsx` — `isGenerating` transition, button disabled when `!profile.is_complete`, local state update for filename after generation

### Tutorial writes (this session)

- `docs/tutorials/14-resume-pdf-generation/README.md` — Tutorial 14 for Feature 08; 6 Parts; all 18 ai-discussion-topics.md questions woven as inline checkpoints; covers `serverExternalPackages`, Yoga layout constraints, Gemini temperature rationale, Buffer→Blob three-attempt type error diagnosis, server-side `is_complete` guard, remove-then-upload, partial upsert, and stale form state vs `revalidatePath`

### Feature 06 doc rewrites (this session)

- `docs/plan/06-profile-save/explanation.md` — fully rewritten from thin bullet Q&A to 9-section narrative prose matching `docs/plan/02-auth/explanation.md` gold standard. Covers: full save loop, `calculateCompletion` in `lib/`, two-prop email separation, pre-upsert `is_complete` read, `'' → null` coercion, remove-then-upload, `FormData` necessity, four-state PostHog gate, three independent `useTransition` instances
- `docs/tutorials/07-profile-save/README.md` — fully regenerated; 7 Parts; all 12 ai-discussion-topics.md questions as inline `**Checkpoint:**` blocks with `<details>` answers; no separate quiz section

### Skill check (this session)

- `/feature-docs` skill is already globally available at `~/.claude/skills/feature-docs/SKILL.md` — the revised narrative-prose `explanation.md` format is the live version used by all projects

## Decisions made

- **Feature 08 Buffer → Blob conversion:** `new Uint8Array(result.buffer)` is required before wrapping in `new Blob()`. Passing `Buffer` directly or via `new Blob([buffer])` both fail TypeScript — `Buffer.buffer` is `ArrayBufferLike` (union includes `SharedArrayBuffer`), which `Blob`'s constructor rejects. `new Uint8Array(typedArray)` creates a copy with a fresh `ArrayBuffer`, satisfying `BlobPart`. Documented in `docs/plan/08-resume-pdf-generation/explanation.md` Section 3.
- **Feature 08 storage upload:** InsForge `storage.upload()` takes exactly 2 arguments. `library-docs.md` had an incorrect `{ upsert: true }` third-argument example — build caught it. Remove-then-upload is the correct pattern; `upsert` does not exist in the SDK.
- **Tutorial numbering:** Tutorial 14 is the Feature 08 tutorial. The tutorial number sequence skips some integers because architect deep-dives and recover tutorials occupy slots 11, 12, 13, etc.
- **Explanation.md narrative standard:** All `explanation.md` files must use numbered sections with flowing prose paragraphs (matching `docs/plan/02-auth/explanation.md`). Feature 06 was the only existing file that didn't meet this bar — now fixed. Features 01–05 were already acceptable quality.

## Problems solved

- **Feature 06 `explanation.md` was thin:** 7 brief `## Why X?` sections with 3–5 sentences each. Rewritten to 9 numbered narrative sections with concrete failure modes, code blocks, and multi-paragraph reasoning.
- **Tutorial 07 had a separate quiz section:** Old version had a standalone "Self-check quiz" at lines 905–966 violating the organic-checkpoint rule. Regenerated from scratch with all 12 questions as inline checkpoints.

## Current state

- **Phase 2 (Profile Page) is fully complete.** Features 05–08 all working.
- All tutorial docs through Tutorial 14 are written.
- Feature 06 and Feature 08 plan docs are high-quality narrative prose.
- Build is clean. No lint errors. Progress tracker is up to date.
- `feature-docs` global skill has the revised explanation.md format.

## Next session starts with

Begin **Feature 09 — Find Jobs Page: Full UI**. Run `/architect Feature 09` before any implementation. Check `context/build-plan.md` for the exact feature scope. The placeholder `/find-jobs` page at `app/find-jobs/page.tsx` should be replaced entirely (per the note in `context/progress-tracker.md`).

## Open questions

- None from this session.
