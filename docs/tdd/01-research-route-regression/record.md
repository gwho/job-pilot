# Record — TDD Session: Research Route Regression Tests

## What was covered

Two behaviors from `app/api/agent/research/route.ts` identified for regression coverage after the Feature 13 project-review fixes:

1. **PostHog isolation** — `POST` returns `{ success: true, data: { companyResearch: dossier } }` even when `captureServerEvent` throws. A PostHog failure must not gate a successful research result.

2. **Server-side company derivation** — The `company_researched` PostHog event includes `company` derived from `researchCompany()`'s return value, not from the client request body. When `company` is `null`, the event receives `""` (the `?? ""` fallback).

## Test file written

`__tests__/api/agent/research.test.ts`

Three tests, two describe groups:

```
POST /api/agent/research
  analytics isolation — PostHog failure must not affect the response
    ✓ returns success:true with dossier even when captureServerEvent throws
  PostHog event properties — company derived server-side, not from client
    ✓ passes company from researchCompany return value to the event
    ✓ uses empty string when researchCompany returns null company
```

## Dependencies mocked

| Module | Exported mock | Reason |
|--------|--------------|--------|
| `@/lib/insforge-server` | `createInsforgeServer` | Returns auth stub — not testing auth |
| `@/agent/research` | `researchCompany` | Returns controlled `{ dossier, company }` |
| `@/lib/posthog-server` | `captureServerEvent` | Controlled to succeed or throw per test |

All mocks use Vitest factory functions (`vi.mock("path", () => ({ ... }))`).
`beforeEach` calls `vi.resetAllMocks()` and resets each mock to its default state.

## Approach

- Tests call the public `POST` handler directly with a `Request` cast to `NextRequest`
- No tests of internal functions (`researchCompany`, `synthesizeDossier`, etc.)
- All tests went GREEN immediately — existing code already implements the correct behaviors; tests lock against regression

## Test run results

```
Test Files  5 passed (5)
     Tests  45 passed (45)   ← up from 42 before this session
```
