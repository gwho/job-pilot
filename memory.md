# Memory — Feature 07 AI Profile Extraction + Tutorial Refactor Session

Last updated: 2026-06-24

## What was built

### Feature 07 — AI Profile Extraction from Resume (completed, two recover sessions required)

**Code files modified:**
- `next.config.ts` — added `serverExternalPackages: ["pdf-parse"]` to fix Turbopack ESM resolution
- `agent/extractor.ts` — import changed from `import pdf from "pdf-parse"` to `import { PDFParse } from "pdf-parse"`; usage changed from `await pdf(buffer)` to `new PDFParse({ data: buffer })` → `await parser.getText()`

**Feature is fully working:** Extract from Resume button → pdf-parse extracts text → Gemini via openai SDK returns structured JSON → `applyExtraction()` populates form fields null-safely → user reviews and saves manually.

### Tutorial writes (this session)

- `docs/tutorials/10-profile-extraction/README.md` — Feature 07 tutorial; 6 Parts; all 15 ai-discussion-topics.md questions woven into Part checkpoints; no quiz section
- `docs/tutorials/11-profile-extraction-architect-deep-dive/README.md` — architect deep-dive for Feature 07; 6 Parts; covers AI boundary decision, state ownership, server-side download, null contract, enum constraints, no-auto-save quality gate
- `docs/tutorials/12-pdf-parse-v2-migration/README.md` — consolidated recover tutorial for both pdf-parse sessions; 6 Parts + Intro; all 25 discussion questions from both recover folders woven organically into Part checkpoints

### Tutorial refactors (this session)

- `docs/tutorials/04-recover-start-for-free-404/README.md` — converted all inline checkpoint answers to `<details>` blocks; added 2 new checkpoints from discussion Q's (Mode 1 vs 3 with no stack trace; what if getCtaHref had a typo); absorbed self-check quiz questions into Parts; removed quiz section
- `docs/tutorials/10-profile-extraction/README.md` — added 9 new checkpoints from 15 discussion questions (distributed across all 6 Parts); absorbed 5 self-check quiz questions into Parts; removed quiz section

### Skill file update

- `/Users/jessejames/.claude/skills/tutorial/SKILL.md` — removed "Self-check quiz" step (Step 4 item 4 replaced with "Question mapping"); removed Section 7 (Self-check quiz) from Required sections; renumbered remaining sections; added quality rule: discussion questions must be woven into Parts organically, no standalone quiz section

### Recover session docs

- `docs/recover/pdf-parse-esm-default-export/` — Session 1: build error diagnosis, resolution, ai-discussion-topics (13 questions), plan
- `docs/recover/pdf-parse-v2-api-mismatch/` — Session 2: runtime error diagnosis, resolution, ai-discussion-topics (12 questions), plan

## Decisions made

- **`pdf-parse@2.4.5` v2.x requires two fixes, in order:** `serverExternalPackages` (bundler layer) must come first, then the named class import (API layer). The build fix doesn't fix the runtime; the runtime fix won't compile without the build fix.
- **Tutorial checkpoint style locked:** All `ai-discussion-topics.md` questions go inside Part checkpoints with `<details>` answer blocks — never in a standalone Self-check quiz section. This makes tutorials usable as interactive agent sessions.
- **Tutorial 10 and Tutorial 11 are separate documents:** Tutorial 10 = feature walkthrough. Tutorial 11 = architect deep-dive. The decision to split (vs. consolidate) is recorded in `docs/tutorials/11-profile-extraction-architect-deep-dive/README.md`.

## Problems solved

- **pdf-parse ESM build error:** `pdf-parse@2.4.5` is ESM-first. Turbopack follows `"import"` condition → ESM entry → re-exports pdfjs-dist geometry types (Rectangle, etc.), no default export. Fix: `serverExternalPackages: ["pdf-parse"]` routes resolution to Node.js at runtime via CJS entry.
- **pdf-parse runtime "Internal server error":** v2.x CJS entry exports named class `PDFParse`, not a default function. `import pdf from "pdf-parse"` → `pdf` is `undefined` → `await pdf(buffer)` throws `TypeError`. Fix: `import { PDFParse }` + `new PDFParse({ data: buffer })` + `await parser.getText()`.
- **Tutorial duplicate prevention:** When `/tutorial` was invoked twice for the same feature (once on architect folder, once on plan folder), established pattern: Tutorial N = feature walkthrough (from plan/), Tutorial N+1 = architect deep-dive (from architect/). Documented in `feedback_tutorial-skill-invocation-choice.md` memory.

## Current state

- Feature 07 fully working end to end. Build is clean. No lint errors.
- Tutorials 10, 11, 12 written. Tutorials 04 and 10 refactored to organic-weaving style.
- `/tutorial` skill updated — all future tutorials will use the organic checkpoint pattern with no quiz section.
- Progress tracker: Feature 07 ✅. Next → Feature 08.

## Next session starts with

Begin **Feature 08** — check `context/build-plan.md` and `context/progress-tracker.md` for the exact feature name and scope. Run `/architect feature 08` before any implementation.

## Open questions

- None from this session.
