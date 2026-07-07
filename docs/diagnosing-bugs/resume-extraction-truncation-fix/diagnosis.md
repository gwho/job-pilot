# Diagnosis — Resume Extraction Truncation Fix

## Feedback Loop

The intended tight loop is:

```bash
npm run test:run -- __tests__/agent/extractor.test.ts
```

The loop targets `extractProfileFromResume()` with mocked `pdf-parse` and mocked OpenAI responses. It includes a regression case where the first model response has `finish_reason: "length"` and the second response returns valid extraction JSON.

In this local shell, Vitest could not start because Node `v21.6.0` does not expose `node:util.styleText`, which Rolldown imports during Vitest startup. TypeScript and ESLint verification were used successfully while preserving the regression test in the repo.

## Root Cause

The extractor returned a controlled failure immediately when Nemotron reported truncation. For real resumes, that meant the user still saw "Could not extract structured profile data..." even though the failure was recoverable with a smaller JSON request.

## Correct Hypothesis

If truncation is the cause, then changing the extractor to retry once with compact output instructions should turn a first `finish_reason: "length"` into a successful extraction when the retry returns valid JSON.
