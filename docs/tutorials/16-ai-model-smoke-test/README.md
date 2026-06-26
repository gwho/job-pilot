# Tutorial 16 — AI Model Smoke Testing: Verifying AI Integrations Before They Touch the UI

**After completing this tutorial you will understand:** what a smoke test is and why it's the correct first move after any AI model change, how to design a sequential test pyramid where each layer isolates a single failure mode, why the test client must be constructed identically to the production client and what breaks when it isn't, how to make correct assertions on non-deterministic AI output (shape-testing vs content-testing), and how to load `.env.local` in a standalone Node script without a test runner.

---

> [!NOTE]
> **Prerequisites:**
> - Tutorial 14 (`../14-resume-pdf-generation/README.md`) — built `agent/pdf-generator.tsx`, whose production system prompt is mirrored in Test 4. This tutorial tests that agent function.
> - Tutorial 10 (`../10-profile-extraction/README.md`) — built `agent/extractor.ts`, whose production system prompt is mirrored in Test 3. Understanding what that agent does makes the test legible.
>
> Open [`scripts/test-ai.ts`](../../../scripts/test-ai.ts),
> [`agent/extractor.ts`](../../../agent/extractor.ts), and
> [`agent/pdf-generator.tsx`](../../../agent/pdf-generator.tsx) alongside this tutorial.

---

## CS & language concepts in this tutorial

| Concept | Where it appears | Category |
|---------|-----------------|----------|
| Test pyramid | Four sequential tests: connectivity → JSON mode → realistic prompts | System design |
| Unix process exit codes | `process.exit(1)` when any test fails | OS fundamentals |
| Error type discrimination | `err instanceof SyntaxError` vs. generic `Error` in Test 2 | Type theory |
| Shape vs. value assertions | `checks.length > 0`, structural field checks instead of exact string comparison | System design |
| Fail-fast principle | Key presence guard before any API call | Design patterns |
| Process environment | `--env-file=.env.local` loads vars into `process.env` before the script runs | OS fundamentals |

---

## How to use an LLM before this tutorial

Run these prompts before reading any code. Budget 25–35 minutes.

### Concept 1 — Smoke tests: what they catch and what they don't

> "Explain what a 'smoke test' is in software engineering. Where does the term come from? What specific class of failure does a smoke test catch — and what is it explicitly NOT designed to catch? What is the difference between a smoke test, a unit test, and an integration test? Give me an example of each for a system that calls an external AI API. Quiz me with a scenario."

*What to listen for:* A smoke test is the minimal check that a system starts and responds at all — borrowed from electronics (power on, check for smoke). It catches configuration failures: wrong keys, wrong endpoints, missing dependencies. It does NOT catch logic errors, edge cases, or correctness. A unit test isolates a single function. An integration test exercises multiple real components together (auth + DB + AI). The smoke test sits below integration tests in cost and setup time.

*Practice question:* An engineer changes the model string from `"gemini-2.5-flash-lite"` to `"nvidia/nemotron-3-ultra-550b-a55b:free"` and the base URL from Google's endpoint to OpenRouter's. They ask: "Do I need to run anything before deploying?" What should they run, and why?

---

### Concept 2 — Unix process exit codes

> "Explain Unix process exit codes. What does exit code 0 mean, and what does a non-zero exit code mean? How does a shell script or CI pipeline use exit codes to know if a step succeeded or failed? What happens if a program crashes vs. explicitly calls `process.exit(1)` in Node.js? Give me a concrete example of how an exit code from a test script would affect a GitHub Actions CI job. Quiz me."

*What to listen for:* Exit code `0` means success. Any non-zero code means failure — convention uses `1` for generic failure. The shell's `&&` operator chains commands: `cmd1 && cmd2` only runs `cmd2` if `cmd1` exited `0`. CI pipelines (GitHub Actions, CircleCI) treat any non-zero exit from a step as a failed step and stop the pipeline. A program that crashes throws an uncaught exception and Node.js exits with code `1` automatically. A program that catches all errors but doesn't call `process.exit(1)` will exit with code `0` even if tests failed.

*Practice question:* A test script catches every error in try/catch blocks, logs "3 failed" to the console, but never calls `process.exit(1)`. A GitHub Actions CI step runs this script. What does GitHub Actions report?

---

### Concept 3 — Testing non-deterministic systems

> "I'm building tests for code that calls an AI language model. The model's output changes slightly on every call — different wording, sometimes different field values. How do I write useful assertions for code like this? What should I assert, and what should I leave unasserted? How is this different from testing a pure function? Give me a concrete example of a good assertion vs. a bad assertion for an AI call that returns JSON. Quiz me."

*What to listen for:* For deterministic code (`add(2, 3)` always returns `5`), you assert exact values. For non-deterministic code, you assert *shape*, *type*, *presence*, and *constraints* — not exact content. A good assertion: "the `skills` field is a non-empty array." A bad assertion: "the `skills` field equals `['React', 'TypeScript', 'Next.js']`." The AI might return `['TypeScript', 'React', 'Next.js, GraphQL']` and both would be correct answers.

*Practice question:* A test for the extraction agent asserts `parsed.full_name === "Jane Smith"`. The test input contains "Jane Smith." Is this a good assertion? What would break it?

---

### Concept 4 — LLM `response_format: json_object` — what it does and doesn't do

> "Explain what `response_format: { type: 'json_object' }` does when you send it to an OpenAI-compatible API. Does it guarantee valid JSON? Does it guarantee the JSON has specific fields? Does it guarantee the fields have the right types? What can still go wrong even when this mode is enabled? Quiz me."

*What to listen for:* JSON mode constrains the *syntax* of the response — the model is instructed (and sometimes post-processed) to return text that parses as valid JSON. It does NOT guarantee: specific field names, specific field types, non-empty required fields, or correct enum values. A model could return `{}` (valid JSON, useless for extraction). It could return `{"experience_level": "Senior"}` when you specified only `"senior"` is valid. `JSON.parse` would succeed in both cases but downstream code would break.

