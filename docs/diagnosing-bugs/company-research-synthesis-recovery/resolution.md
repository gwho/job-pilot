# Resolution — Company Research Synthesis Recovery (Issue #38)

This file is about the *diagnosis methodology* — why the loop was built the way it was, and what the mock-leak detour teaches beyond this one bug. The actual fix implementation and its design tradeoffs are documented in `docs/tdd/company-research-synthesis-recovery/` and `docs/plan/company-research-synthesis-recovery/explanation.md`.

## Why matching production error text beats a plausible theory

`/diagnosing-bugs` Phase 4 (instrumentation) is meant to distinguish between hypotheses when the evidence is ambiguous. Here it wasn't needed, and skipping it was a deliberate call, not a shortcut: the red test's error output —

```
SyntaxError: Unexpected token 'T', "The user w"... is not valid JSON
```

— is not *similar to* the production error, it is *character-for-character identical* to it, produced by the same `JSON.parse()` call site under a synthetic fixture designed only to mimic the shape of the failure (a prose string starting with "The user w..."). A plausible theory ("the model probably returns prose sometimes") would have justified building the fix on a guess. Reproducing the exact string is proof the guess was right, at effectively zero extra cost — the fixture was already needed for the red test regardless.

The general principle: when a bug ships a distinctive error string, treat matching that string in a minimized repro as a stronger diagnostic signal than a strong prior. It's cheap to check for and it rules out "this is a different bug that merely looks similar."

## Why minimising meant deleting browser research from the test, not mocking it more

The naive approach to testing `researchCompany()` would mock Hyperbrowser/Stagehand's page-interaction behavior (`page.goto`, `stagehand.extract`, etc.) so the test could exercise the "browser research succeeded, then synthesis failed" path. That would have been more "complete" coverage, but it adds test surface (page mock behavior) that has nothing to do with the bug — the bug is entirely inside `synthesizeDossier()`, which never touches Hyperbrowser or Stagehand at all.

Per `/diagnosing-bugs` Phase 2 ("cut inputs, callers, config, data, and steps one at a time... every remaining element is load-bearing"): giving the job fixture no `company`/URL makes `deriveHomepageUrl()` return `""`, which makes `researchCompany()`'s existing `if (homepageUrl)` guard skip browser research — a real, already-existing production code path (the same one that runs whenever browser research legitimately can't determine a homepage), not a test-only shortcut invented for convenience. This is the difference between minimising correctly (removing something genuinely not load-bearing for the bug) and minimising by cutting a corner (mocking away something that *is* load-bearing but inconvenient to set up).

## What the mock-leak detour teaches about `vi.clearAllMocks()`

The false lead — a "prose" test failing with a "wrong call count" error, and a "wrong shape" test throwing the *previous* test's error — looked at first like a real inconsistency in the production code's behavior. It wasn't; it was a test-harness bug. The distinguishing question that resolved it: *why would the assertion for test 3 involve content that was only ever written into test 2's mock?* That question only makes sense once you notice Vitest's mock lifecycle has two tiers — `mockClear()` (call history only) and `mockReset()` (call history + queued return values) — and `vi.clearAllMocks()` only does the first.

This matters beyond this one file: any test suite in this codebase using `mockResolvedValueOnce()` inside a helper (the `mockCompletion()` pattern, shared with `__tests__/agent/extractor.test.ts`) is safe *only if every test consumes exactly as many queued responses as it enqueues*. That invariant held in `extractor.test.ts` by construction (each test's queued call count always matched its expected `create()` call count once the code was correct) but broke here specifically *while the code was still buggy* — the buggy code threw before consuming a second queued response that a soon-to-be-fixed retry path was expected to need. The lesson: when a red test's failure message doesn't match what the code being tested should produce, suspect the harness before suspecting the code — especially when queued mock values and pre-fix "throws early" behavior are both in play at once.

## Why Phase 6 (cleanup) had nothing to remove

No `[DEBUG-*]`-prefixed instrumentation was added this session (see above), so Phase 6's usual `grep` for temporary debug logs found nothing to clean up. The only artifact left behind from the diagnosis phase is the regression test file itself, which is not throwaway — it's the permanent coverage the `/tdd` phase built the fix against.
