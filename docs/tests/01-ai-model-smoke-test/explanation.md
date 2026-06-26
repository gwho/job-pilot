# Explanation — AI Model Smoke Testing

## 1. What is a smoke test and why it fits AI model changes

A smoke test is the minimal check that a system is basically operational — like switching on a machine to see if it starts before running it at full load. The name comes from electronics: you power on a new circuit board, and if smoke comes out, you stop immediately. No smoke — proceed.

For AI model changes specifically, a smoke test is the right first move because the failure surface is wide and the failures are quiet. If the API key is wrong, the model ID is wrong, the base URL changed, or JSON mode is unsupported — none of these produce a compile error. TypeScript cannot check that `process.env.OPENROUTER_API_KEY` is set. The model string `"nvidia/nemotron-3-ultra-550b-a55b:free"` is just a string — a typo compiles fine and only fails at runtime when the API returns a 404 or a model-not-found error. A smoke test makes these quiet failures loud and early.

The alternative — running the app and clicking through the UI — would require: navigating to the profile page, uploading a resume, waiting for extraction, checking that the form populated correctly. If extraction fails with a cryptic JSON parse error, you're now debugging in the full stack (Next.js → API route → agent function → OpenRouter → model → response parsing). The smoke test collapses that stack to a single script where each failure is isolated.

---

## 2. The four-test structure and what each layer checks

The four tests form a pyramid. Each test extends the previous one. If a lower test fails, higher tests will fail too — but they'll fail for the same reason, not a new one. Running them in order means you stop at the first failure and know exactly what layer broke.

**Test 1 — Connectivity**

This is the smallest possible API call. One message, no response format constraint, 20 tokens. The only thing that can go wrong is: wrong API key, wrong base URL, wrong model ID, or no network. If Test 1 fails, nothing else is worth checking. The detail line prints the exact response text so you can see the model is coherent.

**Test 2 — JSON mode**

This is the most important test for this project. Every agent function uses `response_format: { type: "json_object" }`. If the model via OpenRouter does not support this, all agent functions will fail at `JSON.parse(response.choices[0].message.content!)`. The test sends a trivially simple schema (`{ "status": string, "value": number }`) so the model's full attention goes to following the JSON constraint, not generating content.

Why a separate test for JSON mode rather than combining with Test 1? Because the failure mode is different. Test 1 failure = "cannot reach model." Test 2 failure = "model reachable but JSON mode broken." These need to be distinguishable. A combined test that fails would leave you guessing which of the two problems occurred.

**Tests 3 and 4 — Realistic prompts**

These mirror the actual system prompts from `agent/extractor.ts` and `agent/pdf-generator.tsx`. The same schema constraints, the same extraction instructions, the same output shape requirements. The difference from Tests 1–2: these test that the *specific model behaviour* satisfies *the project's specific contract* with the model.

A model might handle generic JSON mode fine but respond badly to a specific instruction style. For example: the extraction system prompt lists enum values (`"junior" | "mid" | "senior" | "lead"`). A model that ignores enum constraints would return `"Senior"` instead of `"senior"`, which would pass JSON parsing but fail the TypeScript type check downstream. The realistic prompt tests catch this class of failure.

---

## 3. Why max_tokens in tests must match production

The first run of Test 3 produced: `Unterminated string in JSON at position 36`. This is the exact error you get when `JSON.parse` receives a string that was cut off mid-character. The model started generating valid JSON, but the token limit was hit before the closing braces arrived. The output was not a model error — it was a test configuration error.

The fix — raising `max_tokens` from 200 to 800 — matched the production value in `agent/extractor.ts`. This reveals an important principle:

**Test configuration must mirror production configuration.** A smoke test that uses different settings than the real code is not testing the real code. It's testing a hypothetical. If the test uses `max_tokens: 200` but the agent uses `max_tokens: 800`, the test gives you confidence that doesn't transfer to production. Worse, it can give false negatives: a test fails at `200` tokens, you change the prompt to be shorter, and now you have a prompt that works in the test but diverges from the production prompt.

The specific values to keep in sync:
- `max_tokens` — must match the production value for that call
- `temperature` — must match (0.3 for extraction/matching, 0.7 for generation)
- `response_format` — always `json_object` for all agent calls in this project

