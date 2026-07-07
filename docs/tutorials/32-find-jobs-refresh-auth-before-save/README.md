# Tutorial 32 — Find Jobs Refresh Auth Before Save: Long-Running Routes and Late DB Writes

**After completing this tutorial you will understand:** why a successful external actor run can still fail at the persistence boundary; how long-running route handlers can outlive the access token captured at request start; how to refresh an InsForge SSR session before late writes without changing normal server-client usage; how to test stale-token bugs with a fast route-handler seam; and why a targeted refresh fix is different from redesigning the workflow as a background job.

> [!NOTE]
> **Prerequisites:** Tutorial 22 (`../22-find-jobs-repeated-search/README.md`) — explains the Find Jobs route seam, actor pagination loop, and InsForge query-chain mocks. Tutorial 21 (`../21-find-jobs-error-feedback/README.md`) — introduces the client-facing error banner contract. Open [`app/api/agent/find/route.ts`](../../../app/api/agent/find/route.ts), [`lib/insforge-server.ts`](../../../lib/insforge-server.ts), and [`__tests__/find-jobs/token-refresh-before-save.test.ts`](../../../__tests__/find-jobs/token-refresh-before-save.test.ts) alongside this tutorial.

## CS & language concepts in this tutorial

| Concept | Where it appears | Category |
|---------|-----------------|----------|
| Token lifetime vs. request lifetime | Long actor/scoring gap before late DB writes in `app/api/agent/find/route.ts` | System design |
| Leeway window | `refreshLeewaySeconds: 600` in `getLateWriteInsforge()` | Distributed systems |
| Lazy cached resource | `lateWriteInsforge` initialized once per request | Programming patterns |
| Error taxonomy | `InsforgeSessionRefreshError` mapped to `401`, insert failures mapped to `500` | API design |
| Route-seam testing | Direct `POST` invocation in `token-refresh-before-save.test.ts` | Testing |
| Temporal bug modeling | Two mocked InsForge clients model early vs. late auth state | Testing |

## How to use an LLM before this tutorial

### Concept 1 — Access-token lifetime in server routes

> "Explain how an SSR route handler creates an authenticated API client from cookies. If that route spends 10 minutes calling an external service before writing to a database, what can happen to the access token captured at route start? Give a concrete timeline and quiz me at the end."

*What to listen for:* The token is not timeless just because the request is still running. A client created from cookies uses the token available at creation time. Long external work creates a gap between authentication and mutation.

*Practice question:* A token has 3 minutes left when a user clicks Find Jobs. The actor takes 8 minutes. What happens if the route writes with the original client?

### Concept 2 — Refresh leeway

> "Explain refresh leeway for access tokens. Why might a server refresh a token that is not expired yet but is close to expiring? Give an example involving a batch insert and ask me to identify where the refresh should happen."

*What to listen for:* Leeway handles "about to expire" tokens. It prevents beginning a write phase with a token that may expire during the phase.

*Practice question:* Why is `refreshLeewaySeconds: 600` useful before late Find Jobs writes?

### Concept 3 — Route-seam tests

> "Explain route-handler seam testing in Next.js App Router. Why can a test call an exported `POST` function directly instead of running a dev server? Compare that to a browser test for the same bug and quiz me."

*What to listen for:* The route function is ordinary async code that accepts a `Request` and returns a `Response`. Mocking module imports lets the test simulate auth, actor, scoring, and DB behavior without network.

*Practice question:* Why does a route-seam test catch stale-token save behavior faster than a live actor run?

### Concept 4 — Error semantics

> "Compare a database insert failure caused by an expired session with a database insert failure caused by a schema or constraint problem. Should both return the same HTTP status and user message? Give a concrete recovery action for each and quiz me."

*What to listen for:* Expired session is an authentication recovery path: sign in again. Schema/constraint failure is a server problem: retry or report. The user message should match the recovery action.

*Practice question:* Why does refresh failure return 401 while ordinary insert failure still returns 500?

## Architecture overview

