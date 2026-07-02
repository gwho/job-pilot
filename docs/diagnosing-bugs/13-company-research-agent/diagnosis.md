# Diagnosis — Feature 13 Company Research Agent: "Failed to research company"

## What broke

Clicking "Research Company" on the job details page showed the generic error state: "Failed to research company." No dossier was produced. The error appeared immediately for every job, every time.

## Which failure mode

**Targeted bug** — two independent silent failures that compounded. Neither failure produced a visible error in the browser; both were swallowed by catch blocks that logged to the server and continued execution. The generic error only appeared when the fallback path itself threw.

The pattern: Feature 13 has intentional error isolation — browser research failures are caught and synthesis runs from whatever data is available. The bug was that both the browser phase AND the synthesis phase failed, making the "never empty" invariant false in practice even though it looked correct in the code.

---

## Failure 1 — Stagehand model provider error (silent, always)

### What was happening

Inside `conductBrowserResearch()`, the first call to `stagehand.extract()` was throwing `UnsupportedAISDKModelProviderError`. This error was caught by the `try/catch` inside `conductBrowserResearch()` itself, logged to `agent_logs`, and the function returned the empty `content` default. Browser research always silently failed for every research request.

### How it was diagnosed

The model name in `lib/stagehand.ts` was:

```typescript
modelName: "nvidia/nemotron-3-ultra-550b-a55b:free",
```

Reading Stagehand's `LLMProvider.getClient()` in `node_modules/@browserbasehq/stagehand/dist/esm/lib/v3/llm/LLMProvider.js` revealed the parsing logic: the first `/` in `modelName` separates `subProvider` from `subModelName`. With the value above:

- `subProvider = "nvidia"`
- `subModelName = "nemotron-3-ultra-550b-a55b:free"`

`"nvidia"` is not in Stagehand's supported provider list (`openai`, `anthropic`, `google`, etc.) — it throws `UnsupportedAISDKModelProviderError` before any browser navigation occurs. Because this throw happened inside a `try/catch` inside `conductBrowserResearch()`, it was caught silently. The outer `researchCompany()` function received the empty `content` default and proceeded to synthesis.

### The misleading aspect

The error never appeared in any route-level error log because it was caught at the agent function level. Server logs showed `[agent/research] Homepage extraction failed: UnsupportedAISDKModelProviderError...` in `agent_logs`, but there was no indication in the API response that browser research had failed — the route continued normally.

---

## Failure 2 — Nemotron JSON truncation (always, because browser research always failed)

### What was happening

`synthesizeDossier()` always ran (by design). But with no browser data, the synthesis prompt sent to Nemotron included `"No browser research available — synthesize from job posting and candidate profile only."` The response was expected to be a 9-field JSON object. With `max_tokens: 800`, the JSON was being truncated mid-field. `JSON.parse()` received an incomplete string and threw `SyntaxError: Unexpected end of JSON input`.

### How it was diagnosed

Unlike browser research failures (which are inside `conductBrowserResearch()`'s own try/catch), `synthesizeDossier()` is called unconditionally — outside any try/catch in `researchCompany()`. A throw from `synthesizeDossier()` propagates directly to the API route's outer catch block, which logs `"[api/agent/research]"` + the error and returns the generic 500 response.

The `max_tokens: 800` value was too low for a response containing 9 fields, some with arrays of 3–8 items, plus string fields like `companyOverview`. The synthesis output for the profile-only path (no browser data) still includes all 9 fields because the schema is fixed — Nemotron must still produce `yourEdge`, `gapsToAddress`, `smartQuestions`, etc. from the job description alone. That output routinely exceeds 800 tokens.

### Why failure 1 caused failure 2

If browser research had worked, `synthesizeDossier()` would have received richer `content` data and shorter per-field output (since browser text fills the context). The profile-only synthesis path requires Nemotron to be more verbose to fill the same fields from less source material, making it more likely to hit the token cap.

---

## Diagnosis summary

| # | Failure | Location | Catch behaviour | Visibility |
|---|---------|----------|-----------------|------------|
| 1 | `UnsupportedAISDKModelProviderError` from Stagehand | `conductBrowserResearch()` try/catch | Caught, logged to `agent_logs`, execution continues | None in response |
| 2 | `SyntaxError: Unexpected end of JSON input` from truncated Nemotron output | `synthesizeDossier()` → uncaught in `researchCompany()` | Propagates to route catch → generic 500 | Generic "Failed to research company" in UI |

Both failures were present from the first deployment of Feature 13. Failure 1 was always silent. Failure 2 surfaced as the generic error because it was the only throw that reached the route's catch block.
