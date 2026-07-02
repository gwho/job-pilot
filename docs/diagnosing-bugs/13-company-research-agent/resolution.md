# Resolution — Feature 13 Company Research Agent: "Failed to research company"

## Fix 1 — Stagehand model name prefix

**File:** `lib/stagehand.ts`

**Change:**

```typescript
// Before
modelName: "nvidia/nemotron-3-ultra-550b-a55b:free",

// After
// "openai/" prefix tells Stagehand to use its OpenAI provider; the rest is the
// OpenRouter model ID sent as the model param to https://openrouter.ai/api/v1
modelName: "openai/nvidia/nemotron-3-ultra-550b-a55b:free",
```

**Why it works:** Stagehand splits the model name at the first `/` to identify the sub-provider. `"openai/nvidia/nemotron-3-ultra-550b-a55b:free"` produces `subProvider = "openai"` and `subModelName = "nvidia/nemotron-3-ultra-550b-a55b:free"`. Stagehand creates an OpenAI-compatible client with `baseURL = "https://openrouter.ai/api/v1"` and sends `"nvidia/nemotron-3-ultra-550b-a55b:free"` as the model name in the API body. OpenRouter accepts that ID and routes it to Nemotron.

**What was not changed:** The `apiKey` and `baseURL` in the `model` config were already correct — `OPENROUTER_API_KEY` and `"https://openrouter.ai/api/v1"`. Only the prefix on `modelName` was wrong.

---

## Fix 2 — Nemotron token cap and null guard

**File:** `agent/research.ts` (`synthesizeDossier`)

**Change 1 — Increase max_tokens:**

```typescript
// Before
max_tokens: 800,

// After
max_tokens: 2000,
```

**Why 2000:** The dossier schema has 9 fields. `yourEdge`, `gapsToAddress`, `smartQuestions`, and `interviewPrep` are all arrays of 3–8 items. `companyOverview` and `whyThisRole` are multi-sentence strings. A realistic response body is 600–1200 tokens depending on array lengths. 800 was too tight even for the minimum-viable output. 2000 gives 1.5–2x headroom without approaching model context limits.

**Change 2 — Null guard before JSON.parse:**

```typescript
// Before
const raw = JSON.parse(response.choices[0]?.message?.content ?? "{}") as Record<string, unknown>;

// After
const rawContent = response.choices[0]?.message?.content;
if (!rawContent) {
  throw new Error("Nemotron returned empty content — model may be unavailable or rate-limited");
}
const raw = JSON.parse(rawContent) as Record<string, unknown>;
```

**Why the explicit null guard:** The original `?? "{}"` fallback was silent — it parsed an empty object and returned a dossier with all fields set to `""` or `[]`. That looks like a dossier to the DB and the UI but contains nothing useful. The explicit throw with a descriptive message surfaces the failure mode in the route's error log where it belongs: if Nemotron returns empty, that signals an API key issue, quota exhaustion, or model unavailability — not a condition to swallow.

---

## What was not changed

**Architecture:** The function structure — browser research isolated, synthesis unconditional — was correct and was not changed. The bug was entirely in the configuration of external calls (model name format, token limit), not in the error handling architecture.

**Error message to client:** The generic `"Failed to research company"` remains the API response. The fix ensures synthesis succeeds so the route returns `success: true` with a dossier, not `success: false` with the generic error. The message content exists to protect against future synthesis failures — it should stay.

**Catch blocks:** The silent catch in `conductBrowserResearch()` is intentional. Browser failures should not fail the feature. What changed is that browser failures no longer always happen (Fix 1), so synthesis now receives actual content rather than always running from the empty default.

---

## Lessons for future debugging in this codebase

### Lesson 1 — Silent catch blocks mask upstream failures

Feature 13's error architecture is correct (browser failures non-fatal, synthesis always runs), but silent catches make it harder to observe what the system is actually doing. The primary signal is `agent_logs` — check `agent_logs` for the relevant `job_id` and `user_id` before reading code. The log message format is `[agent/research] <location>: <error>`.

### Lesson 2 — Third-party model name formats are undocumented traps

Stagehand's model name parsing logic (`subProvider / subModelName`) is not prominently documented. The only reliable way to discover it is reading `LLMProvider.getClient()` in `node_modules/@browserbasehq/stagehand/dist/esm/lib/v3/llm/LLMProvider.js`. Any future model switch for Stagehand must trace this function first.

The generalised rule for this project: before writing any call to a third-party SDK, read the relevant `.d.ts` and `.js` in `node_modules`. Training data is stale; installed versions are authoritative.

### Lesson 3 — max_tokens needs to match the schema, not intuition

When using `response_format: { type: "json_object" }`, the token budget must cover the full JSON structure, not just the "main content." Arrays of items, string formatting, and JSON overhead all consume tokens. For the Feature 13 9-field dossier, 800 tokens was insufficient. The correct approach: estimate worst-case output for the largest expected arrays, add 30% headroom, and set that as the limit.

### Lesson 4 — Compounding silent failures produce misleading error messages

When multiple failures compound (browser research always fails → synthesis runs from empty content → synthesis truncates → JSON.parse throws), the error visible to the user reflects only the last failure. Diagnosing from the user-visible error alone is insufficient — trace the full execution path to find the first failure. The order of investigation should be:

1. Check `agent_logs` for the job/user
2. Trace from the route inward through each function's try/catch
3. Identify the earliest failure in the chain

The last throw is rarely the root cause.