*Practice question:* `response_format: json_object` is enabled. The model returns `{"status": "ok"}` but your code expects `{"status": string, "value": number}`. What happens when your code accesses `parsed.value`?

---

### Concept 5 — JavaScript `instanceof` and error type discrimination

> "Explain how `instanceof` works in JavaScript for error types. If I catch an error with `catch (err)`, how do I know whether it's a `SyntaxError` vs. a `TypeError` vs. some custom error class? Why does this matter? Give me an example of a situation where different error types mean fundamentally different things and should produce different error messages. Quiz me."

*What to listen for:* `instanceof` checks the prototype chain — `err instanceof SyntaxError` returns `true` only if `err` was constructed with `SyntaxError` (or a subclass). `JSON.parse` throws a `SyntaxError` specifically when the input is not valid JSON. A network error from the `openai` SDK throws a different error class. Discriminating them lets you produce accurate diagnostics: "JSON parse failed" (model returned non-JSON) is a different root cause from "request failed" (network or auth issue). Treating them as the same error class produces the same message for different failures.

*Practice question:* `JSON.parse("hello")` throws. What type of error is it? `fetch("bad-url")` rejects. What type of error is it? If your test code catches both and only checks `err.message`, what diagnostic information is lost?

---

## Architecture overview

```
scripts/test-ai.ts (standalone Node script)
│
│  Loaded with:  npx tsx --env-file=.env.local scripts/test-ai.ts
│  No Next.js runtime. No InsForge. No DB. No auth.
│
├── OpenAI client (identical to agent/ config)
│     apiKey:          OPENROUTER_API_KEY
│     baseURL:         https://openrouter.ai/api/v1
│     defaultHeaders:  HTTP-Referer, X-Title
│
├── Test 1 — Connectivity
│     Smallest possible call. No response format. 20 tokens.
│     Failure means: wrong key, wrong URL, wrong model, no network.
│
├── Test 2 — JSON mode
│     response_format: json_object. Simple schema. 100 tokens.
│     Failure means: model reachable but JSON mode broken.
│
├── Test 3 — Extraction prompt
│     System prompt from agent/extractor.ts. 800 tokens.
│     Failure means: JSON mode works but extraction contract broken.
│
└── Test 4 — Generation prompt
      System prompt from agent/pdf-generator.tsx. 400 tokens.
      Failure means: JSON mode works but generation contract broken.

Each test: try/catch → pass(label, detail) or fail(label, err)
Final: process.exit(1) if failed > 0
```

**Key invariants:**
1. Tests run sequentially — a failure in Test 1 makes Tests 2–4 meaningless; sequential ordering lets you stop reasoning at the first failure.
2. The OpenAI client in the test is constructed identically to the one in `agent/` — testing a different client configuration would not give you confidence about the real agents.
3. `max_tokens` in every test must match the production value for that call — a mismatch produces truncated JSON that fails `JSON.parse`, which is a test configuration error, not a model error.

---

## Part 1 — The test pyramid: four layers, one direction

Open [`scripts/test-ai.ts`](../../../scripts/test-ai.ts) lines 54–68 (`testConnectivity`) and lines 219–238 (`run`):

```typescript
async function testConnectivity() {
  console.log(bold("\nTest 1 — Connectivity"));
  try {
    const res = await openai.chat.completions.create({
      model: MODEL,
      max_tokens: 20,
      messages: [{ role: "user", content: "Say only the word: hello" }],
    });
    const text = res.choices[0].message.content ?? "";
    if (!text) throw new Error("Empty response content");
    pass("OpenRouter reachable, model responded", `Response: "${text.trim()}"`);
  } catch (err) {
    fail("Could not reach OpenRouter or model refused", err);
  }
}
```

```typescript
async function run() {
  // ...key check...
  await testConnectivity();
  await testJsonMode();
  await testExtractionPrompt();
  await testGenerationPrompt();
  // ...results...
}
```

Test 1 is the simplest possible API call: one user message, no response format constraint, 20 tokens. The only things that can fail here are configuration failures — wrong API key, wrong base URL, wrong model ID, or no network. Notice there is no system prompt, no `response_format`, and the `max_tokens` budget is intentionally tiny. The test is not asking the model to do anything intelligent. It is asking: *can I reach you at all?*

The four tests are called sequentially with `await` — they do not run in parallel. This is the test pyramid at work. If Test 1 fails, Tests 2–4 would also fail, but they would fail for the *same* reason (cannot reach the model), not new reasons. Running them in order means the moment Test 1 fails, you know exactly what layer broke. Running them in parallel would produce four failures for a single root cause — four failure messages when one would suffice.

The term "smoke test" comes from electronics. When you power on a new circuit board for the first time, if smoke comes out, you stop immediately — you don't proceed to measure voltages or test individual components. This test suite plays the same role: before exercising the AI layer of the app in any way, you check that it starts.

> **System design — Test pyramid:** The test pyramid is an architectural pattern for test suites. Cheap, fast tests that verify basic connectivity sit at the bottom. Integration tests that exercise real components together sit in the middle. End-to-end tests that simulate user interactions sit at the top. You always run bottom-up — if the bottom fails, the top is meaningless. Each layer isolates a narrower class of failure, so when a test fails you know *which* layer broke and can ignore everything above it.

**Checkpoint:** The four tests run in order: connectivity → JSON mode → extraction prompt → generation prompt. If Test 2 (JSON mode) fails, is there any point in running Tests 3 and 4? What does the answer reveal about how the test pyramid handles shared failure modes?

<details>
<summary>Reveal answer</summary>

No — if Test 2 fails, Tests 3 and 4 will also fail for the exact same reason: the model does not support `response_format: json_object`, which means every agent function in this project will break. Running Tests 3 and 4 would produce two additional failures, but they carry no new diagnostic information. They just confirm that the same broken thing is broken in two more places.

This is precisely why the tests are sequential. Each test layer assumes the previous layer passed. Test 3 assumes JSON mode works (Test 2 verified this). Test 4 assumes JSON mode works AND the extraction pattern works (Tests 2 and 3 verified those). A failure in a lower layer is the complete explanation for all failures above it. Sequential ordering lets you stop reasoning at the first failure and start fixing instead.

