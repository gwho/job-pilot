# Decisions — Find Jobs Refresh Auth Before Save

## Decision 1: Treat the Failure as a Late Persistence Auth Boundary

The session identified the ordering in the server log as the decisive clue:

```text
[jobsdb-actor] Done. Pushed 30 jobs across up to 4 page(s).
[api/agent/find] jobs insert error: AUTH_UNAUTHORIZED Invalid token
```

Because the actor had already pushed jobs, the provider and extraction path were not the primary suspect. The failure boundary was the first DB write after the long actor/scoring work.

The alternative was to continue debugging JobsDB blocking or actor selectors. That would have chased the wrong system boundary: the actor had produced data successfully.

## Decision 2: Refresh Before Late DB Writes, Not at Route Start

The route already authenticates at the start with:

```ts
const insforge = await createInsforgeServer();
const { data: authData } = await insforge.auth.getCurrentUser();
```

The problem is that this client is created before the slow part of the route. Refreshing only there would still allow the token to age during Apify and scoring. The agreed fix was to refresh immediately before late writes.

The rejected alternative was relying on the initial client and retrying only after an insert fails. That would make failed writes part of normal control flow and could leave run-status updates with the same stale token problem.

## Decision 3: Keep User-Scoped Auth, Do Not Bypass RLS

The plan keeps using InsForge's user-scoped server client. It does not introduce an admin or service credential to save jobs.

That preserves the existing invariant that all job rows are written under the current `user_id` and continue to pass through row-level security. A service credential might avoid token expiry, but it would require new audit and authorization rules that were not needed for this targeted fix.

## Decision 4: Return a Specific Session-Expired Error on Refresh Failure

Refresh failure means the user needs to sign in again. The plan chose a `401` response with:

```text
Session expired while saving jobs. Please sign in again and rerun the search.
```

The alternative was reusing `"Could not save jobs"`. That message is too vague for an auth-expiry path and gives the user the wrong recovery model.

## Decision 5: Lock the Bug With a Route-Seam Test

The test seam is `POST /api/agent/find`. The test uses two InsForge clients:

1. Initial client: works for early auth, run creation, and existing-job reads.
2. Fresh client: works for the late insert.

The test asserts that the route calls:

```ts
createInsforgeServer({
  refreshSession: true,
  refreshLeewaySeconds: 600,
});
```

The alternative was a live actor test. That would be slow, flaky, and dependent on external JobsDB and Apify conditions. The route-seam test catches the actual failure pattern in seconds.
