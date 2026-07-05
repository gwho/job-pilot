# Feedback Loop — Find Jobs pg_stat_statements Extension

Session date: 2026-07-04
Skill: `/diagnosing-bugs`
Seam: `app/api/agent/find/route.ts` → InsForge `jobs` INSERT

---

## Bug report

**Symptom:** Searching "Sales coordinator" / "Hong Kong" shows a pink error bar:
> Could not save jobs

**Client-side error logged:**
```
[FindJobsClient] search failed: "Could not save jobs"
at components/find-jobs/FindJobsClient.tsx:100
```

The route at `app/api/agent/find/route.ts:243` returns `{ success: false, error: "Could not save jobs" }` whenever `jobsError` is truthy after the InsForge insert. The UI message was the only signal available on the client — no server error detail was surfaced.

---

## What static analysis ruled out

Before running the app, every field in the `JobInsert` payload was checked against the schema and TypeScript types:

- All column names matched `scripts/schema.sql`
- `responsibilities`, `requirements`, `nice_to_have`, `benefits` — passed as `null`; schema has no `NOT NULL`, so valid
- `match_score` — `Math.round()` always returns an integer for the `INTEGER` column
- `matched_skills` / `missing_skills` — `scoreJobs` always returns `string[]`, not null
- `job_type` — normalised to `"fulltime" | "parttime" | "contract"` before insert
- RLS: the `agent_runs` INSERT (same `user_id`, same auth context) already succeeded — so auth and the `profiles` FK were healthy
- Dedup: `source_url` was already filtered for empty/null and for duplicates before building records

Static analysis could not identify the root cause. **The actual InsForge error object was required.**

---

## Diagnostic instrumentation added

Two lines added to `app/api/agent/find/route.ts` immediately before and inside the insert failure branch:

```ts
// BEFORE the insert:
console.log("[DEBUG-find-save] inserting", records.length, "records. Sample:", {
  ...records[0],
  about_role: records[0]?.about_role?.slice(0, 80),
});

// INSIDE the if (jobsError) branch:
console.error("[DEBUG-find-save] jobsError full:", JSON.stringify(jobsError));
```

The `[DEBUG-find-save]` prefix tag ensured easy grep-based cleanup.

---

## Actual error (from InsForge postgres.logs dashboard)

The user surfaced the error from the InsForge dashboard under **postgres.logs** (not from the app terminal):

```json
{
  "event_message": "relation \"pg_stat_statements\" does not exist at character 76",
  "metadata": {
    "level": "error",
    "parsed": { "pid": "1268701" }
  }
}
```

Timestamp: Jul 03, 2026, 01:55 PM

**Error code:** `42P01` — PostgreSQL `undefined_table` error class. A SQL query was attempting to reference `pg_stat_statements` as a relation, but the extension was not installed on this database instance.

---

## Root cause

`pg_stat_statements` is a PostgreSQL extension that tracks query execution statistics. InsForge's internal PostgREST layer references it during batch INSERT operations. When the extension is absent, the batch INSERT fails at the PostgreSQL level and returns the error to the SDK caller.

This explains the asymmetry:
- Single-row inserts (`agent_runs`) and SELECT queries (`jobs` existing-URL fetch) succeeded
- The multi-row batch `jobs` INSERT failed

The extension was absent from this InsForge database instance — it had never been created.

---

## Fix applied

Ran directly against the InsForge database via the `mcp__insforge__run-raw-sql` MCP tool:

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

Result: `SQL query executed completed successfully`.

No application code change was required.

---

## Cleanup

Both `[DEBUG-find-save]` log lines were removed from `app/api/agent/find/route.ts`. The existing permanent error log was preserved:

```ts
console.error("[api/agent/find] jobs insert error:", jobsError);
```

---

## Regression test added

**File:** `__tests__/find-jobs/save-error.test.ts`

Three tests using the same `createChain` / InsForge mock pattern as `repeated-search.test.ts`. The mock returns the exact PostgreSQL error on the jobs INSERT (2nd `jobs` table call):

```ts
{
  data: null,
  error: {
    code: "42P01",
    message: 'relation "pg_stat_statements" does not exist at character 76',
  },
}
```

Tests assert:
1. HTTP status is 500
2. `{ success: false, error: "Could not save jobs" }` in response body
3. `jobs` array is not present in the error response

All 48 tests pass. Lint and build clean.