```
User clicks Find Jobs
        │
        ▼
┌──────────────────────────────────────────────────────────────┐
│ app/api/agent/find/route.ts                         SERVER   │
│                                                              │
│ 1. createInsforgeServer()                                    │
│    └─ auth, profile, agent_run insert, existing jobs read     │
│                                                              │
│ 2. Long external work                                        │
│    └─ JobsDB actor pagination + Nemotron scoring              │
│                                                              │
│ 3. getLateWriteInsforge()                                    │
│    └─ createInsforgeServer({ refreshSession: true,            │
│                              refreshLeewaySeconds: 600 })     │
│                                                              │
│ 4. Late writes with refreshed client                         │
│    └─ jobs.insert + agent_runs.update                         │
└──────────────────────────────────────────────────────────────┘
```

**Key invariants:**
1. Early reads and run creation can use the normal server client.
2. Writes after actor/scoring work must use the refreshed late-write client.
3. Refresh failure is an auth failure (`401`), not a generic save failure (`500`).

## Part 1 — The helper keeps normal client creation unchanged

Open [`lib/insforge-server.ts`](../../../lib/insforge-server.ts):

```ts
import { cookies } from "next/headers";
import { createServerClient, updateSession } from "@insforge/sdk/ssr";

type CreateInsforgeServerOptions = {
  refreshSession?: boolean;
  refreshLeewaySeconds?: number;
};

export class InsforgeSessionRefreshError extends Error {
  constructor(message = "InsForge session refresh failed") {
    super(message);
    this.name = "InsforgeSessionRefreshError";
  }
}

export async function createInsforgeServer(
  options: CreateInsforgeServerOptions = {},
) {
  const cookieStore = await cookies();

  if (options.refreshSession) {
    const session = await updateSession({
      requestCookies: cookieStore,
      responseCookies: cookieStore,
      refreshLeewaySeconds: options.refreshLeewaySeconds,
    });

    if (session.error || !session.accessToken) {
      throw new InsforgeSessionRefreshError(session.error?.message);
    }
  }

  return createServerClient({ cookies: cookieStore });
}
```

The default call still does exactly what the rest of the app expects: read cookies and create an InsForge server client. The new behavior is opt-in through `refreshSession: true`.

That matters because this bug is specific to long-running routes. For ordinary pages and route handlers, forcing a refresh on every request would add unnecessary network work and change a stable project-wide helper. The option keeps the special behavior at the special boundary.

**Checkpoint:** Why not create a separate `createFreshInsforgeServer()` helper instead of adding an option?

<details>
<summary>Reveal answer</summary>

A separate helper would work, but it would split the server-client creation policy across two entry points. Adding an option keeps the invariant visible: all server InsForge clients come from `createInsforgeServer`, and callers opt into refresh only when they need it. The failure mode of two helpers is drift: future code may choose the wrong one or update one without the other.

</details>

**Try it yourself:** Search for `createInsforgeServer(`. Notice that most calls still use no options; only the long-running Find Jobs save path needs the refresh option.

## Part 2 — The late-write boundary inside the route

Open [`app/api/agent/find/route.ts`](../../../app/api/agent/find/route.ts) around the constants and late-write helper:

```ts
const LATE_WRITE_REFRESH_LEEWAY_SECONDS = 600;
const SESSION_EXPIRED_MESSAGE =
  "Session expired while saving jobs. Please sign in again and rerun the search.";
```

```ts
const totalFound = uniqueJobsDbJobs.length;
let lateWriteInsforge: Awaited<ReturnType<typeof createInsforgeServer>> | null = null;

async function getLateWriteInsforge(): Promise<
  Awaited<ReturnType<typeof createInsforgeServer>>
> {
  if (!lateWriteInsforge) {
    lateWriteInsforge = await createInsforgeServer({
      refreshSession: true,
      refreshLeewaySeconds: LATE_WRITE_REFRESH_LEEWAY_SECONDS,
    });
  }
  return lateWriteInsforge;
}
```

