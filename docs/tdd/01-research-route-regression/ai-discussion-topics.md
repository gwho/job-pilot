# AI Discussion Topics — TDD Session: Research Route Regression Tests

---

## Group 1 — Behavior vs. implementation tests

1. The test calls `POST(makeRequest({ jobId: "job-1" }))` instead of calling `researchCompany()` or `captureServerEvent()` directly. What would break if someone replaced `researchCompany()` with a different internal implementation that returned the same shape? Would the behavior tests break? Would implementation tests break?

2. The test does not assert that `researchCompany()` was called exactly once, or that it was called before `captureServerEvent()`. Why not? Under what circumstance would asserting call order be appropriate?

3. What is the "refactor safety" test of a test suite? How do you verify that your tests are testing behavior rather than implementation?

---

## Group 2 — vi.mock() and module mocking mechanics

4. Explain Vitest's `vi.mock()` hoisting. If `vi.mock()` is written after an `import` statement in the source file, does the mock still apply to that import? Why?

5. What is the difference between `vi.mock("path")` (auto-mock) and `vi.mock("path", () => ({ ... }))` (factory mock)? When would auto-mocking silently produce incorrect behavior?

6. If `vi.mock("@/agent/research")` is added to a test file but `researchCompany` is never imported or used in that file, what happens to the real `researchCompany` when `POST` calls it internally?

7. Explain what happens when `vi.resetAllMocks()` is NOT called between tests. Write a concrete scenario where the PostHog isolation test would produce a false positive without reset.

---

## Group 3 — Type safety and test mocks

8. The stub for `createInsforgeServer` uses `as never` to bypass TypeScript's type check. Why does `as never` work here when `as any` might not? What does TypeScript's `never` type mean, and why is every type assignable from it?

9. The mock only stubs `auth.getCurrentUser` — it doesn't stub `insforge.database`, `insforge.storage`, etc. Why doesn't TypeScript complain that the stub is missing those methods? What runtime error would occur if the route tried to call `insforge.database.from(...)` on this stub?

10. `makeRequest` uses `as unknown as NextRequest` (double cast) rather than `as NextRequest`. Why is the double cast necessary? What TypeScript rule prevents the single cast?

---

## Group 4 — Assertion patterns

11. `expect.objectContaining({ company: "Stripe" })` vs. exact object matching — which is correct for this test and why? What specific regression would each miss?

12. The null-company test (`company: null` → `company: ""`) tests one branch of `company ?? ""`. What other test would you add if the code changed to `company?.trim() ?? ""`? What would be the minimum set of branches to cover?

13. The test asserts `res.status` is `200`. Why is checking the HTTP status necessary in addition to checking `body.success`? What is a scenario where `body.success` is `true` but `res.status` is not `200`?

---

## Group 5 — Test design trade-offs

14. The session wrote 3 tests for 2 behaviors. The `project-review` skill found 8 issues that were then fixed. Should those 8 fixes each have a dedicated test? How do you decide which project-review findings warrant regression tests?

15. The tests went GREEN immediately — the behavior was already implemented correctly. What is the value of writing tests that start green? How does it differ from writing failing tests first?
