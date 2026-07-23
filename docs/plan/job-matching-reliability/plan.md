# Plan — AI Matching Score/Skill Regression Recovery

## What was built

`scoreJobs()` in `agent/job-matcher.ts` scores every discovered job against the candidate profile in one Nemotron call. It previously had no `finish_reason` check, no runtime shape validation, no retry, and trusted pure array position to align returned scores back to input jobs. On any failure — a request error, truncated/prose/wrong-shape JSON, a short `scores` array — it fell back to `FALLBACK_SCORE`, which fabricated `matchScore: 0`. `app/api/agent/find/route.ts` wrote that value to `jobs.match_score` unconditionally, so a matcher failure became a real, permanent 0% match — indistinguishable from a genuine zero score, and in direct violation of `CONTEXT.md`'s own "Unscored job" glossary entry ("_Avoid: ... zero-score job_").

Investigation showed the DB column (`match_score INTEGER`, nullable), `types/index.ts` (`match_score: number | null`), and every UI consumer (`JobInfo.tsx`, `MatchScore.tsx`, `JobsTable.tsx`, `FindJobsClient.tsx`, `app/dashboard/page.tsx`) already fully supported `match_score: null` as "unscored" — high/low filters, score sort, dashboard averages, and distribution all already excluded or correctly handled null. The bug was narrowly confined to the matcher fabricating `0` instead of ever producing `null`.

There was also no rescore path: `app/api/agent/find/route.ts` deduplicated discovered jobs by `source_url`, so a row that received the fallback sentinel once stayed that way forever — rediscovering the same URL on a later search only ever skipped it.

### The fix

**`agent/job-matcher.ts`** — rewritten around a two-level validation contract:

- **Envelope validity** (`parseScoringAttempt` + `ScoringEnvelopeSchema`): checks `finish_reason === "length"`, empty content, `JSON.parse` failure, and whether the parsed value is `{ scores: unknown[] }` at all. Any failure here — including the request itself throwing — gets exactly **one** whole-batch retry at a higher token budget (2000 → 2600) with a compacting prompt suffix. If the retry also fails at this level, every job in the batch is left unscored.
- **Entry validity** (`alignScores` + `JobScoreEntrySchema`), reached only once the envelope parsed: each score entry must include a 1-based `jobNumber` (echoed back by the model, matching the existing "Job N:" prompt labels) rather than relying on array position. A malformed entry is dropped; a missing `jobNumber` leaves only that job unscored; a `jobNumber` claimed by two or more entries is left **unscored, not resolved by first-wins** — the model contradicted itself and neither claim is trustworthy. None of this triggers a batch retry — the envelope was well-formed, so the other jobs' real scores are preserved.
- Terminal failure at either level produces `{ matchScore: null, matchReason: UNSCORED_MATCH_REASON, matchedSkills: [], missingSkills: [] }` — never a fabricated number. Unlike company research synthesis (which has a deterministic non-AI dossier fallback), job matching has no honest way to approximate a score without the model.

**`app/api/agent/find/route.ts`** — adds a bounded rescore path:

- `isLegacyFallbackScore(job)` matches the *exact* pre-fix sentinel (`match_score === 0 && match_reason === UNSCORED_MATCH_REASON` && both skill arrays empty) — never `match_score === 0` alone, since a real 0% score is possible and must never be reprocessed or overwritten.
- `needsRescore(job)` also covers a plain `match_score === null` row (already-correct "unscored" state deserves the same retry opportunity).
- Up to `RESCORE_CAP` (10) rediscovered rows matching `needsRescore`, oldest `found_at` first, are folded into the same `scoreJobs()` batch as brand-new jobs (one call, sliced back apart by index afterward) — draining a large backlog monotonically across repeated searches instead of scoring it all in one oversized batch.
- Rescored rows are `update()`d in place by `id`, never `insert()`ed as duplicates, and a row not selected by `needsRescore` (i.e. already validly scored) is never touched.
- The update is written unconditionally with whatever `scoreJobs()` returned — a real score corrects the row, and a repeated scoring failure still normalizes the legacy `0` to `null` rather than leaving the old sentinel in place.
- A failed DB update is logged and swallowed — non-fatal, never blocks the response.
- `rescoredByUrl` feeds into `displayJobs` alongside `insertedByUrl`/`existingByUrl` so the response reflects the corrected score immediately.
- `job_found` (and the `strongMatches` count) remain scoped to `insertedJobs` only — they model discovery, not remediation, so rescored existing rows never re-fire that event.

## Tests

- `__tests__/agent/job-matcher.test.ts` (15 tests) — envelope-level retry (truncation, prose, wrong shape, request error, exhausted retry), and entry-level alignment (malformed/missing/duplicate `jobNumber`, out-of-range numbers, clamping, defaults, null profile).
- `__tests__/find-jobs/matching-reliability.test.ts` (10 tests) — route persistence: legacy-fallback rescore, genuine-0%-untouched, null-score rescore, valid-score untouched, mixed new+rescore batch, the 10-item cap (oldest-first), non-fatal update failure, 0→null normalization on repeated failure, and no duplicate `job_found` for rescored rows.
- Full suite: 120/120 passing. `npm run lint` and `npm run build` both clean.

## Not in scope

- Redesigning `TARGET_NEW`/new-job batch sizing — `RESCORE_CAP` is a separate, independently-named constant that happens to share the value 10 today.
- A user-triggered rescore UI/workflow — the brief's largest remediation option; automatic rescore-on-rediscovery was sufficient and reuses the existing manual search action.
- Any UI changes — every consumer already handled `match_score: null` correctly before this fix.
