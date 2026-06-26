# Test Record — AI Model Smoke Test

## Context

The project's AI layer was switched from Google Gemini 2.5 Flash-Lite to NVIDIA Nemotron 3 Ultra (via OpenRouter). Before using the new model in the real app, a smoke test was written to verify the new configuration worked end-to-end in isolation.

**Trigger:** New model + new API key + new base URL = three things that could each fail independently. A smoke test catches any failure before it reaches the UI.

---

## What Was Tested

| Test | Prompt style | max_tokens | Expected |
|---|---|---|---|
| 1 — Connectivity | Plain text, no special mode | 20 | Model responds at all |
| 2 — JSON mode | `response_format: json_object`, simple schema | 100 | Response parses as valid JSON |
| 3 — Extraction prompt | Production system prompt from `agent/extractor.ts` | 800 | Named fields extracted correctly |
| 4 — Generation prompt | Production system prompt from `agent/pdf-generator.tsx` | 400 | `summary` + `workExperience[].bullets` present |

---

## Test Script

**File:** `scripts/test-ai.ts`
**Run command:** `npx tsx --env-file=.env.local scripts/test-ai.ts`

The script initialises the same `OpenAI` client that `agent/` uses, including `defaultHeaders`, then runs four async tests sequentially. Each test prints `✓` or `✗` with a detail line and exits with code `1` if any test failed.

---

## Run Results

### First run — 3/4 passed

```
Test 1 — Connectivity                          ✓
Test 2 — JSON mode                             ✓
Test 3 — Extraction prompt                     ✗  Unterminated string in JSON at position 36
Test 4 — Generation prompt                     ✓
Results: 3 passed  1 failed
```

**Root cause of Test 3 failure:** `max_tokens: 200` was too low. The model started generating the JSON response but the output was cut off mid-string because the token budget ran out. The real `agent/extractor.ts` uses `max_tokens: 800`. The test was using a lower value to keep it "quick" — but the test prompt was close enough to the real prompt that the output size was similar.

**Fix:** Changed `max_tokens` in Test 3 from `200` to `800` to match the production setting.

### Second run — 4/4 passed

```
Test 1 — Connectivity                          ✓  Response: "hello"
Test 2 — JSON mode                             ✓  Parsed: {"status":"ok","value":1}
Test 3 — Extraction prompt                     ✓  name="Jane Smith", level="senior", skills=[React, TypeScript, Next.js…]
Test 4 — Generation prompt                     ✓  summary="Senior Frontend Engineer with expertise…", bullets=2
Results: 4 passed  0 failed
```

---

## What the Tests Confirmed

- OpenRouter is reachable with the `OPENROUTER_API_KEY`
- The model ID `nvidia/nemotron-3-ultra-550b-a55b:free` is valid and responding
- `response_format: { type: "json_object" }` is supported by this model via OpenRouter
- The extraction system prompt produces a correctly-shaped typed JSON response
- The generation system prompt produces `summary` + `workExperience[].bullets` as required by the PDF template

---

## Configuration Verified

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

---

## Files Changed During This Session

| File | Change |
|---|---|
| `agent/extractor.ts` | `GOOGLE_API_KEY` → `OPENROUTER_API_KEY`, Google base URL → OpenRouter, model string, added `defaultHeaders` |
| `agent/pdf-generator.tsx` | Same changes; unused `import React` removed |
| `CLAUDE.md` | Stack table, data flows, invariants, env vars updated |
| `context/architecture.md` | Stack table, agent file descriptions, data flow diagrams, Stagehand example, invariant updated |
| `context/library-docs.md` | "Google Gemini" section rewritten as "NVIDIA Nemotron 3 Ultra"; Stagehand model config updated; Adzuna rules note updated |
| `context/code-standards.md` | `GOOGLE_API_KEY` → `OPENROUTER_API_KEY` in env vars table; openai package description updated |
| `context/project-overview.md` | All Gemini → Nemotron |
| `context/build-plan.md` | All Gemini → Nemotron |
| `context/progress-tracker.md` | All Gemini → Nemotron |
| `memory.md` | All Gemini → Nemotron |
| `docs/plan/08-resume-pdf-generation/plan.md` | Gemini → Nemotron |
| `docs/plan/08-resume-pdf-generation/explanation.md` | Gemini → Nemotron |
| `scripts/test-ai.ts` | Created |
