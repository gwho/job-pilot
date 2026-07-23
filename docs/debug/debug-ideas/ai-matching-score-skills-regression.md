# Debug Brief — AI Matching, Match Score, and Skill Comparison Regression

Last updated: 2026-07-23

## Reported symptom

The job details page for a recently saved job shows:

- `0% Match Score`
- `Not scored — matching unavailable for this job.`
- `No skill data available.`

The affected UI areas are:

- Match Score badge
- AI Match Reasoning
- Required Skills vs Your Profile
- Matched skills
- Missing/gap skills

This is a separate defect from company-research synthesis recovery.

## What the screenshot proves

The UI is rendering values that already exist on the saved `jobs` row:

```ts
match_score: 0
match_reason: "Not scored — matching unavailable for this job."
matched_skills: []
missing_skills: []
```

That exact reason comes from `FALLBACK_SCORE` in `agent/job-matcher.ts`. The current UI is therefore displaying the matcher’s persisted fallback; this is not initially a CSS or component-rendering problem.

What has **not** been diagnosed yet is why the matcher entered its fallback path. Do not declare a root cause until a deterministic red feedback loop captures it.

## Current pipeline and failure propagation

```text
JobsDB actor results
  → agent/jobsdb.ts converts jobs to ScoringInput[]
  → scoreJobs() sends one batch request to Nemotron
  → scoreJobs() parses and index-aligns the response
  → any request/parse failure returns FALLBACK_SCORE for every job
  → missing/malformed entries also receive FALLBACK_SCORE
  → app/api/agent/find/route.ts persists the fallback as a real score
  → job details page faithfully renders 0%, fallback reason, and empty skills
```

There is a second persistence problem:

```text
Transient scoring failure
  → fallback row saved with match_score = 0
  → later search discovers the same source_url
  → deduplication treats it as an existing job
  → only newJobs are passed to scoreJobs()
  → the existing fallback row is never rescored
```

This means a temporary model or parsing failure can become permanent for that saved job.

## Integrity mismatch to resolve

`CONTEXT.md` defines an **unscored job** as a job whose match score is unknown because matching did not produce a real score. It explicitly says an unscored job:

- is not a low match;
- is not a bad match;
- is not a zero-score job; and
- should only appear in complete views such as All Matches.

Persisting matcher failure as `match_score = 0` violates that domain definition. A legitimate model-produced 0% score and “scoring failed” are different states.

Even before the underlying matcher failure is fixed, the terminal failure representation must stop treating “unknown” as a real 0%.

## Immediate project sequencing

The company-research synthesis recovery is still uncommitted on the current branch. Do not mix matching changes into it.

Complete and commit the current recovery work first. Then create a new stacked branch:

```bash
git checkout -b fix/job-matching-reliability
```

The new PR should target `fix/company-research-synthesis-recovery`, following the repository’s stacked-PR workflow.

## GitHub issue to create

Suggested title:

> Fix AI job matching failures being persisted as permanent 0% scores

Suggested issue body:

```markdown
## Problem

Some saved jobs show:

- 0% Match Score
- “Not scored — matching unavailable for this job.”
- no matched or missing skills

That reason is the `FALLBACK_SCORE` sentinel from `agent/job-matcher.ts`.
Matcher request, JSON parsing, response-shape, and batch-alignment failures are
currently collapsed into the same fallback and persisted as a real 0% score.

Because `/api/agent/find` only scores new jobs, deduplicated existing fallback
rows are never rescored. A transient matching failure can therefore become
permanent.

## Expected behavior

- Valid Nemotron output produces a real score, reason, matched skills, and
  missing skills for every job.
- Invalid/truncated/non-JSON/wrong-shape output is handled through a bounded,
  tested recovery policy.
- A failed score is represented as unscored, never as a legitimate 0%.
- Unscored jobs are not included in low-match filtering, averages, or score
  distributions.
- Existing rows affected by the fallback have a defined rescore/remediation
  path.
- Raw profile, job-description, and model-response content is never logged.
- Regression tests reach the real matcher and persistence boundaries.
```

## Skill order

### 1. Invoke `/diagnosing-bugs`

Start with:

```text
/diagnosing-bugs Diagnose the AI matching regression documented in
docs/debug/debug-ideas/ai-matching-score-skills-regression.md. First build and
run a deterministic red feedback loop that reaches the real scoreJobs() and
jobs persistence path. Do not assume the model, profile, UI, or database is the
root cause before that loop exists.
```

The first required deliverable is one red-capable command:

```bash
npm run test:run -- __tests__/find-jobs/matching-reliability.test.ts
```

The test file does not exist yet. Build it using the existing Find Jobs route-test patterns, but do **not** mock `scoreJobs()`. Mock the OpenAI completion boundary, JobsDB actor boundary, InsForge client, and analytics boundary instead. The test must prove what value reaches `jobs.insert()`.

The loop is complete only when it:

