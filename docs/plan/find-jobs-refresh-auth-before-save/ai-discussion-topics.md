# AI Discussion Topics — Refresh Auth Before Late Save

## Group 1: Diagnosing the Boundary

1. The actor log said `Done. Pushed 30 jobs`, then the route logged `AUTH_UNAUTHORIZED`. Why does that ordering rule out actor extraction as the primary failure?

2. Why is "invalid token during insert" different from a generic database insert failure, even though both happen at the same line of route code?

3. What would have gone wrong if the fix retried the actor instead of refreshing the InsForge session?

4. Why is a route-seam test better than a live 10-minute actor run for locking down this bug?

## Group 2: Token Lifetime and Long Requests

5. What does `createServerClient({ cookies })` capture at creation time, and why does that matter for long-running route handlers?

6. Why is refreshing at the beginning of the route insufficient for a request that spends minutes in external work before writing?

7. What does `refreshLeewaySeconds` protect against beyond tokens that are already expired?

8. If the access token has 2 minutes left and the route is about to insert 30 jobs, why is refreshing before insert safer than waiting for a 401 response?

## Group 3: Error Semantics

9. Why should refresh failure return `401` instead of the existing `500` `"Could not save jobs"` response?

10. What user action does the session-expired message imply? How is that different from the action implied by "try again"?

11. Why does the route still keep the existing `"Could not save jobs"` response for non-auth insert failures?

12. What information should be logged for refresh failure, and what should not be shown to the user?

## Group 4: Test Design

13. The test uses an initial InsForge mock that would fail on late insert and a fresh mock that succeeds. What real-world timeline does this model?

14. Why does the test assert the second call to `createInsforgeServer` instead of only asserting `status === 200`?

15. What regression would still pass a response-only test but fail the explicit second-call assertion?

16. Why did the existing scorer mocks need to become `async` for typecheck, even though Vitest could run them before?

## Group 5: Architecture Tradeoffs

17. Why is this targeted fix smaller than moving Find Jobs to a background job?

18. What new state would a background job design need that the current route does not need?

19. If a background job used a service credential instead of a user access token, what RLS and auditing questions would need to be answered?

20. What signs would tell you the synchronous route design has become too expensive to keep?