The helper is deliberately inside the route handler. It needs per-request state: cache one refreshed client for this request, but never share it across users or requests.

The `600` second leeway is not arbitrary decoration. It encodes the observed failure mode: the route can spend minutes in Apify before persisting. A token that is technically valid but has only a few minutes left is not good enough at this boundary.

**Checkpoint:** Why is `getLateWriteInsforge()` called after actor/scoring work instead of immediately after `getCurrentUser()`?

<details>
<summary>Reveal answer</summary>

Refreshing immediately after `getCurrentUser()` would still let the refreshed token age while the actor and scoring work run. The risky boundary is not "request start"; it is "about to mutate after long external work." Refreshing there gives the write phase the freshest available auth state.

</details>

**Try it yourself:** Temporarily lower `LATE_WRITE_REFRESH_LEEWAY_SECONDS` in your head to `0`. What bug class would that reintroduce for tokens that are valid now but expire during the write phase?

## Part 3 — All late writes use the refreshed client

Open the insert path in [`app/api/agent/find/route.ts`](../../../app/api/agent/find/route.ts):

```ts
const writeInsforge = await getLateWriteInsforge();

// Persist only new jobs, returning saved rows for the client.
const { data: insertedJobs, error: jobsError } = await writeInsforge.database
  .from("jobs")
  .insert(records)
  .select();

if (jobsError || !insertedJobs) {
  console.error("[api/agent/find] jobs insert error:", jobsError);
  await writeInsforge.database
    .from("agent_runs")
    .update({ status: "failed", completed_at: new Date().toISOString() })
    .eq("id", runId)
    .eq("user_id", userId);
  return NextResponse.json(
    { success: false, error: "Could not save jobs" },
    { status: 500 },
  );
}
```

The important part is not only that `jobs.insert` uses `writeInsforge`. The failure update uses it too. If insert fails for a real DB reason, the route still needs to mark the run failed. Using the stale client for that update would create a second failure while handling the first.

The same pattern appears in zero-result and all-duplicate paths: run completion is also a late write, so it uses `getLateWriteInsforge()`.

**Checkpoint:** What would break if the route refreshed only for `jobs.insert` but kept using the original `insforge` client for final `agent_runs.update`?

<details>
<summary>Reveal answer</summary>

The jobs could save successfully, but the run status update could fail with the same stale token. The UI and dashboard would then have saved rows but a run stuck in `running` or missing completion metadata. The fix needs to cover the whole late-write phase, not one query.

</details>

**Try it yourself:** Search the route for `writeInsforge.database`. List every late write it covers and decide whether each one happens before or after the slow actor/scoring boundary.

## Part 4 — Refresh failure gets its own response

Open the catch branch in [`app/api/agent/find/route.ts`](../../../app/api/agent/find/route.ts):

```ts
} catch (error) {
  if (error instanceof InsforgeSessionRefreshError) {
    console.error("[api/agent/find] session refresh before save failed:", error);
    return NextResponse.json(
      { success: false, error: SESSION_EXPIRED_MESSAGE },
      { status: 401 },
    );
  }

  console.error("[api/agent/find]", error);
  return NextResponse.json(
    { success: false, error: "Internal server error" },
    { status: 500 },
  );
}
```

Refresh failure means "the user session cannot be refreshed." That is not the same as a table constraint failure, a missing column, or an InsForge service problem. The user-facing recovery action is to sign in again.

The existing `"Could not save jobs"` response stays in the insert-error branch. That path is still correct for non-auth DB errors.

**Checkpoint:** Why is this branch `401` instead of `500`?

<details>
<summary>Reveal answer</summary>

The server did not lose the ability to process the request in general; it lost valid user authentication for the write. `401` communicates that the request lacks valid authentication. A `500` would imply an internal server failure and would encourage retrying the same request without signing in again.

</details>

**Try it yourself:** In the test file, find the case that throws `new InsforgeSessionRefreshError("Invalid refresh token")`. What response does it assert?

