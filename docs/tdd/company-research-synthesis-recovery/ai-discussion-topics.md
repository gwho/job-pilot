# AI Discussion Topics — TDD Session: Company Research Synthesis Recovery

## Horizontal vs. Vertical Slicing

1. The `/tdd` skill calls "write all tests, then all implementation" an anti-pattern, but this session started with all 8 tests already written and red. What made that acceptable here rather than a violation of the skill's own rule?
2. What specifically would have made this bulk test-writing *unsafe* — imagine the same 8 tests written without the prior `/diagnosing-bugs` session. What would likely be wrong with them?
3. Is "the tests encode a spec the user already confirmed" a general enough justification to skip tracer-bullet cycles on other features, or is this case unusually well-suited to it?

## Behavior vs. Implementation

4. Why does testing through `researchCompany()` instead of `synthesizeDossier()` matter, given `synthesizeDossier()` is where all the actual logic lives?
5. What internal refactor of `agent/research.ts` could happen in the future that this test suite would *not* need to change for?
6. The exhausted-retry test asserts `techStack.length + gapsToAddress.length > 0` instead of exact values. What would be lost by asserting exact array contents instead?

## Schema Design as a Test-Driven Discovery

7. Walk through why an all-optional `DossierSynthesisSchema` initially let the "wrong shape" test pass incorrectly. What does that reveal about the difference between validating *type* and validating *shape*?
8. Why are `companyOverview` and `whyThisRole` specifically the two required fields, rather than, say, requiring `techStack` to be present too?
9. If the model's real output distribution changed such that `whyThisRole` were often legitimately absent, what would need to change about the schema — and what would break if it did?

## Retry Design Divergence

10. Why does this feature retry on wrong-shape JSON while `agent/extractor.ts` doesn't? What single fact about company research's downstream behavior justifies the difference?
11. Is "retry more broadly because there's a fallback to catch failures" a pattern worth generalizing to other agent files, or is it specific to having a genuinely safe deterministic fallback available?

## Test Isolation Mechanics

12. Explain precisely what `mockReset()` clears that `mockClear()` (via `vi.clearAllMocks()`) does not.
13. Why did this particular bug (queued mock leaking across tests) only surface while the *implementation* was still buggy, and disappear once the retry path existed?
14. What's a general checklist item you could apply before writing any new Vitest suite that uses `mockResolvedValueOnce()` in a shared helper, to avoid rediscovering this same class of bug?

## Refactor Step

15. The refactor step in this session was "review, find nothing to change" rather than an active restructuring. What would have been a legitimate reason to refactor here even though the tests were already green?
