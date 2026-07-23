# Explanation — Feature company-research-synthesis-recovery: Company Research Synthesis Recovery

## Why retry on wrong-shape JSON, not just truncation?

`agent/extractor.ts` (profile extraction) only retries when `finish_reason === "length"`; a parse failure or shape-validation failure there returns a hard failure immediately. Company research needed to retry on *all three* — truncation, non-JSON prose, and valid-but-wrong-shape JSON.

The difference is what's downstream of failure. Profile extraction's hard failure is the end of the line: the user sees an error and can retry manually. Company research has a second safety net — the deterministic fallback — so a broader retry is cheap insurance rather than the last line of defense. It's also directly evidenced: production logged both a truncation error and a literal prose response (`"The user w..."`), and there was no reason to assume wrong-shape JSON couldn't also happen, given the original code had zero runtime shape validation at all.

## Why a deterministic non-AI fallback instead of a controlled failure?

The alternative — keep today's generic "Failed to research company" error, just make the underlying cause honest — was considered and rejected. It's less code, but it doesn't fix the complaint the bug report opens with: a user completes the expensive browser-research step (a real Hyperbrowser session, real page navigation) and still gets nothing.

CLAUDE.md's existing invariant — "Company research always returns a dossier — Nemotron synthesises from job description + profile if browser research fails" — was written for the case where *browser research* fails. But the deeper intent is that the feature never leaves the user empty-handed. Extending that guarantee to cover *synthesis* failure too, not just browser-research failure, is the literal reading of "always returns a dossier."

A third Nemotron call for the fallback was rejected because it's the same failure mode risk that caused the bug in the first place — a fallback that can fail the same way as the thing it's falling back from isn't a fallback. The deterministic builder uses only data already in hand (`job.about_role`, `job.matched_skills`, `job.missing_skills`, and any browser research content already collected), so it cannot fail on malformed AI output — there's no AI call in it at all.

## Why doesn't `buildFallbackDossier()` take the candidate profile?

Normal synthesis sends Nemotron the full candidate profile (title, experience, skills, work history) so it can personalize the dossier. The fallback deliberately doesn't take a `profile` parameter.

`job.matched_skills` and `job.missing_skills` are not raw job-posting data — they're already the output of comparing the full candidate profile against this specific job (computed earlier by the matching agent, before company research ever runs). Re-deriving that comparison from the raw profile inside the fallback would duplicate work the matcher already did, for a code path whose entire purpose is to be a cheap, guaranteed-to-succeed last resort — not a second personalization engine. The profile's signal is present in the fallback, just already distilled into the two fields that matter most for "why this candidate, this gap."

## Why a higher retry budget (2600) instead of matching the extractor's jump (2500 → 3000)?

The two features have different starting budgets — company research synthesis starts at 2000 tokens (it was already the production `max_tokens` value, unchanged by this fix), profile extraction starts at 2500. The retry increase (600 tokens, ~30%) is proportionally similar to the extractor's (500 tokens, ~20%) without being copied verbatim — the right retry budget is a function of how verbose each schema's fields are, not a shared constant.

## Why does the regression test disable browser research (job has no company/URL)?

The bug lives entirely inside `synthesizeDossier()` — the JSON-parsing boundary — not in browser research. Mocking Hyperbrowser/Stagehand's actual page-interaction behavior would add complexity to the test without exercising any code this fix touches. Giving the test job fixture no `company`/`source_url`/`external_apply_url` makes `deriveHomepageUrl()` return `""`, so `researchCompany()`'s existing `if (homepageUrl)` guard skips browser research entirely and reaches `synthesizeDossier()` directly with empty `content` — the same code path production already uses today whenever browser research legitimately finds nothing. `lib/hyperbrowser` and `lib/stagehand` are still mocked (not left real) so the suite fails loudly rather than making a network call if that assumption ever breaks.

## Why test through `researchCompany()` instead of extracting and testing `synthesizeDossier()` directly?

`synthesizeDossier()` isn't exported — testing it directly would mean either exporting an internal function purely for tests (a smell: the test would then know about internal structure) or duplicating its logic in a shallow test double. Testing through the public `researchCompany()` boundary means the test exercises the *real* call chain: DB fetch → browser-research skip → synthesis → DB save, so a future refactor of the internal split between these functions can't silently break the regression coverage. This was true before the fix too — the existing `__tests__/api/agent/research.test.ts` mocks `researchCompany()` entirely, which is exactly why it couldn't catch this bug; the new suite closes that gap at the correct seam instead of adding another shallow layer above it.
