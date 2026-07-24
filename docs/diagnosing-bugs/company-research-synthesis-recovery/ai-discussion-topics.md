# AI Discussion Topics — Diagnosing Company Research Synthesis Recovery (Issue #38)

## Building the Feedback Loop

1. Why was `researchCompany()` chosen as the test seam instead of exporting `synthesizeDossier()` directly for testability?
2. What makes a red test "tight" in the sense `/diagnosing-bugs` uses the word — what three properties did this loop need before diagnosis could proceed?
3. Why is a 1.3-second test loop meaningfully better for debugging than a 70-83 second live browser-research run, beyond just "faster"?

## Minimisation

4. Why does giving the test job fixture no `company`/`source_url` count as legitimate minimisation rather than a shortcut that skips real coverage?
5. What would have been lost — or gained — by mocking Hyperbrowser/Stagehand's page interactions instead of skipping browser research entirely?
6. The skill says "every remaining element is load-bearing" is the completion criterion for minimisation. What in this test fixture is load-bearing, and what would happen if you removed the mocked `openai` module?

## Evidence and Hypothesis Ranking

7. Why does an exact string match between a test's error output and a production log line count as stronger evidence than a hypothesis that merely "fits the facts"?
8. Rank the five hypotheses in `diagnosis.md` again from scratch, using only the two production log lines (not the full session). Do you land on the same order?
9. Why was Phase 4 (instrumentation) skipped this session? Under what circumstance would it have been necessary even with matching error text in hand?

## The Mock-Leak Detour

10. Walk through exactly why `vi.clearAllMocks()` failed to isolate `mocks.create` between tests. What specific call left a queued value behind?
11. What's the difference between `mockClear()`, `mockReset()`, and `mockRestore()` in Vitest — and which one actually removes queued `mockResolvedValueOnce()` values?
12. Why did this leak only manifest *while the production code was still buggy*, and not after the fix was in place? What does that imply about writing tests against not-yet-fixed code?
13. `agent/extractor.ts`'s test suite uses the same `mockCompletion()` pattern and never hit this bug. What invariant protected it, and why did this new suite briefly violate that invariant?

## Process

14. The debug brief (`docs/debug/debug-ideas.md`) prescribed the skill order and even the exact test file path before diagnosis started. Does pre-writing that much of the plan undermine the discipline `/diagnosing-bugs` is built around, or strengthen it? What's the risk either way?
15. What would you have done differently if the production logs had shown only one error type (say, just truncation) instead of two distinct failure classes?
