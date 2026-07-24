# Explanation — AI Matching Score/Skill Regression Recovery

## Why two validation levels, not one?

`agent/research.ts`'s dossier synthesis fix (the direct precedent for this one) validates a single Nemotron response as one unit: either the whole JSON object is valid or it isn't, and there's nothing smaller to salvage from a partial success. Job matching is a *batch* call — one request scores N jobs at once — so a single invalid entry inside an otherwise well-formed response is a fundamentally different failure than the whole response being garbage.

Collapsing these into one check would force a bad tradeoff: either (a) treat any per-entry defect as invalid-the-whole-response, wasting a full retry (and losing every other job's real score) over one bad entry, or (b) treat the response as valid whenever `JSON.parse` succeeds, silently accepting malformed or misaligned individual entries. Splitting validation into an envelope check (is this a `{ scores: [...] }` at all?) and a separate per-entry check (is *this* entry well-formed, and does its claimed `jobNumber` uniquely match a real job?) lets a single bad entry degrade gracefully — that one job goes unscored — without discarding everything else the model got right, and without spending a retry on a batch that mostly worked.

## Why echo back `jobNumber` instead of trusting array position?

The pre-fix code aligned scores to jobs purely by array index: `scores[i]` was assumed to correspond to `jobs[i]`. If the model reordered, skipped, or duplicated an entry — plausible for a free-tier model under a numbered-list prompt — that assumption breaks silently: a wrong score gets attached to the wrong job with no way to detect it after the fact.

Asking the model to echo a `jobNumber` per entry (1-based, matching the "Job N:" labels already in the prompt) turns an undetectable failure mode into a detectable one. If the model gets confused, the symptom becomes a missing or duplicated `jobNumber` — something the code can actually catch and handle (leave that job unscored) instead of quietly serving a wrong score. The field is 1-based rather than 0-based specifically so the model never has to translate between "the number in the prompt" and "the number in its answer" — removing an unnecessary source of confusion for no reliability gain.

## Why is a duplicate `jobNumber` unscored rather than resolved by "first entry wins"?

First-wins would pick one of two contradictory claims arbitrarily and persist it as if it were authoritative. But the model produced two different answers for the same job in the same response — that's evidence the model itself wasn't confident or consistent about that job, not evidence that the first answer happens to be right. Silently keeping one creates the illusion of a real score with no basis for trusting it over the alternative. Marking it unscored is the honest representation: matching genuinely didn't produce a trustworthy result for that job this attempt.

## Why does a legitimate 0% score need a different signature than the failure sentinel?

Both a real 0% match and matcher failure could reasonably show up as `match_score: 0` if we didn't distinguish them, which is exactly the bug we're fixing. The fix is careful to check the *exact* legacy combination — `match_score === 0`, `match_reason === UNSCORED_MATCH_REASON`, and both skill arrays empty — before treating an existing row as eligible for rescore. A real 0% match will almost certainly have a different, model-generated `match_reason` and non-empty skill arrays (the model still lists what's missing even for a poor fit), so checking `match_score === 0` alone would risk silently re-scoring (and potentially overwriting) a legitimate, deliberate zero.

## Why fold rescore candidates into the same batch as new jobs, rather than a separate call?

A rescore candidate is, by definition, a job that isn't really scored yet — so if a shared batch call fails entirely, the worst outcome is that it *remains* unscored, exactly like today. Isolating it into a second API call would only double request volume against a rate-limited free-tier model for a failure scenario that already degrades gracefully. Folding is strictly cheaper with no added risk.

## Why cap the rescore batch at 10, oldest first?

The existing new-job discovery pipeline (`TARGET_NEW = 10`) already has an implicit assumption that a single Nemotron call scores a bounded, single-digit-count batch reasonably within its token budget. Adding an uncapped backlog of previously-unscored rows on top of that would compound an existing (pre-existing, not introduced by this fix) scalability assumption. Capping at a fixed number, oldest-first, means a large backlog drains a little on every search rather than either being ignored or blowing up the batch size — and it's a separate constant from `TARGET_NEW` specifically so the two concerns (new-job discovery target vs. rescore batch size) don't accidentally couple if one changes later for unrelated reasons.
