# Discussion — Find Jobs Refresh Auth Before Save

## The Diagnostic Shape

The reported failure was not simply "Find Jobs failed." It contained a timeline:

1. JobsDB actor processed 34 requests.
2. The actor finished with 30 pushed jobs.
3. The route attempted to insert those jobs.
4. InsForge returned `AUTH_UNAUTHORIZED`.

That timeline matters because bugs often look similar at the UI boundary. A failed search, a blocked actor, a broken scraper selector, a scoring exception, and a stale auth token can all surface as "search failed." The server log made this one narrower: data existed, but the write failed.

## Why Long-Running Route Handlers Are Special

Most route handlers authenticate, read or write, and return quickly. In that shape, the token read from cookies at the beginning of the request is usually still valid when the DB query runs.

Find Jobs is different. The route holds the request open while an external Apify actor runs. A single successful search can take several minutes. That creates a time gap between "client created" and "client writes." If the access token had only a few minutes left when the user clicked Find Jobs, it can expire before persistence.

The core lesson is that auth is not a one-time concern in long-running request flows. There can be multiple auth boundaries inside one route:

- start boundary: identify the user
- pre-write boundary: prove the user still has a valid session before mutating data

## Why the Fresh Client Is Scoped to Late Writes

The early client is still useful. It authenticates the user, reads the profile, creates the `agent_runs` row, and reads existing jobs for dedupe. Those operations happen near request start.

The refreshed client is only needed after the slow external work. Scoping it that way keeps the implementation small and makes the reason visible in code. A future reader can see that `getLateWriteInsforge()` exists because late writes have a different token-lifetime risk from early reads.

## Why "Just Retry the Insert" Is Weaker

Retrying after `AUTH_UNAUTHORIZED` sounds appealing, but it hides the boundary. The route would first perform a write with a token it has reason to distrust, then branch on failure. It also has to decide which writes to retry. If `jobs.insert` fails and then `agent_runs.update({ status: "failed" })` uses the same stale client, the route can fail while trying to record its own failure.

Refreshing before writes makes the intended state explicit: the write phase should start with fresh auth.

## Why the Test Asserts the Second Client Call

A response-only test could pass accidentally. For example, the route could swallow the insert error and still return a fake success. Or the mock could be too permissive and let the stale client insert.

The explicit assertion on the second `createInsforgeServer` call proves the behavior that matters:

```ts
expect(createInsforgeServer).toHaveBeenNthCalledWith(2, {
  refreshSession: true,
  refreshLeewaySeconds: 600,
});
```

That locks down the architecture decision, not just the response body.

## The Larger Architecture Pressure

This fix keeps the synchronous route design. That was the pragmatic choice because the bug was local: stale auth before late writes.

The session also identified a deeper pressure: a 5-10 minute HTTP request is brittle. It depends on browser patience, deployment `maxDuration`, provider latency, and token lifetime. A background job design would return quickly after creating an `agent_runs` row, then let the client poll or subscribe for progress.

That larger design would need new concepts:

- queued/running/completed/failed run state visible to the UI
- progress or partial-result reporting
- retry policy for actor failures
- auth model for background workers
- cleanup for stale runs

Those are real decisions, so they were kept out of this targeted fix.
