# Principles — TDD Session: Research Route Regression Tests

---

## 1. Behavior tests vs. implementation tests

The TDD skill's core principle: test through public interfaces, not internal structure. For `app/api/agent/research/route.ts`, the public interface is the `POST` function. The test calls `POST(makeRequest({ jobId: "job-1" }))` and asserts on the returned `Response` object.

What was not tested:
- Whether `researchCompany()` internally calls `synthesizeDossier()`
- Whether `createInsforgeServer()` is called before or after body validation
- Whether `captureServerEvent()` receives a `PostHog` instance or calls `.shutdown()`

These are implementation details. If the route is refactored to achieve the same behavior differently, the tests should still pass. Tests that break on rename or structural refactor are testing the wrong things.

The diagnostic: "Would this test break if I renamed an internal function but kept the observable behavior?" If yes — wrong test.

---

## 2. Why vi.mock() hoisting matters for import order

Vitest hoists `vi.mock()` calls to the top of the file before any `import` statements execute. This means:

```typescript
vi.mock("@/agent/research", () => ({ researchCompany: vi.fn() }));

import { POST } from "@/app/api/agent/research/route";
import { researchCompany } from "@/agent/research";
```

Even though `vi.mock()` appears before `import POST`, and `POST` imports `researchCompany` at module load time, the mock is registered before either import resolves. When `app/api/agent/research/route.ts` is evaluated, it imports `@/agent/research` and gets the mock — not the real module.

This is why the factory function approach (`vi.mock("path", () => ({ ... }))`) is preferred over auto-mocking. Auto-mocking (`vi.mock("path")` with no factory) is non-deterministic — it inspects the real module at analysis time and creates `vi.fn()` for each export. The factory approach is explicit about which exports exist and what they return.

---

## 3. The mock type problem and `as never`

`createInsforgeServer()` returns a full InsForge client — a complex type with dozens of methods across `auth`, `database`, `storage`, etc. Constructing a complete type-safe stub in a test is impractical.

The test uses `as never`:
```typescript
vi.mocked(createInsforgeServer).mockResolvedValue({
  auth: {
    getCurrentUser: vi.fn().mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    }),
  },
} as never);
```

`as never` is a TypeScript escape: `never` is assignable to all types, so it bypasses the type mismatch between the partial stub and the full InsForge client type. This is appropriate in test files because:
1. The stub only needs to satisfy the methods the route actually calls
2. The route only uses `insforge.auth.getCurrentUser()` — the rest of the client is irrelevant
3. TypeScript errors on the test mock don't indicate a production bug

`as never` in production code is a red flag. In tests, it is a pragmatic escape for complex third-party types that are not designed to be easily stubbed.

---

## 4. `vi.resetAllMocks()` and the isolation guarantee

`beforeEach(() => { vi.resetAllMocks(); ... })` runs before every test. It:
- Resets all mocked function call counts to zero
- Resets all `.mockReturnValue()` / `.mockResolvedValue()` setups
- Does NOT restore the original implementation (that is `vi.restoreAllMocks()`)

Without `vi.resetAllMocks()`:
- A test that calls `vi.mocked(captureServerEvent).mockRejectedValue(...)` would leave that rejection in place for subsequent tests
- A test that checks `captureServerEvent` was called N times would see the cumulative count from all previous tests

The `beforeEach` pattern also re-establishes default mock values after the reset, so every test starts from the same known state. The per-test overrides (e.g., `vi.mocked(captureServerEvent).mockRejectedValue(...)` for the isolation test) only apply for that one test.

---

## 5. `expect.objectContaining()` for partial event property matching

The PostHog event test:
```typescript
expect(captureServerEvent).toHaveBeenCalledWith(
  expect.objectContaining({
    event: "company_researched",
    properties: expect.objectContaining({
      company: "Stripe",
    }),
  }),
);
```

`expect.objectContaining(subset)` matches any object that includes the specified keys with the specified values, regardless of other keys. This is the correct matcher here because:
- The test cares that `company: "Stripe"` is present — this is the behavior being locked
- The test does not care about `userId` or `jobId` — those are not the behavior under test
- Using exact matching (`toHaveBeenCalledWith({ distinctId: "user-1", event: "...", properties: { userId: "user-1", jobId: "job-1", company: "Stripe" } })`) would make the test brittle: if `userId` or `jobId` format changes, this test breaks even though the `company` behavior is unchanged

The nested `expect.objectContaining()` on `properties` is needed because `properties` is itself an object. Without it, `toHaveBeenCalledWith(expect.objectContaining({ properties: { company: "Stripe" } }))` would do an exact match on `properties` — failing because the actual `properties` object also has `userId` and `jobId`.

---

## 6. Testing the `?? ""` fallback: why three tests for two behaviors

The session produced three tests for two stated behaviors. The third test — `"uses empty string when researchCompany returns null company"` — tests a branch within the second behavior.

The route code:
```typescript
properties: { userId, jobId, company: company ?? "" },
```

This has two paths:
- `company` is a non-null string → `company` passed as-is
- `company` is `null` → `""` passed

The first test confirmed the non-null path. The third test confirms the null path. Both are needed because the `?? ""` operator is a runtime branch: if someone removes it and passes `company: company` directly, the null-company test catches it. If someone adds `company: company?.toUpperCase() ?? ""` (transforming the value), both tests catch it.

Testing both branches of a nullish coalescing expression is the right amount of coverage for a behavior that has a defined specification (`""` for null company).

---

## 7. makeRequest: constructing NextRequest from Request

`NextRequest` extends the web platform `Request`. The route handler calls only `req.json()` — a method inherited from `Request`. So a standard `Request` object cast to `NextRequest` satisfies all the route's needs:

```typescript
function makeRequest(body: Record<string, unknown>): NextRequest {
  return new Request("http://localhost/api/agent/research", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}
```

`as unknown as NextRequest` is a double cast — necessary because TypeScript won't allow `Request` → `NextRequest` directly (the types are compatible at runtime but diverge at the type level due to Next.js-specific properties). The route never accesses those Next.js-specific properties (`req.cookies`, `req.geo`, `req.ip`, etc.), so the cast is safe for this test scope.

If a future test needs to test request headers or cookies, this helper would need to be replaced with `new NextRequest(...)` from `next/server`.
