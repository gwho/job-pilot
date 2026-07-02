# AI Discussion Topics — Diagnosing Bugs: Feature 13 Company Research Agent

---

## Group 1: Silent failures and error architecture

1. Feature 13 intentionally catches browser research failures and continues to synthesis. This architecture meant the Stagehand model error was invisible until synthesis also failed. What is the trade-off between "browser failures are non-fatal" (user always gets a dossier) and "failures are harder to diagnose"? How would you design the system to keep the user experience while making failures more observable to developers?

2. The `conductBrowserResearch()` function has its own internal `try/catch`. If you removed it and let errors propagate to `researchCompany()`'s outer catch instead, what would change for the user experience? What would change for the developer's ability to diagnose problems?

3. The generic API error message `"Failed to research company"` is deliberately different from the server log message. Why is this separation important? What attack is it defending against? What does the server-side log add that the generic message cannot?

## Group 2: Third-party model name parsing

4. Stagehand's `LLMProvider.getClient()` splits `modelName` at the first `/` to identify the provider. This is an undocumented internal convention. What does this teach about the relationship between documentation and installed code? When should you read `node_modules` source before writing a call to a library?

5. The original `"nvidia/nemotron-3-ultra-550b-a55b:free"` model name produced `subProvider = "nvidia"`, which isn't supported. The fix `"openai/nvidia/nemotron-3-ultra-550b-a55b:free"` uses `"openai"` as the provider and sends the rest to OpenRouter. Why does this work — what does OpenRouter do with the model ID `"nvidia/nemotron-3-ultra-550b-a55b:free"` in the request body?

6. The error type was `UnsupportedAISDKModelProviderError`, which is a Stagehand-internal error. What would have happened if this error type was not exported by Stagehand (i.e., you could not import it to compare against)? How does the error handling change when you can only compare against `error.message` strings?

## Group 3: Token budgets and JSON truncation

7. `max_tokens: 800` was set for a 9-field JSON dossier. Walk through how you would estimate the correct token budget for a known JSON schema: what factors affect token count, and how would you set a value with 30% headroom without running the model first?

8. The original `?? "{}"` fallback in `JSON.parse(response.choices[0]?.message?.content ?? "{}")` parsed an empty object silently on truncation. The fix throws explicitly instead. Why is a silent fallback to `"{}"` more harmful than a thrown error in this specific case? When is a silent fallback the right choice?

9. The `response_format: { type: "json_object" }` parameter instructs the model to return valid JSON. Why does this not prevent truncation? What does `response_format` control, and what does `max_tokens` control — and how do they interact?

## Group 4: Compounding failures and diagnosis order

10. Both failures (Stagehand model error and JSON truncation) were present from Feature 13's first deployment. Neither produced an error during TypeScript build or any test. What categories of bugs pass all static checks but only fail at runtime? How do you design a test suite that catches "API key format" and "token budget" bugs?

11. The diagnosis revealed that Failure 1 (Stagehand) caused Failure 2 (truncation) to be the dominant visible symptom, even though it was the secondary failure. When debugging a compounding failure chain, what is the right order of investigation — from the user-visible error backward, or from the entry point forward? What are the trade-offs of each approach?

12. The `agent_logs` table in InsForge stores error messages from agent operations. How would you use `agent_logs` as the first investigation tool when a user reports "Research Company fails"? What SQL query would you run, and what would you look for in the results?
