# AI Discussion Topics — Find Jobs Refresh Auth Before Save

## Group 1: Reading Failure Timelines

1. Why does the log line "Pushed 30 jobs" before `AUTH_UNAUTHORIZED` move suspicion away from the actor?
2. What other failures would produce a similar UI symptom but a different server-log timeline?
3. How would the diagnosis change if `AUTH_UNAUTHORIZED` appeared before the actor run started?

## Group 2: Auth Boundaries

4. Why can one HTTP route have more than one meaningful auth boundary?
5. What does a server client capture when it is created from cookies?
6. Why is token lifetime more important in long-running route handlers than in ordinary CRUD routes?
7. What does a refresh leeway protect against?

## Group 3: Placement of the Fix

8. Why is refreshing before late writes better than refreshing at route start?
9. Why is refreshing before late writes better than retrying after a failed insert?
10. Which late writes in the route need the refreshed client, and why?
11. What failure could happen if `jobs.insert` used the fresh client but the final `agent_runs.update` used the stale client?

## Group 4: RLS and Service Credentials

12. Why was a service/admin credential rejected for this targeted fix?
13. What authorization questions would a background worker using service credentials need to answer?
14. How does keeping the user-scoped client preserve the existing data model?

## Group 5: Test Design

15. Why is a route-seam test enough to reproduce this bug without waiting 10 minutes?
16. What does the two-client mock model?
17. Why assert the second `createInsforgeServer` call instead of only asserting `status === 200`?
18. What regression would be missed if the fresh-client call were not asserted?

## Group 6: Future Architecture

19. What new UI states would a background Find Jobs job require?
20. How would a polling flow change the responsibilities of `/api/agent/find`?
21. What tradeoffs come with keeping the synchronous route after this fix?
