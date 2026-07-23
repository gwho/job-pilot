# AI Discussion Topics — Feature company-research-synthesis-recovery: Company Research Synthesis Recovery

## Structured Output & Validation

1. Why doesn't `response_format: { type: "json_object" }` guarantee the model won't return prose?
2. What's the difference between `JSON.parse` throwing and a zod `safeParse` failing — why does the code need to handle both as the same "invalid" outcome?
3. Why require `companyOverview` and `whyThisRole` in `DossierSynthesisSchema` but leave every array field optional?

## Retry Design

4. Why does company research retry on wrong-shape JSON when `agent/extractor.ts` (profile extraction) doesn't?
5. What determines whether a retry budget should be proportional (like the ~30% bump here) versus a fixed jump?
6. What would break if the retry were unbounded instead of capped at one attempt?
7. Why does the retry only change the *system prompt suffix* and *token budget*, not the model or temperature?

## Fallback & Invariant Design

8. Why is a deterministic non-AI fallback safer than a third model call, even with different retry instructions?
9. The fallback doesn't take the candidate `profile` — walk through why `job.matched_skills`/`missing_skills` already carry that signal.
10. CLAUDE.md's invariant was written for browser-research failure. What made it correct to extend the same guarantee to synthesis failure?
11. What's the tradeoff between "always return something" and "fail loudly so the user knows to retry"? When would a controlled failure be the better choice instead?

## Testing & Seams

12. Why test through `researchCompany()` instead of extracting and testing `synthesizeDossier()` directly?
13. Why is giving the test job fixture no `company`/URL a legitimate way to skip browser research, rather than a test-only shortcut?
14. What does asserting `mocks.create` was called "exactly twice" prove that asserting "the dossier is correct" alone would not?
15. Why did the original `__tests__/api/agent/research.test.ts` fail to catch this bug despite testing the same route?

## Architecture Boundaries

16. Why does this fix live entirely inside `agent/research.ts` with no changes to `app/api/agent/research/route.ts` or any UI component?
17. What other agent files parse raw model JSON the same way this one used to — where else might this exact bug exist today?
