# Plan — Feature company-research-synthesis-recovery: Company Research Synthesis Recovery

## What was built

- `agent/research.ts` — Added `DossierSynthesisSchema` (zod), a safe parse boundary (`parseSynthesisAttempt`) that treats `finish_reason === "length"`, empty content, `JSON.parse` failure, and zod validation failure as a single "invalid" outcome, a non-streaming typed OpenAI request helper (`requestDossierSynthesis`), one bounded retry with compact instructions at a higher token budget when the first attempt is invalid, and a deterministic non-AI fallback (`buildFallbackDossier`) used only when both attempts are invalid.
- `__tests__/agent/research-synthesis.test.ts` — New regression suite exercising `researchCompany()` (not a shallow helper) with OpenAI/InsForge/Hyperbrowser/Stagehand mocked. Covers: valid JSON on first attempt, truncated-then-valid retry, prose-then-valid retry, wrong-shape-then-valid retry, exhausted retry building the deterministic fallback, no second Hyperbrowser/Stagehand call from the retry, and exactly one DB `update()` with a complete dossier.
- `context/library-docs.md` — Updated the Nemotron section's token budgets and rules: documents the 2000 → 2600 retry budget, that company research retries on *any* invalid shape (not just truncation, unlike profile extraction), and the fallback-dossier policy.
- `context/ui-registry.md` — Added a backend-only non-UI change note.
- `context/progress-tracker.md` — Added the synthesis recovery decision entry.
- GitHub issue [#38](https://github.com/gwho/job-pilot/issues/38) filed with the confirmed root cause and expected behavior before implementation.

## Schema changes

None in the database. `CompanyResearchDossier` (`types/index.ts`) is unchanged — it is always fully populated on write, whether from a successful Nemotron parse or the deterministic fallback. The new `DossierSynthesisSchema` is a runtime-only zod schema validating the *model's* raw response shape before it's mapped into a `CompanyResearchDossier`.

## Key invariants

- `researchCompany()` must never throw on a synthesis failure — every path (parsed, retried-and-parsed, or exhausted) returns a `CompanyResearchDossier`.
- At most two Nemotron calls per `researchCompany()` invocation — one initial, one retry. The exhausted-retry fallback makes no further model calls.
- Browser research (Hyperbrowser/Stagehand) runs at most once per invocation, before `synthesizeDossier()` is ever called. The synthesis retry only re-calls the OpenAI completion.
- Exactly one `jobs.update({ company_research })` call happens, always with a complete, valid dossier — never a partial one from a failed attempt.
- Logging at the synthesis boundary is metadata-only (`finish_reason`, content length, brace-start/end check, parse success, zod issue paths, attempt number) — never raw model output, prompts, or candidate/job content.
- The deterministic fallback intentionally does not take the full candidate `profile` — it uses `job.matched_skills`/`missing_skills`, which the matcher already derived by comparing the full profile against this job. See `explanation.md` for why.
