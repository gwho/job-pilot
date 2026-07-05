# AI Discussion Topics — Find Jobs pg_stat_statements Extension

Session date: 2026-07-04
Skill: `/diagnosing-bugs`

---

## Group 1: The feedback loop principle

1. The `/diagnosing-bugs` skill says "No red-capable command, no Phase 2." What does "red-capable" mean, and why is a command that merely "doesn't crash" not enough?

2. In this session, static analysis of the code didn't reveal the bug. What category of bugs can static analysis reliably find, and what categories does it miss entirely?

3. The original bug report included a client-side error (`FindJobsClient.tsx:100`) and a UI message ("Could not save jobs"). Why was neither of these sufficient to diagnose the root cause?

4. The session tried a `curl` approach for the feedback loop but abandoned it — the route requires authentication cookies that curl doesn't have. What does this tell you about the limits of HTTP-level testing for authenticated API routes?

---

## Group 2: Infrastructure bugs vs. code bugs

5. This bug was caused by a missing PostgreSQL extension, not by application code. What's the fundamental difference between an infrastructure bug and a code bug, and why does that distinction affect where you look first?

6. The `agent_runs` INSERT (single row) and the `jobs` SELECT both succeeded, but the `jobs` INSERT (multiple rows) failed. What are two plausible reasons why different operations within the same database session could behave differently based on the same missing extension?

7. The InsForge mock in tests always returns whatever you tell it to. What's the tradeoff of mocking infrastructure dependencies in tests? What class of bugs does mocking make invisible?

8. If `pg_stat_statements` is an internal PostgREST concern, why does its absence surface as a user-facing error ("Could not save jobs") instead of being handled silently or separately?

---

## Group 3: PostgreSQL extensions

9. `pg_stat_statements` tracks query execution statistics. Why would PostgREST reference a statistics extension during a batch INSERT rather than just during monitoring or query analysis?

10. `CREATE EXTENSION IF NOT EXISTS pg_stat_statements;` worked immediately. This means `shared_preload_libraries` was already configured. What is `shared_preload_libraries` in PostgreSQL, and why do some extensions require it to be set before `CREATE EXTENSION` will work?

11. The fix was a one-time database operation — no code change, no deploy, no restart. Why can a SQL command create a new capability in a running database without restarting it?

12. If you were setting up a new InsForge database from scratch for this project, what would you add to a setup checklist to prevent this regression? Where would that checklist live in the project?

---

## Group 4: Reading database logs

13. The error appeared in InsForge's `postgres.logs` tab, not in the Next.js server terminal (where `console.error` writes). What's the difference between what `postgres.logs` captures and what the application SDK error captures?

14. The PostgreSQL error code was `42P01` (`undefined_table`). PostgreSQL organises error codes into classes: `42xxx` for syntax/relation errors, `23xxx` for integrity violations, `08xxx` for connection errors. How would knowing these classes immediately narrow your hypothesis list in a future debug session?

15. The route logs `jobsError` with `console.error` already — but the user had to go to the InsForge dashboard to find the actual error. What would make the application's own error log more useful for future diagnosis, without creating noise?

---

## Group 5: The regression test

16. The regression test mocks InsForge to return `{ code: "42P01", message: "relation 'pg_stat_statements' does not exist..." }`. What exactly does this test protect against? What would it NOT catch?

17. The test doesn't run against a real database — it uses a mock. Could you write a test that would have been RED before the extension was installed and GREEN after, without using a mock? What would that require?

18. The test asserts three things: HTTP status 500, `{ success: false, error: "Could not save jobs" }`, and no `jobs` field in the response. Why test all three rather than just the status code?

19. The existing `repeated-search.test.ts` already tests the happy path (successful insert). With that test in place, what specific gap does `save-error.test.ts` fill?