- reaches the production `scoreJobs()` implementation;
- reproduces the fallback sentinel;
- asserts that failure is not persisted as a real 0%;
- runs deterministically in seconds; and
- is runnable without a human or live third-party call.

### 2. Invoke `/tdd`

After the reproduction is red, minimised, and the hypotheses are ranked:

```text
/tdd Implement the verified AI matching reliability fix using the red tests
from the diagnosis. Preserve batch ordering, use a bounded recovery policy, and
represent terminal failure as unscored rather than 0%.
```

Write regression coverage before each behavior change.

### 3. Invoke `/project-review`

Before demo or PR handoff:

```text
/project-review Review the AI matching reliability fix against the GitHub
issue, CONTEXT.md’s unscored-job definition, the route persistence contract,
filter/dashboard consumers, project architecture, and all regression tests.
```

The review must inspect all downstream consumers of `match_score`:

- `components/job-details/JobInfo.tsx`
- `components/job-details/MatchScore.tsx`
- `components/find-jobs/JobsTable.tsx`
- `components/find-jobs/FindJobsClient.tsx`
- `app/dashboard/page.tsx`
- PostHog `job_found` properties

### 4. Invoke `/remember save`

After the fix, verification, documentation, commit, and PR:

```text
/remember save
```

Save the issue number, verified root cause, recovery policy, remediation choice for existing jobs, tests added, branch/PR, and next project priority.

### Conditional skills

- If the same matching failure remains after one corrective implementation prompt, stop immediately and invoke `/recover`.
- Invoke `/architect` before implementation if the solution expands into a user-triggered rescore workflow, a new matching-status column, or a shared structured-output framework.
- Invoke `/imprint` only if a UI component changes. Backend-only matcher recovery plus existing null-score rendering does not require it.

## Phase 1 — Build the feedback loop

### Correct test seam

The route tests currently mock `scoreJobs()`, which means they cannot catch this defect. A new test should drive:

```text
POST /api/agent/find
  → real scoreJobs()
  → mocked OpenAI response
  → route record construction
  → mocked jobs.insert(records)
```

The first test should make OpenAI return a response that causes the production fallback path, then assert on the record passed to `jobs.insert()`.

Add focused `agent/job-matcher.test.ts` tests after the route-level loop exists. Unit tests alone are insufficient because they do not prove whether unknown scores are persisted as `0` or `null`.

### Required initial cases

1. Valid, aligned batch response:
   - every job receives a real integer score;
   - reason and both skill arrays are preserved;
   - no retry occurs.

2. Truncated JSON:
   - first completion is invalid with `finish_reason: "length"`;
   - the feedback loop must expose current fallback behavior;
   - the eventual implementation may retry once, if diagnosis confirms that policy.

3. Prose/non-JSON:
   - response ignores the JSON contract;
   - parse failure is caught without leaking raw content.

4. Wrong shape:
   - `scores` is missing or not an array;
   - score entries have invalid field types.

5. Length mismatch:
   - fewer scores than input jobs;
   - more scores than input jobs;
   - alignment remains deterministic.

6. Request/provider failure:
   - OpenAI-compatible call rejects;
   - search does not misrepresent failure as a legitimate 0%.

7. Exhausted recovery:
   - no infinite retry;
   - no partial/misaligned score persisted;
   - affected jobs use the canonical unscored representation.

8. Existing affected row:
   - a discovered `source_url` already exists with the exact fallback sentinel;
   - test the chosen rescore/remediation behavior.

## Phase 2 — Reproduce and minimise

Run the single test command until it deterministically shows the same data observed in the screenshot:

```ts
{
  match_score: 0,
  match_reason: "Not scored — matching unavailable for this job.",
  matched_skills: [],
  missing_skills: [],
}
```

Then minimise the setup while keeping the full matcher-to-insert path.

Do not use a live JobsDB search as the primary feedback loop. Live actor and model calls are slow and non-deterministic. Use one authenticated live run after deterministic tests pass.

## Phase 3 — Rank hypotheses

Only after the red loop exists, produce 3–5 ranked, falsifiable hypotheses. Candidate hypotheses to test include:

1. **Model response is truncated.**
   - Prediction: `finish_reason` is `length`, content lacks a complete closing structure, and a compact/higher-budget retry succeeds.

2. **Provider returns prose, empty content, or rejects the request.**
   - Prediction: the fallback correlates with parse failure, missing choice content, rate-limit metadata, or a request error.

3. **Batch output is too large or complex.**
   - Prediction: failure rate rises with job count/description length and disappears with bounded input or smaller batches.

4. **Response JSON parses but violates the expected shape or count.**
   - Prediction: parse succeeds while runtime validation or `scores.length === jobs.length` fails.

5. **Profile retrieval or profile shape is degraded.**
   - Prediction: the route receives `profile = null` or sparse fields, but this alone should still produce a model score under the documented best-effort contract. If null profile deterministically triggers fallback, the model/prompt boundary remains implicated.

Show the ranked list before testing probes. Change one variable at a time.

## Phase 4 — Safe instrumentation

Temporary diagnostics may record:

