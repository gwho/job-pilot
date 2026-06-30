# AI Discussion Topics — Diagnosing Bugs

## Repro Design

1. Why did the stale-row test need to assert old rows disappeared, not just that new rows appeared?
2. Why is a live actor run a better feedback loop for JobsDB relevance than a mocked API response?
3. How would you make the actor relevance check stricter without making it too brittle?

## Boundaries

4. Which layer owns dedupe for database insertion, and which layer owns what rows are displayed?
5. Why is it useful for the actor URL helper to be testable outside `main.ts`?
6. What signal would tell you that the issue had moved from the UI layer to the actor layer?

## Scraper Semantics

7. Why can a scraper be structurally healthy but semantically wrong?
8. What is the difference between "page has job cards" and "page has job cards for this query"?
9. What metadata should a scraper emit to make semantic debugging easier?

## Regression Testing

10. Which parts of this bug can be covered by unit tests?
11. Which parts require live integration tests?
12. How often should a live JobsDB canary run happen, and what should it assert?
