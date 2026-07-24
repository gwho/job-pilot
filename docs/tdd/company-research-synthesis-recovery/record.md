# Record — TDD Session: Company Research Synthesis Recovery

## Starting state

Entered this session with the regression suite already written and red: `__tests__/agent/research-synthesis.test.ts`, 8 tests, 7 failing at `agent/research.ts:266:20` (from the preceding `/diagnosing-bugs` session — see `docs/diagnosing-bugs/company-research-synthesis-recovery/`). The spec was not "figure out what to test" — it was already fixed by the red suite. This session's job was making it pass without changing what it asserts.

## Interface change

`synthesizeDossier(content, job, profile)` keeps its exact signature and return type (`Promise<CompanyResearchDossier>`). No caller-visible interface changed — `researchCompany()`'s call site is untouched. The change is entirely internal to `agent/research.ts`.

## What was built, in the order it was built

1. **`DossierSynthesisSchema`** (zod) — `companyOverview` and `whyThisRole` required strings, everything else an optional array. Placed directly above `synthesizeDossier()`.
2. **`SynthesisAttemptResult`** union type — `{ status: "parsed"; data }` or `{ status: "invalid" }`. Collapses four distinct failure modes (truncation, empty content, JSON parse failure, schema validation failure) into one outcome the retry logic can react to uniformly.
3. **`parseSynthesisAttempt(response, attempt)`** — checks `finish_reason === "length"` first, then empty content, then `JSON.parse` in a try/catch, then `DossierSynthesisSchema.safeParse()`. Every branch that returns `{ status: "invalid" }` logs metadata only (never raw content) with an `attempt` number for correlation.
4. **`buildFallbackDossier(content, job)`** — pure function, no I/O, no model call. Builds a complete `CompanyResearchDossier` from `job.about_role`, `job.matched_skills`, `job.missing_skills`, and whatever `content.homepage`/`content.subpages`/`content.visitedUrls` browser research already collected.
5. **`requestDossierSynthesis(openai, systemPrompt, userPrompt, maxTokens)`** — non-streaming typed request helper, mirrors `agent/extractor.ts`'s `requestProfileExtraction()`.
6. **`synthesizeDossier()` rewritten tail** — call attempt 1 → if invalid, call attempt 2 with `SYNTHESIS_RETRY_SUFFIX` appended to the system prompt and a higher token budget → if still invalid, return `buildFallbackDossier()` → otherwise map the validated `DossierSynthesis` into the full `CompanyResearchDossier` shape (same `?? []` defaulting pattern as before, now operating on zod-validated data instead of an unchecked cast).

## Result

```bash
npm run test:run -- __tests__/agent/research-synthesis.test.ts
# 8 passed (8)

npm run test:run
# Test Files  11 passed (11)
# Tests  95 passed (95)

npm run lint    # clean
npm run build   # clean, TypeScript passes
```

No test assertions were changed to make the suite pass — every one of the 8 tests written during diagnosis passed as originally written.

## Files touched

- `agent/research.ts` — only file with logic changes.
- `__tests__/agent/research-synthesis.test.ts` — pre-existing from the diagnosis session, untouched during this phase.