## Part 5 — The regression test models time without waiting

Open [`__tests__/find-jobs/token-refresh-before-save.test.ts`](../../../__tests__/find-jobs/token-refresh-before-save.test.ts):

```ts
vi.mocked(createInsforgeServer)
  .mockResolvedValueOnce(
    buildInitialInsforgeMock() as unknown as Awaited<
      ReturnType<typeof createInsforgeServer>
    >,
  )
  .mockResolvedValueOnce(
    buildFreshInsforgeMock(makeInsertedJob()) as unknown as Awaited<
      ReturnType<typeof createInsforgeServer>
    >,
  );
```

The test does not sleep for 10 minutes. It models the timeline with two clients:

- Initial client: good enough for early auth, profile, run creation, and existing-job reads.
- Fresh client: required for late insert.

The initial mock intentionally returns an `AUTH_UNAUTHORIZED` error if it is used for the late `jobs` call. That makes the test red on the old implementation and green only when the route refreshes before saving.

```ts
expect(createInsforgeServer).toHaveBeenNthCalledWith(2, {
  refreshSession: true,
  refreshLeewaySeconds: 600,
});
```

This assertion locks down the architectural behavior, not just the response. A future refactor that accidentally reuses the initial client will fail this test.

**Checkpoint:** Why is asserting the second `createInsforgeServer` call stronger than only asserting `res.status === 200`?

<details>
<summary>Reveal answer</summary>

A response-only assertion could pass for the wrong reason: the route might swallow the stale-token error, the mock might accidentally allow the stale insert, or the response could be forged without actually persisting. The second-call assertion proves the route crossed the intended refresh boundary before persistence.

</details>

**Try it yourself:** Change the route mentally so `jobs.insert` uses `insforge.database` again. Which test assertion fails first?

## Full data flow: saving jobs after a long actor run

1. `FindJobsClient` posts `{ jobTitle, location }` to `/api/agent/find`.
2. `POST` creates the normal InsForge server client and calls `getCurrentUser()`.
3. The route creates an `agent_runs` row and reads existing JobsDB URLs for dedupe.
4. The route calls `discoverJobsDbJobs()` until it has enough fresh jobs or stops.
5. The route scores only `newJobs`.
6. Before any late write, `getLateWriteInsforge()` calls `createInsforgeServer({ refreshSession: true, refreshLeewaySeconds: 600 })`.
7. `updateSession()` refreshes cookies if the access token is expired or close to expiring.
8. The refreshed client inserts `jobs` and updates `agent_runs`.
9. The route returns the saved display rows and success message.
10. If refresh fails, the route returns `401` with the session-expired message.

## Extend it (challenges)

**Challenge 1 — Trace** (15-20 min): Follow the `runId` from creation through every late update in `app/api/agent/find/route.ts`. Mark which updates use the initial client and which use the refreshed client.

<details>
<summary>Hint</summary>

Start at the first `agent_runs.insert`, then search for `.from("agent_runs")`.
</details>

**Challenge 2 — Extend** (20-30 min): Add a route-seam test for the all-duplicate path where no jobs are inserted but the final run completion still uses the refreshed client.

<details>
<summary>Hint</summary>

Mock the actor to return one job whose `sourceUrl` already exists in the initial DB result. Assert the second `createInsforgeServer` call still happens.
</details>

**Challenge 3 — Design** (30-45 min): Sketch a background-job version of Find Jobs. Define the API routes, run statuses, and UI polling behavior needed to replace the long synchronous request.

<details>
<summary>Hint</summary>

Start with `POST /api/agent/find` returning only `{ runId }`, then add `GET /api/agent/find/:runId` for status and results.
</details>

For deeper exploration, `docs/plan/find-jobs-refresh-auth-before-save/ai-discussion-topics.md` has 20 prompts covering auth boundaries, route-seam testing, error semantics, and the background-job tradeoff. Feed them to an LLM *after* forming your own answer first — the gap between what you thought and what you learn is where understanding lands.
