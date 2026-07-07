# Resolution — Resume Extraction Truncation Fix

The fix stayed at the extractor seam:

- `agent/extractor.ts` now asks for bounded JSON output up front.
- It sends a bounded slice of resume text to the model.
- It uses `ChatCompletionCreateParamsNonStreaming` and `ChatCompletion` so `.choices` is typed correctly.
- It retries once with compact instructions after a truncated response.
- It still returns the same safe user-facing error after repeated truncation, empty content, invalid JSON, wrong-shape JSON, or underlying PDF/network failures.

Verification:

- `npx tsc --noEmit` passed.
- `npm run lint` passed.
- `npm run test:run -- __tests__/agent/extractor.test.ts` could not start because of the local Node/Vitest/Rolldown `node:util.styleText` mismatch.
