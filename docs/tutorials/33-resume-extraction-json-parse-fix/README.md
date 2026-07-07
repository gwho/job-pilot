# Tutorial 33 — Resume Extraction JSON and Truncation Recovery: Making AI Output Fail Safely

**After completing this tutorial you will understand:** why JSON mode still needs runtime validation, how `finish_reason: "length"` differs from malformed JSON, why resume extraction logs must avoid PII, and how to test AI edge cases without calling the real model.

> [!NOTE]
> **Prerequisites:** Tutorial 10 (`../10-profile-extraction/README.md`) explains the original PDF extraction flow. Tutorial 16 (`../16-ai-model-smoke-test/README.md`) explains JSON-mode smoke tests. Open [`agent/extractor.ts`](../../../agent/extractor.ts) and [`__tests__/agent/extractor.test.ts`](../../../__tests__/agent/extractor.test.ts) alongside this tutorial.

## CS & language concepts in this tutorial

| Concept | Where it appears | Category |
|---------|-----------------|----------|
| Runtime validation vs. type assertion | `ProfileExtractionSchema.safeParse` replacing `JSON.parse(raw) as ProfileExtraction` | Type theory |
| Discriminated union for parser outcomes | `CompletionParseResult` with `parsed`, `failed`, and `truncated` states | Type theory |
| Bounded retry | One compact retry after `finish_reason === "length"` | Reliability |
| Output-size control | Prompt caps for roles, skills, industries, and responsibilities | AI systems |
| PII-safe observability | Metadata-only logs for malformed model output | Security |
| Non-streaming overload selection | `ChatCompletionCreateParamsNonStreaming` and `stream: false` | TypeScript/API design |
| Mocked failure injection | OpenAI and `pdf-parse` mocks in `extractor.test.ts` | Testing |

## How to use an LLM before this tutorial

### Concept 1 — JSON Mode Is Not A Schema

> "Explain the difference between valid JSON and schema-valid JSON in an OpenAI-compatible chat completion. Give an example where JSON.parse succeeds but the application should still reject the value. Quiz me at the end."

*What to listen for:* JSON mode can make the output parseable, but it does not prove field names, enum values, arrays, numbers, or nullability match your application contract.

*Practice question:* Why can `JSON.parse(raw) as ProfileExtraction` still produce unsafe runtime data?

### Concept 2 — Token Truncation

> "Explain what `finish_reason: 'length'` means in a chat completion. How is it different from a model returning prose instead of JSON? Give a debugging example and quiz me."

*What to listen for:* Truncation means the model was cut off by the output budget. It can happen even when the model is following instructions.

*Practice question:* Why should truncation not be treated the same as a scanned PDF with no text layer?

### Concept 3 — PII-Safe Logs

> "Teach me how to debug malformed AI responses that may contain personal data. What metadata can I log safely, and what should never be logged? Quiz me."

*What to listen for:* Good logs identify the failure class without storing user content.

*Practice question:* Why is logging `raw.slice(0, 200)` unsafe for resume extraction?

### Concept 4 — Mocked AI Tests

> "Show me how to test an AI integration by mocking the model response instead of calling the live API. Include one example for malformed JSON and one for truncation. Quiz me."

*What to listen for:* The regression test should force the exact edge case deterministically.

*Practice question:* What does a mocked truncation test prove that a live model smoke test cannot prove reliably?

## Architecture Overview

```text
┌─────────────────────┐
│ ProfileForm button  │
└──────────┬──────────┘
           ▼
┌──────────────────────────────┐
│ POST /api/profile/extract    │
│ auth + storage download only │
└──────────┬───────────────────┘
           ▼
┌──────────────────────────────┐
│ agent/extractor.ts           │
│ PDF text → Nemotron → zod    │
│ safe parse + truncation retry│
└──────────┬───────────────────┘
           ▼
┌──────────────────────────────┐
│ { success, data | error }    │
└──────────────────────────────┘
```

Key invariants:

