# Plan — Feature resume-extraction-json-parse-fix: Resume Extraction JSON and Truncation Recovery

## What was built

- `agent/extractor.ts` — Added zod runtime validation, safe JSON parsing, PII-safe error logging, full agent-level try/catch, bounded extraction output instructions, non-streaming typed OpenAI requests, and one compact retry when Nemotron returns `finish_reason === "length"`.
- `__tests__/agent/extractor.test.ts` — Added mocked extractor regression coverage for short PDF text, prose AI output, wrong-shape JSON, truncation retry, repeated truncation, empty content, underlying PDF/network errors, and valid extraction success.
- `context/library-docs.md` — Updated Nemotron structured-output guidance to avoid raw `JSON.parse`, document profile extraction token budgets, require PII-safe logging, and document truncation retry behavior.
- `context/progress-tracker.md` — Added the resume extraction truncation recovery decision.
- `context/ui-registry.md` — Added a backend-only no-UI-change note.

## Schema changes

None.

## Key invariants

- `extractProfileFromResume()` must never throw to its API route caller; all failures return `{ success: false, error }`.
- Resume extraction must never log raw resume text or raw model content because both can contain PII.
- `response_format: { type: "json_object" }` is not enough; parsed model output must be runtime-validated before use.
- A first truncated model response is recoverable exactly once with compact instructions; repeated truncation returns the user-facing extraction error.
- The profile extraction route and `ProfileForm` remain orchestration/UI plumbing; AI parsing behavior lives in `agent/extractor.ts`.
