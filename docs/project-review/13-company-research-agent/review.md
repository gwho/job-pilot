# Review — Feature 13: Company Research Agent

## Scope

Reviewed Feature 13 immediately after the diagnosing-bugs session that fixed the two root-cause failures (Stagehand model name prefix and max_tokens). The review checked all five implementation files plus all context files modified during the feature.

Files reviewed:
- `agent/research.ts`
- `app/api/agent/research/route.ts`
- `components/job-details/CompanyResearch.tsx`
- `lib/hyperbrowser.ts`
- `lib/stagehand.ts`
- `context/architecture.md`
- `context/library-docs.md`
- `context/code-standards.md`

---

## Layer 1 — Plan alignment

**PASS with one gap**

The implementation matched the architect plan for all agent, route, and component layers. The one plan gap was in `context/code-standards.md`: the plan required a `company_researched` PostHog event with `{ userId, jobId, company }` but the route was firing with `{ userId, jobId }` — `company` was missing.

---

## Layer 2 — System integrity

**ISSUES FOUND** — 6 issues

### Issue 1 — PostHog event missing `company` property (Important)

`context/code-standards.md` defines `company_researched` as requiring `{ userId, jobId, company }`. The route fired the event with only `{ userId, jobId }`. The `company` field was never passed.

**Fixed:** Changed `researchCompany()` return type from `Promise<CompanyResearchDossier>` to `Promise<{ dossier: CompanyResearchDossier; company: string | null }>`. The route destructures `{ dossier, company }` and passes `company: company ?? ""` to the event.

### Issue 2 — PostHog capture inside main try (Important)

`captureServerEvent()` was awaited inside the same `try/catch` block that guards `researchCompany()`. If PostHog threw (network failure, quota), the catch block returned HTTP 500 to the client — even though the research succeeded and the dossier was already saved to the DB.

**Fixed:** PostHog wrapped in its own isolated `try/catch` after the main `try` block. A PostHog failure now logs a console error and continues to the `return NextResponse.json({ success: true, ... })`.

### Issue 3 — Stale model name in `context/architecture.md` (Important)

The "Company Research Pattern" section in `context/architecture.md` showed:
```typescript
modelName: "nvidia/nemotron-3-ultra-550b-a55b:free",
```
This was the broken form that caused the diagnosing-bugs session bug. The fix applied in the diagnose session was to `lib/stagehand.ts` but the context file still showed the wrong form. Any agent reading this file in a future session would regenerate the broken model name.

**Fixed:** Updated to `"openai/nvidia/nemotron-3-ultra-550b-a55b:free"` with a comment explaining the `openai/` prefix routing.

### Issue 4 — Stale model name in `context/library-docs.md` (Important)

Same problem as Issue 3 in a different context file. The Stagehand Initialisation section in `library-docs.md` also showed the `"nvidia/..."` form.

**Fixed:** Same correction applied.

### Issue 5 — Corrupt editorial note in `context/library-docs.md` (Important)

Lines 543–689 of `library-docs.md` contained the literal text:
```
## Company Research Section

Replace the existing Stagehand 'Company Research Pattern' section in library-docs.md with this:
```
...followed by the new section content. This was an instruction meant to be applied to the file — it was accidentally appended as document content instead. It also contained the old `stagehand.extract({ instruction, schema })` object form, which is wrong (the correct form is positional arguments).

**Fixed:** Deleted lines 543–689 via Python line-range deletion. The correct section content was left in place earlier in the file.

### Issue 6 — Wrong max_tokens and temperature in `context/library-docs.md` (Important)

`library-docs.md` documented max_tokens as 800 for company research synthesis. The working code uses 2000 (fixed in the diagnosing-bugs session). Temperature was documented as a single value (0.3) for all operations; the working code uses 0.3 for matching/scoring/extraction and 0.4 for company research synthesis.

**Fixed:** Updated the temperature table to split the two values with explanations, and updated the company research max_tokens entry to 2000.

---

## Layer 3 — Production readiness

**ISSUES FOUND** — 2 issues

### Issue 7 — Source URLs as plain text (Minor)

`research.sources` is an array of URL strings. In `CompanyResearch.tsx`, these were rendered as plain `<li>` text — not clickable. A user could not open a source without copying and pasting it.

**Fixed:** Sources now rendered conditionally: when the string starts with `http://` or `https://`, rendered as `<a target="_blank" rel="noopener noreferrer">` with hover underline; otherwise rendered as plain text (guards against non-URL strings in the array).

### Issue 8 — Temperature value inconsistency in docs (Minor)

`context/architecture.md` did not document the split temperature values (0.3 for scoring, 0.4 for synthesis) or the max_tokens change. Covered under Issue 6 fix.

---

## Summary

8 issues found across 3 layers. All 8 resolved during the same implement session.

- **Layer 1 (plan alignment):** 1 gap — `company` missing from PostHog event
- **Layer 2 (system integrity):** 6 issues — PostHog isolation, 2 stale context files, corrupt editorial note, wrong token/temperature docs
- **Layer 3 (production readiness):** 2 issues — source URLs unclickable, temperature docs incomplete

Nothing deferred. All issues were either code fixes or documentation corrections with no trade-offs.
