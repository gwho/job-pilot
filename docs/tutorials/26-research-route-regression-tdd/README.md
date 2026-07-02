# Tutorial 26 — API Route Regression Tests: Module Mocking, Behavior Contracts, and Assertion Patterns

**After completing this tutorial you will understand:** why tests must exercise behavior through public interfaces rather than internal function calls; how Vitest's `vi.mock()` hoisting works and why module load order doesn't matter; when to use factory mocks vs. auto-mocks; why `expect.objectContaining()` produces more durable assertions than exact object matching; and how to safely construct a `NextRequest` for testing without a running Next.js server.

---

> [!NOTE]
> **Prerequisites:** Tutorial 25 (`../25-company-research-agent-review-fixes/README.md`) — covers the PostHog isolation fix and the company return-type change that this tutorial's tests lock in. Tutorial 24 (`../24-company-research-agent/README.md`) — covers the full route and agent architecture. Open [`__tests__/api/agent/research.test.ts`](../../../__tests__/api/agent/research.test.ts) and [`app/api/agent/research/route.ts`](../../../app/api/agent/research/route.ts) alongside this tutorial.

---

## CS & language concepts in this tutorial

| Concept | Where it appears | Category |
|---------|-----------------|----------|
| Test doubles — mock vs. spy vs. stub | `vi.mock()` factories + `vi.mocked()` call assertions | Design patterns |
| Module hoisting | `vi.mock()` evaluated before `import` statements | OS fundamentals |
| Type-level `never` | `as never` escape for complex stub types | Type theory |
| Partial object matching | `expect.objectContaining()` nested inside `toHaveBeenCalledWith` | Algorithms |
| Branch coverage | Two tests for `company ?? ""` — non-null path and null path | Algorithms |

---

## How to use an LLM before this tutorial

Budget 20–25 minutes on these four concepts.

### Concept 1 — Test doubles: mock, stub, spy, fake

> "Explain the four types of test doubles: mock, stub, spy, and fake. Give a concrete example of each in the context of an API route that calls an external database and an analytics service. How do you decide which type to use for a given dependency? Quiz me: if I want to verify that a function was called with a specific argument, which double do I use? If I want a function to return a controlled value without caring whether it was called, which do I use?"

