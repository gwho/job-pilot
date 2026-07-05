# Reasoning — Find Jobs pg_stat_statements Extension

Session date: 2026-07-04
Skill: `/diagnosing-bugs`

---

## Why static analysis alone couldn't find this bug

The hardest class of bugs to diagnose from code alone are **infrastructure bugs** — failures caused by the environment the code runs in, not the code itself. This was one of them.

Every field in the `JobInsert` payload was type-correct. Every column name matched the schema. The TypeScript compiler was happy. The unit tests (which mock InsForge) were green. And yet the real app failed.

The difference between a mock and reality: the mock returns whatever you tell it to. Reality has a database server, a PostgREST layer, extensions, triggers, and configuration that no mock can replicate unless you deliberately model it.

This is why the `/diagnosing-bugs` skill mandates building a **feedback loop before forming hypotheses**. Staring at code produces theories. Running the code against the real system produces evidence. Evidence beats theories every time.

---

## What pg_stat_statements is and why InsForge needs it

`pg_stat_statements` is a PostgreSQL extension that records statistics about every SQL statement executed on the server — how many times each query ran, how long it took, how many rows it affected.

InsForge (which uses a PostgREST-based API layer) references `pg_stat_statements` internally, likely for:
- Query performance monitoring within the platform
- Analytics on which operations are expensive
- Internal health checks

This reference happens at the database level — inside SQL executed by PostgREST itself, not inside application code. When the extension doesn't exist, PostgreSQL rejects the query with:

```
relation "pg_stat_statements" does not exist at character 76
```

`42P01` is PostgreSQL's `undefined_table` error class — it fires when a query references a relation (table, view, or extension output) that doesn't exist.

---

## Why the batch INSERT failed but simpler queries didn't

This is the key asymmetry that confused the initial diagnosis:

- `agent_runs` single-row INSERT → succeeded
- `jobs` SELECT for existing URLs → succeeded
- `jobs` batch INSERT (10+ rows, 22 columns) → failed

Two plausible explanations for why only the batch INSERT triggered the extension reference:

**1. PostgREST uses pg_stat_statements for query planning on complex operations.** A batch insert with many rows and many columns may cross a threshold that triggers PostgREST's internal query analyser — single-row or read-only queries don't reach that threshold.

**2. InsForge platform-level hooks.** InsForge may attach post-INSERT hooks or triggers to certain tables for analytics purposes. The `jobs` table, being the primary data table, might have such a hook. The hook tries to record query stats, fails, and the error propagates back as an insert failure.

Without access to InsForge's internal PostgREST configuration, the exact trigger point isn't knowable from application code. What matters: the symptom is predictable once you know it — any operation that touches `pg_stat_statements` silently fails until the extension exists.

---

## The diagnostic journey: ranked hypotheses vs. actual cause

Before seeing the InsForge logs, six hypotheses were ranked:

1. DB schema mismatch — a column in the payload doesn't exist in the live DB
2. Required column missing/null — a NOT NULL column receiving null
3. RLS/user_id issue — auth session not matching `auth.uid()`
4. Duplicate source_url — unique constraint violation
5. Invalid value for constrained column — `source_provider` or `job_type` failing a CHECK
6. `match_score` shape mismatch — float vs. integer

None of these were correct. The actual cause was **a missing database extension** — a category that wasn't on the hypothesis list at all.

This is the core lesson of the `/diagnosing-bugs` skill: **form hypotheses after you have evidence, not before.** If diagnosis had started by trying to fix hypothesis #1 (removing `external_apply_url`), it would have been wrong. The debug log + dashboard lookup took minutes. Blind hypothesis-fixing would have taken hours.

---

## Why the error only appeared in postgres.logs, not the app terminal

The route logs `jobsError` with `console.error`. InsForge's SDK returns the error as a structured object like:
```ts
{ code: "42P01", message: "relation ...", details: "...", hint: "..." }
```

This object was being logged — but the app terminal output during the session wasn't shared. The user instead opened the InsForge dashboard and navigated to **postgres.logs**, which shows raw PostgreSQL error events emitted by the database engine itself.

The postgres.logs tab shows errors at the database level, not filtered through the SDK. This is a more direct signal — it shows what PostgreSQL actually rejected, with the exact SQL error code.

**Lesson for future debugging:** When InsForge/Supabase insert operations fail with a generic SDK error, check `postgres.logs` in the dashboard first. The raw error is there, even if the SDK wraps it.

---

## Why CREATE EXTENSION IF NOT EXISTS is the right fix

`CREATE EXTENSION` installs the extension into the current database. `IF NOT EXISTS` makes the statement idempotent — running it twice doesn't cause an error. This is safe to run at any time.

For `pg_stat_statements` specifically:
- It requires `shared_preload_libraries = 'pg_stat_statements'` in `postgresql.conf` — on most managed PostgreSQL services (Supabase, InsForge, RDS), this is already configured
- Once `shared_preload_libraries` is in place, `CREATE EXTENSION` just registers the extension in the database and creates the `pg_stat_statements` view
- If `shared_preload_libraries` is NOT configured, `CREATE EXTENSION` fails with a different error — that wasn't the case here (the fix succeeded)

The extension lives at the database level, not the application level. No code change, no deploy, no restart. It's a one-time database operation.

---

## The regression test: what it locks in and what it doesn't

The test in `__tests__/find-jobs/save-error.test.ts` mocks the InsForge insert to return:

```ts
{ data: null, error: { code: "42P01", message: 'relation "pg_stat_statements" does not exist...' } }
```

What this locks in:
- The route's error handling path works correctly — it doesn't crash or return 200
- The error message is the expected string `"Could not save jobs"`
- HTTP status is 500

What this does NOT prevent:
- The `pg_stat_statements` extension being dropped or removed in the future
- A new InsForge instance being set up without the extension

The test can't prevent infrastructure regressions — it can only verify the application handles DB errors gracefully. The real protection against this specific regression is runbook documentation: "after creating a new InsForge database, run `CREATE EXTENSION IF NOT EXISTS pg_stat_statements;`."

---

## The debug tag discipline

Every temporary log added during diagnosis was tagged `[DEBUG-find-save]`. This serves two purposes:

1. **Grep-based cleanup**: `grep -r "DEBUG-find-save" .` finds every log that needs to be removed — no risk of leaving a stray log behind
2. **Scope marking**: Anyone reading server output during the session knows these logs are temporary and why they exist

The permanent log `console.error("[api/agent/find] jobs insert error:", jobsError)` was already in place and was kept. It uses the route path prefix `[api/agent/find]` which is the permanent logging convention for this codebase.

---

## Concepts worth exploring further

- **PostgREST internals**: How PostgREST translates SDK calls into SQL, and which operations trigger internal system queries
- **PostgreSQL error codes**: The `42xxx` class (syntax/relation errors), `23xxx` class (integrity violations), `08xxx` class (connection errors) — knowing these speeds up diagnosis dramatically
- **InsForge dashboard logs**: `postgres.logs` vs `postgreREST.logs` vs `insforge.logs` — what each layer captures and when to check each one
- **Extension management in managed Postgres**: Which extensions come pre-loaded, which need `CREATE EXTENSION`, and which also need `shared_preload_libraries` changes
