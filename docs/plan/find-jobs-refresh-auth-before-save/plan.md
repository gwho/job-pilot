# Find Jobs — Refresh Auth Before Late Save

## What Was Built

Fixed a long-running Find Jobs failure where the JobsDB actor successfully fetched jobs, but saving them failed with:

```text
AUTH_UNAUTHORIZED: Invalid token
```

The route now refreshes the InsForge session before late DB writes. This keeps the early request authentication model unchanged while preventing the access token captured at request start from being reused after a long actor/scoring run.

## Root Cause

`POST /api/agent/find` created one InsForge server client at the start of the request. The route then ran JobsDB actor pagination and Nemotron scoring before inserting jobs. In live logs, that work took about 10 minutes:

```text
[jobsdb-actor] Done. Pushed 30 jobs across up to 4 page(s).
[api/agent/find] jobs insert error: AUTH_UNAUTHORIZED Invalid token
```

The actor result was valid. The failure happened after the actor completed, when the route attempted to write with an expired access token.

## Files Changed

| File | Change |
|---|---|
| `lib/insforge-server.ts` | Added optional session refresh support and `InsforgeSessionRefreshError` |
| `app/api/agent/find/route.ts` | Uses a refreshed late-write InsForge client before result persistence |
| `__tests__/find-jobs/token-refresh-before-save.test.ts` | New regression coverage for stale-token save and refresh failure |
| `__tests__/find-jobs/blocked-actor.test.ts` | Type-safe async scorer mocks and InsForge test double casts |
| `__tests__/find-jobs/repeated-search.test.ts` | Type-safe async scorer mock and InsForge test double cast |
| `__tests__/find-jobs/save-error.test.ts` | Type-safe InsForge test double cast |

## Behavior

| Scenario | Result |
|---|---|
| Actor succeeds and access token is still valid | Jobs save normally |
| Actor succeeds after the original access token expires | Route refreshes session, creates a fresh InsForge client, saves jobs |
| Refresh token is missing/invalid before save | Route returns `401` with session-expired message |
| Jobs insert fails for a non-auth DB error | Existing `500` `"Could not save jobs"` contract remains |

## Verification

```bash
npm run test:run -- __tests__/find-jobs/token-refresh-before-save.test.ts
npm run test:run -- __tests__/find-jobs/
npx tsc --noEmit
npm run lint
```

All commands pass.

## Follow-Up

The immediate bug is fixed, but the route is still doing long-running actor work inside a browser-held HTTP request. A later architecture pass should move JobsDB discovery to a background job or polling flow so the UI does not depend on a 5-10 minute request staying open.