If the tests ran in parallel, you would receive four failures simultaneously and have to determine whether they share a root cause or represent four independent problems. The sequential structure makes that determination for you.
</details>

**Try it yourself:** Open `scripts/test-ai.ts` and read the `run()` function (lines 219–238). The four `await` calls are the entire pyramid. Count how many lines it takes to define the orchestration (excluding the tests themselves). Notice how flat it is — no framework, no test runner, just four awaited async functions.

---

**Checkpoint:** The term "smoke test" implies you check something minimal before proceeding. Where does a smoke test stop and an integration test begin? What would make this script cross that boundary?

<details>
<summary>Reveal answer</summary>

A smoke test checks that the system responds at all — it verifies configuration (credentials, endpoints, model ID) and basic connectivity. It does not verify correct behavior under real conditions.

This script would cross into integration test territory if it added: real InsForge authentication, a real database query to fetch a user's profile, a real PDF upload to storage, or assertions on the actual content of what the model returns (verifying that extracted fields are semantically correct for a specific resume). Those additions would require live credentials for multiple services, a real user in the database, and a real file — a substantially heavier setup.

The boundary is: smoke tests verify that the *plumbing is connected*. Integration tests verify that real operations *produce correct results* when the plumbing is connected. This script stays firmly in smoke-test territory by using synthetic data, making no database calls, and asserting only shape — not meaning.
</details>

---

**Checkpoint:** This project has no configured test runner (no Vitest, no Jest). The smoke test is a standalone `tsx` script. What are the tradeoffs of a script vs. a test runner for a project like this?

<details>
<summary>Reveal answer</summary>

**Script advantages:** Zero setup, zero new dependencies. Run with one command. Anyone who can read the file can understand what it does — no knowledge of test runner APIs required. Easy to adapt output format, error messages, and flow control.

**Test runner advantages:** Parallel test execution, watch mode, coverage reports, built-in `describe`/`it`/`expect` assertions, snapshot testing, mocking utilities, and CI integration via standard exit codes and reporters. A test runner also enforces structure — tests are isolated by convention, which prevents the kind of state leak where a passing test leaves state that makes a later test fail.

**When a test runner becomes worth adding:** When there are many tests (10+) with shared setup/teardown. When you need to run tests in watch mode during active development. When coverage reporting matters. When tests need database transactions or mocking. For this project's current scope — one AI layer, four smoke tests — a script is the right tool. Adding Vitest for four API calls would cost more in maintenance than it saves.
</details>

---

## Part 2 — The client must be identical to production

Open [`scripts/test-ai.ts`](../../../scripts/test-ai.ts) lines 41–50:

```typescript
const MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";

const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY!,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "https://job-pilot.app",
    "X-Title": "JobPilot",
  },
});
```

Now open [`agent/extractor.ts`](../../../agent/extractor.ts) lines 72–75:

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

These two client initialisations are identical — same `apiKey` source, same `baseURL`, same `defaultHeaders`. This is not accidental. The `defaultHeaders` are OpenRouter's recommended attribution headers: `HTTP-Referer` identifies the application making requests, `X-Title` names it. OpenRouter uses these for routing decisions and to associate requests with your account in their dashboard.

If the test client omitted `defaultHeaders`, it would be testing a subtly different configuration than what the agents use. A header combination that causes a routing or rate-limiting issue in production would not surface in the test. The test would pass all four checks, you would ship, and the failure would appear only when the app makes a request with the headers attached.

The principle: **the test client must be constructed identically to the production client.** The only things that differ between test and production are the input data (synthetic resume snippets, not real PDFs) and the prompts (abbreviated versions of the production system prompts). The infrastructure — how you authenticate, where you send the request, what metadata you attach — must be identical.

**Checkpoint:** The test client is built with the same `defaultHeaders` as the production client. What would the risk be if the test omitted `defaultHeaders`, passed all four tests, and a header combination turned out to cause a routing issue in production?

<details>
<summary>Reveal answer</summary>

The test would give false confidence. You would see "4 passed, 0 failed" and conclude the integration is working. But the passing tests were made without the `HTTP-Referer` and `X-Title` headers — so they tested a configuration that doesn't match what the app sends.

If OpenRouter routes requests differently based on the `Referer` header (for example, applying rate limits differently to known apps vs. anonymous requests), a test without headers would bypass that routing logic. The same requests made from the app — with headers attached — would hit different infrastructure, potentially triggering errors the test never saw.

The general principle: a test that uses a different configuration than production is testing a hypothetical, not the real system. Whatever confidence it provides does not transfer to production.
</details>

---

## Part 3 — JSON mode: the most critical test

Open [`scripts/test-ai.ts`](../../../scripts/test-ai.ts) lines 70–106:

```typescript
async function testJsonMode() {
  console.log(bold("\nTest 2 — JSON mode (response_format: json_object)"));
  try {
    const res = await openai.chat.completions.create({
      model: MODEL,
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 100,
      messages: [
        {
          role: "system",
          content:
            'Return ONLY valid JSON. Schema: { "status": string, "value": number }',
        },
        { role: "user", content: "Confirm the model is working." },
      ],
    });

    const raw = res.choices[0].message.content ?? "";
    if (!raw) throw new Error("Empty content in JSON mode response");

    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null)
      throw new Error(`Parsed value is not an object: ${typeof parsed}`);

    pass(
      "response_format: json_object returns parseable JSON",
      `Parsed: ${JSON.stringify(parsed)}`
    );
  } catch (err) {
    if (err instanceof SyntaxError) {
      fail("Response was not valid JSON — json_object mode may not be supported", err);
    } else {
      fail("JSON mode test failed", err);
    }
  }
}
```

Test 2 is the most important test for this project. Every agent function — `extractProfileFromResume`, `generateResumePdf`, and every future agent function — calls `JSON.parse(response.choices[0].message.content!)`. If `response_format: { type: "json_object" }` does not work with this model via OpenRouter, that `JSON.parse` will throw every time, and every AI-powered feature in the app will be broken.

