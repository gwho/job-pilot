# AI Discussion Topics — Project Review: Feature 13 Company Research Agent

---

## Group 1 — PostHog event contract

1. `code-standards.md` defines `company_researched` as requiring `{ userId, jobId, company }`. Why is this contract defined at the standards level rather than enforced by TypeScript types? What would a TypeScript enforcement look like?

2. The review found that `company` was missing from the PostHog event. Why can't the route simply accept `company` in the client body alongside `jobId`? What is the security risk of accepting event properties from the client?

3. The fix changed `researchCompany()` to return `{ dossier, company }` instead of just the dossier. What is the alternative — making a second DB query in the route for the company name? Why is the return-type change better?

4. If PostHog's schema changes and `company_researched` needs an additional required property (say `industry`), how do you audit the codebase to find all the places that need to be updated?

---

## Group 2 — Analytics isolation and non-fatal side effects

5. Explain what "analytics failure should not return a 500 to a client that received a successful result" means from a user's perspective. What exactly would the user see if PostHog threw while inside the main try block?

6. The rule is: a side effect's failure must not change the HTTP status returned to the client. How do you decide what is a "side effect" vs. part of the "core operation"? Is saving the dossier to the DB a side effect?

7. After isolating PostHog in its own try/catch, a PostHog failure logs a `console.error`. What additional observability would be useful here? How would you know in production that PostHog has been consistently failing?

8. Apply the analytics isolation pattern to a different scenario: a route that sends a welcome email after creating a new account. Should the email send be inside the main try block or isolated? What happens if the account is created but the email fails?

---

## Group 3 — Context file drift

9. The review found that both `context/architecture.md` and `context/library-docs.md` still showed the broken `"nvidia/..."` model name after the diagnosing-bugs fix. Why might an agent fix the code but not the context files? What process would prevent this?

10. How does a stale value in a context file create a regression loop? Describe the sequence: bug fixed in code → context file not updated → new agent session reads context → new code written with stale value.

11. The corrupt editorial note in `library-docs.md` promoted the wrong `stagehand.extract()` API shape (`extract({ instruction, schema })` instead of `extract(instruction, schema)`). What would happen if a future agent session read this file and generated new extraction code from it?

12. Why is the max_tokens value documented in a context file rather than left as a comment in the code? What is the argument for and against centralising these values in `library-docs.md`?

---

## Group 4 — URL rendering and security

13. The source URL guard is `src.startsWith("http://") || src.startsWith("https://")`. Why not use `new URL(src)` and check `url.protocol`? What is the advantage of the prefix check?

14. `rel="noopener noreferrer"` is required for all `target="_blank"` links. Explain each attribute: what does `noopener` prevent, what does `noreferrer` prevent, and why do you need both?

15. The dossier's `sources` array comes from a Nemotron synthesis call. Is it possible for a malicious user to inject an arbitrary URL into this array? What is the threat model for a URL that comes from an AI-synthesized DB column?