---

## 4. How the test handles failure output

The test uses three console output helpers: `pass()`, `fail()`, and `dim()`. Each maps to a visual pattern: green `✓` for pass, red `✗` for fail, dimmed text for detail lines.

The fail path does two things: increments `failed`, and prints the error message. At the end, `process.exit(1)` is called if any test failed. This exit code matters: any CI system, shell script, or `&&` chain that runs this command will receive a non-zero exit code and know the tests failed. Without `process.exit(1)`, a failed test suite would silently return 0 and be treated as success.

The error handling distinguishes `SyntaxError` (a specific failure mode — JSON parsing failed) from generic errors. This is intentional: a `SyntaxError` in the JSON mode test has a specific meaning ("the model returned something that isn't JSON, which means json_object mode is not working"). A different error type has a different meaning ("the API call itself failed"). Treating them the same would produce the same error message for fundamentally different failures.

---

## 5. Why the client in the test is identical to the client in agent/

The test script initialises the `OpenAI` client with the same four values the agent files use:

```typescript
const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY!,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "https://job-pilot.app",
    "X-Title": "JobPilot",
  },
});
```

If the test used a different client (for example, omitting `defaultHeaders`), it would be testing a subtly different configuration than what the agents use. OpenRouter uses the headers for routing and attribution — if a particular header combination causes a routing issue, a test without those headers would not catch it.

The principle: **the test client must be constructed identically to the production client.** The only things that differ between test and production are the prompts and the synthetic input data — not the infrastructure configuration.

---

## 6. How to load .env.local in a script without a test runner

Next.js loads `.env.local` automatically for the app runtime (pages, API routes, Server Actions). It does not load it for standalone scripts. A script run with `npx tsx scripts/test-ai.ts` starts a fresh Node process with no knowledge of `.env.local`.

Two solutions were considered:

**Option A: `dotenv` package.** `import * as dotenv from "dotenv"` + `dotenv.config({ path: ".env.local" })`. Common pattern but requires `dotenv` as a dependency, which this project doesn't have.

**Option B: `--env-file` flag (Node 20+).** Node built-in. No extra dependency. Run: `npx tsx --env-file=.env.local scripts/test-ai.ts`. Node parses `.env.local` before the script starts, so `process.env.OPENROUTER_API_KEY` is available immediately.

Option B was chosen because it has zero dependencies and works with Node 24 (the version in this environment). The script documents the run command in a comment at the top so future developers know how to invoke it.

The key guard in the script:

```typescript
if (!process.env.OPENROUTER_API_KEY) {
  console.log("OPENROUTER_API_KEY not set in .env.local — aborting.");
  process.exit(1);
}
```

This check runs before any API call. Without it, the API call would fail with an authentication error from OpenRouter, which is a less clear message than "key not set."

---

## 7. What the tests do NOT cover — and why that's fine

The smoke test does not cover:
- InsForge authentication (the agent functions fetch the user's profile from the DB)
- PDF buffer generation (`renderToBuffer` in `pdf-generator.tsx`)
- The actual API routes (`/api/profile/extract`, `/api/resume/generate`)
- The UI interaction (clicking buttons, form state updates)

This is intentional. A smoke test proves a single layer works. If AI calls return correct JSON, the problem is not the AI layer — it's something else. When a bug appears in production that makes it past a smoke test, you know immediately which layer to investigate.

Adding InsForge calls to this script would require real auth tokens, a real user in the DB, and a real resume file. The script would no longer be a smoke test — it would be an integration test, which is heavier to set up and slower to run. The smoke test's value is that it runs in under 30 seconds with zero setup beyond the API key.

---

## 8. When to re-run this test

Re-run `scripts/test-ai.ts` any time:
- The OpenRouter API key changes (key rotation, regeneration)
- The model string changes (switching models again, adding `:nitro` routing tier)
- Any of the `defaultHeaders` values change (app URL, app name)
- The production `max_tokens` or `temperature` values in `context/library-docs.md` change
- A model outage is suspected (OpenRouter status page + this script = fastest diagnosis)
