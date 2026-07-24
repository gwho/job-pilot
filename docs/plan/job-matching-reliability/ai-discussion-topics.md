# AI Discussion Topics — AI Matching Score/Skill Regression Recovery

## Validation design

1. Walk through why envelope validity and entry validity need to be checked separately here, when `agent/research.ts`'s single-call synthesis fix didn't need that split at all.
2. What would go wrong if `ScoringEnvelopeSchema` validated each score entry's full shape (not just that `scores` is an array), instead of leaving entries as `unknown` until `alignScores` checks them individually?
3. Why does a jobNumber claimed by two entries get marked unscored instead of picking the first one? What does "first-wins" implicitly assume that isn't actually true here?

## Alignment and the `jobNumber` field

4. Why is `jobNumber` 1-based instead of 0-based, given the rest of the codebase (array indices) is naturally 0-based?
5. What specific failure mode does echoing `jobNumber` back protect against that pure array-position alignment couldn't have caught at all?
6. An out-of-range `jobNumber` (e.g. `15` when there are only 10 jobs) is silently ignored rather than treated as an error. Is that the right call, or should it be flagged as evidence the model's response is unreliable overall?

## The legacy-fallback signature vs. `match_score = 0`

7. Why does `isLegacyFallbackScore()` check `match_reason` and both skill arrays, not just `match_score === 0`? Construct a scenario where checking `match_score === 0` alone would incorrectly re-score (and risk overwriting) a real result.
8. `CONTEXT.md`'s "Unscored job" glossary entry predates this fix. What does it tell you about how the domain was already understood, even though the code didn't reflect it yet?

## Rescore batching and remediation

9. Why is folding rescore candidates into the same `scoreJobs()` call as new jobs safe, when isolating them into a separate call might seem more cautious at first glance?
10. `RESCORE_CAP` happens to equal `TARGET_NEW` today. Why does the fix use a separate named constant instead of just reusing `TARGET_NEW`?
11. What's the actual failure mode if a rescore's DB `update()` call fails? Trace what the user sees on their next search versus what they'd see if this fix didn't swallow that error.
12. `job_found` is never fired for a rescored row. What's the argument that this is correct product behavior, not just an implementation shortcut?

## Comparing this fix to the company-research synthesis recovery precedent

13. Both fixes retry once on Nemotron JSON failures, but terminal failure means different things — a deterministic fallback dossier for company research, `matchScore: null` here. Why can't job matching have an equivalent deterministic fallback score?
14. What made it possible to discover, during investigation, that the UI/DB/type layer already fully supported the fix's target state (`match_score: null`) before any code changed? What would you check first on a similar future bug to find out early whether the fix is smaller than it first appears?
