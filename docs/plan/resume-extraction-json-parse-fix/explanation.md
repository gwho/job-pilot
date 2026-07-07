# Explanation — Feature resume-extraction-json-parse-fix: Resume Extraction JSON and Truncation Recovery

## Why validate with zod instead of `as ProfileExtraction`?

`JSON.parse(raw) as ProfileExtraction` only changes TypeScript's view of the value. It does not prove the model returned arrays for `skills`, a number for `years_experience`, or valid enum values. The zod schema is now the runtime contract and the exported `ProfileExtraction` type is inferred from it, so the compile-time type and runtime validation cannot drift.

The rejected alternative was keeping the cast and only wrapping `JSON.parse` in try/catch. That would have fixed prose responses, but valid JSON with the wrong shape would still flow into `ProfileForm` as if it were trustworthy.

## Why retry on `finish_reason === "length"`?

The first fix correctly stopped the 500, but the real resume still failed because Nemotron hit the token limit and returned `finish_reason: "length"`. That is not the same as invalid input or an image-only PDF. It is a recoverable output-size failure.

The retry uses compact instructions and a larger budget instead of blindly retrying the same request. Repeating the same prompt would likely produce the same oversized response and waste another model call.

## Why bound the output in the prompt?

The profile shape includes open-ended arrays and a free-form `responsibilities` string. Without caps, the model can produce long role descriptions for every job on the resume. The prompt now limits work experience count, responsibilities length, skills, industries, and target roles.

This makes the JSON more likely to fit within the token budget while preserving the profile form's purpose: auto-fill useful fields for user review, not reproduce the entire resume.

## Why not change the API route or profile UI?

`app/api/profile/extract/route.ts` already returns the agent result as JSON, and `ProfileForm` already displays `{ success: false, error }`. The broken behavior was inside the agent function: it either threw on parsing or returned a truncation error after the first corrective pass.

Changing the route or UI would have treated symptoms. Keeping the fix in `agent/extractor.ts` preserves the project boundary where API routes orchestrate and `agent/` owns AI behavior.

## Why avoid raw response logging?

The model response is derived from the uploaded resume. Logging even a small prefix can expose names, phone numbers, employers, or other personal data. The extractor logs metadata only: content length, whether it looked like a JSON object, issue counts, and validation paths.

This still gives enough debugging signal without putting resume content in server logs.

## Why use non-streaming OpenAI types?

The OpenAI SDK's `chat.completions.create()` has streaming and non-streaming overloads. TypeScript initially inferred a union that included streams, where `.choices` is not available. The extractor now uses `ChatCompletionCreateParamsNonStreaming`, `stream: false`, and `ChatCompletion` so the code reflects the runtime behavior.
