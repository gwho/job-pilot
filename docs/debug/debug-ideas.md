# Debug Brief — Company Research Synthesis Returns Invalid JSON

Last updated: 2026-07-23

## Priority decision

Choose **“something else”** as the next project direction:

1. Create a GitHub issue for this defect.
2. Fix it before starting a new product phase.
3. Keep the fix in the existing stacked-PR workflow.
4. Return to the PR-stack merge decision after the defect is verified.

Do not start a new feature first. The defect blocks an existing core workflow: a user can complete the expensive browser-research step and still receive no dossier.

The current branch is `fix/find-jobs-pipeline-reliability`, with PR #36 based on `feature/analytics-charts-real-data`. Create the company-research fix branch from the current reliability branch so the next PR remains stacked:

```bash
git checkout -b fix/company-research-synthesis-recovery
```

Open its PR against `fix/find-jobs-pipeline-reliability`, not `main`.

## GitHub issue to create first

Suggested title:

> Fix malformed and truncated Nemotron JSON in company research synthesis

Suggested issue body:

```markdown
## Problem

Company research intermittently fails after the browser-research step because
`synthesizeDossier()` calls `JSON.parse()` directly on Nemotron output. Real runs
have returned both truncated JSON and prose instead of JSON.

## Evidence

- `Unterminated string in JSON` at positions 3679 and 4001
- `Unexpected token 'T', "The user w"... is not valid JSON`
- Failure site: `agent/research.ts`, inside `synthesizeDossier()`
- API result: `POST /api/agent/research` returns 500 after roughly 70–83 seconds
- UI result: “Failed to research company”

## Expected behavior

- Valid model output produces and saves a dossier normally.
- A truncated or malformed first response gets one bounded synthesis-only retry.
- The retry reuses the already-collected browser research; it must not repeat the
  Hyperbrowser/Stagehand work.
- Parsed JSON is validated at runtime before it is saved.
- Exhausted recovery returns a controlled, generic error and logs safe diagnostic
  metadata without logging candidate/profile content.
- Regression tests cover valid JSON, truncation, prose, invalid shape, and an
  exhausted retry.
```

## Observed failure

Three consecutive company-research attempts failed at the same call site:

```text
[api/agent/research] SyntaxError: Unterminated string in JSON
    at JSON.parse
    at synthesizeDossier (agent/research.ts:266:20)
```

and:

```text
[api/agent/research] SyntaxError: Unexpected token 'T',
"The user w"... is not valid JSON
    at JSON.parse
    at synthesizeDossier (agent/research.ts:266:20)
```

These errors show two distinct output classes:

- JSON that ends before the object is complete.
- Natural-language prose where a JSON object was required.

The UI’s generic error banner is behaving according to the project’s security rules. The immediate defect is in the synthesis boundary, not the banner.

## Current code observations

These are observations, not a confirmed root-cause conclusion:

- `agent/research.ts` requests `response_format: { type: "json_object" }`.
- The request uses `max_tokens: 2000`.
- The response’s `finish_reason` is not inspected.
- `rawContent` is passed directly to `JSON.parse()`.
- The parsed object is cast to `Record<string, unknown>` instead of validated with a runtime schema.
- A malformed response throws out of `synthesizeDossier()` and becomes a route-level 500.
- The existing route tests mock `researchCompany()`, so they cannot detect this failure.
- `agent/extractor.ts` already contains a useful precedent: typed non-streaming requests, `finish_reason === "length"` detection, bounded output, one compact retry, safe parsing, and Zod validation.

Do not copy the extractor implementation blindly. Company-research output has a different shape and must preserve its own grounding and completeness requirements.

## Skill order

### 1. Invoke `/diagnosing-bugs`

Use this first:

```text
/diagnosing-bugs Diagnose the company-research synthesis failure documented in
docs/debug/debug-ideas.md. Build and run a fast deterministic red regression loop
that reaches the real synthesis boundary before forming or testing hypotheses.
```

The first required deliverable is one red-capable command. A suitable target is:

```bash
npm run test:run -- __tests__/agent/research-synthesis.test.ts
```

The test file does not exist yet. Build it at a seam that exercises the actual OpenAI completion handling used by company research.

Prefer testing through the public `researchCompany()` boundary with external systems mocked. If that becomes unreasonably broad, extract a narrowly named synthesis/completion module and test that real module. Do not add a shallow helper test that bypasses the production parsing and retry path.

The existing `__tests__/api/agent/research.test.ts` is not sufficient because it mocks `researchCompany()` entirely.

### 2. Invoke `/tdd`

After the minimal reproduction is red and the hypotheses have been ranked:

```text
/tdd Implement the verified company-research synthesis recovery using the red
regression tests from the diagnosis. Keep retry bounded and synthesis-only.
```

The red-green sequence should cover:

1. Valid JSON succeeds without retry.
2. `finish_reason === "length"` followed by valid JSON succeeds after one retry.
3. Prose/non-JSON followed by valid JSON succeeds after one retry.
4. JSON with the wrong dossier shape is rejected safely.
5. Two invalid responses produce the chosen controlled terminal behavior.
6. Browser research is performed at most once per user action.
7. No invalid or partial dossier is written to InsForge.

