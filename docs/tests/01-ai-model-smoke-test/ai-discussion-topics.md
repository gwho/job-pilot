# Discussion Topics — AI Model Smoke Testing

## Group 1: What smoke tests are and why they exist

1. The term "smoke test" comes from electronics. What does that analogy tell you about what a smoke test is supposed to catch — and what it is NOT supposed to catch? Where does a smoke test stop and an integration test begin?

2. This project has no test runner configured. The smoke test is a standalone script run with `npx tsx`. What are the tradeoffs of a script vs a test runner like Vitest or Jest? In which situations would a test runner be worth adding to a project like this?

3. The four tests run sequentially, not in parallel. Why does the order matter? If Test 2 (JSON mode) fails, is there any point in running Tests 3 and 4?

4. The smoke test script exits with `process.exit(1)` if any test fails. Why does the exit code matter for a test script? What happens if a failing test suite exits with code 0?

---

## Group 2: Testing AI calls specifically

5. AI calls are non-deterministic — the model can return different outputs for the same input. How does the test handle this? What does the test actually assert, and what does it leave unasserted?

6. Test 2 uses a trivially simple schema (`{ "status": string, "value": number }`) rather than the full extraction schema. Why is a simpler schema better for the JSON mode test? What specific failure would a complex schema hide?

7. Tests 3 and 4 use synthetic input data (a made-up resume, a made-up profile) rather than real data from the database. What are the advantages of synthetic data in a smoke test? What class of failures would synthetic data miss that real data would catch?

8. The test does not assert the exact content of the model's response — only its shape. For example, Test 3 checks that `full_name` is a string but does not check that it equals exactly `"Jane Smith"`. Why is shape-testing the right level of assertion for AI output?

9. The test for extraction (Test 3) checks that `checks.length > 0` — at least one of name, level, or skills was extracted. What would it mean if the model returned a valid JSON object but extracted nothing? Is that a different failure from Test 2 failing?

---

## Group 3: Configuration discipline

10. The first run of Test 3 failed with `Unterminated string in JSON` because `max_tokens: 200` was too low. This is a test configuration error, not a model error. What is the principle here? What would happen in a larger codebase if test configurations routinely diverged from production configurations?

11. The test client is constructed with the same `defaultHeaders` as the production client. What would the risk be if the test used a client without the headers, passed all four tests, and the app was shipped — and the headers turned out to cause a routing issue in production?

12. `context/library-docs.md` documents the production values for `max_tokens` and `temperature` per use case. What is the relationship between that document and this test script? If you changed `max_tokens` for extraction from 800 to 1200 in `library-docs.md`, what else should you update?

---

## Group 4: The `response_format: json_object` problem

13. `response_format: { type: "json_object" }` is the most model-specific setting in the codebase. It constrains the model to return valid JSON. But what does it NOT guarantee? Give two examples of a response that would satisfy `json_object` mode but still break the agent code.

14. When the JSON mode test fails with a `SyntaxError`, the error handler prints a specific message: "Response was not valid JSON — json_object mode may not be supported." Why is it useful to distinguish a `SyntaxError` from a generic error in this context?

15. OpenRouter is a proxy in front of many model providers. Is it OpenRouter or the underlying model that enforces `json_object` mode? What does that mean for how reliable JSON mode is across different models on the same OpenRouter endpoint?

---

## Group 5: Environment and infrastructure

16. The script uses `--env-file=.env.local` (Node 20+ built-in) instead of the `dotenv` package. What is the difference between the two approaches? Under what circumstances would the `dotenv` package be the better choice?

17. The script has a guard that aborts before any API call if `OPENROUTER_API_KEY` is not set:
    ```typescript
    if (!process.env.OPENROUTER_API_KEY) { process.exit(1); }
    ```
    Without this guard, what error message would you see when the API call runs? Why is the guard's error message more useful than OpenRouter's authentication error?

18. The test comment at the top says: "Run: `npx tsx --env-file=.env.local scripts/test-ai.ts`." Why is the run command documented in the file itself, rather than only in a README? What happens to knowledge that only lives in someone's head or in a chat window?

---

## Group 6: When to test and when to extend

19. The smoke test does not cover InsForge auth, PDF rendering, or the API routes. A developer suggests: "Why not just add those to the test script? Then we'd have full coverage." What is the argument against this? What is the tradeoff between coverage and speed/simplicity in a smoke test?

20. The explanation lists conditions under which the test should be re-run (key rotation, model change, header changes). Why is a list like this worth maintaining? What would happen over time if the team ran the test only when something broke?

21. Imagine the smoke test passes 4/4 but the "Extract from Resume" button in the app still fails. List three possible root causes that the smoke test would not catch. What kind of test would catch each one?
