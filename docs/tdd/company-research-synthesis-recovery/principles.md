# Principles — TDD Session: Company Research Synthesis Recovery

## This looked like the horizontal-slicing anti-pattern. Was it?

The `/tdd` skill is explicit: "DO NOT write all tests first, then all implementation... this produces crap tests" that test the *shape* of imagined behavior rather than real behavior discovered incrementally. This session entered with all 8 tests already written and red — the textbook shape of the anti-pattern.

The distinction that makes it not the anti-pattern: the skill's objection to horizontal slicing is that tests written in bulk *before understanding* end up testing invented behavior, because the author is guessing at what the system should do. These 8 tests were not guesses. They were derived from:

- Two real production error strings, reproduced byte-for-byte in the red suite during `/diagnosing-bugs`.
- A terminal-behavior design decision (deterministic fallback dossier vs. controlled failure) explicitly confirmed with the user *before* the test file was written, not inferred afterward.
- A concrete precedent (`agent/extractor.ts`) establishing what "recoverable" already means in this codebase, and an explicit, reasoned decision about where this feature's spec should diverge from that precedent (retry on any invalid shape, not just truncation).

In other words, the "understanding" that vertical-slicing normally builds test-by-test had already been built — just via diagnosis and explicit user confirmation instead of via incremental TDD cycles. Writing the tests in one pass afterward is documentation of an already-understood spec, not premature commitment to an imagined one. The risk the anti-pattern warns about (tests that are "insensitive to real changes") didn't materialize: implementation changed twice during this session (see "What the tests actually drove," below) and the tests caught both defects precisely.

**The generalizable rule**: horizontal test-writing is safe exactly when the "RED: write all tests" step is preceded by enough real diagnostic or specification work that the tests encode confirmed behavior, not guessed behavior. It is unsafe as a starting move on a feature nobody has thought through yet — that's when tracer-bullet, one-test-at-a-time cycles earn their keep, because each cycle is what builds the understanding in the first place.

## What the tests actually drove

Even though all 8 tests existed before implementation, the *order* code was written in still followed a tracer-bullet-like discipline in practice: the schema and parse function were built first (to turn the JSON.parse crashes into typed "invalid" outcomes), run against the suite, then the retry logic, then the fallback builder — checking the failing subset after each addition rather than writing the entire `synthesizeDossier()` rewrite in one shot blind. Two concrete things came directly from watching individual tests fail rather than from the spec text alone:

1. **The "wrong shape" test initially passed with the wrong schema.** An early version of `DossierSynthesisSchema` made every field optional (mirroring the original code's permissive `?? ""` fallback style). Under that schema, `{ overview: "wrong field names entirely" }` — the test's deliberately mismatched fixture — validated successfully, because an all-optional schema accepts an object with none of the expected keys. The test caught this immediately: "recovers ... after one retry" failed because no retry happened (the first "invalid" object was accepted as valid). This is why `companyOverview` and `whyThisRole` are the two *required* fields in the final schema — a schema entirely composed of optional fields cannot detect "wrong shape" at all, only "wrong type."

2. **The exhausted-retry test needed a `> 0` assertion, not an exact-value assertion**, because the deterministic fallback's exact field values are an implementation detail (which of `job.matched_skills` vs `content.subpages[].technologies` ends up in `techStack`), while "the fallback is grounded in trusted job data, not empty" is the actual behavior worth locking down. This mirrors the skill's core principle directly: assert observable behavior, not internal structure.

## Why test through `researchCompany()`, not `synthesizeDossier()`

`synthesizeDossier()` is not exported. Testing it directly would require either exporting an internal function solely so tests can reach it (making the test suite aware of, and therefore coupled to, the internal function split) or duplicating its logic behind a shallow double. Testing through `researchCompany()` means the suite exercises the real call chain — DB fetch, the `if (homepageUrl)` browser-research guard, synthesis, DB save — so a future refactor that merges or splits these internal functions differently cannot silently break coverage, as long as the public behavior (one dossier, one DB write, correct call counts) stays the same. This is precisely why the *original* `__tests__/api/agent/research.test.ts` couldn't catch this bug: it mocks `researchCompany()` entirely, one layer higher than where the bug lived.

## The mock-reset lesson, restated as a test-writing principle

Diagnosing the `vi.clearAllMocks()` vs `mockReset()` gap (full account in `docs/diagnosing-bugs/company-research-synthesis-recovery/resolution.md`) produced a durable rule for any test file in this codebase that queues `mockResolvedValueOnce()` responses across multiple `it()` blocks sharing one `beforeEach`: call `.mockReset()` specifically on any mock that uses `mockResolvedValueOnce()`/`mockImplementationOnce()`, not just `vi.clearAllMocks()`, unless every test is guaranteed to consume exactly as many queued values as it enqueues. `agent/extractor.ts`'s test suite happens to satisfy that guarantee by construction; this suite didn't, until the retry path existed to consume the second queued value on every test that provides one.

## Refactor pass

After all 8 tests were green, the skill's Step 4 (refactor while green) was applied by review rather than by change: the implementation was checked against `agent/extractor.ts`'s established conventions (naming, log prefix, non-streaming typed request pattern) and found already consistent — no duplication to extract, no module that needed deepening. The one deliberate structural choice — keeping `buildFallbackDossier()` a pure function taking only `(content, job)`, not `profile` — was surfaced explicitly during `/project-review` rather than found in this refactor pass; see `docs/project-review/company-research-synthesis-recovery/findings.md`.
