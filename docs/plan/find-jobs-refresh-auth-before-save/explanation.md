# Technical Explanation — Refresh Auth Before Late Save

## Why the Bug Appeared After the Actor Succeeded

The important detail in the live log was ordering:

```text
[jobsdb-actor] Done. Pushed 30 jobs across up to 4 page(s).
[api/agent/find] jobs insert error: AUTH_UNAUTHORIZED Invalid token
```

That means the provider path worked. JobsDB returned cards, the actor extracted details, the dataset came back to the Next.js route, and scoring completed. The failure happened only when the route tried to persist the resulting rows.

The previous route used one InsForge server client for the whole request. That client reads the access token from cookies when it is created. If the route runs longer than the remaining lifetime of that token, late writes use a stale bearer token.

## Why Refresh Belongs at the Late-Write Boundary

Refreshing at the start of the route is not enough. The actor and scoring work happen after that point, and they are the expensive part of the request. The correct boundary is immediately before DB writes that happen after external work.

The route now uses:

```ts
const LATE_WRITE_REFRESH_LEEWAY_SECONDS = 600;
```

This intentionally refreshes if the token is already expired or close to expiring. The leeway matches the failure mode: a request can spend minutes in Apify before it writes.

## Why `createInsforgeServer` Was Extended Instead of Adding a Separate Client Factory

The project already has a single server-client entry point:

```ts
const insforge = await createInsforgeServer();
```

Adding an option keeps all server-side InsForge client creation in one module:

```ts
await createInsforgeServer({
  refreshSession: true,
  refreshLeewaySeconds: 600,
});
```

The default call path is unchanged. Existing pages, route handlers, and server actions still create a read/write server client from cookies without forcing a refresh.

## Why the Helper Throws a Specific Error

Refresh failure is different from a generic DB write failure. A missing or invalid refresh token means the user needs to sign in again. Returning `"Could not save jobs"` hides the real recovery action.

`InsforgeSessionRefreshError` gives the route a precise catch branch:

```ts
if (error instanceof InsforgeSessionRefreshError) {
  return NextResponse.json(
    { success: false, error: SESSION_EXPIRED_MESSAGE },
    { status: 401 },
  );
}
```

That preserves the existing `500` path for non-auth persistence failures while making auth expiry explicit.

## Why the Refreshed Client Is Cached Inside the Route

The route can have multiple late writes:

- mark `agent_runs` completed for genuine zero results
- mark `agent_runs` completed for all-duplicate results
- insert new jobs
- mark `agent_runs` failed if insert fails
- mark `agent_runs` completed after insert succeeds

`getLateWriteInsforge()` caches the refreshed client so the route refreshes once per request. That avoids redundant refresh calls and ensures every late write uses the same refreshed auth context.

## Why the Test Uses Two InsForge Clients

The regression test models the real failure:

1. The initial client can authenticate, create the run, and read existing jobs.
2. The initial client would fail if used for the late insert.
3. The second client represents the refreshed session and succeeds.

The test asserts the second call:

```ts
expect(createInsforgeServer).toHaveBeenNthCalledWith(2, {
  refreshSession: true,
  refreshLeewaySeconds: 600,
});
```

This catches accidental regressions where a future refactor reuses the initial client for `jobs.insert`.

## Why Background Jobs Are Still the Better Long-Term Shape

This fix preserves the current synchronous route design. It does not make a 10-minute HTTP request a great architecture. A background job would let the route start a run, return quickly, and let the UI poll or subscribe to progress.

That larger change would affect user experience, run state, retries, and progress reporting. It is correctly out of scope for this targeted bug fix.
