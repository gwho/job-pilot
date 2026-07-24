# Review — Company Research Synthesis Recovery (Issue #38)

## Scope

Reviewed immediately after the `/tdd` session that implemented the fix, against: GitHub issue #38, the regression suite (`__tests__/agent/research-synthesis.test.ts`), CLAUDE.md/AGENTS.md architecture rules, project error-handling conventions, and the CLAUDE.md invariant "Company research always returns a dossier — Nemotron synthesises from job description + profile if browser research fails."

Files reviewed:
- `agent/research.ts`
- `__tests__/agent/research-synthesis.test.ts`
- `__tests__/api/agent/research.test.ts` (checked for regressions, not modified)
- `components/job-details/CompanyResearch.tsx` (checked via a background sub-agent for field-rendering safety, not modified)

One explicit question this review was asked to resolve, per the debug brief's instruction not to leave it ambiguous: whether the terminal behavior after an exhausted retry is a deterministic minimal dossier (preserving the invariant) or a controlled failure (revising it). This had already been decided with the user *before* implementation — the review's job was to verify the implementation actually delivers on that choice, not to re-decide it.

---

## Layer 1 — Plan alignment

**PASS.**

Every item in issue #38's "Expected behavior" section is implemented and covered by a passing test: valid output succeeds without retry; a truncated or malformed first response gets exactly one bounded, synthesis-only retry reusing already-collected browser research; parsed JSON is validated at runtime (zod) before being saved; exhausted recovery returns the agreed deterministic dossier instead of throwing; regression tests cover valid JSON, truncation, prose, invalid shape, and an exhausted retry — matching the debug brief's required red-green sequence items 1 through 5 exactly.

Nothing was built beyond the brief's scope: no UI changes, no extraction of a broader shared structured-output module (`/architect` correctly wasn't triggered — the brief reserved it for exactly that scenario, which didn't happen).

---

## Layer 2 — System integrity

**PASS**, with one item surfaced as a judgment call rather than a defect.

- **Architecture boundaries**: `agent/research.ts` still imports nothing from `components/` or `actions/`; all changes are internal to the `agent/` layer, consistent with the API-route-orchestrates / agent-owns-AI-behavior boundary.
- **Logging convention**: every new `console.error` call uses the `[agent/research]` prefix and logs metadata only (`finish_reason`, content length, brace-start/end check, parse success, zod issue count/paths, attempt number) — verified line by line, none log raw model output, prompts, or job/profile content.
- **Retry design**: deliberately diverges from the `agent/extractor.ts` precedent (retries on any invalid shape, not truncation alone) — a reasoned divergence tied to company research having a fallback to lean on, not an inconsistency.
- **Judgment call — not a defect**: CLAUDE.md's invariant literally says the dossier synthesizes "from job description **+ profile**." `buildFallbackDossier(content, job)` does not take a `profile` parameter — it uses `job.matched_skills`/`missing_skills`, which are themselves profile-derived (computed earlier by the matching agent). Flagged to the user; **the user's explicit decision was to leave it as-is** and have the documentation clarify the distinction (normal synthesis uses the full profile; the terminal fallback uses the already-derived match signals) rather than thread the profile object through. Documentation was updated accordingly in `agent/research.ts`'s inline comment and `context/library-docs.md`.

---

## Layer 3 — Production readiness

**PASS.**

- No third model call under any code path (verified structurally and by a test asserting `mocks.create` is called exactly twice on the exhausted-retry path).
- No partial or empty dossier is ever persisted — verified by a test asserting `jobs.update()` is called exactly once, with a complete dossier, regardless of which path produced it.
- `researchCompany()` cannot throw on a synthesis failure under any of the tested paths.
- Browser research (`createHyperbrowserSession`/`createStagehand`) cannot be re-invoked by the retry — `synthesizeDossier()` has no reference to either; this is structural, not merely tested.
- `__tests__/api/agent/research.test.ts` (mocks `researchCompany()` entirely) required no changes and remains part of the 95/95 green full suite.
- `/imprint` correctly not invoked — zero UI files touched.
- A background check of `components/job-details/CompanyResearch.tsx` confirmed every dossier field (all `string[]` arrays and the two `string` fields `companyOverview`/`whyThisRole`) is guarded — arrays with `.length > 0`, strings with a truthy check — so a sparse fallback dossier renders cleanly with unrendered sections, not empty headings or a crash. No UI code needed to change for the fallback dossier to display correctly.

---

## Summary

0 critical or important issues. 1 minor judgment call surfaced (profile not threaded into the fallback builder) — resolved by the user's explicit decision to leave the code as-is and tighten the documentation instead. See `findings.md` for the deeper reasoning behind why that resolution is sound, not just expedient.