- The route orchestrates; extraction behavior lives in `agent/extractor.ts`.
- Agent failures return `{ success: false, error }`, not thrown exceptions.
- Raw resume/model content must not be logged.

## Part 1 — Runtime Validation Replaces Trust

Open [`agent/extractor.ts`](../../../agent/extractor.ts):

```ts
const ProfileExtractionSchema = z.object({
  full_name: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  current_title: z.string().nullable().optional(),
  experience_level: z.enum(["junior", "mid", "senior", "lead"]).nullable().optional(),
  years_experience: z.number().nullable().optional(),
  linkedin_url: z.string().nullable().optional(),
  portfolio_url: z.string().nullable().optional(),
  work_authorization: z
    .enum(["citizen", "permanent_resident", "visa_required"])
    .nullable()
    .optional(),
  remote_preference: z.enum(["remote", "onsite", "hybrid", "any"]).nullable().optional(),
  salary_expectation: z.string().nullable().optional(),
  skills: z.array(z.string()).optional(),
  industries: z.array(z.string()).optional(),
  job_titles_seeking: z.array(z.string()).optional(),
  work_experience: z.array(WorkExperienceEntrySchema).optional(),
  education: EducationSchema.optional(),
});

export type ProfileExtraction = z.infer<typeof ProfileExtractionSchema>;
```

The type now comes from the schema instead of sitting beside it. That matters because the model is an untyped boundary: TypeScript cannot inspect JSON returned over HTTP.

**Checkpoint:** What would happen if the model returned `{"skills":"TypeScript, React"}` and the code only used `as ProfileExtraction`?

<details>
<summary>Reveal answer</summary>

`JSON.parse` would succeed, and the cast would tell TypeScript to trust the value. At runtime, `skills` would still be a string, not an array. The zod schema rejects that before the UI treats it as extracted profile data.
</details>

**Try it yourself:** Search for `ProfileExtractionSchema.safeParse` in `agent/extractor.ts` and trace where its failure result becomes the user-facing extraction error.

## Part 2 — Truncation Is Recoverable Once

Open [`agent/extractor.ts`](../../../agent/extractor.ts):

```ts
const INITIAL_MAX_TOKENS = 2500;
const RETRY_MAX_TOKENS = 3000;
const MAX_RESUME_TEXT_CHARS = 18000;
```

```ts
if (parsed.status === "parsed") {
  return { success: true, data: parsed.data };
}

if (parsed.status === "failed") {
  return { success: false, error: parsed.error };
}

const retryResponse = await requestProfileExtraction(
  openai,
  COMPACT_RETRY_SYSTEM_PROMPT,
  boundedText,
  RETRY_MAX_TOKENS,
);
const retryParsed = parseCompletion(retryResponse);
```

The first response can fail because the model ran out of output budget. The retry changes both the prompt and the budget. That is different from retrying a network request: the second attempt asks for a smaller artifact.

**Checkpoint:** Why is an unbounded retry loop wrong here?

<details>
<summary>Reveal answer</summary>

If the model keeps producing oversized JSON, repeated retries increase latency and cost without changing the failure class. One compact retry is enough to recover from common over-generation while preserving a deterministic endpoint.
</details>

**Try it yourself:** In `agent/extractor.ts`, find every numeric cap in `SYSTEM_PROMPT` and explain which part of the JSON each cap protects.

## Part 3 — Logs Without Resume Content

Open [`agent/extractor.ts`](../../../agent/extractor.ts):

```ts
console.error("[agent/extractor] Model returned non-JSON content", {
  contentLength: raw.length,
  startsWithJsonObject: raw.trimStart().startsWith("{"),
});
```

The log tells you whether the model returned something that looked like JSON and how large it was. It does not store the candidate's name, phone number, employers, or resume text.

**Checkpoint:** Why is `raw.slice(0, 200)` not acceptable here?

<details>
<summary>Reveal answer</summary>