### 3. Invoke `/project-review`

Before demo or PR handoff:

```text
/project-review Review the company-research synthesis recovery against the issue,
the regression tests, project architecture, error-handling rules, and the
“company research always returns a dossier” invariant.
```

The review must explicitly resolve whether the terminal behavior after an exhausted retry is:

- a deterministic minimal dossier built from trusted job/profile inputs, preserving the invariant; or
- a controlled failure, with the invariant intentionally revised and documented.

Do not leave this ambiguous.

### 4. Invoke `/remember save`

After verification and documentation:

```text
/remember save
```

Record the issue number, branch/PR, verified root cause, chosen terminal behavior, tests added, and the next project priority.

### Conditional skills

- If one corrective implementation still produces the same failure, stop and invoke `/recover` immediately, as required by `AGENTS.md`.
- Invoke `/imprint` only if the fix changes or adds a UI component. A backend-only recovery that keeps the current generic error banner does not require it.
- `/architect` is not required for the initial diagnosis. Invoke it only if the verified fix expands into a broader shared structured-output module or changes the company-research contract.

## Required debugging sequence

### Phase 1 — Build the red feedback loop

Mock only external boundaries:

- OpenAI/OpenRouter completion call.
- InsForge queries and update.
- Hyperbrowser and Stagehand, if the chosen public seam reaches them.
- Time, where `researchedAt` needs a stable assertion.

Use synthetic fixtures. Do not put real profile, resume, job, or model-response content into tests.

The first red case should return a truncated first completion:

```ts
{
  choices: [
    {
      message: {
        content: "{\"companyOverview\":\"Example\",\"techStack\":[\"TypeScript\"",
      },
      finish_reason: "length",
    },
  ],
}
```

The second mocked completion should be a valid dossier. The test should assert that recovery succeeds and the completion API is called exactly twice.

Add a separate prose case with `finish_reason: "stop"` because one real failure was not truncation.

### Phase 2 — Reproduce and minimise

Run the single test command until it deterministically catches the exact failure. Minimise the fixture so every remaining dependency is needed.

Do not use a live 70–83 second browser run as the primary feedback loop. Use one live run only after the deterministic tests pass.

### Phase 3 — Rank hypotheses

Only after the red loop exists, rank 3–5 falsifiable hypotheses. Likely candidates to test include:

1. The response hits the output-token limit and reports `finish_reason: "length"`.
2. The provider intermittently ignores or cannot guarantee `json_object` output.
3. The requested dossier is too verbose for the current output budget.
4. Valid JSON is returned but does not match the expected dossier shape.
5. The provider terminates a response for a reason other than token length.

For each hypothesis, state what observable metadata would confirm or falsify it.

### Phase 4 — Add safe instrumentation

Capture metadata only:

- `finish_reason`
- response character length
- whether trimmed content starts with `{`
- whether trimmed content ends with `}`
- parse success/failure
- Zod validation issue paths/count
- attempt number

Use a unique temporary prefix such as `[DEBUG-research-json]` and remove it before completion.

Do not log:

- raw model output
- the user prompt
- candidate profile or work history
- job description content
- credentials, headers, or environment variables

### Phase 5 — Implement only the verified repair

The likely recovery design should be evaluated through the tests, not assumed:

- Define a Zod schema for the complete dossier response.
- Use a typed, non-streaming OpenAI request.
- Inspect `finish_reason` before parsing.
- Parse inside a safe boundary.
- Validate the parsed value before constructing the persisted dossier.
- Retry at most once with compact instructions.
- Reuse the same collected `ExtractedContent`, `Job`, and `Profile`.
- Never reopen Hyperbrowser or rerun Stagehand during synthesis retry.
- Merge trusted `visitedUrls` into sources after validation.
- Persist only a fully validated final dossier.

Avoid regex-based JSON “repair” as the primary solution. It can turn incomplete model output into plausible but semantically corrupted data.

### Phase 6 — Verify and clean up

Run:

```bash
npm run test:run -- __tests__/agent/research-synthesis.test.ts
npm run test:run
npm run lint
npm run build
```

Then perform one authenticated browser verification:

1. Open a saved job.
2. Click **Research Company**.
3. Confirm a dossier renders.
4. Confirm the job’s `company_research` value is saved.
5. Confirm `company_researched` fires only after successful persistence.
6. Confirm no raw AI/profile content appears in server logs.

Remove all `[DEBUG-research-json]` instrumentation and temporary harnesses before committing.

## Project documentation required after the fix

Because this is a completed reliability feature, update:

- `context/progress-tracker.md`
- `context/ui-registry.md` with a backend-only non-UI note, if no UI changed
- `context/library-docs.md` with the company-research completion/retry policy
- `docs/plan/company-research-synthesis-recovery/plan.md`
- `docs/plan/company-research-synthesis-recovery/explanation.md`
- `docs/plan/company-research-synthesis-recovery/ai-discussion-topics.md`

The final PR description should state the verified root cause, not merely “added retry logic.”