The test schema is deliberately trivial: `{ "status": string, "value": number }`. This is not the extraction schema or the generation schema — it's the simplest possible shape that proves JSON mode is operating. Using a complex schema here would add noise: if the test failed, you wouldn't know if it was because JSON mode is broken or because the model struggled with a specific schema. A simple schema isolates the question to "does JSON mode work at all?"

Notice the `catch` block. It doesn't just call `fail()` uniformly — it discriminates on error type:

```typescript
  } catch (err) {
    if (err instanceof SyntaxError) {
      fail("Response was not valid JSON — json_object mode may not be supported", err);
    } else {
      fail("JSON mode test failed", err);
    }
  }
```

`JSON.parse` throws a `SyntaxError` specifically when its input is not valid JSON. If the model returned text like `"I can help with that, here's the JSON: {..."`, `JSON.parse` would throw `SyntaxError: Unexpected token`. This is a specific failure mode: the model did not honour the JSON constraint. A different error type (say, a network error or an API authentication error) means something else broke. The `instanceof SyntaxError` check separates "JSON mode broken" from "API call broken" — two very different diagnostics.

> **Type theory — Error type discrimination:** JavaScript's error system uses prototype chains. `JSON.parse("bad")` throws a `SyntaxError`; `fetch("bad-url")` rejects with a `TypeError`. Both are `instanceof Error`, but they have different types further down the prototype chain. `err instanceof SyntaxError` tests specifically for the `SyntaxError` constructor in the chain — it returns `true` only for that type. Discriminating error types at the catch site is the correct way to route errors to accurate diagnostic messages. A catch-all that only reads `err.message` loses the type information that tells you which layer failed.

**Checkpoint:** `response_format: { type: "json_object" }` constrains the model to return valid JSON. But what does it NOT guarantee? Give two examples of a response that would satisfy JSON mode but still break the agent code.

<details>
<summary>Reveal answer</summary>

JSON mode guarantees *syntax* — the response parses without throwing. It does NOT guarantee:

**Example 1 — Missing fields:** The model returns `{}`. This is valid JSON. `JSON.parse("{}")` succeeds. But `agent/extractor.ts` then does `const data = JSON.parse(raw) as ProfileExtraction` and accesses `data.full_name`, `data.skills`, etc. All of those are `undefined`. Downstream code that checks `if (data.skills != null)` would skip the update — which is the correct null-safe behaviour here — but a caller expecting at least some extracted data would get nothing.

**Example 2 — Wrong enum value:** The model returns `{"experience_level": "Senior"}` when the system prompt specified the only valid values are `"junior" | "mid" | "senior" | "lead"`. `JSON.parse` succeeds. TypeScript's cast `as ProfileExtraction` does not validate at runtime — it only satisfies the type checker at compile time. The value `"Senior"` would propagate into the form state and the database. If any downstream code does a strict comparison like `profile.experience_level === "senior"`, it would silently fail.

Both of these are real failure modes in AI integrations. JSON mode prevents `JSON.parse` from throwing; it doesn't validate the content.
</details>

---

**Checkpoint:** Why does Test 2 use a trivially simple schema (`{ "status": string, "value": number }`) rather than the full extraction schema from `agent/extractor.ts`? What specific failure would using a complex schema hide?

<details>
<summary>Reveal answer</summary>

Test 2 exists to answer exactly one question: "Does `response_format: json_object` work at all?" A simple schema focuses the model's entire generation on satisfying the JSON constraint, not on following complex extraction rules. If the test fails with a simple schema, the answer is clear: JSON mode is broken.

If Test 2 used the full extraction schema (15+ fields, enum constraints, nested arrays), a failure could mean any of: JSON mode is broken, the model misunderstood the schema structure, the extraction instructions conflicted with the JSON constraint, or the `max_tokens` budget was too low for the full response. You would have four potential explanations for one failure.

The general testing principle: each test should test exactly one thing. When a test does two things and fails, you don't know which one caused the failure.

Tests 3 and 4 then add the realistic schema as a second layer, assuming Test 2 proved JSON mode works. This layering — simple first, complex second — is what makes the pyramid diagnostic rather than just a pass/fail gate.
</details>

---

**Checkpoint:** OpenRouter is a proxy in front of many model providers. Is it OpenRouter or the underlying NVIDIA model that enforces `json_object` mode? Why does this matter for how reliable the feature is?

<details>
<summary>Reveal answer</summary>

