# AI Discussion Topics — Project Review: Company Research Synthesis Recovery

## Invariants: Wording vs. Outcome

1. CLAUDE.md's invariant says "job description + profile." Why does an implementation that only uses `job.matched_skills`/`missing_skills` (not the raw `profile` object) still satisfy the invariant's intent?
2. What general test could you apply to decide whether an invariant is describing a *mechanism* or an *outcome* the next time a review finds implementation wording drifting from documentation wording?
3. What would need to be true about `job.matched_skills`/`missing_skills` for this same design to become a real invariant violation instead of a judgment call?

## Why "Leave As-Is, Document Instead" Was the Right Resolution

4. The reviewer flagged the profile-parameter gap; the user chose to keep the code and fix the docs. What made that the correct call here, versus threading `profile` through for a literal match?
5. What would "fixing" this by adding `profile` to `buildFallbackDossier()`'s signature actually have bought, given the fallback is a last-resort, non-AI path?
6. Under what circumstances would documentation-only resolution be the *wrong* call — i.e., when should a reviewer push back on "just document it" as too easy an out?

## Verifying "Always Returns a Dossier" as an Implementation, Not Just a Design Intent

7. What three separate things did the review check to confirm no partial dossier is ever persisted? Why does "the test passes" alone not fully answer that question?
8. Why does the review distinguish "structurally cannot re-invoke browser research" from "tested to not re-invoke browser research" as two different, both-necessary claims?
9. The review used a background sub-agent to check `CompanyResearch.tsx`'s field-rendering guards rather than reading the component directly. What's the tradeoff of delegating that check versus doing it inline?

## Layered Review Method

10. Why does Layer 1 (plan alignment) check "nothing built beyond scope" as well as "everything planned exists"? What's the cost of a feature that does more than what was asked, even if the extra part is harmless?
11. This review found 0 critical/important issues. What would change about how you read a "clean" review layer if you knew the underlying feature had a known-flaky test suite versus, as here, a suite that reproduced production errors byte-for-byte?

## Scope Discipline

12. The debug brief explicitly said `/architect` should only be invoked if the fix "expands into a broader shared structured-output module." Why didn't extracting `parseSynthesisAttempt()`/`buildFallbackDossier()` into their own module count as that kind of expansion?
13. `/imprint` was correctly skipped since no UI changed. What's the smallest UI-adjacent change to this fix that *would* have required it?