The response is derived from a resume. The first 200 characters could contain the user's name, contact details, job history, or education. Metadata gives debugging signal without putting PII in logs.
</details>

**Try it yourself:** Search the repo for `raw.slice` and `message.content` in agent files. Identify any other AI parsing path that may need the same logging rule.

## Part 4 — The Regression Test

Open [`__tests__/agent/extractor.test.ts`](../../../__tests__/agent/extractor.test.ts):

```ts
it("retries once with compact instructions when the first response is truncated", async () => {
  mockCompletion('{"skills": ["Go", "Rust"', "length");
  mockCompletion(JSON.stringify(VALID_EXTRACTION));

  const result = await extractProfileFromResume(buffer);

  expect(result).toEqual({ success: true, data: VALID_EXTRACTION });
  expect(mocks.create).toHaveBeenCalledTimes(2);
  expect(mocks.create.mock.calls[0][0]).toMatchObject({ max_tokens: 2500 });
  expect(mocks.create.mock.calls[1][0]).toMatchObject({ max_tokens: 3000 });
  expect(mocks.create.mock.calls[1][0].messages[0].content).toContain(
    "The previous response was too long and was truncated",
  );
});
```

This test does not ask the real model to behave badly. It directly creates the failure shape from the production log and asserts the extractor recovers when the retry returns valid JSON.

**Checkpoint:** Why is this better than manually clicking "Extract from Resume" ten times?

<details>
<summary>Reveal answer</summary>

Manual testing depends on model behavior, network latency, auth state, storage state, and the uploaded PDF. The unit test isolates the extractor contract and deterministically recreates the truncation signal.
</details>

**Try it yourself:** Run `npm run test:run -- __tests__/agent/extractor.test.ts`. If Vitest fails at startup with `node:util.styleText`, switch to the project-supported Node version before using this test loop.

## Full data flow: clicking Extract from Resume after this fix

1. `ProfileForm` sends `POST /api/profile/extract`.
2. `app/api/profile/extract/route.ts` authenticates, reads `resume_pdf_key`, downloads the private PDF, and passes a `Buffer` to `extractProfileFromResume`.
3. `extractProfileFromResume` extracts PDF text with `PDFParse`.
4. Short or image-only PDFs return the existing "Could not extract text..." error without calling the model.
5. Valid text is bounded and sent to Nemotron with JSON-only, size-bounded instructions.
6. The response is checked for empty content, truncation, parseability, and schema validity.
7. If the first response was truncated, the extractor retries once with compact instructions.
8. The route returns `{ success: true, data }` or `{ success: false, error }`.
9. `ProfileForm` either applies extracted values or shows the existing human-readable error.

## Extend it (challenges)

**Challenge 1 — Trace** (15-20 min): Follow `EXTRACTION_FAILED_MESSAGE` from `agent/extractor.ts` to the rendered error in `ProfileForm`. Write down every function boundary.

<details>
<summary>Hint</summary>

Start in `extractProfileFromResume`, then open `app/api/profile/extract/route.ts`, then search `handleExtract` in `components/profile/ProfileForm.tsx`.
</details>

**Challenge 2 — Extend** (20-30 min): Add a new test case where the first response is non-JSON prose and confirm the extractor does not retry. Explain why retrying prose is less useful than retrying truncation.

<details>
<summary>Hint</summary>

The parser returns `status: "failed"` for non-JSON and `status: "truncated"` only for `finish_reason === "length"`.
</details>

**Challenge 3 — Design** (30-45 min): Inspect `agent/research.ts` and design a similar zod/safe-parse strategy for company research without implementing it. List what should differ from resume extraction.

<details>
<summary>Hint</summary>

Company research has a different product requirement: it should synthesize a complete dossier even when browser research is thin.
</details>

For deeper exploration, `docs/plan/resume-extraction-json-parse-fix/ai-discussion-topics.md` has 15 prompts covering structured output, truncation recovery, privacy-safe logging, architecture boundaries, and testing. Feed them to an LLM *after* forming your own answer first.