This depends on the model and how OpenRouter handles it. For models that natively support JSON mode (like OpenAI's GPT-4o), the underlying model enforces it. For models that don't have native JSON mode support, OpenRouter can apply a post-processing layer to coerce the output — but this is less reliable and can produce truncated or subtly malformed JSON.

This matters because: if the underlying NVIDIA Nemotron model does not natively support `json_object` mode and OpenRouter's post-processing handles it, the reliability depends on OpenRouter's implementation. A model update that changes the output format could break the post-processing. A model that OpenRouter routes to a different provider (OpenRouter supports multiple backends for the same model ID) might have different JSON mode behaviour.

Test 2's existence is the practical answer to this uncertainty. Rather than relying on documentation about which layer handles JSON mode, you test it empirically. If the test passes, JSON mode works for this model at this moment, regardless of which layer enforces it. Repeating the test after any model string change or OpenRouter routing change gives you renewed confidence.
</details>

---

## Part 4 — Configuration discipline: the max_tokens failure

Open [`scripts/test-ai.ts`](../../../scripts/test-ai.ts) lines 108–161 (`testExtractionPrompt`), specifically the `openai.chat.completions.create` call:

```typescript
    const res = await openai.chat.completions.create({
      model: MODEL,
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 800,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `RESUME TEXT:\n${RESUME_SNIPPET}` },
      ],
    });
```

The `max_tokens: 800` on line 133 is the value that mattered most in this session. The first run of Test 3 failed with:

```
Test 3 — Extraction prompt    ✗  Unterminated string in JSON at position 36
```

`Unterminated string in JSON at position 36` is the exact error `JSON.parse` throws when the input was cut off mid-string — the model started generating valid JSON but the token budget ran out before the closing braces arrived. The model's output stopped at character 36, producing something like: `{"full_name": "Jane Sm`.

The initial `max_tokens` for Test 3 was `200`. The reasoning was: "it's a test, keep it quick." But the production `agent/extractor.ts` uses `max_tokens: 800` — because the extraction schema has 15+ fields and some like `work_experience` are arrays of objects that generate substantial JSON. `200` tokens is not enough to complete the response, so `JSON.parse` always fails.

The fix was to change the test to use `800` — matching the production value exactly. This reveals a hard rule: **test configuration must mirror production configuration.** A smoke test that uses different parameters than the real code is testing a hypothetical. If the test passes at 200 tokens and the agent uses 800, the test tells you nothing about whether the agent works. Worse, it can produce false negatives: the test fails at 200 tokens, you shorten the system prompt to make it fit, and now you have a test that passes with a prompt that diverges from production.

The source of truth for production values is `context/library-docs.md`, which documents exactly what `max_tokens` and `temperature` to use per call type. If those values ever change, the test should change to match.

> **Design patterns — Fail-fast principle:** The fail-fast principle is the practice of detecting errors as early as possible and surfacing them loudly rather than letting them propagate silently. In test configuration: a `max_tokens` mismatch fails at the test layer (obvious `SyntaxError` from `JSON.parse`) rather than propagating to the app where the same error appears as a broken UI feature with no obvious connection to token limits. Catching configuration drift in the test layer — before the app is even running — is fail-fast applied to the integration boundary.

**Checkpoint:** Test 3 initially used `max_tokens: 200` but the production agent uses `max_tokens: 800`. This is a test configuration error, not a model error. What would happen in a larger codebase if test configurations routinely diverged from production configurations over time?

<details>
<summary>Reveal answer</summary>

In a small codebase with one AI integration and one developer, a one-line fix corrects the divergence immediately. In a larger codebase with multiple AI call sites and multiple developers, the damage compounds:

1. **False negatives accumulate.** Tests fail for configuration reasons rather than real breakage. Developers stop trusting the tests. Tests that "always fail" get skipped or ignored.

2. **False positives appear.** If the test uses a smaller schema than production (testing a simpler version of the prompt), a model that works for the test prompt might not work for the production prompt. The tests pass, the deployment happens, and users see failures.

3. **Prompt drift occurs.** Developers change the test prompt to make it fit within the test `max_tokens`, creating a prompt that doesn't match production. Now the test and production are testing different behaviours — the test becomes completely decoupled from what it's supposed to verify.

The root fix: make the test values derive from or reference the same constants as production. In this project, both should reference the values documented in `context/library-docs.md`. If those values are also represented as named constants in the code (e.g., `const EXTRACTION_MAX_TOKENS = 800`), the test and production would import the same constant and could never diverge.
</details>

---

**Checkpoint:** `context/library-docs.md` documents the production values for `max_tokens` and `temperature` per use case. If you changed `max_tokens` for extraction from 800 to 1200 in `library-docs.md`, what else would you need to update?

<details>
<summary>Reveal answer</summary>

Two files need updating:

1. **`agent/extractor.ts`** — the `max_tokens` in the `openai.chat.completions.create` call must change from 800 to 1200.
2. **`scripts/test-ai.ts`** — the `max_tokens` in `testExtractionPrompt()` must change from 800 to 1200 to mirror the production value.

The asymmetry in how this project is set up: `library-docs.md` is documentation (a markdown file), not code. There is no runtime link between the documented value and the code value — they are maintained independently. If you update `library-docs.md` but not `extractor.ts`, the documentation is wrong. If you update `extractor.ts` but not `test-ai.ts`, the test drifts from production.

The sustainable fix would be to define the value as a constant in code (e.g., in `lib/utils.ts`) and import it in both places. Then `library-docs.md` would reference the constant name, and any change flows automatically to both call sites via TypeScript's import resolution.
</details>

---

## Part 5 — Shape-testing non-deterministic output

Open [`scripts/test-ai.ts`](../../../scripts/test-ai.ts) lines 140–160:

```typescript
    const parsed = JSON.parse(raw) as {
      full_name: string | null;
      current_title: string | null;
      experience_level: string | null;
      skills: string[];
    };

    const checks: string[] = [];
    if (parsed.full_name) checks.push(`name="${parsed.full_name}"`);
    if (parsed.experience_level) checks.push(`level="${parsed.experience_level}"`);
    if (Array.isArray(parsed.skills) && parsed.skills.length > 0)
      checks.push(`skills=[${parsed.skills.slice(0, 3).join(", ")}…]`);

    if (checks.length === 0)
      throw new Error(`Model returned valid JSON but extracted nothing useful: ${raw}`);

    pass("Extraction prompt returns typed JSON", checks.join(", "));
```

Notice what the test does NOT assert. It does not check that `parsed.full_name === "Jane Smith"` even though the test input contains "Jane Smith." It does not check that `parsed.skills` equals `["React", "TypeScript", "Next.js", "GraphQL", "Tailwind CSS"]` even though those exact skills appear in the resume snippet. It checks only that at least one field was extracted — `checks.length > 0`.

This is *shape-testing*, not *content-testing*. AI output is non-deterministic: the same prompt produces slightly different results on every call. The model might return `"Jane Smith"` or `"Jane M. Smith"`. It might return `["React", "TypeScript"]` or `["TypeScript", "React", "Next.js"]`. Both are correct extractions of the input. An exact-value assertion would turn every run into a dice roll.

What the test actually verifies:
- The model returned valid JSON (Test 2 covered this, Test 3 re-verifies in context)
- The JSON has the expected structure (TypeScript cast succeeds, field access works)
- The model extracted *something* meaningful (at least one of name, level, or skills is present)
- The extraction contract is not totally broken (a model that returned `{}` for every resume would fail `checks.length === 0`)

The input data is also synthetic — a made-up resume for "Jane Smith" with invented skills and no real employer. Real production resumes would be in different formats, different languages, with ambiguous dates and unusual experience structures. Synthetic data doesn't test those edge cases. That is fine for a smoke test — you're not trying to verify correctness for all inputs, only that the integration works for a known-good input.

> **System design — Shape vs. value assertions:** In testing non-deterministic systems (AI, randomised algorithms, systems with network variability), there are three assertion levels: (1) **Type check** — the response is an object, the fields exist; (2) **Shape check** — the response has the expected fields with the expected types; (3) **Value check** — the response contains specific values. For AI output, stop at level 2. Value checks on non-deterministic output produce flaky tests — tests that sometimes pass and sometimes fail based on model variance, not code changes. Flaky tests are worse than no tests because they erode trust in the test suite.

**Checkpoint:** AI calls are non-deterministic — the model can return different outputs for the same input. How does the test handle this? What does it actually assert, and what does it leave unasserted?

<details>
<summary>Reveal answer</summary>

The test handles non-determinism by asserting *structure*, not *content*. Specifically:

**What it asserts:**
- `JSON.parse(raw)` does not throw (valid JSON returned)
- `typeof parsed === "object" && parsed !== null` (it's an object, not a string or array)
- At least one of `full_name`, `experience_level`, or `skills` is present and non-empty

**What it leaves unasserted:**
- The exact value of any field
- The order of skills in the array
- Whether `current_title` or `linkedin_url` were extracted
- Whether the `experience_level` enum value matches the specific allowed values

This is exactly the right level of assertion for a smoke test of an AI integration. The test is asking: "Is the extraction pipeline functioning?" — not "Is the model extracting perfectly?" Correctness for specific inputs would be a property test or an evaluation harness, which is a different tool for a different purpose.
</details>

---

**Checkpoint:** Tests 3 and 4 use synthetic input data (a made-up resume, a made-up profile) rather than real data from the database. What are the advantages of synthetic data in a smoke test? What class of failures would it miss that real data would catch?

<details>
<summary>Reveal answer</summary>

**Advantages of synthetic data:**
- No setup required — no real user, no DB connection, no auth token
- The test runs in under 30 seconds in any environment with only the API key
- The input is controlled — you know exactly what the model should extract, so any reasonable extraction is a pass
- No sensitive data in the test script (real resumes contain names, addresses, phone numbers)

**Failures it misses:**
- Format-specific failures: some real resumes use unusual formatting (columns, tables, Unicode characters) that the extraction system prompt doesn't handle well. Synthetic input is always well-formatted.
- Language failures: if a user uploads a resume in French or Spanish, the extraction prompt may behave differently. Synthetic input is always English.
- Edge cases in real work history: overlapping employment dates, single-character company names, very long responsibility descriptions that push JSON over token limits. Synthetic input is always well-behaved.

These classes of failure are not what a smoke test is designed to catch. A smoke test verifies the plumbing is connected. An evaluation harness — a separate system that tests against a curated set of real (or realistic) edge-case inputs and checks extraction quality — is the right tool for the failures listed above.
</details>

---

**Checkpoint:** The test for extraction (Test 3) checks `checks.length === 0` and throws if nothing was extracted. What would it mean if the model returned a valid JSON object but extracted nothing? Is that a different failure from Test 2 failing?

<details>
<summary>Reveal answer</summary>

Yes, it's a different and subtler failure. Test 2 failing means JSON mode itself is broken — the model returned something that isn't parseable JSON. `checks.length === 0` failing means JSON mode works, the JSON is valid, but the model extracted no meaningful data from the resume.

This could happen if:
- The model misunderstood the extraction schema and returned `{"full_name": null, "current_title": null, "experience_level": null, "skills": []}` — technically valid JSON that satisfies all the structural checks, but represents a total extraction failure
- The model returned a JSON object with unexpected field names (e.g., `{"name": "Jane Smith"}` instead of `{"full_name": "Jane Smith"}`) — the expected field is null but the data is there under a different key

Both of these would pass `JSON.parse` and satisfy the structural type cast (`as { full_name: string | null; ... }`), but would fail the `checks.length > 0` guard because the expected fields are all null or empty.

This is why `checks.length > 0` is a meaningful assertion: it catches the case where the model technically responded correctly (valid JSON) but the extraction contract is broken (nothing extracted). Without it, a model that always returned `{}` would pass Test 3.
</details>

---

## Part 6 — Loading env vars and reporting results

Open [`scripts/test-ai.ts`](../../../scripts/test-ai.ts) lines 14–37 (helpers) and lines 219–244 (`run` and its catch):

```typescript
// Run: node --env-file=.env.local --import tsx/esm scripts/test-ai.ts
// Or:  npx tsx --env-file=.env.local scripts/test-ai.ts
import OpenAI from "openai";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

let passed = 0;
let failed = 0;

function pass(label: string, detail?: string) {
  passed++;
  console.log(`  ${green("✓")} ${label}`);
  if (detail) console.log(`    ${dim(detail)}`);
}

function fail(label: string, err: unknown) {
  failed++;
  const msg = err instanceof Error ? err.message : String(err);
  console.log(`  ${red("✗")} ${label}`);
  console.log(`    ${red(msg)}`);
}
```

```typescript
async function run() {
  console.log(bold("=== JobPilot AI Smoke Tests ==="));
  console.log(dim(`Model: ${MODEL}`));
  console.log(dim(`Key:   ${process.env.OPENROUTER_API_KEY ? "set ✓" : "MISSING ✗"}`));

  if (!process.env.OPENROUTER_API_KEY) {
    console.log(red("\nOPENROUTER_API_KEY not set in .env.local — aborting."));
    process.exit(1);
  }

  await testConnectivity();
  await testJsonMode();
  await testExtractionPrompt();
  await testGenerationPrompt();

  console.log(
    `\n${bold("Results:")} ${green(`${passed} passed`)}  ${failed > 0 ? red(`${failed} failed`) : dim("0 failed")}\n`
  );

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(red("\nUnhandled error:"), err);
  process.exit(1);
});
```

**How `.env.local` gets loaded.** Next.js loads `.env.local` automatically when running the app or API routes. It does not load it for standalone scripts — `npx tsx scripts/test-ai.ts` starts a fresh Node process that knows nothing about `.env.local`. Two options were considered:

- **`dotenv` package:** `import * as dotenv from "dotenv"` + `dotenv.config({ path: ".env.local" })`. Common in many projects, but requires `dotenv` as a dependency, which this project doesn't have.
- **`--env-file` flag (Node 20+):** Built into Node itself. `npx tsx --env-file=.env.local scripts/test-ai.ts`. Node parses `.env.local` before the script starts, so `process.env.OPENROUTER_API_KEY` is set when the first line of the script runs.

The `--env-file` flag was chosen: zero new dependencies, works on Node 24. The comment at the top of the file documents the exact run command — not in a README, not in someone's memory, but in the file itself. This is the principle of *co-locating knowledge with the artifact*: whoever opens the file in six months will find the run command on line 1.

> **OS fundamentals — Process environment:** Every Unix process has an *environment* — a set of key-value string pairs inherited from its parent. `process.env` in Node.js is the current process's environment. The `--env-file` flag instructs Node to parse a file of `KEY=VALUE` lines and inject those pairs into the environment before the script starts. This is identical in effect to exporting variables in a shell script before running a command: `export OPENROUTER_API_KEY=... && npx tsx scripts/test-ai.ts`. The file-based approach is safer because it keeps secrets out of shell history.

**The early exit guard.** Before any API call, the script checks:

```typescript
  if (!process.env.OPENROUTER_API_KEY) {
    console.log(red("\nOPENROUTER_API_KEY not set in .env.local — aborting."));
    process.exit(1);
  }
```

Without this guard, the API call would fail with an authentication error from OpenRouter — something like `401 Unauthorized` or `invalid_api_key`. That message is accurate but forces you to diagnose which key is wrong, whether it's set at all, or whether the env file was loaded. The guard answers the question before the API call, producing a message you can act on immediately: the key is not set.

**process.exit(1) and why it matters.** At the end of `run()`, `if (failed > 0) process.exit(1)`. Without this, a script that logs "3 failed" would still exit with code 0 — success from the OS's perspective. A CI pipeline (`npm test` → `scripts/test-ai.ts`) would report the step as passed. The non-zero exit code is what makes the shell and CI systems aware of the failure.

> **OS fundamentals — Exit codes:** Unix exit codes are integers between 0 and 255. Code 0 means success. Any non-zero code means failure. The shell uses exit codes to implement `&&` (run second command only if first exited 0) and `||` (run second command only if first exited non-zero). CI platforms (GitHub Actions, CircleCI, Vercel build steps) treat non-zero exit from any step as a pipeline failure and stop the run. `process.exit(1)` is how a Node script intentionally signals failure to the OS, the shell, and any orchestration system above it.

**Checkpoint:** The script calls `process.exit(1)` if any test fails. Why does the exit code matter for a standalone test script? What happens if a failing test suite exits with code 0?

<details>
<summary>Reveal answer</summary>

A CI pipeline (GitHub Actions, Vercel build, shell script with `&&`) determines success or failure from the exit code, not from the console output. If a test script exits with code 0, the CI step reports success — even if the console shows "3 failed." The failing tests are invisible to the pipeline. The deployment proceeds. The broken integration reaches production.

This is not hypothetical — it's a common bug in handwritten test scripts. The developer runs the script locally, sees the failure output, and manually decides not to deploy. But the CI pipeline can only read the exit code. A script that always exits 0 is useless as a CI gate.

`process.exit(1)` is what converts a human-readable failure report into a machine-readable signal. The two outputs serve different audiences: the `✗` output is for humans reading the terminal. The exit code is for machines deciding what to do next.
</details>

---

**Checkpoint:** The script uses `--env-file=.env.local` (Node 20+ built-in) instead of the `dotenv` package. What is the difference between the two approaches? Under what circumstances would the `dotenv` package be the better choice?

<details>
<summary>Reveal answer</summary>

**`--env-file` (Node built-in):**
- No dependency to install or maintain
- Loaded by the Node runtime before the script starts — `process.env` is populated before the first `import` resolves
- Only works on Node 20+. Older Node versions would silently ignore the flag (or throw, depending on version)
- The file must be valid `KEY=VALUE` format — no `export`, no subshell expansion

**`dotenv` package:**
- Works on any Node version (6+)
- Loaded inside the script via `dotenv.config()` — after imports have already run, which means dynamic imports or top-level `import` statements that read env vars won't see the values
- Supports more env file features (multiline values, comments on values) depending on the version
- Adds a dependency and a version to maintain

`dotenv` is the better choice when: the codebase must support Node < 20, the env file has non-standard syntax, or the project already uses `dotenv` elsewhere (one pattern, no divergence). For this project — Node 24, standard `.env.local` format, no existing `dotenv` dependency — the built-in `--env-file` is strictly simpler.
</details>

---

**Checkpoint:** The run command is documented in a comment at the top of `scripts/test-ai.ts`. Why document it in the file itself rather than only in a README or a chat window?

<details>
<summary>Reveal answer</summary>

Knowledge that only lives in someone's head, a chat log, or a README that isn't read becomes inaccessible as soon as that person is unavailable or the context is lost. Six months from now, the developer who opens `test-ai.ts` to investigate a failing API integration needs to know immediately how to run it. Opening the file is the first thing they'll do. Finding the run command there — on line 2 — costs zero additional steps.

READMEs go stale. Chat windows are not indexed. Comments inside the file are co-located with the artifact they describe — they update naturally when the artifact changes (a developer changing the env flag would see the comment and update it), and they appear immediately when the file is opened.

The more general principle: any executable artifact (script, test, migration, seed file) should self-document its own invocation. The reader should not need to leave the file to learn how to use it.
</details>

---

## Full data flow: tracing Test 3 from invocation to console output

```
npx tsx --env-file=.env.local scripts/test-ai.ts
  │
  ├── Node loads .env.local → OPENROUTER_API_KEY enters process.env
  ├── tsx compiles scripts/test-ai.ts (TypeScript → JS, in memory)
  └── run() called
        │
        ├── Guard: process.env.OPENROUTER_API_KEY? → set ✓, continue
        │
        ├── testConnectivity() ─────────── await, Test 1 passes
        ├── testJsonMode() ──────────────── await, Test 2 passes
        │
        └── testExtractionPrompt()
              │
              ├── SYSTEM prompt defined (extraction schema, 15 fields)
              ├── RESUME_SNIPPET defined (synthetic "Jane Smith" resume)
              │
              ├── openai.chat.completions.create({
              │     model: "nvidia/nemotron-3-ultra-550b-a55b:free",
              │     response_format: { type: "json_object" },
              │     temperature: 0.3,
              │     max_tokens: 800,        ← must match agent/extractor.ts
              │     messages: [SYSTEM, RESUME_SNIPPET]
              │   })
              │     │
              │     └── HTTPS POST → https://openrouter.ai/api/v1/chat/completions
              │           headers: Authorization, HTTP-Referer, X-Title
              │           │
              │           └── OpenRouter routes to NVIDIA Nemotron
              │                 │
              │                 └── Model generates JSON response
              │                       (up to 800 tokens)
              │
              ├── res.choices[0].message.content → raw JSON string
              ├── JSON.parse(raw) → parsed object
              ├── TypeScript cast as { full_name, experience_level, skills, ... }
              │
              ├── checks: string[] = []
              │   if parsed.full_name  → push 'name="Jane Smith"'
              │   if parsed.experience_level → push 'level="senior"'
              │   if Array.isArray(parsed.skills) && .length > 0
              │       → push 'skills=[React, TypeScript, Next.js…]'
              │
              ├── checks.length === 0? No → continue
              │
              └── pass("Extraction prompt returns typed JSON",
                        "name=\"Jane Smith\", level=\"senior\", skills=[…]")
                    │
                    └── passed++
                        console.log("  ✓ Extraction prompt returns typed JSON")
                        console.log("    name=\"Jane Smith\", level=\"senior\"…")

        ├── testGenerationPrompt() ──── await, Test 4 passes
        │
        └── Results: 4 passed  0 failed
              if failed > 0: process.exit(1)   ← not triggered
              script exits with code 0
```

---

## Extend it (challenges)

### Challenge 1 — Trace the first-run failure (15–20 min)

The first run of Test 3 failed with `Unterminated string in JSON at position 36`. Without changing any code, simulate this failure yourself: temporarily change `max_tokens: 800` in `testExtractionPrompt()` to `max_tokens: 30`, run the script, and observe the output.

**What to trace:** What is the exact error message? Is it caught by the `err instanceof SyntaxError` branch or the generic `else` branch? What does the partial JSON look like if you add `console.log(raw)` before `JSON.parse(raw)`? What does this tell you about where in the JSON the model was cut off?

After observing, restore `max_tokens: 800` and verify Test 3 passes again.

<details>
<summary>Hint</summary>

The error will be a `SyntaxError` because `JSON.parse` is what throws when the string is cut off. Add `console.log("RAW:", raw)` before `JSON.parse(raw)` to see the truncated output. You should see something like `{"full_name": "Ja` — wherever the model's output was cut by the token limit. This is the first-run failure you read about in the docs, reproduced deliberately.
</details>

---

### Challenge 2 — Add Test 5: matching prompt (20–30 min)

The project's `agent/` folder will eventually contain a `matcher.ts` that scores a job against a user's profile. Add a fifth test to `scripts/test-ai.ts` that verifies a matching system prompt works.

Write a system prompt that instructs the model to return JSON with this shape:

```typescript
{
  match_score: number,       // 0-100
  match_reason: string,
  matched_skills: string[],
  missing_skills: string[]
}
```

Use synthetic job and profile input. Assert that `match_score` is a number between 0 and 100, `match_reason` is a non-empty string, and both skill arrays exist. Wire it into `run()` after Test 4.

<details>
<summary>Hint</summary>

Follow the same pattern as `testExtractionPrompt` and `testGenerationPrompt`. Define the system prompt as a `const SYSTEM = ...` string at the top of the function. Use `max_tokens: 300` (the production value from `context/library-docs.md` for job matching). Temperature should be `0.3` — this is a classification/scoring task, not creative prose. The assertion for `match_score` should check `typeof parsed.match_score === "number" && parsed.match_score >= 0 && parsed.match_score <= 100`.
</details>

---

### Challenge 3 — Remove `response_format` and observe (30–45 min)

In `testJsonMode()`, remove `response_format: { type: "json_object" }` from the `openai.chat.completions.create` call. Run the script.

**What to predict before running:** Will the test pass or fail? If it fails, which branch of the catch block will handle the error — `instanceof SyntaxError` or the generic `else`? What will the raw response content look like before `JSON.parse`?

After observing the result:

1. Was your prediction correct?
2. The model's system prompt says `'Return ONLY valid JSON. Schema: { "status": string, "value": number }'`. Without the `response_format` constraint, does the model still return JSON? Does it always? What does this tell you about the relationship between prompt instructions and formal JSON mode?
3. What would happen in the production agents if `response_format` were accidentally removed from a call in `agent/extractor.ts`?

<details>
<summary>Hint</summary>

Models differ. Nemotron may return valid JSON even without the constraint because the prompt instructs it to — or it may return prose that wraps the JSON in markdown code fences (` ```json ... ``` `). `JSON.parse` would throw on the prose/fences version because `JSON.parse` does not strip markdown. The `instanceof SyntaxError` branch would catch it. In production, if `response_format` were removed from `extractor.ts`, the agent would throw on `JSON.parse`, the API route would return a 500, and the UI would show an error. The bug would be silent to TypeScript (it's just a missing field in a request object) but loud at runtime.
</details>

---

For deeper exploration, `docs/tests/01-ai-model-smoke-test/ai-discussion-topics.md` has 21 prompts covering smoke test philosophy, testing AI calls specifically, the `response_format` problem, configuration discipline, and when to extend a smoke test into a broader test suite. Feed them to an LLM *after* forming your own answer first — the gap between what you thought and what you learn is where understanding lands.
