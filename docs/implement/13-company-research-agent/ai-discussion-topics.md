# AI Discussion Topics — Implement Session: Feature 13 Project-Review Fixes

---

## Group 1 — Return type design

1. `researchCompany()` was changed to return `{ dossier, company }` instead of just `dossier`. What TypeScript feature allows a function to return a named tuple or object with a mix of types? How would the caller's code change if the return were a positional tuple `[dossier, company]` instead?

2. Why is the return-type change preferable to a second DB query in the route for the `company` field? What is the performance argument? What is the coupling argument?

3. If `researchCompany()` needs to return more data in the future (e.g., the job's `title` or `source_url`), how would you extend the return type? Is there a point at which returning many fields suggests a different design (e.g., returning the full job row)?

---

## Group 2 — Failure isolation patterns

4. The PostHog call was moved outside the main try block. What exactly does "outside the main try block" mean structurally in the route? Draw the control flow of the fixed route: where does each throw land, and what does the client receive in each case?

5. Apply the isolation principle to this scenario: after saving a new job application, a route should notify a Slack webhook. The webhook is flaky. Write the correct structure using the isolation pattern.

6. The PostHog catch block logs a `console.error` but does not return early or change the response. If PostHog starts failing 100% of the time, how would you know? What would you add to the catch block to make this failure observable in production?

7. Is there any case where a PostHog failure SHOULD cause a request to fail? Describe a scenario where analytics capture is part of the core operation, not just a side effect.

---

## Group 3 — Context file maintenance

8. After the project-review fix, both `architecture.md` and `library-docs.md` showed the correct `"openai/nvidia/..."` model name. What is the minimum process that would have prevented these files from drifting during the diagnosing-bugs session?

9. The corrupt editorial note in `library-docs.md` showed the old `extract({ instruction, schema })` object form. What exactly would happen at runtime if a future agent wrote extraction code using this form? Would TypeScript catch the error? Would the tests catch it?

10. Context files (`architecture.md`, `library-docs.md`, `code-standards.md`) are maintained by hand. What are the trade-offs of generating these files automatically from the code vs. maintaining them by hand? When does each approach break down?

---

## Group 4 — Token budgets and JSON synthesis

11. The max_tokens estimate for the 9-field dossier schema is approximately 1000–1400 tokens at worst case. Walk through the estimation: how many tokens does a typical `smartQuestions` array of 6 items consume? What does "30% headroom" protect against?

12. The original code used `?? "{}"` as a fallback for empty Nemotron content, which produced a dossier with all fields set to `""` or `[]`. Why is this a silent failure rather than an obvious error? What would the user have seen?

13. The explicit null guard before `JSON.parse`:
    ```typescript
    const rawContent = response.choices[0]?.message?.content;
    if (!rawContent) throw new Error("Nemotron returned empty content — ...");
    ```
    When would Nemotron return empty content? Name two real scenarios.