- attempt number;
- input job count;
- bounded description character count;
- whether a profile row was present;
- profile completeness flag, without field values;
- response `finish_reason`;
- response character length;
- whether content begins with `{` and ends with `}`;
- JSON parse success/failure;
- Zod validation issue count and paths;
- returned score count;
- input/score count alignment;
- provider error category/status, without headers or response bodies.

Use a unique prefix such as:

```text
[DEBUG-job-matcher]
```

Do not log:

- raw model output;
- the prompt;
- profile skills, work history, contact information, or resume content;
- full job descriptions;
- credentials, request headers, cookies, or environment values.

Remove every `[DEBUG-job-matcher]` log before completion.

## Phase 5 — Fix constraints

Implement only what the verified diagnosis supports. Any repair must preserve these constraints:

- Keep `response_format: { type: "json_object" }`.
- Use a typed, non-streaming completion request.
- Inspect `finish_reason` before parsing.
- Parse inside a safe boundary.
- Validate the full response and every score with Zod.
- Preserve one-to-one job/score alignment.
- Bound any retry; never loop until the model succeeds.
- Do not install another JSON-repair dependency.
- Do not use regex to turn partial JSON into persisted scores.
- Do not fail the JobsDB discovery result solely because scoring is unavailable.
- Do not persist unknown scoring as a real `0`.
- Do not overwrite an existing valid score during remediation.

The company-research recovery implementation is a useful local precedent, but do not copy its deterministic dossier fallback into matching. A deterministic job match score cannot be honestly fabricated when the scorer failed.

## Required domain behavior

The terminal matcher outcome should distinguish:

```ts
type ScoringOutcome =
  | {
      status: "scored";
      matchScore: number;
      matchReason: string;
      matchedSkills: string[];
      missingSkills: string[];
    }
  | {
      status: "unscored";
      reason: string;
    };
```

This exact type is illustrative, not mandatory. The required semantic is:

- model-produced `0` is a valid score;
- matcher failure is unknown/unscored;
- the database stores unknown as `match_score: null`;
- filters and analytics exclude unknown;
- the UI does not show an unknown score as `0%`.

Use the existing human-readable sentinel if useful, but do not use `match_score = 0` as the status flag.

## Existing-row recovery decision

Fixing future scoring does not repair rows already persisted with the fallback sentinel.

Identify affected rows by the exact combination:

```text
match_score = 0
match_reason = "Not scored — matching unavailable for this job."
matched_skills is empty
missing_skills is empty
```

Do not identify affected rows by `match_score = 0` alone; a real 0% model score is possible.

Choose and test one remediation path:

1. **Automatic rescore on rediscovery**
   - When a JobsDB result matches an existing affected row, include it in the scoring batch and update that row after a successful score.
   - Do not insert a duplicate.
   - Do not overwrite valid existing scores.

2. **One-time scoped remediation**
   - After the reliability fix is deployed, rescore only rows carrying the exact sentinel.
   - Scope every query/update to `user_id`.
   - Preserve rows if rescoring fails.

3. **User-triggered rescore**
   - Adds a new product workflow and UI; invoke `/architect` first.
   - This is the largest option and should not be chosen unless automatic recovery is unsuitable.

Recommended starting option: **automatic rescore on rediscovery**, because it fits the existing manual search workflow and avoids adding a new UI.

Before editing InsForge integration code, fetch the latest InsForge TypeScript database documentation as required by `AGENTS.md`, then follow `context/library-docs.md`.

## Phase 6 — Verification

Run focused tests:

```bash
npm run test:run -- __tests__/find-jobs/matching-reliability.test.ts
npm run test:run -- __tests__/agent/job-matcher.test.ts
```

Then run the project checks:

```bash
npm run test:run
npm run lint
npm run build
```

Perform one authenticated browser verification:

1. Complete enough profile fields to provide meaningful matching inputs.
2. Run a search that returns at least one new JobsDB job.
3. Open a newly saved job.
4. Confirm a real score, specific reason, and matched/missing skills render.
5. Confirm no `FALLBACK_SCORE` sentinel was stored.
6. Simulate or locate an affected existing row and confirm the chosen remediation path.
7. Confirm an unscored row, if recovery is exhausted, does not display `0%`.
8. Confirm dashboard averages/distributions and High/Low filters exclude unscored rows.
9. Confirm no raw model/profile/job content appears in logs.

## Documentation after the fix

Update:

- `context/progress-tracker.md`
- `context/library-docs.md`
- `context/ui-registry.md` if UI behavior changes, otherwise add a backend-only note
- `CONTEXT.md` only if the unscored-job definition changes
- `docs/plan/job-matching-reliability/plan.md`
- `docs/plan/job-matching-reliability/explanation.md`
- `docs/plan/job-matching-reliability/ai-discussion-topics.md`

The PR description must state:

- the verified root cause;
- why failure was previously persisted as 0%;
- the bounded recovery policy;
- how unscored is represented;
- how existing affected rows recover; and
- the exact regression commands used.