*What to listen for:* A **stub** returns a fixed value. A **mock** additionally records calls so you can assert on them. A **spy** wraps the real function and records calls. A **fake** is a simplified working implementation (an in-memory database, for example). For testing a route: the database is stubbed (return controlled data, don't care if it was called), the analytics call is mocked (return controlled data AND verify it was called with the right arguments), and you wouldn't use a fake for either unless building an integration test.

*Practice question:* In the research route tests, `captureServerEvent` is mocked. Is it also being used as a stub in the same test? Can one function serve as both?

---

### Concept 2 — How module systems and import caching work

> "Explain how Node.js module caching works: once a module is loaded, subsequent `require()` calls return the same instance. How does Vitest use this to implement `vi.mock()`? What does it mean to 'hoist' a function call to before imports? Why is it impossible to mock a module after the importing module has already been evaluated? Quiz me on what happens when module A imports module B, then a test mocks module B — does module A get the mock or the real module B?"

*What to listen for:* Node.js caches modules by filepath — each module is loaded once and the same object is returned on subsequent imports. Vitest intercepts the module registry: when `vi.mock("path")` is called, it replaces the real module in the registry with the mock before any code runs. "Hoisting" means the `vi.mock()` call is physically moved to before all `import` statements during Vitest's transpilation step. The result: when module A is evaluated and tries to import module B, the registry already has the mock installed.

*Practice question:* A test file has `vi.mock("./util")` at line 50 and `import { helper } from "./util"` at line 3. Which runs first at runtime — the mock registration or the import?

---

### Concept 3 — TypeScript's `never` type

> "Explain TypeScript's `never` type. What values does `never` represent? Why is `never` assignable to every other type? What does this mean in a type cast: `someValue as never`? When is this escape hatch appropriate vs. when is it a red flag? Give an example of a legitimate use in a test mock. Quiz me on what happens at runtime when you cast something to `never`."

*What to listen for:* `never` represents the empty type — a set of zero values. Logically, if a function promises to return something of every possible type, and `never` is empty (it satisfies vacuously). In TypeScript, `never` is at the bottom of the type hierarchy — it is assignable to `string`, `number`, `object`, anything. This makes `as never` a universal bypass for type checks. At runtime, `as never` is erased — it doesn't change the value. The bypass is legitimate in tests where you're constructing partial stubs of complex types; it is a red flag in production code where it usually means a wrong assumption about the data shape.

*Practice question:* A stub for `createInsforgeServer()` only has `.auth.getCurrentUser`. The real return type has 20 methods. Using `as never`, TypeScript accepts the stub. What happens at runtime if the route later calls `insforge.database.from(...)`?

---

### Concept 4 — Partial assertion matchers

> "Explain `expect.objectContaining(subset)` in Jest/Vitest. When you use it inside `toHaveBeenCalledWith()`, what exactly is being compared? What is the difference between asserting the exact argument vs. asserting a subset of the argument? Give a concrete example where exact matching would make a test brittle, and partial matching would not. Quiz me: a function is called with `{ a: 1, b: 2, c: 3 }`. Does `expect.objectContaining({ a: 1, c: 3 })` match? Does `expect.objectContaining({ a: 1, d: 4 })` match?"

*What to listen for:* `expect.objectContaining(subset)` passes if the actual argument includes all keys in `subset` with the specified values. Extra keys in the actual argument are ignored. Exact matching fails if any key in the actual argument differs from the expected object. The brittleness: if you use exact matching for a PostHog event, adding a new event property (say `sessionId`) breaks all tests that assert on that event, even though the property being tested (`company`) hasn't changed.

*Practice question:* `expect.objectContaining({ a: 1, d: 4 })` — does it match `{ a: 1, b: 2, c: 3 }`? Why not? Which key causes the failure?

---

## Architecture overview

```
Test file                           Real code under test
─────────────────────────────────   ────────────────────────────────────
__tests__/api/agent/research.test.ts
  │
  ├─ vi.mock("@/lib/insforge-server")   ← replaces auth layer
  ├─ vi.mock("@/agent/research")        ← replaces research agent
  ├─ vi.mock("@/lib/posthog-server")    ← replaces analytics
  │
  └─ import POST from route ────────► app/api/agent/research/route.ts
       │                                  │
       │                                  ├─ createInsforgeServer()  [MOCKED]
       │                                  ├─ researchCompany()       [MOCKED]
       │                                  ├─ captureServerEvent()    [MOCKED]
       │                                  └─ NextResponse.json(...)
       │
       └─ res = await POST(makeRequest({ jobId }))
            │
            └─ assert on: res.status, res.json(), captureServerEvent.calls
```

**Key invariant:** The test only interacts with `POST` and observes the `Response` it returns plus the recorded calls on the mocked `captureServerEvent`. The test never imports or calls `researchCompany()` or `createInsforgeServer()` directly.

---

## Part 1 — The module mock structure

Open [`__tests__/api/agent/research.test.ts`](../../../__tests__/api/agent/research.test.ts) at the top:

```typescript
vi.mock("@/lib/insforge-server", () => ({
  createInsforgeServer: vi.fn(),
}));

vi.mock("@/agent/research", () => ({
  researchCompany: vi.fn(),
}));

vi.mock("@/lib/posthog-server", () => ({
  captureServerEvent: vi.fn(),
}));

import { POST } from "@/app/api/agent/research/route";
import { createInsforgeServer } from "@/lib/insforge-server";
import { researchCompany } from "@/agent/research";
import { captureServerEvent } from "@/lib/posthog-server";
```

At first glance this looks wrong — the `vi.mock()` calls are before the `import` statements, but the `import` for `POST` from the route is also before the mocks take effect, right?

Wrong. Vitest hoists `vi.mock()` calls. During transpilation, the test file is rewritten so all `vi.mock()` calls execute before any `import` statements. By the time `import { POST } from "@/app/api/agent/research/route"` is evaluated, all three mocks are already in the module registry. When `route.ts` is evaluated and runs its own `import { researchCompany } from "@/agent/research"`, it gets the mock — not the real module.

> **OS fundamentals — Module loading and caching:** Node.js (and Vitest's ESM-aware equivalent) caches each module by its resolved filepath. A module is evaluated once; all subsequent imports return the same object from the cache. Vitest exploits this: `vi.mock()` installs a replacement into the cache. Any module that imports the mocked path — including modules that were imported by the test — gets the mock from the cache. This is why mocking must happen before the first import of any code that transitively depends on the mocked module.

**Checkpoint:** If you added `vi.mock("@/lib/posthog-server")` inside a `beforeEach` block instead of at the top level, would it still work? Why or why not?

<details>
<summary>Reveal answer</summary>

No. `beforeEach` runs after all module imports have been evaluated. By the time `beforeEach` runs, `route.ts` has already imported the real `captureServerEvent`. Vitest's hoisting only applies to top-level `vi.mock()` calls — it rewrites them to run before imports. A `vi.mock()` inside a function (including `beforeEach`) is not hoisted and runs too late to intercept the import.

</details>

---

## Part 2 — The beforeEach setup and mock reset

```typescript
beforeEach(() => {
  vi.resetAllMocks();

  vi.mocked(createInsforgeServer).mockResolvedValue({
    auth: {
      getCurrentUser: vi.fn().mockResolvedValue({
        data: { user: { id: "user-1" } },
        error: null,
      }),
    },
  } as never);

  vi.mocked(researchCompany).mockResolvedValue({
    dossier: MOCK_DOSSIER,
    company: "Stripe",
  });

  vi.mocked(captureServerEvent).mockResolvedValue(undefined);
});
```

`vi.resetAllMocks()` runs first. It clears all call records and removes all `.mockReturnValue()` / `.mockResolvedValue()` setups from every mock in the file. Without it, a test that does `vi.mocked(captureServerEvent).mockRejectedValue(...)` would leave the rejection in place for all subsequent tests.

After the reset, the `beforeEach` re-establishes defaults so every test starts in a known state:
- Auth returns a valid user
- `researchCompany` returns `{ dossier: MOCK_DOSSIER, company: "Stripe" }`
- `captureServerEvent` resolves successfully

A test that needs a different behavior overrides one of these defaults inline:
```typescript
it("returns success:true even when PostHog throws", async () => {
  vi.mocked(captureServerEvent).mockRejectedValue(new Error("PostHog unavailable"));
  // rest of test
});
```

> **Design patterns — Test double setup:** The "override in test, reset in beforeEach" pattern keeps each test self-contained while avoiding repetition. The `beforeEach` is the happy-path default; individual tests override only what needs to differ. This is preferable to putting all setup inside each test (verbose) or relying on test execution order (fragile).

**Checkpoint:** What exactly does `vi.mocked(createInsforgeServer)` return? Why is this different from using `createInsforgeServer` directly?

<details>
<summary>Reveal answer</summary>

`vi.mocked(fn)` is a TypeScript type helper that casts `fn` to `MockedFunction<typeof fn>`. It doesn't change the runtime value — `createInsforgeServer` is already a `vi.fn()` because of the `vi.mock()` factory. The cast gives TypeScript the types for `.mockResolvedValue()`, `.mockRejectedValue()`, `.mockReturnValue()`, and call assertion methods like `.toHaveBeenCalledWith()`. Without `vi.mocked()`, TypeScript sees `createInsforgeServer` as the original function type and rejects calls to `.mockResolvedValue()`.

</details>

---

## Part 3 — The InsForge mock type problem

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

The `as never` is the interesting part. `createInsforgeServer()` returns a full InsForge client — a complex object with `auth`, `database`, `storage`, `functions`, and more, each with many methods and typed return values. Constructing a type-safe stub for the entire object is impractical in a unit test.

`as never` is a TypeScript type escape. `never` is the bottom type — it is assignable to every other type. TypeScript sees `{ auth: { ... } } as never` and accepts it as the `InsforgeClient` type. At runtime, `as never` is erased — the actual value is the partial object.

This is safe here because the route only calls `insforge.auth.getCurrentUser()`. If the route tried to call `insforge.database.from(...)` on this stub, it would throw `TypeError: insforge.database is undefined` at runtime — the test would fail loudly, revealing that the stub needs to be extended.

> **Type theory — The `never` type:** `never` is the empty type: a set with no values. TypeScript's type hierarchy places `never` at the bottom (subtype of everything) and `unknown` at the top (supertype of everything). A `never` value is assignable to any type because it represents "this can never be reached" — vacuously, a value that cannot exist satisfies any constraint. `as never` is the type assertion version of this: "trust me, treat this value as any type you need."

**Checkpoint:** Why is `as never` used instead of `as any`? What's the difference in practice for this mock?

<details>
<summary>Reveal answer</summary>

`as any` would also work here — both bypass type checking. The difference is stylistic and intentional: `as never` communicates "this value cannot satisfy the real type, and I know it — I'm using it as a stub." `as any` communicates "I don't know or care about the type." In a codebase with strict TypeScript, `as never` is a more explicit signal that a type escape is intentional and scoped. The practical runtime behavior is identical.

</details>

---

## Part 4 — The PostHog isolation test

```typescript
it("returns success:true with dossier even when captureServerEvent throws", async () => {
  vi.mocked(captureServerEvent).mockRejectedValue(new Error("PostHog unavailable"));

  const res = await POST(makeRequest({ jobId: "job-1" }));
  const body = await res.json() as {
    success: boolean;
    data?: { companyResearch: CompanyResearchDossier };
    error?: string;
  };

  expect(res.status).toBe(200);
  expect(body.success).toBe(true);
  expect(body.data?.companyResearch).toEqual(MOCK_DOSSIER);
});
```

This test targets one specific regression: if the PostHog try/catch is ever accidentally removed and the PostHog call is moved back inside the main try block, this test fails.

Three assertions for one behavior:
- `res.status === 200` — the HTTP layer returned success, not a 500
- `body.success === true` — the JSON body signals success
- `body.data?.companyResearch` equals the dossier — the actual research data is present

All three are needed. It is theoretically possible for `res.status` to be 200 with a body of `{ success: false }` (a non-standard API contract). It is theoretically possible for `body.success` to be `true` with no `data` field. Checking all three makes the test airtight for the actual contract this route implements.

**Try it yourself:** Temporarily remove the inner `try/catch` from `app/api/agent/research/route.ts` so `captureServerEvent()` runs inside the main try. Run `npx vitest run __tests__/api/agent/research.test.ts`. Which assertion fails first?

---

## Part 5 — The company derivation test

```typescript
it("passes company from researchCompany return value to the event", async () => {
  await POST(makeRequest({ jobId: "job-1" }));

  expect(captureServerEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      event: "company_researched",
      properties: expect.objectContaining({
        company: "Stripe",
      }),
    }),
  );
});
```

The request body is `{ jobId: "job-1" }` — no `company` field. The test confirms that `company: "Stripe"` appears in the PostHog event anyway — sourced from `researchCompany()`'s return value (which is mocked to return `{ dossier: MOCK_DOSSIER, company: "Stripe" }`).

The nested `expect.objectContaining()`:
- Outer: the argument to `captureServerEvent` must contain `event` and `properties` (may also have `distinctId`)
- Inner: `properties` must contain `company: "Stripe"` (may also have `userId` and `jobId`)

Exact matching would be:
```typescript
expect(captureServerEvent).toHaveBeenCalledWith({
  distinctId: "user-1",
  event: "company_researched",
  properties: { userId: "user-1", jobId: "job-1", company: "Stripe" },
});
```

This is brittle: adding any new property to the event (e.g., `timestamp`) would break the test even though the `company` behavior is unchanged. The partial matcher tests what matters — `company: "Stripe"` — without coupling to the full call signature.

> **Algorithms — Subset membership testing:** `expect.objectContaining()` is a runtime subset test: does the actual object contain all key-value pairs from the expected subset? The time complexity is O(n) in the number of expected keys. This is the correct algorithm for "I care about these specific properties, not the full object shape." The counterpart is exact equality (`toEqual()`), which is O(n) in the size of the full object — appropriate when you need to verify no unexpected keys were added.

**Checkpoint:** The second test also does `expect.objectContaining({ company: "Stripe" })`. The third test checks `company: ""`. What regression would test 2 alone miss that test 3 catches?

<details>
<summary>Reveal answer</summary>

Test 2 only runs when `researchCompany` returns `company: "Stripe"` (non-null). The route code is `company: company ?? ""`. Test 2 never exercises the `?? ""` branch. If someone changed the code to `company: company!` (removing the null fallback), test 2 would still pass when company is `"Stripe"`. Test 3, which mocks `company: null`, would call `captureServerEvent` with `company: null` — and the assertion `company: ""` would fail, catching the regression.

</details>

---

## Part 6 — makeRequest: constructing a NextRequest from Request

```typescript
function makeRequest(body: Record<string, unknown>): NextRequest {
  return new Request("http://localhost/api/agent/research", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}
```

`NextRequest` extends the Web Platform `Request` — both come from the Fetch API standard. The route handler only calls `req.json()`, which is a method on the base `Request` class. So a plain `Request` object satisfies all the route's runtime needs.

`as unknown as NextRequest` is a double cast. TypeScript won't allow `Request as NextRequest` directly because, while structurally compatible at runtime, the TypeScript types diverge: `NextRequest` adds properties (`req.cookies`, `req.geo`, `req.ip`, etc.) that `Request` doesn't have. The double cast goes through `unknown` first — `unknown` accepts any value, and `NextRequest` is a subset of `unknown`, so TypeScript permits the second cast.

> **Type theory — Double casts via `unknown`:** `X as Y` is only allowed when TypeScript believes X and Y overlap. When they don't (incompatible types), TypeScript rejects it. The workaround: `X as unknown as Y`. Every type is assignable to `unknown` (it's the top type), and `unknown` is assignable to any type via assertion. The double cast is a signal that you're doing something TypeScript can't verify — it's an explicit escape, not an accidental one.

**Try it yourself:** In the test file, change `as unknown as NextRequest` to `as NextRequest` and run `npx tsc --noEmit`. What error does TypeScript produce? Then restore the double cast and confirm it compiles cleanly.

---

## Full data flow: what happens when `captureServerEvent` throws in the test

```
POST(makeRequest({ jobId: "job-1" }))
  │
  ├─ createInsforgeServer() → stub returns { auth: { getCurrentUser } }
  │
  ├─ getCurrentUser() → stub returns { data: { user: { id: "user-1" } }, error: null }
  │
  ├─ req.json() → { jobId: "job-1" }
  │
  ├─ researchCompany("job-1", "user-1") → stub returns { dossier: MOCK_DOSSIER, company: "Stripe" }
  │    (mock registered by vi.mock("@/agent/research"); never calls real agent)
  │
  ├─ try { captureServerEvent({ ... }) } → THROWS "PostHog unavailable"
  │    catch { console.error(...) }         ← swallowed, does NOT propagate
  │
  └─ return NextResponse.json({ success: true, data: { companyResearch: MOCK_DOSSIER } })
       │
       └─ Test assertions:
            res.status === 200 ✓
            body.success === true ✓
            body.data.companyResearch deep-equals MOCK_DOSSIER ✓
```

---

## Extend it (challenges)

**Challenge 1 — Trace the mock registry** (15–20 min)

Add a `console.log(researchCompany.toString())` immediately after the `vi.mock()` call and before the `import { POST }` statement. Run the test. What does the log show? Does it show the real `researchCompany` source code, or something else? What does this tell you about when mock replacement happens relative to `import` evaluation?

<details>
<summary>Hint</summary>

Vitest hoists `vi.mock()` calls, so the mock is installed before any imports run. The `console.log` will show a mock function, not the real source. The `import` of `researchCompany` receives the mock from the registry.

</details>

---

**Challenge 2 — Add auth failure coverage** (20–30 min)

The current test suite covers the happy path (auth succeeds) and the PostHog failure path. Add two tests:
1. `returns 401 when auth fails` — mock `getCurrentUser` to return `{ data: { user: null }, error: new Error("Not authenticated") }`
2. `returns 400 when jobId is missing from body` — send `makeRequest({})` (no jobId)

Both should assert on `res.status` and `body.success`. Run the test suite to confirm all 5 tests pass.

<details>
<summary>Hint</summary>

Override `createInsforgeServer` in the specific test's body (after `vi.resetAllMocks()` in `beforeEach` re-establishes the happy-path default):
```typescript
vi.mocked(createInsforgeServer).mockResolvedValue({
  auth: {
    getCurrentUser: vi.fn().mockResolvedValue({
      data: { user: null },
      error: new Error("Not authenticated"),
    }),
  },
} as never);
```

</details>

---

**Challenge 3 — Design a test without vi.mock()** (30–45 min)

The current tests mock at the module level. An alternative is dependency injection: instead of the route importing `researchCompany` directly, it could accept it as a parameter or receive it via a factory. Sketch what `route.ts` would look like with dependency injection. What would the test look like without `vi.mock()`? What are the trade-offs — when is module mocking better, and when is DI better?

<details>
<summary>Hint</summary>

Dependency injection for an API route is unusual in Next.js (routes have a fixed signature), but you could inject via a higher-order function: `export function makeHandler(deps: { researchCompany: typeof researchCompany }) { return async function POST(req) { ... } }`. Tests call `makeHandler({ researchCompany: vi.fn() })`. The trade-off: DI is more explicit but requires changing the route interface; module mocking is invisible but relies on Vitest-specific machinery that doesn't exist in production.

</details>

---

For deeper exploration, `docs/tdd/01-research-route-regression/ai-discussion-topics.md` has 15 questions across 5 groups covering behavior vs. implementation tests, vi.mock() hoisting mechanics, TypeScript's `never` type, partial matchers, and test design trade-offs. Feed them to an LLM *after* forming your own answer first — the gap between what you thought and what you learn is where understanding lands.
